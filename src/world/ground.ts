import { createRandom, GeoBuilder } from './geo';
import {
  AVENUE_Z,
  AVENUE_Z_MAX,
  AVENUE_Z_MIN,
  CELL,
  CELLS,
  CROSS_STREETS,
  CURB,
  HALF,
  HILL_STREETS_X,
  ROAD_HALF,
  heightAt,
  isRaised,
  surfaceAt,
} from './layout';
import type { Surface } from './layout';
import { GROUND_TILE_METRES } from './textures';

const CURB_COLOR = 0xa8a399;
const YELLOW = 0xe3b21f;
const WHITE = 0xdcd9d0;
/** Markings float this far above the road so they never fight it for depth. */
const MARK_LIFT = 0.035;
const MARK_PIECE = 1.25;

export interface GroundGeometry {
  /** One textured builder per surface type. */
  surfaces: Record<Surface, GeoBuilder>;
  /** Triangle soup of the whole ground, for the physics collider. */
  colliderPositions: Float32Array;
  colliderIndices: Uint32Array;
}

/**
 * Build the ground as a grid of cells, each textured by what it is (asphalt, cobblestone,
 * sidewalk...). Sidewalks and lots are raised by the kerb height, with kerb faces added to
 * `kerbs`. `shadeAt` returns how much to darken a cell that lies in a building's shadow.
 */
export function buildGround(
  kerbs: GeoBuilder,
  shadeAt: (ix: number, iz: number) => number,
): GroundGeometry {
  const random = createRandom(99);
  const surfaces: Record<Surface, GeoBuilder> = {
    asphalt: new GeoBuilder(true),
    cobble: new GeoBuilder(true),
    sidewalk: new GeoBuilder(true),
    mosaic: new GeoBuilder(true),
    sand: new GeoBuilder(true),
    lot: new GeoBuilder(true),
    grass: new GeoBuilder(true),
  };
  const colliderPositions: number[] = [];
  const colliderIndices: number[] = [];

  const surfaceOf = (ix: number, iz: number): Surface | null => {
    if (ix < 0 || iz < 0 || ix >= CELLS || iz >= CELLS) return null;
    return surfaceAt(-HALF + (ix + 0.5) * CELL, -HALF + (iz + 0.5) * CELL);
  };

  for (let iz = 0; iz < CELLS; iz++) {
    for (let ix = 0; ix < CELLS; ix++) {
      const x0 = -HALF + ix * CELL;
      const x1 = x0 + CELL;
      const z0 = -HALF + iz * CELL;
      const z1 = z0 + CELL;
      const surface = surfaceAt(x0 + CELL / 2, z0 + CELL / 2);
      const raised = isRaised(surface);
      const lift = raised ? CURB : 0;

      const h00 = heightAt(x0, z0);
      const h10 = heightAt(x1, z0);
      const h01 = heightAt(x0, z1);
      const h11 = heightAt(x1, z1);

      // Asphalt gets patchy repairs; everything else just a little variation.
      let tint = 0.95 + random() * 0.1;
      if (surface === 'asphalt' && random() < 0.07) tint = random() < 0.5 ? 0.78 : 1.14;
      if (surface === 'sand' && h00 < -0.25) tint *= 0.86;
      tint *= shadeAt(ix, iz);

      const tile = GROUND_TILE_METRES[surface];
      surfaces[surface].quad(
        [x0, h01 + lift, z1],
        [x1, h11 + lift, z1],
        [x1, h10 + lift, z0],
        [x0, h00 + lift, z0],
        0xffffff,
        [tint, tint, tint, tint],
        [
          [x0 / tile, z1 / tile],
          [x1 / tile, z1 / tile],
          [x1 / tile, z0 / tile],
          [x0 / tile, z0 / tile],
        ],
      );

      const base = colliderPositions.length / 3;
      colliderPositions.push(
        x0,
        h01 + lift,
        z1,
        x1,
        h11 + lift,
        z1,
        x1,
        h10 + lift,
        z0,
        x0,
        h00 + lift,
        z0,
      );
      colliderIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);

      if (!raised) continue;
      // Kerb faces wherever a raised cell meets a lower one.
      const lower = (other: Surface | null): boolean => other !== null && !isRaised(other);
      const shade = [0.8, 0.8, 1, 1] as const;
      if (lower(surfaceOf(ix, iz - 1))) {
        kerbs.quad(
          [x1, h10, z0],
          [x0, h00, z0],
          [x0, h00 + CURB, z0],
          [x1, h10 + CURB, z0],
          CURB_COLOR,
          shade,
        );
      }
      if (lower(surfaceOf(ix, iz + 1))) {
        kerbs.quad(
          [x0, h01, z1],
          [x1, h11, z1],
          [x1, h11 + CURB, z1],
          [x0, h01 + CURB, z1],
          CURB_COLOR,
          shade,
        );
      }
      if (lower(surfaceOf(ix + 1, iz))) {
        kerbs.quad(
          [x1, h11, z1],
          [x1, h10, z0],
          [x1, h10 + CURB, z0],
          [x1, h11 + CURB, z1],
          CURB_COLOR,
          shade,
        );
      }
      if (lower(surfaceOf(ix - 1, iz))) {
        kerbs.quad(
          [x0, h00, z0],
          [x0, h01, z1],
          [x0, h01 + CURB, z1],
          [x0, h00 + CURB, z0],
          CURB_COLOR,
          shade,
        );
      }
    }
  }

  return {
    surfaces,
    colliderPositions: new Float32Array(colliderPositions),
    colliderIndices: new Uint32Array(colliderIndices),
  };
}

