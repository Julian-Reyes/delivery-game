import { BIKE_TURN_RADIUS, departure, isRideable } from './graph';
import type { RoadEdge, RoadGraph } from './graph';

/**
 * Which turns the bike can physically make. The rider cannot reverse, so a turn it cannot
 * make in one sweep is a turn it cannot make at all.
 *
 * Travel is tracked as a state per edge and direction: `edge * 2 + 1` heads from the
 * edge's `from` node to its `to` node, `edge * 2` the other way.
 */

/** How far along each edge its direction at a node is measured. */
const DIRECTION_REACH = 6;

export function stateOf(edge: number, towardTo: boolean): number {
  return edge * 2 + (towardTo ? 1 : 0);
}

export function stateEdge(state: number): number {
  return state >> 1;
}

export function stateTowardTo(state: number): boolean {
  return (state & 1) === 1;
}

/** The same edge, travelled the other way. */
export function reverseState(state: number): number {
  return state ^ 1;
}

/** The node a state is heading towards. */
export function stateTarget(graph: RoadGraph, state: number): number {
  const edge = graph.getEdge(stateEdge(state));
  return stateTowardTo(state) ? edge.to : edge.from;
}

/**
 * Largest radius you can hold through a corner of deflection `deflection` (radians, 0 =
 * straight on) when both roads are `width` wide: outside edge, clip the inside corner,
 * back out to the outside edge.
 */
export function cornerRadius(width: number, deflection: number): number {
  const slack = 1 - Math.cos(deflection / 2);
  return slack < 1e-9 ? Infinity : width / slack;
}

/** Whether arriving at `node` along `from`, you can carry on along `to`. */
export function canTurn(graph: RoadGraph, node: number, from: RoadEdge, to: RoadEdge): boolean {
  if (from.id === to.id) return canTurnAround(graph, from, node);
  const pad = graph.getNode(node).pad;
  if (pad >= BIKE_TURN_RADIUS) return true;
  const arriving = departure(from, node, DIRECTION_REACH);
  const leaving = departure(to, node, DIRECTION_REACH);
  // Arriving is the reverse of the direction the incoming edge leaves the node in.
  const cos = Math.max(-1, Math.min(1, -(arriving.x * leaving.x + arriving.z * leaving.z)));
  const deflection = Math.acos(cos);
  return cornerRadius(Math.min(from.width, to.width), deflection) >= BIKE_TURN_RADIUS;
}

/** Whether you can turn right round at a node (a dead end or a square) on this edge. */
export function canTurnAround(graph: RoadGraph, edge: RoadEdge, node: number): boolean {
  return graph.getNode(node).pad >= BIKE_TURN_RADIUS || edge.width / 2 >= BIKE_TURN_RADIUS;
}

/** States you can be in right after arriving at the end of `state`. */
export function nextStates(graph: RoadGraph, state: number, out: number[]): number[] {
  out.length = 0;
  const edge = graph.getEdge(stateEdge(state));
  const node = stateTowardTo(state) ? edge.to : edge.from;
  for (const id of graph.edgesAt(node)) {
    const next = graph.getEdge(id);
    if (!isRideable(next)) continue;
    if (!canTurn(graph, node, edge, next)) continue;
    // Leaving the node, whichever edge it is (including this one, for a U-turn).
    out.push(stateOf(id, next.from === node));
  }
  return out;
}
