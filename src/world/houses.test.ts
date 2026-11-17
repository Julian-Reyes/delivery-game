import { describe, expect, it } from 'vitest';
import { SPAWN } from './layout';
import { FLOOR_HEIGHT, MAX_WALK, frontDoor, planHouses } from './houses';
import type { House } from './houses';
import { isRideable, nearestOnGraph } from './roads/graph';
import { buildRoadNetwork } from './roads/network';
import { findRoute } from './roads/route';
import { HILLSIDE, buildTerrain, inCity } from './terrain';

const seed = 1;
const roads = buildRoadNetwork(seed);
const terrain = buildTerrain(seed, roads);
const plan = planHouses({
  seed,
  area: { area: 'hillside', ...HILLSIDE },
  roads,
  terrain,
  start: SPAWN,
  pickups: 4,
  dropoffs: 16,
});

function cornersOf(house: House): [number, number][] {
  const fx = Math.sin(house.yaw);
  const fz = Math.cos(house.yaw);
  const out: [number, number][] = [];
  for (const [a, b] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ] as const) {
    out.push([
      house.x + fz * (house.width / 2) * a + fx * (house.depth / 2) * b,
      house.z - fx * (house.width / 2) * a + fz * (house.depth / 2) * b,
    ]);
  }
  return out;
}

describe('favela houses', () => {
  it('packs the hillside densely', () => {
    expect(plan.houses.length).toBeGreaterThan(700);
    const fronting = plan.houses.filter((house) => house.street !== null).length;
    expect(fronting).toBeGreaterThan(250);
  });

  it('keeps every house inside the area and out of the city', () => {
    for (const house of plan.houses) {
      for (const [x, z] of cornersOf(house)) {
        expect(x).toBeGreaterThan(HILLSIDE.x0);
        expect(x).toBeLessThan(HILLSIDE.x1);
        expect(z).toBeGreaterThan(HILLSIDE.z0);
        expect(z).toBeLessThan(HILLSIDE.z1);
        expect(inCity(x, z)).toBe(false);
      }
    }
  });

  it('stands every house on the ground and never buries it in the slope', () => {
    for (const house of plan.houses) {
      const top = house.floorY + house.floors * FLOOR_HEIGHT;
      for (const [x, z] of [...cornersOf(house), [house.x, house.z] as [number, number]]) {
        const ground = terrain.heightAt(x, z);
        expect(house.baseY).toBeLessThan(ground);
        expect(top).toBeGreaterThan(ground + 1);
      }
    }
  });

  it('builds nothing on a road', () => {
    for (const house of plan.houses) {
      // Sample the footprint; no sample may lie on a road surface.
      for (const [x, z] of [...cornersOf(house), [house.x, house.z] as [number, number]]) {
        const near = nearestOnGraph(roads, x, z);
        if (!near) continue;
        const edge = roads.getEdge(near.edge);
        expect(near.distance, `house ${house.id}`).toBeGreaterThan(edge.width / 2);
      }
    }
  });

  it('never overlaps two houses', () => {
    // Centres closer than the sum of their inner radii would mean overlap.
    const sorted = [...plan.houses].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      if (!a) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (!b || b.x - a.x > 12) break;
        const inner = Math.min(a.width, a.depth) / 2 + Math.min(b.width, b.depth) / 2;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(inner * 0.95);
      }
    }
  });

  it('is the same for the same seed', () => {
    const again = planHouses({
      seed,
      area: { area: 'hillside', ...HILLSIDE },
      roads,
      terrain,
      start: SPAWN,
      pickups: 4,
      dropoffs: 16,
    });
    expect(again.houses).toEqual(plan.houses);
  });
});

describe('delivery spots', () => {
  it('has shops to pick up from and houses to deliver to, both ridden-to and walk-up', () => {
    const pickups = plan.spots.filter((spot) => spot.kind === 'pickup');
    const ride = plan.spots.filter((spot) => spot.kind === 'dropoff' && spot.walk === 0);
    const walk = plan.spots.filter((spot) => spot.kind === 'dropoff' && spot.walk > 0);
    expect(pickups).toHaveLength(4);
    expect(ride.length).toBeGreaterThanOrEqual(6);
    expect(walk.length).toBeGreaterThanOrEqual(4);
    for (const spot of pickups) {
      const house = plan.houses[spot.house];
      expect(house?.street === null ? null : roads.getEdge(house?.street ?? 0).kind).toBe('main');
    }
  });

  it('can reach every spot by bike, then a short walk at most', () => {
    for (const spot of plan.spots) {
      const route = findRoute(roads, SPAWN.x, SPAWN.z, spot.parkX, spot.parkZ, 'ride');
      expect(route, `spot ${spot.id}`).not.toBeNull();
      expect(spot.walk).toBeLessThanOrEqual(MAX_WALK);
      const park = nearestOnGraph(roads, spot.parkX, spot.parkZ, isRideable);
      expect(park?.distance).toBeLessThan(0.01);
      const house = plan.houses[spot.house];
      if (!house) throw new Error('spot without a house');
      const door = frontDoor(house);
      expect(door.x).toBeCloseTo(spot.x);
      expect(door.z).toBeCloseTo(spot.z);
    }
  });
});
