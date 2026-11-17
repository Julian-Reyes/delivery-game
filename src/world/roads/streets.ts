import { createRandom } from '../random';
import { BIKE_TURN_RADIUS, ROAD_KINDS } from './graph';
import type { AreaId, RoadKind, RoadPoint } from './graph';
import { filletPath, fitProfile } from './design';
import type { Control, DesignedRoad, RoadPlan } from './design';
import { ROAD_SHOULDER } from '../terrain';

/**
 * Grows the small streets of a favela from its main roads: secondary streets, lanes and
 * alleys that wind along the hillside, loop back into other roads where the heights allow,
 * or end in a small turning space; then stairs between roads at different heights.
 *
 * Every step of every street is checked as it grows: it must stay on the ground (no deep
 * cuttings), within its kind's grade, inside the area, and far enough from every other
 * road to leave room for a row of houses. Deterministic for a seed.
 */

export interface StreetArea {
  area: AreaId;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
  road: DesignedRoad;
  pedestrian: boolean;
}

const STEP = 8;
const TURNS = [-0.5, -0.25, 0, 0.25, 0.5];
/** A new street heads straight out this far before it may turn, to get clear of its host. */
const LEAVE_STEPS = 3;
const LEAVE_TURNS = [-0.1, 0, 0.1];
/** Deepest cutting or highest fill a growing street may need at any step. */
const MAX_CUT = 3;
/** Room between the edges of two roads for a row of houses (back to back or facing). */
const HOUSE_ROOM = 8;
/**
 * Pedestrian stairs squeeze between houses, but must stay out of other roads' flat beds
 * (half-width plus shoulder), or the terrain cannot be cut for both.
 */
const STAIR_ROOM = ROAD_SHOULDER + 1;
const HASH_CELL = 12;
/** Clearance is checked in pieces this long. */
const PIECE = 2;
/** Junctions on the same road at least this far apart. */
const JUNCTION_SPACING = 22;
/** No street starts this close to either end of the road it grows from. */
const END_CLEARANCE = 30;
const PAD_RADIUS = Math.ceil(BIKE_TURN_RADIUS * 10) / 10 + 0.4;
/** Level landing at each end of a stair flight, beyond the road's own approach. */
const STAIR_LANDING = 4;
/** Stairways at least this far apart at either end. */
const STAIR_SPACING = 30;
const MAX_STAIR_GRADE = 0.75;

/**
 * How far a road joining `road` runs level before it may climb: across that road's
 * half-width and the flat shoulder the terrain keeps beside it.
 */
export function approachRun(road: DesignedRoad): number {
  return (road.width ?? ROAD_KINDS[road.kind].width) / 2 + ROAD_SHOULDER + 0.5;
}

export class SegmentIndex {
  private readonly cells = new Map<number, Segment[]>();

  private key(ix: number, iz: number): number {
    return (ix + 4000) * 8000 + (iz + 4000);
  }

  add(segment: Segment): void {
    const pad = segment.width / 2 + HOUSE_ROOM;
    const ix0 = Math.floor((Math.min(segment.ax, segment.bx) - pad) / HASH_CELL);
    const ix1 = Math.floor((Math.max(segment.ax, segment.bx) + pad) / HASH_CELL);
    const iz0 = Math.floor((Math.min(segment.az, segment.bz) - pad) / HASH_CELL);
    const iz1 = Math.floor((Math.max(segment.az, segment.bz) + pad) / HASH_CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = this.key(ix, iz);
        let bucket = this.cells.get(k);
        if (!bucket) this.cells.set(k, (bucket = []));
        bucket.push(segment);
      }
    }
  }

  addRoad(road: DesignedRoad, pedestrian: boolean): void {
    const width = road.width ?? ROAD_KINDS[road.kind].width;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      if (a && b) this.add({ ax: a.x, az: a.z, bx: b.x, bz: b.z, width, road, pedestrian });
    }
  }

  /** Segments near a box, each once. */
  near(x0: number, z0: number, x1: number, z1: number): Set<Segment> {
    const found = new Set<Segment>();
    for (let ix = Math.floor(x0 / HASH_CELL); ix <= Math.floor(x1 / HASH_CELL); ix++) {
      for (let iz = Math.floor(z0 / HASH_CELL); iz <= Math.floor(z1 / HASH_CELL); iz++) {
        for (const segment of this.cells.get(this.key(ix, iz)) ?? []) found.add(segment);
      }
    }
    return found;
  }
}

