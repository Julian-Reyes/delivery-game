import { createRandom } from '../random';
import { BIKE_TURN_RADIUS, ROAD_KINDS } from './graph';
import type { RoadPoint } from './graph';
import { filletPath, fitProfile } from './design';
import type { Control, DesignedRoad, RoadPlan } from './design';
import { SegmentIndex, approachRun, clearOf } from './streets';
import type { Junctions, StreetArea } from './streets';

/**
 * Terrace lanes: the backbone of a hillside favela. Houses are built on level shelves cut
 * along the slope, and the lanes between them follow the contours, so they are traced
 * from contour lines of the ground at regular height intervals. Each one is level (no
 * grade at all), sits on the ground with almost no cut or fill, and is joined to the road
 * network by short connectors at its ends. Lanes that cannot be joined to anything are
 * dropped, so every motorcycle lane can be reached.
 */

/** Height between terrace lanes; about 25 m apart on a 28% slope, room for two house rows. */
const LEVEL_STEP = 5.5;
const GRID = 4;
const SPACING = 2;
const MIN_RUN = 40;
const PASSES = 3;
/** Terrace control points every this many samples (8 m) before rounding. */
const CONTROL_EVERY = 4;
/** Connectors from a lane's end to another road: the longest and steepest allowed. */
const CONNECT_REACH = 45;
const CONNECT_GRADE = 0.22;
/** How far a connector may turn away from the terrace's own direction, in radians. */
const MAX_JOIN_TURN = 1.5;
const PAD_RADIUS = Math.ceil(BIKE_TURN_RADIUS * 10) / 10 + 0.4;

type Point2 = { x: number; z: number };

/** Contour lines of `height` at `level` over a box, as polylines (marching squares). */
export function traceContours(
  heightAt: (x: number, z: number) => number,
  box: { x0: number; x1: number; z0: number; z1: number },
  level: number,
): Point2[][] {
  const cols = Math.ceil((box.x1 - box.x0) / GRID);
  const rows = Math.ceil((box.z1 - box.z0) / GRID);
  const h = (ix: number, iz: number): number => heightAt(box.x0 + ix * GRID, box.z0 + iz * GRID);
  const values: number[] = [];
  for (let iz = 0; iz <= rows; iz++) for (let ix = 0; ix <= cols; ix++) values.push(h(ix, iz));
  const v = (ix: number, iz: number): number => values[iz * (cols + 1) + ix] ?? 0;

  // Each crossing of a grid edge gets a key so segments can be chained into lines.
  const crossing = (ax: number, az: number, bx: number, bz: number): { key: string; p: Point2 } => {
    const va = v(ax, az);
    const vb = v(bx, bz);
    const t = (level - va) / (vb - va);
    const key = ax === bx ? `v${ax},${Math.min(az, bz)}` : `h${Math.min(ax, bx)},${az}`;
    return {
      key,
      p: { x: box.x0 + (ax + (bx - ax) * t) * GRID, z: box.z0 + (az + (bz - az) * t) * GRID },
    };
  };

  const links = new Map<string, string[]>();
  const positions = new Map<string, Point2>();
  const link = (a: { key: string; p: Point2 }, b: { key: string; p: Point2 }): void => {
    positions.set(a.key, a.p);
    positions.set(b.key, b.p);
    links.set(a.key, [...(links.get(a.key) ?? []), b.key]);
    links.set(b.key, [...(links.get(b.key) ?? []), a.key]);
  };

  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const corners: [number, number][] = [
        [ix, iz],
        [ix + 1, iz],
        [ix + 1, iz + 1],
        [ix, iz + 1],
      ];
      const edges: { key: string; p: Point2 }[] = [];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k] ?? [0, 0];
        const [bx, bz] = corners[(k + 1) % 4] ?? [0, 0];
        if (v(ax, az) >= level !== v(bx, bz) >= level) edges.push(crossing(ax, az, bx, bz));
      }
      // Two crossings: one segment. Four (a saddle): pair them in order, good enough here.
      for (let k = 0; k + 1 < edges.length; k += 2) {
        const a = edges[k];
        const b = edges[k + 1];
        if (a && b) link(a, b);
      }
    }
  }

  // Chain segments into polylines, starting from open ends first.
  const seen = new Set<string>();
  const lines: Point2[][] = [];
  const walk = (start: string): void => {
    const line: Point2[] = [];
    let current: string | undefined = start;
    let previous: string | undefined;
    while (current && !seen.has(current)) {
      seen.add(current);
      const p = positions.get(current);
      if (p) line.push(p);
      const next: string | undefined = (links.get(current) ?? []).find(
        (k) => k !== previous && !seen.has(k),
      );
      previous = current;
      current = next;
    }
    if (line.length > 1) lines.push(line);
  };
  for (const [key, neighbours] of links) if (neighbours.length === 1 && !seen.has(key)) walk(key);
  for (const key of links.keys()) if (!seen.has(key)) walk(key);
  return lines;
}

