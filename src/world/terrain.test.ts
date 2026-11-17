import { describe, expect, it } from 'vitest';
import { HALF, SEA_LEVEL, surfaceHeightAt } from './layout';
import { addCityStreets } from './roads/city';
import { RoadGraph } from './roads/graph';
import type { RoadPoint } from './roads/graph';
import { buildRoadNetwork } from './roads/network';
import {
  HILLSIDE,
  ROAD_SINK,
  TERRAIN_CELL,
  WORLD,
  buildTerrain,
  coastZ,
  createNaturalHeight,
} from './terrain';

const terrain = buildTerrain(1, new RoadGraph());

describe('world grid', () => {
  it('puts cell edges exactly on the city edges', () => {
    for (const edge of [WORLD.x0, WORLD.x1, WORLD.z0, WORLD.z1]) {
      expect(Number.isInteger((edge + HALF) / TERRAIN_CELL)).toBe(true);
    }
  });
});

describe('natural height', () => {
  const natural = createNaturalHeight(1);

  it('is the city ground inside the city', () => {
    for (const [x, z] of [
      [0, 0],
      [-90, 100],
      [120, -100],
    ] as const) {
      expect(natural(x, z)).toBe(surfaceHeightAt(x, z));
    }
  });

  it('leaves the city edge without a step', () => {
    for (let x = -140; x <= 140; x += 35) {
      expect(Math.abs(natural(x, HALF + 0.5) - surfaceHeightAt(x, HALF - 0.01))).toBeLessThan(0.3);
    }
    for (let z = -140; z <= 140; z += 35) {
      expect(Math.abs(natural(-HALF - 0.5, z) - surfaceHeightAt(-HALF + 0.01, z))).toBeLessThan(
        0.3,
      );
      expect(Math.abs(natural(HALF + 0.5, z) - surfaceHeightAt(HALF - 0.01, z))).toBeLessThan(0.3);
    }
  });

  it('climbs the hillside by roughly a hundred metres', () => {
    const bottom = natural(0, HILLSIDE.z0 + 10);
    const top = natural(0, HILLSIDE.z1 - 60);
    expect(top - bottom).toBeGreaterThan(80);
    expect(top - bottom).toBeLessThan(130);
  });

  it('is sea off the coast and land rising towards the land edges', () => {
    for (const x of [-600, -400, -200, 200]) {
      expect(natural(x, coastZ(x) - 20)).toBeLessThan(SEA_LEVEL);
    }
    for (let x = WORLD.x0 + 50; x < WORLD.x1; x += 120) {
      expect(natural(x, WORLD.z1 - 2)).toBeGreaterThan(natural(x, WORLD.z1 - 120));
    }
    for (const z of [0, 200, 400]) {
      expect(natural(WORLD.x0 + 2, z)).toBeGreaterThan(40);
      expect(natural(WORLD.x1 - 2, z)).toBeGreaterThan(40);
    }
  });

  it('is the same for the same seed and different for another', () => {
    const again = createNaturalHeight(1);
    const other = createNaturalHeight(2);
    expect(again(-100, 300)).toBe(natural(-100, 300));
    expect(other(-100, 300)).not.toBe(natural(-100, 300));
  });
});

describe('Terrain', () => {
  it('interpolates exactly through its own grid points', () => {
    for (const [ix, iz] of [
      [10, 10],
      [150, 200],
      [230, 220],
    ] as const) {
      const x = WORLD.x0 + ix * TERRAIN_CELL;
      const z = WORLD.z0 + iz * TERRAIN_CELL;
      expect(terrain.heightAt(x, z)).toBeCloseTo(terrain.vertexHeight(ix, iz), 4);
    }
  });

  it('carves a road into the hill: flat bed under it, natural ground away from it', () => {
    const graph = new RoadGraph();
    const natural = createNaturalHeight(1);
    // A level shelf cut across the hillside.
    const y = natural(0, 300);
    const points: RoadPoint[] = [];
    for (let x = -60; x <= 60; x += 2) points.push({ x, y, z: 300 });
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) throw new Error('no points');
    graph.edge(graph.node(first.x, y, 300), graph.node(last.x, y, 300), points.slice(1, -1), {
      kind: 'secondary',
      area: 'hillside',
    });
    const carved = buildTerrain(1, graph);
    for (let x = -50; x <= 50; x += 7) {
      expect(carved.heightAt(x, 300)).toBeCloseTo(y - ROAD_SINK, 4);
      expect(carved.heightAt(x, 301.5)).toBeCloseTo(y - ROAD_SINK, 4);
    }
    // Well away from the road nothing changes.
    expect(carved.heightAt(0, 380)).toBeCloseTo(terrain.heightAt(0, 380), 4);
  });

  it('ignores city roads, which have their own ground', () => {
    const city = new RoadGraph();
    addCityStreets(city);
    const empty = buildTerrain(1, new RoadGraph());
    expect(Array.from(buildTerrain(1, city).heights)).toEqual(Array.from(empty.heights));
  });

  it('never rises through a road, and never drops below what its skirt hides', () => {
    for (const seed of [1, 2, 3]) {
      const roads = buildRoadNetwork(seed);
      const carved = buildTerrain(seed, roads);
      for (const edge of roads.edges) {
        if (edge.area === 'city') continue;
        for (let i = 1; i + 1 < edge.points.length; i++) {
          const p = edge.points[i];
          const a = edge.points[i - 1];
          const b = edge.points[i + 1];
          if (!p || !a || !b || Math.abs(p.z) <= HALF + TERRAIN_CELL) continue;
          const length = Math.hypot(b.x - a.x, b.z - a.z);
          const across = edge.kind === 'stairs' ? [0] : [-1, -0.5, 0, 0.5, 1];
          for (const side of across) {
            const x = p.x + ((b.z - a.z) / length) * side * (edge.width / 2);
            const z = p.z - ((b.x - a.x) / length) * side * (edge.width / 2);
            const gap = carved.heightAt(x, z) - p.y;
            // Ridden surfaces never; stairs are a flat placeholder ribbon for now, and the
            // bend at each landing can sit a hand's width proud until they get real steps.
            const limit = side === 0 ? (edge.kind === 'stairs' ? 0.15 : 0) : 0.6;
            expect(gap, `${edge.kind} ${edge.id} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThan(
              limit,
            );
            expect(gap).toBeGreaterThan(-5.9);
          }
        }
      }
    }
  });

  it('lies flat under the middle of a road away from junctions', () => {
    const roads = buildRoadNetwork();
    const carved = buildTerrain(1, roads);
    const main = roads.edges.filter((edge) => edge.kind === 'main');
    for (const edge of main) {
      for (const p of edge.points) {
        if (Math.abs(p.z) <= HALF + TERRAIN_CELL) continue;
        if (roads.nodes.some((node) => Math.hypot(node.x - p.x, node.z - p.z) < 30)) continue;
        expect(Math.abs(carved.heightAt(p.x, p.z) - (p.y - ROAD_SINK))).toBeLessThan(0.25);
      }
    }
  });
});