function pointToSegment(px: number, pz: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const length2 = dx * dx + dz * dz;
  const t =
    length2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / length2)) : 0;
  return Math.hypot(px - (s.ax + dx * t), pz - (s.az + dz * t));
}

function segmentGap(ax: number, az: number, bx: number, bz: number, s: Segment): number {
  // Two segments either cross (gap 0) or are closest at one of the four endpoints.
  const cross = (ux: number, uz: number, vx: number, vz: number): number => ux * vz - uz * vx;
  const d1 = cross(bx - ax, bz - az, s.ax - ax, s.az - az);
  const d2 = cross(bx - ax, bz - az, s.bx - ax, s.bz - az);
  const d3 = cross(s.bx - s.ax, s.bz - s.az, ax - s.ax, az - s.az);
  const d4 = cross(s.bx - s.ax, s.bz - s.az, bx - s.ax, bz - s.az);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const self: Segment = { ...s, ax, az, bx, bz };
  return Math.min(
    pointToSegment(ax, az, s),
    pointToSegment(bx, bz, s),
    pointToSegment(s.ax, s.az, self),
    pointToSegment(s.bx, s.bz, self),
  );
}

/** A junction a new street hangs off: it may come close to that road near that point. */
interface Anchor {
  road: DesignedRoad;
  x: number;
  z: number;
  radius: number;
}

/**
 * Whether a straight run is far enough from every road, except near the junctions it is
 * allowed to approach. Checked in short pieces, so only the part near a junction is excused.
 */
export function clearOf(
  index: SegmentIndex,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  width: number,
  pedestrian: boolean,
  anchors: readonly Anchor[],
): boolean {
  const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / PIECE));
  for (let k = 0; k < pieces; k++) {
    const t0 = k / pieces;
    const t1 = (k + 1) / pieces;
    if (
      !clearPiece(
        index,
        ax + (bx - ax) * t0,
        az + (bz - az) * t0,
        ax + (bx - ax) * t1,
        az + (bz - az) * t1,
        width,
        pedestrian,
        anchors,
      )
    ) {
      return false;
    }
  }
  return true;
}

function clearPiece(
  index: SegmentIndex,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  width: number,
  pedestrian: boolean,
  anchors: readonly Anchor[],
): boolean {
  const reach = width / 2 + HOUSE_ROOM + 8;
  for (const s of index.near(
    Math.min(ax, bx) - reach,
    Math.min(az, bz) - reach,
    Math.max(ax, bx) + reach,
    Math.max(az, bz) + reach,
  )) {
    const room = pedestrian || s.pedestrian ? STAIR_ROOM : HOUSE_ROOM;
    const needed = (width + s.width) / 2 + room;
    if (segmentGap(ax, az, bx, bz, s) >= needed) continue;
    const excused = anchors.some(
      (anchor) =>
        anchor.road === s.road &&
        Math.hypot(ax - anchor.x, az - anchor.z) < anchor.radius &&
        Math.hypot(bx - anchor.x, bz - anchor.z) < anchor.radius,
    );
    if (!excused) return false;
  }
  return true;
}

export interface StreetOptions {
  seed: number;
  area: StreetArea;
  groundAt: (x: number, z: number) => number;
  /** Roads the streets may grow from, already in the plan. */
  trunks: readonly DesignedRoad[];
  /** How many street starts to try along each trunk, per 100 m. */
  density: number;
  junctions: Junctions;
}

/**
 * Where roads already meet, so new junctions keep a sensible distance from each other and
 * from road ends. Shared by the streets and the stairs.
 */
export class Junctions {
  private readonly points = new Map<DesignedRoad, { x: number; z: number }[]>();

  spaced(road: DesignedRoad, x: number, z: number): boolean {
    return (this.points.get(road) ?? []).every(
      (j) => Math.hypot(j.x - x, j.z - z) >= JUNCTION_SPACING,
    );
  }

  mark(road: DesignedRoad, x: number, z: number): void {
    const list = this.points.get(road) ?? [];
    list.push({ x, z });
    this.points.set(road, list);
  }

  markEnds(road: DesignedRoad): void {
    const first = road.points[0];
    const last = road.points[road.points.length - 1];
    if (first) this.mark(road, first.x, first.z);
    if (last) this.mark(road, last.x, last.z);
  }
}

interface Tip {
  x: number;
  z: number;
  y: number;
  heading: number;
}

