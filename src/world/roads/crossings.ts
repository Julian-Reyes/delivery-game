import { createRandom } from '../random';
import { ROAD_KINDS } from './graph';
import type { RoadPoint } from './graph';
import { fitProfile, filletPath } from './design';
import type { DesignedRoad, RoadPlan } from './design';
import { SegmentIndex, approachRun, clearOf } from './streets';
import type { Junctions, StreetArea } from './streets';

/**
 * Cross streets: short, straight streets that cut across a main road between its legs,
 * so the zigzag is crossed by streets every so often instead of only being joined at its
 * ends. Where the hill allows, a street continues on the other side of the main road too,
 * making a four-way crossing. Run before the terrace lanes, which then fill around them.
 */

const MIN_RUN = 22;
const MAX_RUN = 140;
/** Cross streets climb steadily; secondary width up to this grade, lane above it. */
const SECONDARY_GRADE = 0.15;
const LANE_GRADE = 0.22;
/** Along the main road, crossings at least this far apart. */
const SPACING = 55;
/** A crossing must leave its road within this angle of square on. */
const MAX_SKEW = 1.0;

interface Target {
  road: DesignedRoad;
  point: RoadPoint;
  index: number;
  run: number;
}

function headingAt(points: readonly RoadPoint[], i: number): number {
  const a = points[Math.max(0, i - 2)];
  const b = points[Math.min(points.length - 1, i + 2)];
  if (!a || !b) return 0;
  return Math.atan2(b.x - a.x, b.z - a.z);
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Arc length from the start of a road to each of its points. */
function chainage(points: readonly RoadPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    out.push((out[i - 1] ?? 0) + (a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0));
  }
  return out;
}

export interface CrossingOptions {
  seed: number;
  area: StreetArea;
  groundAt: (x: number, z: number) => number;
  /** The main roads to cross; crossings join one part of them to another. */
  mains: readonly DesignedRoad[];
  junctions: Junctions;
}

export function addCrossStreets(plan: RoadPlan, options: CrossingOptions): DesignedRoad[] {
  const { mains, junctions, groundAt } = options;
  const random = createRandom(options.seed * 40692 + 17);
  const index = new SegmentIndex();
  for (const road of mains) index.addRoad(road, false);
  const lengths = new Map(mains.map((road) => [road, chainage(road.points)]));
  const added: DesignedRoad[] = [];

  /** The best place on another stretch of main road to cross to, off one side of `from`. */
  const findTarget = (from: DesignedRoad, i: number, side: number): Target | null => {
    const a = from.points[i];
    if (!a) return null;
    const out = headingAt(from.points, i) + (side * Math.PI) / 2;
    const fromChainage = lengths.get(from)?.[i] ?? 0;
    let best: Target | null = null;
    for (const road of mains) {
      const along = lengths.get(road) ?? [];
      for (let j = 2; j < road.points.length - 2; j++) {
        const b = road.points[j];
        if (!b) continue;
        // Not the same stretch: a crossing joins two different legs.
        if (road === from && Math.abs((along[j] ?? 0) - fromChainage) < MAX_RUN * 2) continue;
        const run = Math.hypot(b.x - a.x, b.z - a.z);
        if (run < MIN_RUN || run > MAX_RUN) continue;
        if (Math.abs(wrap(Math.atan2(b.x - a.x, b.z - a.z) - out)) > MAX_SKEW) continue;
        // Arrive square on as well.
        const arrive = headingAt(road.points, j);
        const into = Math.atan2(a.x - b.x, a.z - b.z);
        const skew = Math.abs(Math.abs(wrap(into - arrive)) - Math.PI / 2);
        if (skew > MAX_SKEW) continue;
        const climb = run - approachRun(from) - approachRun(road);
        if (climb <= 6 || Math.abs(b.y - a.y) > climb * LANE_GRADE) continue;
        if (!junctions.spaced(road, b.x, b.z)) continue;
        if (!best || run < best.run) best = { road, point: b, index: j, run };
      }
    }
    return best;
  };

  /** Lay a crossing from a point on one main road to a target on another. */
  const build = (from: DesignedRoad, a: RoadPoint, target: Target): DesignedRoad | null => {
    const b = target.point;
    const flat = Math.abs(b.y - a.y) / (target.run - approachRun(from) - approachRun(target.road));
    const kind = flat <= SECONDARY_GRADE ? 'secondary' : 'lane';
    const width = ROAD_KINDS[kind].width;
    const anchors = [
      { road: from, x: a.x, z: a.z, radius: approachRun(from) + width + 6 },
      { road: target.road, x: b.x, z: b.z, radius: approachRun(target.road) + width + 6 },
    ];
    if (!clearOf(index, a.x, a.z, b.x, b.z, width, false, anchors)) return null;
    const path = filletPath(
      [
        [a.x, a.z],
        [b.x, b.z],
      ],
      ROAD_KINDS[kind].minRadius,
    );
    const heights = fitProfile(path, groundAt, ROAD_KINDS[kind].maxGrade * 0.97, a.y, b.y, {
      start: approachRun(from),
      end: approachRun(target.road),
    });
    // A straight cut across the slope must still sit on the hill, not tunnel through it.
    for (const [k, p] of path.entries()) {
      if (Math.abs(groundAt(p.x, p.z) - (heights[k] ?? 0)) > 6) return null;
    }
    const road = plan.add({
      name: kind === 'secondary' ? 'Rua' : 'Travessa',
      kind,
      area: options.area.area,
      points: path.map((p, k) => ({ x: p.x, y: heights[k] ?? 0, z: p.z })),
    });
    plan.junction(from, a.x, a.z);
    plan.junction(target.road, b.x, b.z);
    junctions.mark(from, a.x, a.z);
    junctions.mark(target.road, b.x, b.z);
    junctions.markEnds(road);
    index.addRoad(road, false);
    added.push(road);
    return road;
  };

  for (const from of mains) {
    const along = lengths.get(from) ?? [];
    let lastCrossing = -Infinity;
    for (let i = 6; i < from.points.length - 6; i += 3) {
      const a = from.points[i];
      const here = along[i] ?? 0;
      if (!a || here - lastCrossing < SPACING || here < 35) continue;
      // Straight stretches only: no crossings in a hairpin.
      const bend = Math.abs(wrap(headingAt(from.points, i + 6) - headingAt(from.points, i - 6)));
      if (bend > 0.3 || !junctions.spaced(from, a.x, a.z)) continue;
      const sides = random() < 0.5 ? [1, -1] : [-1, 1];
      let crossed = false;
      for (const side of sides) {
        const target = findTarget(from, i, side);
        if (target && build(from, a, target)) crossed = true;
      }
      if (crossed) lastCrossing = here;
    }
  }
  return added;
}
