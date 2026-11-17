import { HALF, SEA_LEVEL, surfaceHeightAt } from './layout';
import { createNoise2D } from './random';
import { horizontalLength } from './roads/graph';
import type { RoadGraph } from './roads/graph';

/**
 * The ground outside the original city: hills, the coast and the slopes the two favela
 * areas climb. Pure data like `layout.ts`.
 *
 * It is built in two passes. `createNaturalHeight` is the untouched landscape, which the
 * road generators read to lay roads along the hills. `buildTerrain` then samples it on a
 * grid and carves the roads in, so the ground always meets every road exactly.
 *
 * Inside the city square the original `layout.ts` ground is used unchanged; the terrain
 * blends out of it so the seam is invisible.
 */

export const TERRAIN_CELL = 4;

/**
 * The whole world, chosen so that cell edges land on the city's edges. Every land edge is
 * high ground rising towards the edge, so you never see under it; the south edge is sea.
 */
export const WORLD = {
  x0: -HALF - 133 * TERRAIN_CELL,
  x1: HALF + 33 * TERRAIN_CELL,
  z0: -HALF - 28 * TERRAIN_CELL,
  z1: HALF + 123 * TERRAIN_CELL,
} as const;

/** Area 1: the hillside behind the top of the city. */
export const HILLSIDE = { x0: -200, x1: 200, z0: 150, z1: 560 } as const;
/** Area 2: Avenida Niemeyer along the cliffs and Vidigal on the headland above it. */
export const HEADLAND = { x0: -620, x1: -200, z0: -230, z1: 160 } as const;

/** How far outside the city square the ground takes to blend into the hills. */
const CITY_BLEND = 40;
/** Road surfaces sit this far above the carved ground, so the ground never shows through. */
export const ROAD_SINK = 0.25;
/** Stairs sink deeper, so the bends between their landings and flights stay buried. */
const STAIR_SINK = 0.6;
/**
 * Flat strip either side of a road before the cut or fill slope starts. One cell diagonal
 * wide, so every terrain triangle under any part of a road is entirely flat bed and none
 * of the bank can poke up through the road's edge.
 */
export const ROAD_SHOULDER = TERRAIN_CELL * Math.SQRT2;
const SHOULDER = ROAD_SHOULDER;
/** Stairs get the same one-diagonal bed as roads, so no bank pokes up through a flight. */
const STAIR_SHOULDER = ROAD_SHOULDER;
/** Cut and fill slopes: rise per metre of distance from the road. */
const BANK_SLOPE = 1.1;
const BANK_REACH = 45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** Rounded bump: 1 at the centre, 0 from `t = 1` outwards. */
function bell(t: number): number {
  return t >= 1 ? 0 : (1 - t * t) * (1 - t * t);
}

/** Smooth maximum, so where two hills meet the saddle is rounded rather than creased. */
function smax(a: number, b: number, k: number): number {
  return (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;
}

function distanceToSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distance: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return { distance: Math.hypot(x - (ax + dx * t), z - (az + dz * t)), t };
}

/** Where the land meets the sea, as a z for each x. The city's own beach is near -125. */
export function coastZ(x: number): number {
  if (x >= -HALF && x <= HALF) return -125;
  if (x > HALF) return -125 - (x - HALF) * 0.05;
  // West of the city the shore swings south-west in a run of small coves under the cliffs.
  const out = -HALF - x;
  return -125 - out * 0.1 + 8 * Math.sin(x / 41) * smoothstep(out / 60) + 4 * Math.sin(x / 17 + 1);
}

/** Terraced-hillside look: flattens the ground into soft steps without changing its trend. */
function terrace(height: number, step: number, strength: number): number {
  const t = height / step;
  const base = Math.floor(t);
  const f = t - base;
  const stepped = (base + smoothstep(smoothstep(f))) * step;
  return height + (stepped - height) * strength;
}

/** How strongly a point belongs to an area box, fading out over `margin` metres. */
function inBox(
  x: number,
  z: number,
  box: { x0: number; x1: number; z0: number; z1: number },
  margin: number,
): number {
  const dx = Math.max(box.x0 - x, x - box.x1, 0);
  const dz = Math.max(box.z0 - z, z - box.z1, 0);
  return 1 - smoothstep(Math.hypot(dx, dz) / margin);
}

