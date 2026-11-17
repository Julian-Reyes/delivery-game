import { describe, expect, it } from 'vitest';
import { SPAWN } from '../world/layout';
import { nearestOnGraph } from '../world/roads/graph';
import { buildRoadNetwork } from '../world/roads/network';
import { Traffic, bikeAllowed, carAllowed } from './traffic';

const DT = 1 / 60;
const graph = buildRoadNetwork();
const farAway = { x: 5000, z: 5000 };

function simulate(traffic: Traffic, seconds: number, player = farAway): void {
  for (let t = 0; t < seconds; t += DT) traffic.step(DT, player);
}

describe('traffic', () => {
  it('fills the city with cars and the favela with motorbikes', () => {
    const traffic = new Traffic(graph, { seed: 1, cars: 20, bikes: 25, avoid: SPAWN });
    const cars = traffic.vehicles.filter((v) => v.kind !== 'bike');
    const bikes = traffic.vehicles.filter((v) => v.kind === 'bike');
    expect(cars.length).toBeGreaterThan(15);
    expect(bikes.length).toBeGreaterThan(20);
    for (const v of traffic.vehicles) {
      expect(Math.hypot(v.x - SPAWN.x, v.z - SPAWN.z)).toBeGreaterThan(20);
    }
  });

  it('keeps cars on city streets and motorbikes on favela roads, never stairs', () => {
    const traffic = new Traffic(graph, { seed: 2, cars: 20, bikes: 25, avoid: SPAWN });
    for (let second = 0; second < 60; second++) {
      simulate(traffic, 1);
      for (const v of traffic.vehicles) {
        if (v.kind === 'bike') expect(bikeAllowed(v.edge)).toBe(true);
        else expect(carAllowed(graph, v.edge)).toBe(true);
      }
    }
  });

  it('drives in its lane, close to the road it is on', () => {
    const traffic = new Traffic(graph, { seed: 3, cars: 20, bikes: 25, avoid: SPAWN });
    simulate(traffic, 30);
    for (const v of traffic.vehicles) {
      const road = nearestOnGraph(graph, v.x, v.z, (edge) => edge === v.edge);
      expect(road?.distance).toBeLessThan(5);
    }
  });

  it('keeps moving: nobody is stuck for good', () => {
    const traffic = new Traffic(graph, { seed: 4, cars: 20, bikes: 25, avoid: SPAWN });
    const start = traffic.vehicles.map((v) => ({ x: v.x, z: v.z }));
    simulate(traffic, 40);
    const moved = traffic.vehicles.filter((v, i) => {
      const s = start[i];
      return s ? Math.hypot(v.x - s.x, v.z - s.z) > 20 : false;
    });
    expect(moved.length).toBeGreaterThan(traffic.vehicles.length * 0.85);
  });

  it('stops for the player standing in the road ahead', () => {
    const traffic = new Traffic(graph, { seed: 5, cars: 1, bikes: 0, avoid: farAway });
    const car = traffic.vehicles[0];
    if (!car) throw new Error('no car');
    simulate(traffic, 1);
    const blocker = {
      x: car.x + Math.sin(car.heading) * 9,
      z: car.z + Math.cos(car.heading) * 9,
    };
    let closest = Infinity;
    for (let t = 0; t < 4; t += DT) {
      traffic.step(DT, blocker);
      closest = Math.min(closest, Math.hypot(car.x - blocker.x, car.z - blocker.z));
    }
    expect(closest).toBeGreaterThan(2);
    expect(car.speed).toBeLessThan(0.5);
  });

  it('brings cars back out of the other tunnel', () => {
    const traffic = new Traffic(graph, { seed: 6, cars: 20, bikes: 0, avoid: SPAWN });
    const tunnels = graph.nodes.filter((node) => node.boundary);
    expect(tunnels).toHaveLength(2);
    let emerged = false;
    for (let t = 0; t < 120 && !emerged; t += DT) {
      traffic.step(DT, farAway);
      emerged = traffic.vehicles.some((v) =>
        tunnels.some((tunnel) => Math.hypot(v.x - tunnel.x, v.z - tunnel.z) < 6 && v.speed > 1),
      );
    }
    expect(emerged).toBe(true);
  });

  it('is the same for the same seed', () => {
    const a = new Traffic(graph, { seed: 7, cars: 10, bikes: 10, avoid: SPAWN });
    const b = new Traffic(graph, { seed: 7, cars: 10, bikes: 10, avoid: SPAWN });
    simulate(a, 5);
    simulate(b, 5);
    expect(a.vehicles.map((v) => [v.x, v.z])).toEqual(b.vehicles.map((v) => [v.x, v.z]));
  });
});