/** Direction of a road at one of its points, as a heading (0 = +z, π/2 = +x). */
function headingAt(points: readonly RoadPoint[], i: number): number {
  const a = points[Math.max(0, i - 2)];
  const b = points[Math.min(points.length - 1, i + 2)];
  if (!a || !b) return 0;
  return Math.atan2(b.x - a.x, b.z - a.z);
}

/** How much a road bends around a point, in radians over about 24 m. */
function bendAt(points: readonly RoadPoint[], i: number): number {
  const before = headingAt(points, Math.max(2, i - 6));
  const after = headingAt(points, Math.min(points.length - 3, i + 6));
  return Math.abs(Math.atan2(Math.sin(after - before), Math.cos(after - before)));
}

export function growStreets(plan: RoadPlan, options: StreetOptions): DesignedRoad[] {
  const { area, groundAt } = options;
  const random = createRandom(options.seed * 48271 + 11);
  const index = new SegmentIndex();
  for (const trunk of options.trunks) index.addRoad(trunk, false);
  const added: DesignedRoad[] = [];

  const inside = (x: number, z: number, margin: number): boolean =>
    x > area.x0 + margin && x < area.x1 - margin && z > area.z0 + margin && z < area.z1 - margin;

  const { junctions } = options;
  const spacedFrom = (road: DesignedRoad, x: number, z: number): boolean =>
    junctions.spaced(road, x, z);
  const markJunction = (road: DesignedRoad, x: number, z: number): void => {
    junctions.mark(road, x, z);
  };
  for (const trunk of options.trunks) junctions.markEnds(trunk);

  /**
   * Grow one street from a point on `host`. Returns null if it came out too short or
   * could not be fitted.
   */
  const grow = (host: DesignedRoad, start: RoadPoint, heading: number, kind: RoadKind) => {
    const spec = ROAD_KINDS[kind];
    const width = spec.width;
    const hostWidth = host.width ?? ROAD_KINDS[host.kind].width;
    const startAnchor: Anchor = {
      road: host,
      x: start.x,
      z: start.z,
      radius: (width + hostWidth) / 2 + HOUSE_ROOM + 4,
    };
    // Most streets wander along the slope at a gentle grade; some climb.
    const targetGrade = (random() < 0.3 ? 0.6 : 0.15) * spec.maxGrade * (random() < 0.5 ? -1 : 1);
    const maxLength = 50 + random() * 130;
    const tip: Tip = { x: start.x, z: start.z, y: start.y, heading };
    // Main roads often run in a cutting; a street may start in it and climb out.
    const startCut = Math.abs(groundAt(start.x, start.z) - start.y);
    const allowedCut = (along: number): number => Math.max(MAX_CUT, startCut + 1 - along * 0.15);
    const controls: Control[] = [[start.x, start.z]];
    let length = 0;

    while (length < maxLength) {
      let best: (Tip & { score: number }) | null = null;
      for (const turn of length < LEAVE_STEPS * STEP ? LEAVE_TURNS : TURNS) {
        const h = tip.heading + turn + (random() - 0.5) * 0.15;
        const x = tip.x + Math.sin(h) * STEP;
        const z = tip.z + Math.cos(h) * STEP;
        if (!inside(x, z, 6)) continue;
        const ground = groundAt(x, z);
        const climb = Math.max(
          -spec.maxGrade * STEP * 0.9,
          Math.min(spec.maxGrade * STEP * 0.9, ground - tip.y),
        );
        const y = tip.y + climb;
        if (Math.abs(ground - y) > allowedCut(length + STEP)) continue;
        if (!clearOf(index, tip.x, tip.z, x, z, width, false, [startAnchor])) continue;
        const score =
          Math.abs(ground - (tip.y + targetGrade * STEP)) + Math.abs(turn) * 2 + random() * 0.8;
        if (!best || score < best.score) best = { x, z, y, heading: h, score };
      }
      if (!best) break;
      controls.push([best.x, best.z]);
      tip.x = best.x;
      tip.z = best.z;
      tip.y = best.y;
      tip.heading = best.heading;
      length += STEP;
    }
    if (length < 32) return null;

    // Finish: join a road just ahead if the heights allow, otherwise a turning space.
    let end: { road: DesignedRoad; point: RoadPoint } | null = null;
    for (const s of index.near(tip.x - 30, tip.z - 30, tip.x + 30, tip.z + 30)) {
      if (s.pedestrian || s.road === host) continue;
      const candidates = s.road.points.filter((p) => Math.hypot(p.x - tip.x, p.z - tip.z) < 28);
      for (const p of candidates) {
        const run = Math.hypot(p.x - tip.x, p.z - tip.z);
        if (run < 8) continue;
        // Arrive roughly head on, not doubling back.
        const toward = Math.atan2(p.x - tip.x, p.z - tip.z);
        if (
          Math.abs(Math.atan2(Math.sin(toward - tip.heading), Math.cos(toward - tip.heading))) > 0.7
        )
          continue;
        const climb = Math.max(0, run - approachRun(s.road));
        if (Math.abs(p.y - tip.y) > climb * spec.maxGrade * 0.8) continue;
        if (!spacedFrom(s.road, p.x, p.z)) continue;
        const otherWidth = s.road.width ?? ROAD_KINDS[s.road.kind].width;
        const endAnchor: Anchor = {
          road: s.road,
          x: p.x,
          z: p.z,
          radius: (width + otherWidth) / 2 + HOUSE_ROOM + 4,
        };
        if (!clearOf(index, tip.x, tip.z, p.x, p.z, width, false, [startAnchor, endAnchor]))
          continue;
        if (!end || run < Math.hypot(end.point.x - tip.x, end.point.z - tip.z))
          end = { road: s.road, point: p };
      }
    }

    let path: { x: number; z: number }[];
    const finalControls: Control[] = end ? [...controls, [end.point.x, end.point.z]] : controls;
    try {
      path = filletPath(finalControls, spec.minRadius * 1.2);
    } catch {
      return null;
    }
    if (!end) {
      // The turning space needs room too.
      const pad = PAD_RADIUS + HOUSE_ROOM / 2;
      for (const s of index.near(
        tip.x - pad - 8,
        tip.z - pad - 8,
        tip.x + pad + 8,
        tip.z + pad + 8,
      )) {
        if (pointToSegment(tip.x, tip.z, s) < pad + s.width / 2) return null;
      }
    }
    const heights = fitProfile(path, groundAt, spec.maxGrade * 0.97, start.y, end?.point.y, {
      start: approachRun(host),
      end: end ? approachRun(end.road) : 0,
    });
    // The fitted profile must still sit on the ground.
    let along = 0;
    for (const [i, p] of path.entries()) {
      const before = path[i - 1];
      if (before) along += Math.hypot(p.x - before.x, p.z - before.z);
      if (Math.abs(groundAt(p.x, p.z) - (heights[i] ?? 0)) > allowedCut(along) + 1.5) return null;
    }

    const road = plan.add({
      name: kind === 'secondary' ? 'Rua' : kind === 'lane' ? 'Travessa' : 'Beco',
      kind,
      area: area.area,
      points: path.map((p, i) => ({ x: p.x, y: heights[i] ?? 0, z: p.z })),
    });
    // Commit the junctions now that the street is accepted.
    plan.junction(host, start.x, start.z);
    markJunction(host, start.x, start.z);
    if (end) {
      plan.junction(end.road, end.point.x, end.point.z);
      markJunction(end.road, end.point.x, end.point.z);
      markJunction(road, end.point.x, end.point.z);
    } else {
      plan.pad(tip.x, tip.z, PAD_RADIUS);
      // filletPath ends exactly on the last control, so the pad sits on the end node.
      const last = road.points[road.points.length - 1];
      if (last) plan.pad(last.x, last.z, PAD_RADIUS);
    }
    junctions.markEnds(road);
    index.addRoad(road, false);
    added.push(road);
    return road;
  };

  /** Try street starts along a road, both sides, on its straighter stretches. */
  const sprout = (host: DesignedRoad, kinds: readonly RoadKind[]) => {
    const spacing = 100 / options.density;
    let next = spacing * (0.3 + random() * 0.7);
    let hostLength = 0;
    for (let i = 1; i < host.points.length; i++) {
      const a = host.points[i - 1];
      const b = host.points[i];
      if (a && b) hostLength += Math.hypot(b.x - a.x, b.z - a.z);
    }
    let travelled = 0;
    for (let i = 3; i < host.points.length - 3; i++) {
      const a = host.points[i - 1];
      const p = host.points[i];
      if (!a || !p) continue;
      travelled += Math.hypot(p.x - a.x, p.z - a.z);
      if (travelled < next) continue;
      // Keep clear of the host's own ends: entrances, junctions and squares.
      if (travelled < END_CLEARANCE || hostLength - travelled < END_CLEARANCE) continue;
      next = travelled + spacing * (0.6 + random() * 0.8);
      if (bendAt(host.points, i) > 0.35 || !spacedFrom(host, p.x, p.z) || !inside(p.x, p.z, 8))
        continue;
      const side = random() < 0.5 ? 1 : -1;
      const out = headingAt(host.points, i) + side * (Math.PI / 2 + (random() - 0.5) * 0.5);
      const kind = kinds[Math.floor(random() * kinds.length)] ?? 'lane';
      grow(host, p, out, kind);
    }
  };

  for (const trunk of options.trunks) sprout(trunk, ['secondary', 'lane', 'lane']);
  // Second generation: lanes and alleys off the first streets.
  for (const street of [...added]) sprout(street, ['lane', 'alley']);

  return added;
}