/** Painted road markings: centre lines, lane dashes and zebra crossings. */
export function buildMarkings(): GeoBuilder {
  const marks = new GeoBuilder();

  /** A flat painted rectangle that follows the road surface. */
  const stripe = (x0: number, z0: number, x1: number, z1: number, color: number): void => {
    const piecesX = Math.max(1, Math.ceil((x1 - x0) / MARK_PIECE));
    const piecesZ = Math.max(1, Math.ceil((z1 - z0) / MARK_PIECE));
    for (let i = 0; i < piecesX; i++) {
      for (let j = 0; j < piecesZ; j++) {
        const ax = x0 + ((x1 - x0) * i) / piecesX;
        const bx = x0 + ((x1 - x0) * (i + 1)) / piecesX;
        const az = z0 + ((z1 - z0) * j) / piecesZ;
        const bz = z0 + ((z1 - z0) * (j + 1)) / piecesZ;
        marks.quad(
          [ax, heightAt(ax, bz) + MARK_LIFT, bz],
          [bx, heightAt(bx, bz) + MARK_LIFT, bz],
          [bx, heightAt(bx, az) + MARK_LIFT, az],
          [ax, heightAt(ax, az) + MARK_LIFT, az],
          color,
        );
      }
    }
  };

  const nearIntersection = (value: number, centres: readonly number[]): boolean =>
    centres.some((centre) => Math.abs(value - centre) < ROAD_HALF + 4);
  const crossZs = CROSS_STREETS.map((street) => street.z);

  // Hill streets: dashed yellow centre line.
  for (const x of HILL_STREETS_X) {
    for (let z = AVENUE_Z_MAX + 4; z < 138; z += 7) {
      if (nearIntersection(z + 1.5, crossZs)) continue;
      stripe(x - 0.08, z, x + 0.08, z + 3, YELLOW);
    }
  }

  // Cross streets: the same, except on the cobblestones.
  for (const street of CROSS_STREETS) {
    if (street.surface === 'cobble') continue;
    for (let x = -92; x < 90; x += 7) {
      if (nearIntersection(x + 1.5, HILL_STREETS_X)) continue;
      stripe(x, street.z - 0.08, x + 3, street.z + 0.08, YELLOW);
    }
  }

  // Avenue: double yellow down the middle, white lane dashes either side.
  stripe(-HALF + 2, AVENUE_Z - 0.3, HALF - 2, AVENUE_Z - 0.14, YELLOW);
  stripe(-HALF + 2, AVENUE_Z + 0.14, HALF - 2, AVENUE_Z + 0.3, YELLOW);
  for (let x = -HALF + 4; x < HALF - 6; x += 8) {
    stripe(x, AVENUE_Z - 3.83, x + 3, AVENUE_Z - 3.67, WHITE);
    stripe(x, AVENUE_Z + 3.67, x + 3, AVENUE_Z + 3.83, WHITE);
  }

  // Zebra crossings on every arm of every intersection.
  const zebraAcrossX = (xc: number, z0: number, z1: number): void => {
    for (let x = xc - ROAD_HALF + 0.5; x < xc + ROAD_HALF - 0.6; x += 1) {
      stripe(x, z0, x + 0.5, z1, WHITE);
    }
  };
  const zebraAcrossZ = (zc: number, x0: number, x1: number, half: number): void => {
    for (let z = zc - half + 0.5; z < zc + half - 0.6; z += 1) {
      stripe(x0, z, x1, z + 0.5, WHITE);
    }
  };

  for (const x of HILL_STREETS_X) {
    zebraAcrossX(x, AVENUE_Z_MAX + 0.3, AVENUE_Z_MAX + 2.3);
    for (const street of CROSS_STREETS) {
      zebraAcrossX(x, street.z - 7.4, street.z - 5.4);
      if (street.z + 7.4 < 140) zebraAcrossX(x, street.z + 5.4, street.z + 7.4);
      if (street.surface === 'cobble') continue;
      if (x - 7.4 > -95) zebraAcrossZ(street.z, x - 7.4, x - 5.4, ROAD_HALF);
      if (x + 7.4 < 95) zebraAcrossZ(street.z, x + 5.4, x + 7.4, ROAD_HALF);
    }
  }
  for (const x of [-60, 0, 60]) {
    zebraAcrossZ(AVENUE_Z, x - 1.25, x + 1.25, (AVENUE_Z_MAX - AVENUE_Z_MIN) / 2);
  }

  return marks;
}