/** The landscape before any road is cut into it, city included. */
export function createNaturalHeight(seed: number): (x: number, z: number) => number {
  const noise = createNoise2D(seed * 7919 + 13);
  const detail = createNoise2D(seed * 104729 + 7);

  const landscape = (x: number, z: number): number => {
    // Area 1: rises from the city's top terrace to a ridge about 100 m higher.
    const cityTop = 28 * (1 + 0.3 * clamp(x / HALF, -1, 1)) + 4.5;
    const climb = z < 540 ? 102 * smoothstep((z - HALF) / 390) : 102 + (z - 540) * 0.25;
    const hillsideMask = smoothstep((z - 60) / 90) * (1 - smoothstep((Math.abs(x) - 230) / 90));
    // A stream ravine winding down the hillside leaves spurs either side of it.
    const ravineX = 40 + 25 * Math.sin(z / 70);
    const ravine =
      12 *
      Math.exp(-(((x - ravineX) / 30) ** 2)) *
      smoothstep((z - 190) / 80) *
      (1 - smoothstep((z - 480) / 60));
    let height = (cityTop + climb - ravine) * hillsideMask;

    // The ridge that keeps the hillside apart from the headland.
    const ridge = distanceToSegment(x, z, -215, -40, -250, 640);
    height = smax(height, (50 + 115 * smoothstep(ridge.t * 1.6)) * bell(ridge.distance / 130), 12);

    // The headland Vidigal climbs, falling to cliffs over the sea.
    height = smax(height, 178 * bell(Math.hypot(x + 430, z - 60) / 330), 12);
    // A shoulder over the east tunnel mouth, so the avenue disappears into a hill.
    height = smax(height, 70 * bell(Math.hypot(x - 250, z + 60) / 150), 10);
    height = smax(height, 95 * bell(Math.hypot(x - 330, z - 120) / 230), 12);
    // Further hills beyond the west edge.
    height = smax(height, 160 * bell(Math.hypot(x + 780, z - 20) / 280), 12);

    // Rise towards every land edge so the world ends in high ground, not a cliff.
    const edge = Math.min(x - WORLD.x0, WORLD.x1 - x, WORLD.z1 - z);
    height += 90 * (1 - smoothstep(edge / 150));

    // Rough the hills up, more the higher they are, so the beach stays smooth.
    const hilliness = smoothstep(height / 25);
    height +=
      hilliness * (5 * noise(x / 110, z / 110) + 2 * noise(x / 41, z / 41)) +
      hilliness * 1.2 * detail(x / 11, z / 11);
    height = Math.max(height, 3 + 1.5 * noise(x / 60, z / 60));

    // The two neighborhoods are built on terraces.
    const terraced = Math.max(inBox(x, z, HILLSIDE, 40), inBox(x, z, HEADLAND, 40));
    if (terraced > 0) height = terrace(height, 3.5, 0.45 * terraced);

    // Cliffs drop into the sea along the coast.
    const shore = 1 + 1.3 * (z - coastZ(x));
    return Math.max(Math.min(height, shore), SEA_LEVEL - 8);
  };

  return (x, z) => {
    const cx = clamp(x, -HALF, HALF);
    const cz = clamp(z, -HALF, HALF);
    const outside = Math.hypot(x - cx, z - cz);
    if (outside === 0) return surfaceHeightAt(x, z);
    const city = surfaceHeightAt(cx, cz);
    return city + (landscape(x, z) - city) * smoothstep(outside / CITY_BLEND);
  };
}

/** True for points inside the original city, whose ground `layout.ts` builds. */
export function inCity(x: number, z: number): boolean {
  return x > -HALF && x < HALF && z > -HALF && z < HALF;
}

/**
 * The terrain as a height grid with every road carved in. Heights between grid points
 * follow the same two triangles per cell as the rendered mesh, so things placed with
 * `heightAt` sit exactly on what you see.
 */
export class Terrain {
  readonly cols = (WORLD.x1 - WORLD.x0) / TERRAIN_CELL;
  readonly rows = (WORLD.z1 - WORLD.z0) / TERRAIN_CELL;
  /** Vertex heights, row by row from the south-west corner: index `iz * (cols + 1) + ix`. */
  readonly heights: Float32Array;

  constructor(heights: Float32Array) {
    if (heights.length !== (this.cols + 1) * (this.rows + 1)) {
      throw new Error('Terrain heights do not match the world grid');
    }
    this.heights = heights;
  }

  vertexHeight(ix: number, iz: number): number {
    const cx = clamp(ix, 0, this.cols);
    const cz = clamp(iz, 0, this.rows);
    return this.heights[cz * (this.cols + 1) + cx] ?? 0;
  }