/**
 * Pedestrian stairs between roads at different heights: short straight flights where the
 * hill makes riding round a long way. Each must clear every other road.
 */
export function addStairs(
  plan: RoadPlan,
  roads: readonly DesignedRoad[],
  options: {
    seed: number;
    area: StreetArea;
    groundAt: (x: number, z: number) => number;
    junctions: Junctions;
  },
): DesignedRoad[] {
  const random = createRandom(options.seed * 69621 + 3);
  const index = new SegmentIndex();
  for (const road of roads) index.addRoad(road, false);
  const width = ROAD_KINDS.stairs.width;
  const used: { x: number; z: number }[] = [];
  const added: DesignedRoad[] = [];

  for (const from of roads) {
    for (let i = 4; i < from.points.length - 4; i += 3 + Math.floor(random() * 4)) {
      const a = from.points[i];
      if (!a || used.some((u) => Math.hypot(u.x - a.x, u.z - a.z) < STAIR_SPACING)) continue;
      if (!options.junctions.spaced(from, a.x, a.z)) continue;
      // The nearest point on another road uphill, close enough for a flight of stairs.
      let best: { road: DesignedRoad; point: RoadPoint; run: number } | null = null;
      for (const to of roads) {
        if (to === from) continue;
        for (const b of to.points) {
          const run = Math.hypot(b.x - a.x, b.z - a.z);
          if (run < 14 || run > 120 || b.y - a.y < 5) continue;
          if (!options.junctions.spaced(to, b.x, b.z)) continue;
          if (!best || run < best.run) best = { road: to, point: b, run };
        }
      }
      if (!best) continue;
      const b = best.point;
      if (used.some((u) => Math.hypot(u.x - b.x, u.z - b.z) < STAIR_SPACING)) continue;
      // One terrain cell further than a road would, since the flight drops away steeply.
      const fromLevel = approachRun(from) + STAIR_LANDING;
      const toLevel = approachRun(best.road) + STAIR_LANDING;
      const flightRun = best.run - fromLevel - toLevel;
      // No flight steeper than a real stairway, about 37 degrees.
      if (flightRun < 6 || (b.y - a.y) / flightRun > MAX_STAIR_GRADE) continue;
      const anchors: Anchor[] = [
        { road: from, x: a.x, z: a.z, radius: fromLevel + 4 },
        { road: best.road, x: b.x, z: b.z, radius: toLevel + 4 },
      ];
      if (!clearOf(index, a.x, a.z, b.x, b.z, width, true, anchors)) continue;
      // Level across each road's width and shoulder, then a straight flight between, which
      // must not bury itself or float far off the hill.
      const steps = Math.ceil(best.run / 2);
      const points: RoadPoint[] = [];
      let fits = true;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const d = t * best.run;
        const flight = Math.min(1, Math.max(0, (d - fromLevel) / (best.run - fromLevel - toLevel)));
        const y = a.y + (b.y - a.y) * flight;
        if (Math.abs(options.groundAt(x, z) - y) > 4) fits = false;
        points.push({ x, y, z });
      }
      if (!fits) continue;
      const stairs = plan.add({
        name: 'Escadaria',
        kind: 'stairs',
        area: options.area.area,
        points,
      });
      plan.junction(from, a.x, a.z);
      plan.junction(best.road, b.x, b.z);
      options.junctions.mark(from, a.x, a.z);
      options.junctions.mark(best.road, b.x, b.z);
      index.addRoad(stairs, true);
      used.push({ x: a.x, z: a.z }, { x: b.x, z: b.z });
      added.push(stairs);
    }
  }
  return added;
}
