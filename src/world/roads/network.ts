import { addCityStreets } from './city';
import { RoadGraph } from './graph';

/**
 * The whole road network, city and hillside neighborhoods together. Deterministic for a
 * given seed, so a layout can be reproduced and refined; the seed only drives the
 * generated parts (the city and the hand-drawn main roads never change).
 */

export const DEFAULT_MAP_SEED = 1;

export function buildRoadNetwork(_seed: number = DEFAULT_MAP_SEED): RoadGraph {
  const graph = new RoadGraph();
  addCityStreets(graph);
  return graph;
}
