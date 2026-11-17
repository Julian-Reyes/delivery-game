import { HILLSIDE, createNaturalHeight } from '../terrain';
import { addCityStreets } from './city';
import { RoadPlan } from './design';
import { RoadGraph } from './graph';
import { planHillsideMainRoads } from './hillside';
import { Junctions, addStairs, growStreets } from './streets';
import { addTerraces } from './terraces';
import { addCrossStreets } from './crossings';

/**
 * The whole road network, city and hillside neighborhoods together. Deterministic for a
 * given seed, so a layout can be reproduced and refined; the seed only drives the
 * generated parts (the city and the hand-drawn main roads never change).
 */

export const DEFAULT_MAP_SEED = 1;

export function buildRoadNetwork(seed: number = DEFAULT_MAP_SEED): RoadGraph {
  const graph = new RoadGraph();
  addCityStreets(graph);
  const natural = createNaturalHeight(seed);
  const plan = new RoadPlan();
  const hillsideArea = { area: 'hillside' as const, ...HILLSIDE };
  const mains = planHillsideMainRoads(plan, natural);
  const junctions = new Junctions();
  const crossings = addCrossStreets(plan, {
    seed,
    area: hillsideArea,
    groundAt: natural,
    mains: [mains.estrada, mains.subida],
    junctions,
  });
  // Crossroads every so often along the main roads: a street off both sides at once.
  const crossroads = growStreets(plan, {
    seed: seed + 7919,
    area: hillsideArea,
    groundAt: natural,
    trunks: [mains.estrada, mains.subida],
    density: 5,
    junctions,
    crossroads: true,
    avoid: crossings,
  });
  const terraces = addTerraces(plan, {
    seed,
    area: hillsideArea,
    groundAt: natural,
    roads: [mains.estrada, mains.subida, ...crossings, ...crossroads],
    junctions,
    minY: 36,
    maxY: 150,
  });
  const streets = growStreets(plan, {
    seed,
    area: hillsideArea,
    groundAt: natural,
    trunks: [mains.estrada, mains.subida, ...crossings, ...crossroads, ...terraces],
    density: 4,
    junctions,
  });
  addStairs(
    plan,
    [mains.estrada, mains.subida, ...crossings, ...crossroads, ...terraces, ...streets],
    {
      seed,
      area: hillsideArea,
      groundAt: natural,
      junctions,
    },
  );
  plan.commit(graph);
  return graph;
}
