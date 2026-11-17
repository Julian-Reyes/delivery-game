import type { AreaId, RoadGraph, RoadKind, RoadPoint, RoadSurface } from './graph';
import { ROAD_KINDS } from './graph';

/**
 * Tools for laying out roads by hand: smooth centrelines from a few control points, height
 * profiles that hug the hill without breaking a grade limit, and junctions where one
 * designed road joins another.
 */

export type Control = readonly [x: number, z: number, radius?: number];

/** Centreline points come out at most this far apart. */
const SPACING = 2;

/**
 * A smooth path through control points: straight lines joined by circular arcs. Each inner
 * control point is a corner rounded with its own radius (or `radius`). Hairpins are two
 * corners close together. Throws if a corner's arc does not fit between its neighbours.
 */
export function filletPath(
  controls: readonly Control[],
  radius: number,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const first = controls[0];
  if (!first) return out;

  // Each corner becomes: entry tangent point, arc, exit tangent point.
  const pieces: (
    | { kind: 'point'; x: number; z: number }
    | {
        kind: 'arc';
        cx: number;
        cz: number;
        r: number;
        a0: number;
        sweep: number;
      }
  )[] = [{ kind: 'point', x: first[0], z: first[1] }];
  let lastExit = { x: first[0], z: first[1] };

  for (let i = 1; i + 1 < controls.length; i++) {
    const prev = controls[i - 1];
    const corner = controls[i];
    const next = controls[i + 1];
    if (!prev || !corner || !next) continue;
    const r = corner[2] ?? radius;
    const inX = corner[0] - prev[0];
    const inZ = corner[1] - prev[1];
    const outX = next[0] - corner[0];
    const outZ = next[1] - corner[1];
    const inLength = Math.hypot(inX, inZ);
    const outLength = Math.hypot(outX, outZ);
    const ux = inX / inLength;
    const uz = inZ / inLength;
    const vx = outX / outLength;
    const vz = outZ / outLength;
    const cross = ux * vz - uz * vx;
    const deflection = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (deflection < 1e-4) {
      pieces.push({ kind: 'point', x: corner[0], z: corner[1] });
      lastExit = { x: corner[0], z: corner[1] };
      continue;
    }
    const tangent = r * Math.tan(deflection / 2);
    const before = Math.hypot(corner[0] - lastExit.x, corner[1] - lastExit.z);
    if (tangent > before + 1e-6 || tangent > outLength / 2 + 1e-6) {
      throw new Error(
        `Corner ${i} at (${corner[0]}, ${corner[1]}) needs ${tangent.toFixed(1)} m each side`,
      );
    }
    const entry = { x: corner[0] - ux * tangent, z: corner[1] - uz * tangent };
    const exit = { x: corner[0] + vx * tangent, z: corner[1] + vz * tangent };
    // Centre is to the inside of the turn.
    const side = cross > 0 ? 1 : -1;
    const cx = entry.x - uz * r * side;
    const cz = entry.z + ux * r * side;
    const a0 = Math.atan2(entry.z - cz, entry.x - cx);
    pieces.push({ kind: 'point', x: entry.x, z: entry.z });
    pieces.push({ kind: 'arc', cx, cz, r, a0, sweep: deflection * side });
    pieces.push({ kind: 'point', x: exit.x, z: exit.z });
    lastExit = exit;
  }
  const last = controls[controls.length - 1];
  if (last) pieces.push({ kind: 'point', x: last[0], z: last[1] });

  // Sample: straight runs between points, arcs by angle.
  let cursor = { x: first[0], z: first[1] };
  out.push({ ...cursor });
  const lineTo = (x: number, z: number): void => {
    const length = Math.hypot(x - cursor.x, z - cursor.z);
    const steps = Math.ceil(length / SPACING);
    for (let s = 1; s <= steps; s++) {
      out.push({
        x: cursor.x + ((x - cursor.x) * s) / steps,
        z: cursor.z + ((z - cursor.z) * s) / steps,
      });
    }
    cursor = { x, z };
  };
  for (const piece of pieces.slice(1)) {
    if (piece.kind === 'point') {
      lineTo(piece.x, piece.z);
      continue;
    }
    const steps = Math.max(2, Math.ceil((Math.abs(piece.sweep) * piece.r) / SPACING));
    for (let s = 1; s <= steps; s++) {
      const angle = piece.a0 + (piece.sweep * s) / steps;
      out.push({
        x: piece.cx + Math.cos(angle) * piece.r,
        z: piece.cz + Math.sin(angle) * piece.r,
      });
    }
    const end = out[out.length - 1];
    if (end) cursor = { x: end.x, z: end.z };
  }

  // Drop zero-length steps where a tangent point met a straight end exactly.
  return out.filter((p, i) => {
    const prev = out[i - 1];
    return !prev || Math.hypot(p.x - prev.x, p.z - prev.z) > 0.05;
  });
}

/**
 * Heights along a path that follow the ground but never climb or drop faster than
 * `maxGrade`. The ground is smoothed first so the road rides over small bumps rather than
 * copying them, and the result is smoothed again so crests do not throw the bike in the
 * air. Pinned ends (`startY`, `endY`) are held exactly.
 */
