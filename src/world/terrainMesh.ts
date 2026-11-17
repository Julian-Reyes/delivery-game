import { BufferGeometry, Color, Float32BufferAttribute, Uint32BufferAttribute } from 'three';
import { SEA_LEVEL } from './layout';
import { createNoise2D } from './random';
import { HEADLAND, HILLSIDE, TERRAIN_CELL, WORLD, inCity } from './terrain';
import type { Terrain } from './terrain';

/**
 * Meshes and the collider for the terrain. The grid is cut into large square chunks so the
 * camera can skip the ones behind it while keeping the draw-call count low. Vertices are
 * shared within a chunk and normals come from the height grid itself, so chunk borders
 * shade seamlessly.
 */

/** Cells per chunk side: 192 m chunks, about 18 of them hold any land. */
const CHUNK = 48;

const GRASS = new Color(0x6f9a4f);
const FOREST = new Color(0x3d6a37);
const ROCK = new Color(0x8a8378);
const EARTH = new Color(0x9c7f5a);
const SAND = new Color(0xd6c497);

export interface TerrainGeometry {
  chunks: BufferGeometry[];
  colliderPositions: Float32Array;
  colliderIndices: Uint32Array;
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function inside(box: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) {
  return x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1;
}

/** A cell is drawn unless it is inside the city or entirely under the sea. */
function cellVisible(terrain: Terrain, ix: number, iz: number): boolean {
  const x = WORLD.x0 + (ix + 0.5) * TERRAIN_CELL;
  const z = WORLD.z0 + (iz + 0.5) * TERRAIN_CELL;
  if (inCity(x, z)) return false;
  const deepest = Math.max(
    terrain.vertexHeight(ix, iz),
    terrain.vertexHeight(ix + 1, iz),
    terrain.vertexHeight(ix, iz + 1),
    terrain.vertexHeight(ix + 1, iz + 1),
  );
  return deepest > SEA_LEVEL - 0.5;
}

export function buildTerrainGeometry(terrain: Terrain, seed: number): TerrainGeometry {
  const patches = createNoise2D(seed * 31 + 5);
  const color = new Color();
  const chunks: BufferGeometry[] = [];
  const colliderPositions: number[] = [];
  const colliderIndices: number[] = [];

  const vertexColor = (ix: number, iz: number, slope: number, out: Color): Color => {
    const x = WORLD.x0 + ix * TERRAIN_CELL;
    const z = WORLD.z0 + iz * TERRAIN_CELL;
    const h = terrain.vertexHeight(ix, iz);
    const n = patches(x / 45, z / 45);
    out.copy(GRASS).lerp(FOREST, smoothstep((n + 0.1) * 2.5));
    // Bare trodden earth where people live, granite where it is too steep for soil.
    if (inside(HILLSIDE, x, z) || inside(HEADLAND, x, z)) {
      out.lerp(EARTH, 0.35 + 0.3 * smoothstep(patches(x / 17, z / 17) + 0.3));
    }
    out.lerp(ROCK, smoothstep((slope - 0.9) * 2));
    out.lerp(SAND, 1 - smoothstep(h / 2.5));
    const shade = 0.92 + 0.12 * patches(x / 7, z / 7);
    return out.multiplyScalar(shade);
  };

  for (let cz = 0; cz < terrain.rows; cz += CHUNK) {
    for (let cx = 0; cx < terrain.cols; cx += CHUNK) {
      const ixEnd = Math.min(terrain.cols, cx + CHUNK);
      const izEnd = Math.min(terrain.rows, cz + CHUNK);
      const span = ixEnd - cx + 1;
      const positions: number[] = [];
      const normals: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];

      for (let iz = cz; iz <= izEnd; iz++) {
        for (let ix = cx; ix <= ixEnd; ix++) {
          const h = terrain.vertexHeight(ix, iz);
          positions.push(WORLD.x0 + ix * TERRAIN_CELL, h, WORLD.z0 + iz * TERRAIN_CELL);
          // Central differences over the whole grid, so neighbouring chunks agree.
          const dx =
            (terrain.vertexHeight(ix + 1, iz) - terrain.vertexHeight(ix - 1, iz)) /
            (2 * TERRAIN_CELL);
          const dz =
            (terrain.vertexHeight(ix, iz + 1) - terrain.vertexHeight(ix, iz - 1)) /
            (2 * TERRAIN_CELL);
          const length = Math.hypot(dx, 1, dz);
          normals.push(-dx / length, 1 / length, -dz / length);
          vertexColor(ix, iz, Math.hypot(dx, dz), color);
          colors.push(color.r, color.g, color.b);
        }
      }

      for (let iz = cz; iz < izEnd; iz++) {
        for (let ix = cx; ix < ixEnd; ix++) {
          if (!cellVisible(terrain, ix, iz)) continue;
          const a = (iz - cz) * span + (ix - cx);
          const b = a + 1;
          const c = a + span;
          const d = c + 1;
          // Split along (ix, iz)-(ix + 1, iz + 1), matching Terrain.heightAt.
          indices.push(a, d, b, a, c, d);

          const x0 = WORLD.x0 + ix * TERRAIN_CELL;
          const z0 = WORLD.z0 + iz * TERRAIN_CELL;
          const base = colliderPositions.length / 3;
          colliderPositions.push(
            x0,
            terrain.vertexHeight(ix, iz),
            z0,
            x0 + TERRAIN_CELL,
            terrain.vertexHeight(ix + 1, iz),
            z0,
            x0,
            terrain.vertexHeight(ix, iz + 1),
            z0 + TERRAIN_CELL,
            x0 + TERRAIN_CELL,
            terrain.vertexHeight(ix + 1, iz + 1),
            z0 + TERRAIN_CELL,
          );
          colliderIndices.push(base, base + 3, base + 1, base, base + 2, base + 3);
        }
      }
      if (indices.length === 0) continue;

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      geometry.setIndex(new Uint32BufferAttribute(indices, 1));
      geometry.computeBoundingSphere();
      chunks.push(geometry);
    }
  }

  return {
    chunks,
    colliderPositions: new Float32Array(colliderPositions),
    colliderIndices: new Uint32Array(colliderIndices),
  };
}
