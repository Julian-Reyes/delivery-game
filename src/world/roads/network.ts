import { createNaturalHeight } from '../terrain';
import { addCityStreets } from './city';
import { RoadPlan } from './design';
import { RoadGraph } from './graph';
import { planHillsideMainRoads } from './hillside';

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
  planHillsideMainRoads(plan, natural);
  plan.commit(graph);
  return graph;
}