export function fitProfile(
  path: readonly { x: number; z: number }[],
  groundAt: (x: number, z: number) => number,
  maxGrade: number,
  startY?: number,
  endY?: number,
): number[] {
  const n = path.length;
  const distance: number[] = [0];
  for (let i = 1; i < n; i++) {
    const a = path[i - 1];
    const b = path[i];
    distance.push((distance[i - 1] ?? 0) + (a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0));
  }
  const ground = path.map((p) => groundAt(p.x, p.z));

  // Average the ground over 15 m either way.
  const window = 15;
  let y = ground.map((_, i) => {
    let sum = 0;
    let weight = 0;
    for (let j = i; j >= 0 && (distance[i] ?? 0) - (distance[j] ?? 0) <= window; j--) {
      sum += ground[j] ?? 0;
      weight += 1;
    }
    for (let j = i + 1; j < n && (distance[j] ?? 0) - (distance[i] ?? 0) <= window; j++) {
      sum += ground[j] ?? 0;
      weight += 1;
    }
    return sum / weight;
  });

  const limit = (values: number[]): number[] => {
    const v = values.slice();
    if (startY !== undefined) v[0] = startY;
    if (endY !== undefined) v[n - 1] = endY;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) {
        const step = ((distance[i] ?? 0) - (distance[i - 1] ?? 0)) * maxGrade;
        const prev = v[i - 1] ?? 0;
        v[i] = Math.min(prev + step, Math.max(prev - step, v[i] ?? 0));
      }
      if (endY !== undefined) v[n - 1] = endY;
      for (let i = n - 2; i >= 0; i--) {
        const step = ((distance[i + 1] ?? 0) - (distance[i] ?? 0)) * maxGrade;
        const next = v[i + 1] ?? 0;
        v[i] = Math.min(next + step, Math.max(next - step, v[i] ?? 0));
      }
      if (startY !== undefined) v[0] = startY;
    }
    return v;
  };

  y = limit(y);
  // Round off the knees between grades; averaging keeps the grade limit.
  for (let pass = 0; pass < 6; pass++) {
    const smoothed = y.map((value, i) =>
      i === 0 || i === n - 1 ? value : ((y[i - 1] ?? value) + value * 2 + (y[i + 1] ?? value)) / 4,
    );
    y = limit(smoothed);
  }
  return y;
}

export interface DesignedRoad {
  name: string;
  kind: RoadKind;
  area: AreaId;
  surface?: RoadSurface | undefined;
  width?: number | undefined;
  points: RoadPoint[];
}

/**
 * Collects designed roads, then adds them to the graph split into edges at every junction.
 * A branch joins another road at the point on it nearest the branch's end.
 */
export class RoadPlan {
  private readonly roads: DesignedRoad[] = [];
  private readonly splits = new Map<DesignedRoad, Set<number>>();
  private readonly pads = new Map<string, number>();

  add(road: DesignedRoad): DesignedRoad {
    this.roads.push(road);
    this.splits.set(road, new Set([0, road.points.length - 1]));
    return road;
  }

  /** Lay a road from control points, its heights fitted to the ground. */
  design(
    options: Omit<DesignedRoad, 'points'> & {
      controls: readonly Control[];
      radius?: number;
      groundAt: (x: number, z: number) => number;
      startY?: number;
      endY?: number;
      maxGrade?: number;
    },
  ): DesignedRoad {
    const spec = ROAD_KINDS[options.kind];
    const path = filletPath(options.controls, options.radius ?? spec.minRadius * 1.3);
    const heights = fitProfile(
      path,
      options.groundAt,
      options.maxGrade ?? spec.maxGrade * 0.97,
      options.startY,
      options.endY,
    );
    return this.add({
      name: options.name,
      kind: options.kind,
      area: options.area,
      surface: options.surface,
      width: options.width,
      points: path.map((p, i) => ({ x: p.x, y: heights[i] ?? 0, z: p.z })),
    });
  }

  /** Point on `road` nearest to (x, z), inserted as a junction. Returns it. */
  junction(road: DesignedRoad, x: number, z: number): RoadPoint {
    let best = 0;
    let bestDistance = Infinity;
    road.points.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    this.splits.get(road)?.add(best);
    const point = road.points[best];
    if (!point) throw new Error(`Road ${road.name} has no points`);
    return point;
  }

  /** Unit horizontal direction of `road` at one of its points. */
  direction(road: DesignedRoad, point: RoadPoint): { x: number; z: number } {
    const i = road.points.indexOf(point);
    const before = road.points[Math.max(0, i - 2)];
    const after = road.points[Math.min(road.points.length - 1, i + 2)];
    if (i < 0 || !before || !after) throw new Error(`Point is not on road ${road.name}`);
    const length = Math.hypot(after.x - before.x, after.z - before.z) || 1;
    return { x: (after.x - before.x) / length, z: (after.z - before.z) / length };
  }

  /** Give the node at a point a paved turning pad (dead ends, small squares). */
  pad(x: number, z: number, radius: number): void {
    this.pads.set(`${x.toFixed(2)},${z.toFixed(2)}`, radius);
  }

  commit(graph: RoadGraph): void {
    for (const road of this.roads) {
      const indices = [...(this.splits.get(road) ?? [])].sort((a, b) => a - b);
      const nodeAt = (index: number): number => {
        const p = road.points[index];
        if (!p) throw new Error(`Road ${road.name} has no point ${index}`);
        const pad = this.pads.get(`${p.x.toFixed(2)},${p.z.toFixed(2)}`) ?? 0;
        return graph.node(p.x, p.y, p.z, { pad });
      };
      for (let k = 1; k < indices.length; k++) {
        const from = indices[k - 1];
        const to = indices[k];
        if (from === undefined || to === undefined || to <= from) continue;
        graph.edge(nodeAt(from), nodeAt(to), road.points.slice(from + 1, to), {
          kind: road.kind,
          area: road.area,
          surface: road.surface,
          width: road.width,
          name: road.name,
        });
      }
    }
  }
}
