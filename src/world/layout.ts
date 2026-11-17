/**
 * The neighborhood as plain data and pure functions: where the streets are, how high the
 * ground is, and what each patch of ground is made of. No three.js or Rapier in here, so
 * rendering, physics and (later) traffic and orders all read the same source of truth.
 *
 * Axes: +x east, +z north (uphill), y up. The sea is to the south. Units are metres.
 *
 * Everything sits on a grid of CELL-sized squares so that road and sidewalk edges land
 * exactly on cell boundaries.
 */

export const CELL = 2.5;
/** The map spans -HALF..HALF on both x and z. */
export const HALF = 150;
export const CELLS = (HALF * 2) / CELL;

export const ROAD_HALF = 5;
export const SIDEWALK = 2.5;
export const CORRIDOR_HALF = ROAD_HALF + SIDEWALK;
/** How far sidewalks and lots sit above the road surface. */
export const CURB = 0.14;

export type Surface = 'asphalt' | 'cobble' | 'sidewalk' | 'mosaic' | 'sand' | 'lot' | 'grass';

/** Seafront: sand, then the mosaic promenade, then the avenue. All flat at sea level. */
export const SAND_EDGE_Z = -115;
export const AVENUE_Z_MIN = -107.5;
export const AVENUE_Z_MAX = -92.5;
export const AVENUE_Z = (AVENUE_Z_MIN + AVENUE_Z_MAX) / 2;
/** North edge of the avenue's sidewalk, where the first row of buildings starts. */
export const SEAFRONT_Z_MAX = -90;
export const SEA_LEVEL = -0.6;

export interface CrossStreet {
  /** Centre line. Cross streets run east–west and are level across their width. */
  z: number;
  /** Ground height at x = 0. */
  height: number;
  surface: 'asphalt' | 'cobble';
}

export const CROSS_STREETS: readonly CrossStreet[] = [
  { z: -40, height: 5, surface: 'asphalt' },
  { z: 20, height: 13, surface: 'cobble' },
  { z: 80, height: 20, surface: 'asphalt' },
  { z: 135, height: 28, surface: 'asphalt' },
];

/** Centre lines of the hill streets, which run north–south and climb. */
export const HILL_STREETS_X: readonly number[] = [-90, -30, 30, 90];

/** Cross streets stop at the outer edge of the outermost hill streets. */
const CROSS_ROAD_X_LIMIT = 95;
const CROSS_CORRIDOR_X_LIMIT = 97.5;
/** Hill streets run from the avenue to the far edge of the top cross street. */
const HILL_ROAD_Z_MAX = 140;
const HILL_CORRIDOR_Z_MAX = 142.5;
export const NORTH_ROW_Z = HILL_CORRIDOR_Z_MAX;

/**
 * Hill streets that carry on north through the top row of buildings and out of the city
 * into the hillside. Beyond the top cross street they climb gently instead of following
 * the steep bank behind the city.
 */
export const NORTH_EXITS_X: readonly number[] = [-30, 90];
const EXIT_GRADE = 0.1;

/** The east side of the hill is this much higher (and the west lower) than the middle. */
const EAST_GAIN = 0.3;
const SAND_SLOPE = 0.03;
const BACK_HILL_SLOPE = 0.6;

/** The one block left open as a park. */
export const PARK = { x0: -22.5, x1: 22.5, z0: -32.5, z1: 12.5 } as const;

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** Flat stretches of the south–north profile, in order. Slopes join them. */
const TERRACES: readonly { z0: number; z1: number; height: number }[] = [
  { z0: SAND_EDGE_Z, z1: SEAFRONT_Z_MAX, height: 0 },
  ...CROSS_STREETS.map((street) => ({
    z0: street.z - CORRIDOR_HALF,
    z1: street.z + CORRIDOR_HALF,
    height: street.height,
  })),
];

/** Ground height along the middle of the map (x = 0) as a function of z. */
function profile(z: number): number {
  const first = TERRACES[0];
  const last = TERRACES[TERRACES.length - 1];
  if (!first || !last) return 0;

  if (z < first.z0) return (z - first.z0) * SAND_SLOPE;
  if (z > last.z1) return last.height + (z - last.z1) * BACK_HILL_SLOPE;

  for (let i = 0; i < TERRACES.length; i++) {
    const terrace = TERRACES[i];
    if (!terrace) continue;
    if (z <= terrace.z1) return terrace.height;
    const next = TERRACES[i + 1];
    if (next && z < next.z0) {
      const t = (z - terrace.z1) / (next.z0 - terrace.z1);
      return terrace.height + (next.height - terrace.height) * smoothstep(t);
    }
  }
  return last.height;
}

function terrainGain(x: number): number {
  return 1 + EAST_GAIN * clamp(x / HALF, -1, 1);
}

/** Height of the road-level ground at any point. Sidewalks and lots add CURB on top. */
export function heightAt(x: number, z: number): number {
  if (z > NORTH_ROW_Z && nearAny(x, NORTH_EXITS_X, CORRIDOR_HALF)) {
    return profile(NORTH_ROW_Z) * terrainGain(x) + (z - NORTH_ROW_Z) * EXIT_GRADE;
  }
  const base = profile(z);
  if (base <= 0) return base;
  return base * terrainGain(x);
}