/** Evenly spaced points along a polyline. */
function resample(line: readonly Point2[], spacing: number): Point2[] {
  const out: Point2[] = [];
  const first = line[0];
  if (!first) return out;
  out.push({ ...first });
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    let d = spacing - carry;
    while (d <= length) {
      const t = d / length;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      d += spacing;
    }
    carry = length - (d - spacing);
  }
  return out;
}

/** Chaikin corner cutting: rounds the little zigzags a contour picks up from the grid. */
function smooth(line: readonly Point2[], passes: number): Point2[] {
  let current = [...line];
  for (let pass = 0; pass < passes; pass++) {
    const next: Point2[] = [];
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return current;
    next.push(first);
    for (let i = 0; i + 1 < current.length; i++) {
      const a = current[i];
      const b = current[i + 1];
      if (!a || !b) continue;
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    next.push(last);
    current = next;
  }
  return current;
}

/** Radius of the circle through three points (Infinity when straight). */
function radiusAt(a: Point2, b: Point2, c: Point2): number {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
}

export interface TerraceOptions {
  seed: number;
  area: StreetArea;
  groundAt: (x: number, z: number) => number;
  /** Every road already planned in the area; lanes keep clear of them and join them. */
  roads: readonly DesignedRoad[];
  junctions: Junctions;
  /** Only terraces between these heights. */
  minY: number;
  maxY: number;
}

export function addTerraces(plan: RoadPlan, options: TerraceOptions): DesignedRoad[] {
  const { area, groundAt, junctions } = options;
  const random = createRandom(options.seed * 16807 + 29);
  const index = new SegmentIndex();
  const roads: DesignedRoad[] = [...options.roads];
  for (const road of roads) index.addRoad(road, road.kind === 'stairs');
  const width = ROAD_KINDS.lane.width;
  const minRadius = ROAD_KINDS.lane.minRadius;
  const margin = 10;
  const box = {
    x0: area.x0 + margin,
    x1: area.x1 - margin,
    z0: area.z0 + margin,
    z1: area.z1 - margin,
  };
  const inside = (p: Point2): boolean =>
    p.x > box.x0 && p.x < box.x1 && p.z > box.z0 && p.z < box.z1;

  // Every contour level, offset by the seed so different seeds shift the terraces.
  const offset = random() * LEVEL_STEP;
  const runs: { level: number; points: Point2[] }[] = [];
  for (let level = options.minY + offset; level < options.maxY; level += LEVEL_STEP) {
    for (const line of traceContours(groundAt, box, level)) {
      const points = resample(smooth(resample(line, 4), 2), SPACING);
      // Split wherever the lane would leave the area, bend too tightly, or crowd a road.
      let run: Point2[] = [];
      const flush = (): void => {
        if (run.length * SPACING >= MIN_RUN) runs.push({ level, points: run });
        run = [];
      };
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const a = points[i - 2];
        const c = points[i + 2];
        if (!p) continue;
        const tooTight = a && c ? radiusAt(a, p, c) < minRadius * 1.4 : false;
        const previous = run[run.length - 1];
        const crowded =
          previous !== undefined &&
          !clearOf(index, previous.x, previous.z, p.x, p.z, width, false, []);
        if (!inside(p) || tooTight || crowded) {
          flush();
          continue;
        }
        run.push(p);
      }
      flush();
    }
  }

  // Longest first, so the best terraces win where two would crowd each other.
  runs.sort((a, b) => b.points.length - a.points.length);
  const added: DesignedRoad[] = [];

  // Terraces with nothing in reach yet get another chance once more lanes exist to join.
  let pending = runs;
  for (let pass = 0; pass < PASSES && pending.length > 0; pass++) {
    const retry: typeof runs = [];
    for (const run of pending) {
      // Re-check against everything accepted so far, keeping the longest clear stretch.
      let best: Point2[] = [];
      let current: Point2[] = [];
      for (const p of run.points) {
        const previous = current[current.length - 1];
        if (previous && !clearOf(index, previous.x, previous.z, p.x, p.z, width, false, [])) {
          if (current.length > best.length) best = current;
          current = [];
        }
        current.push(p);
      }
      if (current.length > best.length) best = current;
      if (best.length * SPACING < MIN_RUN) continue;

      // Join each end to the nearest road it can reach within the grade, else a turning pad.
      const level = run.level;
      const ends = [
        { at: best[0], next: best[1] },
        { at: best[best.length - 1], next: best[best.length - 2] },
      ];
      const joins: ({ road: DesignedRoad; point: RoadPoint } | null)[] = [];
      for (const { at, next } of ends) {
        if (!at || !next) {
          joins.push(null);
          continue;
        }
        const outward = Math.atan2(at.x - next.x, at.z - next.z);
        let found: { road: DesignedRoad; point: RoadPoint; run: number } | null = null;
        for (const road of roads) {
          if (road.kind === 'stairs') continue;
          for (const p of road.points) {
            const reach = Math.hypot(p.x - at.x, p.z - at.z);
            if (reach < 6 || reach > CONNECT_REACH) continue;
            const climb = Math.max(0, reach - approachRun(road));
            if (Math.abs(p.y - level) > climb * CONNECT_GRADE) continue;
            const toward = Math.atan2(p.x - at.x, p.z - at.z);
            if (
              Math.abs(Math.atan2(Math.sin(toward - outward), Math.cos(toward - outward))) >
              MAX_JOIN_TURN
            )
              continue;
            if (!junctions.spaced(road, p.x, p.z)) continue;
            const roadWidth = road.width ?? ROAD_KINDS[road.kind].width;
            const anchor = {
              road,
              x: p.x,
              z: p.z,
              radius: (width + roadWidth) / 2 + 13,
            };
            if (!clearOf(index, at.x, at.z, p.x, p.z, width, false, [anchor])) continue;
            if (!found || reach < found.run) found = { road, point: p, run: reach };
          }
        }
        joins.push(found ? { road: found.road, point: found.point } : null);
      }
      const [startJoin, endJoin] = joins;
      // A lane nobody can ride into is no use: it needs at least one way in.
      if (!startJoin && !endJoin) {
        retry.push(run);
        continue;
      }

      // A dead end needs room for its turning pad.
      const padClear = (p: Point2 | undefined): boolean =>
        p !== undefined &&
        clearOf(index, p.x - 0.01, p.z, p.x + 0.01, p.z, PAD_RADIUS * 2, false, []);
      if (!startJoin && !padClear(best[0])) continue;
      if (!endJoin && !padClear(best[best.length - 1])) continue;

      // Assemble connector in, terrace, connector out as control points, round every corner
      // to the lane's radius, and fit the heights: level along the terrace (it follows a
      // contour), a steady climb on each connector.
      const controls: Control[] = [];
      if (startJoin) controls.push([startJoin.point.x, startJoin.point.z]);
      for (let k = 0; k < best.length; k += CONTROL_EVERY) {
        const p = best[k];
        if (p) controls.push([p.x, p.z]);
      }
      const tail = best[best.length - 1];
      if (tail) controls.push([tail.x, tail.z]);
      if (endJoin) controls.push([endJoin.point.x, endJoin.point.z]);
      let path: Point2[];
      try {
        path = filletPath(controls, minRadius * 1.2);
      } catch {
        continue;
      }
      const heights = fitProfile(
        path,
        groundAt,
        ROAD_KINDS.lane.maxGrade * 0.97,
        startJoin ? startJoin.point.y : level,
        endJoin ? endJoin.point.y : level,
        {
          start: startJoin ? approachRun(startJoin.road) : 0,
          end: endJoin ? approachRun(endJoin.road) : 0,
        },
      );
      const points: RoadPoint[] = path.map((p, k) => ({ x: p.x, y: heights[k] ?? level, z: p.z }));
      const first = points[0];
      const last = points[points.length - 1];
      if (!first || !last) continue;

      const road = plan.add({ name: 'Travessa', kind: 'lane', area: area.area, points });
      if (startJoin) {
        plan.junction(startJoin.road, startJoin.point.x, startJoin.point.z);
        junctions.mark(startJoin.road, startJoin.point.x, startJoin.point.z);
      } else {
        plan.pad(first.x, first.z, PAD_RADIUS);
      }
      if (endJoin) {
        plan.junction(endJoin.road, endJoin.point.x, endJoin.point.z);
        junctions.mark(endJoin.road, endJoin.point.x, endJoin.point.z);
      } else {
        plan.pad(last.x, last.z, PAD_RADIUS);
      }
      junctions.markEnds(road);
      index.addRoad(road, false);
      roads.push(road);
      added.push(road);
    }
    pending = retry;
  }
  return added;
}
