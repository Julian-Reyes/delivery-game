import { HALF, NORTH_EXITS_X, heightAt } from '../layout';
import type { RoadPlan, Control, DesignedRoad } from './design';
import { approachRun } from './streets';

/**
 * Area 1: the favela on the hillside behind the city. Its two main roads decide how the
 * neighborhood feels, so their shape is set by hand: the Estrada zigzags up the full width
 * of the hill in long legs and hairpins, and the Subida climbs diagonally from the east
 * entrance to join it, so you can ride up one way and come down the other.
 *
 * The legs run across the slope, not up it: the hill rises about 28% northward, far more
 * than a main road may. Which side each hairpin is on is fixed here; how far up the hill
 * it sits is solved against the ground, so each leg climbs at a steady, gentle grade
 * whatever the terrain seed.
 */

const [WEST_EXIT = -30, EAST_EXIT = 90] = NORTH_EXITS_X;

/** The grade legs are laid out for, under the main road limit to leave room for bumps. */
const LEG_GRADE = 0.07;
const HAIRPIN_RADIUS = 12;
/** How far up the hill the two corners of a hairpin are apart. */
const HAIRPIN_RISE = 2 * HAIRPIN_RADIUS + 6;
/** Length of road a hairpin adds, for the height estimate. */
const HAIRPIN_LENGTH = Math.PI * HAIRPIN_RADIUS + 6;

/** The Estrada's hairpins alternate west and east; the last leg ends at the top square. */
const ESTRADA_TURNS = [-135, 70, -130, 35];
const ESTRADA_TOP_X = -40;
/**
 * Where along the Estrada's second leg the Subida may join it: west of the ravine but east
 * of the Estrada's first leg, which the Subida must not cross.
 */
const SUBIDA_JOIN_X = [-20, 10] as const;
/** Straight run into a junction, so side roads meet square on. */
const JOIN_RUN = 30;
/** Straight out of each entrance before the first bend, clear of the city's top row. */
const EXIT_RUN = 18;

interface LegEnd {
  x: number;
  z: number;
  /** Estimated road height there. */
  y: number;
}

/**
 * Where a leg from `from` towards `x` should end: the point up the hill at which the
 * ground has risen as much as the road can climb at LEG_GRADE. With `hairpin`, the ground
 * is averaged across the hairpin that follows, because the hill rises faster there than
 * the road can: the road arrives a little above the ground and leaves a little below it,
 * rather than all of the difference becoming one deep cutting.
 */
function solveLeg(
  from: LegEnd,
  x: number,
  groundAt: (x: number, z: number) => number,
  hairpin: boolean,
): LegEnd {
  const ground = (z: number): number =>
    hairpin
      ? (groundAt(x, z) + groundAt(x, z + HAIRPIN_RISE) - LEG_GRADE * HAIRPIN_LENGTH) / 2
      : groundAt(x, z);
  const gap = (z: number): number =>
    ground(z) - (from.y + LEG_GRADE * Math.hypot(x - from.x, z - from.z));
  // Legs always head a little up the hill, so the hairpin corners stay under 90 degrees.
  let low = from.z + 8;
  let high = from.z + 260;
  if (gap(low) > 0) high = low;
  for (let i = 0; i < 40 && gap(low) <= 0 && high - low > 0.1; i++) {
    const mid = (low + high) / 2;
    if (gap(mid) > 0) high = mid;
    else low = mid;
  }
  const z = (low + high) / 2;
  return { x, z, y: from.y + LEG_GRADE * Math.hypot(x - from.x, z - from.z) };
}

/** Controls for a road out of an entrance through a list of hairpin sides. */
function zigzag(
  startX: number,
  turns: readonly number[],
  groundAt: (x: number, z: number) => number,
): { controls: Control[]; end: LegEnd } {
  const controls: Control[] = [
    [startX, HALF],
    [startX, HALF + EXIT_RUN, 14],
  ];
  let at: LegEnd = {
    x: startX,
    z: HALF + EXIT_RUN,
    y: heightAt(startX, HALF) + LEG_GRADE * EXIT_RUN,
  };
  for (const x of turns) {
    const end = solveLeg(at, x, groundAt, true);
    controls.push([end.x, end.z, HAIRPIN_RADIUS]);
    controls.push([end.x, end.z + HAIRPIN_RISE, HAIRPIN_RADIUS]);
    at = { x: end.x, z: end.z + HAIRPIN_RISE, y: end.y + LEG_GRADE * HAIRPIN_LENGTH };
  }
  return { controls, end: at };
}

export interface HillsideRoads {
  estrada: DesignedRoad;
  subida: DesignedRoad;
}

export function planHillsideMainRoads(
  plan: RoadPlan,
  groundAt: (x: number, z: number) => number,
): HillsideRoads {
  const route = zigzag(WEST_EXIT, ESTRADA_TURNS, groundAt);
  const top = solveLeg(route.end, ESTRADA_TOP_X, groundAt, false);
  const estrada = plan.design({
    name: 'Estrada do Morro',
    kind: 'main',
    area: 'hillside',
    controls: [...route.controls, [top.x, top.z]],
    groundAt,
    startY: heightAt(WEST_EXIT, HALF),
  });
  const square = estrada.points[estrada.points.length - 1];
  if (square) plan.pad(square.x, square.z, 9);

  // The Subida climbs diagonally north-west from the east entrance, south of the
  // Estrada's second leg, and meets it west of the ravine wherever the two are at the same
  // height.
  const start: LegEnd = {
    x: EAST_EXIT,
    z: HALF + EXIT_RUN,
    y: heightAt(EAST_EXIT, HALF) + LEG_GRADE * EXIT_RUN,
  };
  let best: { x: number; z: number; mismatch: number } | null = null;
  for (const p of estrada.points) {
    if (p.x < SUBIDA_JOIN_X[0] || p.x > SUBIDA_JOIN_X[1] || p.z < start.z + 40) continue;
    const reach = start.y + LEG_GRADE * Math.hypot(p.x - start.x, p.z - start.z);
    const mismatch = Math.abs(p.y - reach);
    if (!best || mismatch < best.mismatch) best = { x: p.x, z: p.z, mismatch };
    // Only the second leg: stop at the east hairpin.
    if (p.x > SUBIDA_JOIN_X[1] + 40) break;
  }
  if (!best) throw new Error('Rua da Subida found nowhere to meet the Estrada');
  const join = plan.junction(estrada, best.x, best.z);
  // Meet the Estrada square on, from its downhill side, so the two road surfaces only
  // overlap across the Estrada's own width.
  const along = plan.direction(estrada, join);
  const across = { x: along.z, z: -along.x };
  const side = across.z < 0 ? 1 : -1;
  const subida = plan.design({
    name: 'Rua da Subida',
    kind: 'main',
    area: 'hillside',
    controls: [
      [EAST_EXIT, HALF],
      [EAST_EXIT, start.z, 14],
      [join.x + across.x * side * JOIN_RUN, join.z + across.z * side * JOIN_RUN, 14],
      [join.x, join.z],
    ],
    groundAt,
    startY: heightAt(EAST_EXIT, HALF),
    endY: join.y,
    level: { end: approachRun(estrada) },
  });
  return { estrada, subida };
}