function nearAny(value: number, centres: readonly number[], distance: number): boolean {
  for (const centre of centres) if (Math.abs(value - centre) < distance) return true;
  return false;
}

/** What the ground is made of at a point. Roads win over sidewalks at intersections. */
export function surfaceAt(x: number, z: number): Surface {
  if (z < SAND_EDGE_Z) return 'sand';
  if (z < AVENUE_Z_MIN) return 'mosaic';
  if (z < AVENUE_Z_MAX) return 'asphalt';

  let onRoad =
    (z < HILL_ROAD_Z_MAX && nearAny(x, HILL_STREETS_X, ROAD_HALF)) ||
    nearAny(x, NORTH_EXITS_X, ROAD_HALF);
  let onCorridor =
    z < SEAFRONT_Z_MAX ||
    (z < HILL_CORRIDOR_Z_MAX && nearAny(x, HILL_STREETS_X, CORRIDOR_HALF)) ||
    nearAny(x, NORTH_EXITS_X, CORRIDOR_HALF);

  for (const street of CROSS_STREETS) {
    const dz = Math.abs(z - street.z);
    if (dz < ROAD_HALF && Math.abs(x) < CROSS_ROAD_X_LIMIT) {
      if (street.surface === 'cobble') return 'cobble';
      onRoad = true;
    }
    if (dz < CORRIDOR_HALF && Math.abs(x) < CROSS_CORRIDOR_X_LIMIT) onCorridor = true;
  }

  if (onRoad) return 'asphalt';
  if (onCorridor) return 'sidewalk';
  if (x > PARK.x0 && x < PARK.x1 && z > PARK.z0 && z < PARK.z1) return 'grass';
  return 'lot';
}

export function isRaised(surface: Surface): boolean {
  return surface !== 'asphalt' && surface !== 'cobble' && surface !== 'sand';
}

/** Height of the surface you would actually stand on, kerbs included. */
export function surfaceHeightAt(x: number, z: number): number {
  return heightAt(x, z) + (isRaised(surfaceAt(x, z)) ? CURB : 0);
}

/** The building blocks enclosed by streets on all four sides, south-west first. */
export function innerBlocks(): Rect[] {
  const xEdges: [number, number][] = [];
  for (let i = 0; i + 1 < HILL_STREETS_X.length; i++) {
    const a = HILL_STREETS_X[i];
    const b = HILL_STREETS_X[i + 1];
    if (a === undefined || b === undefined) continue;
    xEdges.push([a + CORRIDOR_HALF, b - CORRIDOR_HALF]);
  }

  const zEdges: [number, number][] = [];
  let south = SEAFRONT_Z_MAX;
  for (const street of CROSS_STREETS) {
    zEdges.push([south, street.z - CORRIDOR_HALF]);
    south = street.z + CORRIDOR_HALF;
  }

  const blocks: Rect[] = [];
  for (const [z0, z1] of zEdges) {
    for (const [x0, x1] of xEdges) blocks.push({ x0, x1, z0, z1 });
  }
  return blocks;
}

export function isPark(block: Rect): boolean {
  return block.x0 === PARK.x0 && block.z0 === PARK.z0;
}

export interface SpeedBump {
  x: number;
  z: number;
  /** Direction of travel over the bump. */
  axis: 'x' | 'z';
}

export const SPEED_BUMPS: readonly SpeedBump[] = [
  { x: -90, z: -10, axis: 'z' },
  { x: -30, z: 50, axis: 'z' },
  { x: 30, z: -65, axis: 'z' },
  { x: 90, z: 50, axis: 'z' },
  { x: 0, z: -40, axis: 'x' },
  { x: 60, z: 80, axis: 'x' },
  { x: -60, z: 135, axis: 'x' },
  { x: 0, z: 20, axis: 'x' },
];

export interface Ramp {
  /** Centre of the ramp's footprint. */
  x: number;
  z: number;
  /** Direction you ride up it. 0 faces +z (north), π/2 faces +x (east). */
  heading: number;
  length: number;
  width: number;
  height: number;
}

export const RAMPS: readonly Ramp[] = [
  { x: -60, z: -104.5, heading: Math.PI / 2, length: 5, width: 2.6, height: 1.3 },
  { x: 70, z: -95.5, heading: -Math.PI / 2, length: 5, width: 2.6, height: 1.3 },
  { x: 58, z: -38, heading: Math.PI / 2, length: 4.5, width: 2.4, height: 1.1 },
  { x: -2, z: 137.5, heading: -Math.PI / 2, length: 4.5, width: 2.4, height: 1.1 },
  // Points downhill off the top of a steep block, for the big one.
  { x: -32, z: 69, heading: Math.PI, length: 5, width: 2.6, height: 1.2 },
];

export const SPAWN = { x: -30 + 2, z: -86, heading: 0 } as const;
