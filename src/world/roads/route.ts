import { isRideable, nearestOnGraph } from './graph';
import type { GraphPosition, RoadEdge, RoadGraph } from './graph';
import { nextStates, stateEdge, stateOf, stateTowardTo } from './turns';

/**
 * Shortest routes over the road graph, for delivery distances, par times and (later) the
 * waypoint. Riding honours which turns the bike can make; walking goes anywhere,
 * stairs included.
 */

export type TravelMode = 'ride' | 'walk';

export interface Route {
  /** Horizontal length in metres. */
  length: number;
  /** Edges in travel order, start and finish edges included. */
  edges: number[];
  from: GraphPosition;
  to: GraphPosition;
}

class MinHeap {
  private readonly items: { cost: number; state: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(cost: number, state: number): void {
    const { items } = this;
    items.push({ cost, state });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = items[parent];
      const c = items[i];
      if (!p || !c || p.cost <= c.cost) break;
      items[parent] = c;
      items[i] = p;
      i = parent;
    }
  }

  pop(): { cost: number; state: number } | undefined {
    const { items } = this;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || !last) return top;
    items[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if ((items[left]?.cost ?? Infinity) < (items[smallest]?.cost ?? Infinity)) smallest = left;
      if ((items[right]?.cost ?? Infinity) < (items[smallest]?.cost ?? Infinity)) smallest = right;
      if (smallest === i) break;
      const a = items[i];
      const b = items[smallest];
      if (!a || !b) break;
      items[i] = b;
      items[smallest] = a;
      i = smallest;
    }
    return top;
  }
}

function walkStates(graph: RoadGraph, state: number, out: number[]): number[] {
  out.length = 0;
  const edge = graph.getEdge(stateEdge(state));
  const node = stateTowardTo(state) ? edge.to : edge.from;
  for (const id of graph.edgesAt(node)) {
    if (id === edge.id) continue;
    out.push(stateOf(id, graph.getEdge(id).from === node));
  }
  return out;
}

/** Shortest route between two points, each snapped to the nearest usable edge. */
export function findRoute(
  graph: RoadGraph,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  mode: TravelMode,
): Route | null {
  const usable = (edge: RoadEdge): boolean => mode === 'walk' || isRideable(edge);
  const from = nearestOnGraph(graph, fromX, fromZ, usable);
  const to = nearestOnGraph(graph, toX, toZ, usable);
  if (!from || !to) return null;

  const startEdge = graph.getEdge(from.edge);
  const goalEdge = graph.getEdge(to.edge);
  const expand = mode === 'ride' ? nextStates : walkStates;

  let best = Infinity;
  let bestState = -1;
  if (from.edge === to.edge) {
    best = Math.abs(to.along - from.along);
    bestState = stateOf(from.edge, to.along >= from.along);
  }

  // Cost of a state is the distance travelled on arriving at the node it heads to.
  const cost = new Map<number, number>();
  const previous = new Map<number, number>();
  const heap = new MinHeap();
  const seed = (state: number, distance: number): void => {
    cost.set(state, distance);
    heap.push(distance, state);
  };
  seed(stateOf(startEdge.id, true), startEdge.length - from.along);
  seed(stateOf(startEdge.id, false), from.along);

  const scratch: number[] = [];
  let finish = -1;
  while (heap.size > 0) {
    const item = heap.pop();
    if (!item) break;
    if (item.cost >= best) break;
    if (item.cost > (cost.get(item.state) ?? Infinity)) continue;

    for (const next of expand(graph, item.state, scratch)) {
      if (stateEdge(next) === goalEdge.id) {
        const onGoal = stateTowardTo(next) ? to.along : goalEdge.length - to.along;
        if (item.cost + onGoal < best) {
          best = item.cost + onGoal;
          bestState = next;
          finish = item.state;
        }
      }
      const total = item.cost + graph.getEdge(stateEdge(next)).length;
      if (total < (cost.get(next) ?? Infinity)) {
        cost.set(next, total);
        previous.set(next, item.state);
        heap.push(total, next);
      }
    }
  }
  if (!Number.isFinite(best)) return null;

  const edges: number[] = [stateEdge(bestState)];
  for (let state = finish; state >= 0; state = previous.get(state) ?? -1) {
    edges.push(stateEdge(state));
  }
  edges.reverse();
  return { length: best, edges, from, to };
}