  /** Ground height anywhere in the world. Inside the city this is the city's own ground. */
  heightAt(x: number, z: number): number {
    if (inCity(x, z)) return surfaceHeightAt(x, z);
    const gx = clamp((x - WORLD.x0) / TERRAIN_CELL, 0, this.cols - 1e-6);
    const gz = clamp((z - WORLD.z0) / TERRAIN_CELL, 0, this.rows - 1e-6);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = this.vertexHeight(ix, iz);
    const h11 = this.vertexHeight(ix + 1, iz + 1);
    // Cells are split along the diagonal from (ix, iz) to (ix + 1, iz + 1).
    if (fx >= fz) {
      const h10 = this.vertexHeight(ix + 1, iz);
      return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    }
    const h01 = this.vertexHeight(ix, iz + 1);
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }
}

/**
 * Sample the natural landscape on the world grid, then cut and fill it to meet every road
 * outside the city: flat under the road and its shoulders, then banked at a steady slope
 * back to the natural ground.
 */
export function buildTerrain(seed: number, roads: RoadGraph): Terrain {
  const natural = createNaturalHeight(seed);
  const cols = (WORLD.x1 - WORLD.x0) / TERRAIN_CELL;
  const rows = (WORLD.z1 - WORLD.z0) / TERRAIN_CELL;
  const count = (cols + 1) * (rows + 1);
  const heights = new Float32Array(count);
  for (let iz = 0; iz <= rows; iz++) {
    for (let ix = 0; ix <= cols; ix++) {
      heights[iz * (cols + 1) + ix] = natural(
        WORLD.x0 + ix * TERRAIN_CELL,
        WORLD.z0 + iz * TERRAIN_CELL,
      );
    }
  }

  // Per vertex: the band the banks allow, and the bed of the road or stair it sits under.
  // Where two beds overlap (a junction, a stair landing) the lower one wins: ground below a
  // road edge is hidden by its skirt, ground above it would show through.
  const low = new Float32Array(count).fill(-Infinity);
  const high = new Float32Array(count).fill(Infinity);
  const under = new Float32Array(count).fill(Infinity);

  for (const edge of roads.edges) {
    // The city builds its own ground.
    if (edge.area === 'city') continue;
    if (horizontalLength(edge.points) === 0) continue;
    const stairs = edge.kind === 'stairs';
    const core = edge.width / 2 + (stairs ? STAIR_SHOULDER : SHOULDER);
    // Along one road the nearest point sets the bed (a graded road's bed follows its
    // grade); only between different roads does the lower bed win.
    const nearest = new Map<number, { distance: number; y: number }>();
    const reach = core + BANK_REACH;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (!a || !b) continue;
      const ix0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - WORLD.x0) / TERRAIN_CELL));
      const ix1 = Math.min(cols, Math.ceil((Math.max(a.x, b.x) + reach - WORLD.x0) / TERRAIN_CELL));
      const iz0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach - WORLD.z0) / TERRAIN_CELL));
      const iz1 = Math.min(rows, Math.ceil((Math.max(a.z, b.z) + reach - WORLD.z0) / TERRAIN_CELL));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = WORLD.x0 + ix * TERRAIN_CELL;
          const z = WORLD.z0 + iz * TERRAIN_CELL;
          // The city's edge belongs to the city ground; moving it would open a crack.
          if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) continue;
          const { distance, t } = distanceToSegment(x, z, a.x, a.z, b.x, b.z);
          if (distance > reach) continue;
          const y = a.y + (b.y - a.y) * t - (stairs ? STAIR_SINK : ROAD_SINK);
          const index = iz * (cols + 1) + ix;
          const bank = Math.max(0, distance - core) * BANK_SLOPE;
          low[index] = Math.max(low[index] ?? -Infinity, y - bank);
          high[index] = Math.min(high[index] ?? Infinity, y + bank);
          if (distance <= core) {
            const best = nearest.get(index);
            if (!best || distance < best.distance) nearest.set(index, { distance, y });
          }
        }
      }
    }
    for (const [index, { y }] of nearest) under[index] = Math.min(under[index] ?? Infinity, y);
  }

  for (let index = 0; index < count; index++) {
    const bed = under[index] ?? Infinity;
    if (Number.isFinite(bed)) {
      heights[index] = bed;
      continue;
    }
    const lo = low[index] ?? -Infinity;
    const hi = high[index] ?? Infinity;
    const h = heights[index] ?? 0;
    // Two roads asking for incompatible banks: split the difference.
    heights[index] = lo > hi ? (lo + hi) / 2 : clamp(h, lo, hi);
  }
  return new Terrain(heights);
}
