import { BIKE_TURN_RADIUS, ROAD_KINDS, departure, isRideable, nearestOnGraph } from './graph';
import type { RoadEdge, RoadGraph, RoadPoint } from './graph';
import { canTurn, canTurnAround, nextStates, reverseState, stateOf } from './turns';

/**
 * Checks that the road graph is something you can actually ride: every road reachable from
 * the spawn and back, no grade or curve beyond what its kind allows, no roads running
 * through each other, and somewhere to turn round at every dead end.
 */

export type IssueKind =
  | 'grade'
  | 'curve'
  | 'sparse'
  | 'turn'
  | 'overlap'
  | 'dead-end'
  | 'unreachable'
  | 'trap'
  | 'orphan';

export interface RoadIssue {
  kind: IssueKind;
  x: number;
  z: number;
  /** The edge (or one of the edges) involved, if any. */
  edge: number | null;
  detail: string;
}

/** Longest centreline segment the curve check can trust. */
export const MAX_SEGMENT = 4;
/** Roads further apart than this vertically are a bridge over the other, not a clash. */
const BRIDGE_CLEARANCE = 4;
const HASH_CELL = 20;

function circumradius(a: RoadPoint, b: RoadPoint, c: RoadPoint): number {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
}

export function gradeIssues(graph: RoadGraph): RoadIssue[] {
  const issues: RoadIssue[] = [];
  for (const edge of graph.edges) {
    const limit = ROAD_KINDS[edge.kind].maxGrade;
    let worst = 0;
    let at: RoadPoint | null = null;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (!a || !b) continue;
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      if (run < 1e-6) continue;
      const grade = Math.abs(b.y - a.y) / run;
      if (grade > worst) {
        worst = grade;
        at = { x: (a.x + b.x) / 2, y: 0, z: (a.z + b.z) / 2 };
      }
    }
    if (at && worst > limit + 1e-6) {
      issues.push({
        kind: 'grade',
        x: at.x,
        z: at.z,
        edge: edge.id,
        detail: `${(worst * 100).toFixed(1)}% on a ${edge.kind} (max ${(limit * 100).toFixed(0)}%)`,
      });
    }
  }
  return issues;
}

/**
 * Curves along an edge tighter than its kind allows. Where edges meet, the corner is a
 * junction and `turnIssues` judges it by what the bike can sweep through instead.
 */
export function curveIssues(graph: RoadGraph): RoadIssue[] {
  const issues: RoadIssue[] = [];
  const check = (edge: RoadEdge, a: RoadPoint, b: RoadPoint, c: RoadPoint): boolean => {
    const limit = ROAD_KINDS[edge.kind].minRadius;
    const radius = circumradius(a, b, c);
    if (radius >= limit - 1e-6) return false;
    issues.push({
      kind: 'curve',
      x: b.x,
      z: b.z,
      edge: edge.id,
      detail: `${radius.toFixed(1)} m radius on a ${edge.kind} (min ${limit} m)`,
    });
    return true;
  };

  for (const edge of graph.edges) {
    if (!isRideable(edge)) continue;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (a && b && Math.hypot(b.x - a.x, b.z - a.z) > MAX_SEGMENT + 1e-6) {
        issues.push({
          kind: 'sparse',
          x: (a.x + b.x) / 2,
          z: (a.z + b.z) / 2,
          edge: edge.id,
          detail: `centreline points more than ${MAX_SEGMENT} m apart`,
        });
        break;
      }
    }
    for (let i = 1; i + 1 < edge.points.length; i++) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      const c = edge.points[i + 1];
      // One report per edge is enough to find it.
      if (a && b && c && check(edge, a, b, c)) break;
    }
  }

  return issues;
}

/** Junctions with a road you cannot turn out of, and dead ends with no room to turn. */
export function turnIssues(graph: RoadGraph): RoadIssue[] {
  const issues: RoadIssue[] = [];
  for (const node of graph.nodes) {
    const rideable = graph
      .edgesAt(node.id)
      .map((id) => graph.getEdge(id))
      .filter(isRideable);
    for (const edge of rideable) {
      // Every road into a junction should lead somewhere other than straight back.
      const onward = rideable.some(
        (other) => other !== edge && canTurn(graph, node.id, edge, other),
      );
      if (rideable.length > 1 && !onward) {
        issues.push({
          kind: 'turn',
          x: node.x,
          z: node.z,
          edge: edge.id,
          detail: `no turn the bike can make out of this ${edge.kind}`,
        });
      }
    }
    if (rideable.length === 1 && !node.boundary) {
      const [edge] = rideable;
      if (edge && !canTurnAround(graph, edge, node.id)) {
        issues.push({
          kind: 'dead-end',
          x: node.x,
          z: node.z,
          edge: edge.id,
          detail: `dead end without room to turn (needs a ${BIKE_TURN_RADIUS.toFixed(1)} m pad)`,
        });
      }
    }
    if (graph.edgesAt(node.id).length === 0) {
      issues.push({
        kind: 'orphan',
        x: node.x,
        z: node.z,
        edge: null,
        detail: 'node with no roads',
      });
    }
  }
  return issues;
}

function segmentDistance(
  a: RoadPoint,
  b: RoadPoint,
  c: RoadPoint,
  d: RoadPoint,
): { distance: number; dy: number; x: number; z: number } {
  // Closest points between two 2D segments: try each endpoint against the other segment,
  // and the crossing point if they cross.
  const project = (p: RoadPoint, s0: RoadPoint, s1: RoadPoint): RoadPoint => {
    const dx = s1.x - s0.x;
    const dz = s1.z - s0.z;
    const length2 = dx * dx + dz * dz;
    const t =
      length2 > 0 ? Math.max(0, Math.min(1, ((p.x - s0.x) * dx + (p.z - s0.z) * dz) / length2)) : 0;
    return { x: s0.x + dx * t, y: s0.y + (s1.y - s0.y) * t, z: s0.z + dz * t };
  };

  const denominator = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
  if (Math.abs(denominator) > 1e-12) {
    const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / denominator;
    const u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const y0 = a.y + (b.y - a.y) * t;
      const y1 = c.y + (d.y - c.y) * u;
      return {
        distance: 0,
        dy: Math.abs(y0 - y1),
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
      };
    }
  }

  let best = { distance: Infinity, dy: 0, x: 0, z: 0 };
  const consider = (p: RoadPoint, q: RoadPoint): void => {
    const distance = Math.hypot(p.x - q.x, p.z - q.z);
    if (distance < best.distance) {
      best = { distance, dy: Math.abs(p.y - q.y), x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
    }
  };
  consider(a, project(a, c, d));
  consider(b, project(b, c, d));
  consider(c, project(c, a, b));
  consider(d, project(d, a, b));
  return best;
}

/**
 * Roads whose paved corridors run into each other anywhere but where they meet. Near a
 * shared node the corridors overlap by design, out to where the angle between the roads
 * has separated them.
 */
export function overlapIssues(graph: RoadGraph): RoadIssue[] {
  interface Segment {
    edge: RoadEdge;
    a: RoadPoint;
    b: RoadPoint;
  }
  const buckets = new Map<number, Segment[]>();
  const key = (ix: number, iz: number): number => (ix + 5000) * 10000 + (iz + 5000);
  for (const edge of graph.edges) {
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (!a || !b) continue;
      const pad = edge.width / 2;
      const ix0 = Math.floor((Math.min(a.x, b.x) - pad) / HASH_CELL);
      const ix1 = Math.floor((Math.max(a.x, b.x) + pad) / HASH_CELL);
      const iz0 = Math.floor((Math.min(a.z, b.z) - pad) / HASH_CELL);
      const iz1 = Math.floor((Math.max(a.z, b.z) + pad) / HASH_CELL);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = key(ix, iz);
          let bucket = buckets.get(k);
          if (!bucket) buckets.set(k, (bucket = []));
          bucket.push({ edge, a, b });
        }
      }
    }
  }

  /** Radius around a shared node inside which two edges may overlap. */
  const exemption = (node: number, first: RoadEdge, second: RoadEdge): number => {
    const u = departure(first, node, 6);
    const v = departure(second, node, 6);
    const angle = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.z * v.z)));
    const halfWidths = (first.width + second.width) / 2;
    return halfWidths / Math.sin(Math.max(0.17, Math.min(Math.PI / 2, angle))) + 1;
  };

  const reported = new Set<string>();
  const issues: RoadIssue[] = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const s = bucket[i];
        const t = bucket[j];
        if (!s || !t || s.edge === t.edge) continue;
        const pair =
          s.edge.id < t.edge.id ? `${s.edge.id}:${t.edge.id}` : `${t.edge.id}:${s.edge.id}`;
        if (reported.has(pair)) continue;
        const hit = segmentDistance(s.a, s.b, t.a, t.b);
        if (hit.distance >= (s.edge.width + t.edge.width) / 2 - 1e-6) continue;
        if (hit.dy > BRIDGE_CLEARANCE) continue;

        let exempt = false;
        for (const node of [s.edge.from, s.edge.to]) {
          if (node !== t.edge.from && node !== t.edge.to) continue;
          const n = graph.getNode(node);
          const radius = Math.max(
            exemption(node, s.edge, t.edge),
            n.pad + Math.max(s.edge.width, t.edge.width),
          );
          if (Math.hypot(hit.x - n.x, hit.z - n.z) < radius) exempt = true;
        }
        if (exempt) continue;

        reported.add(pair);
        issues.push({
          kind: 'overlap',
          x: hit.x,
          z: hit.z,
          edge: s.edge.id,
          detail: `${s.edge.kind} ${s.edge.id} runs into ${t.edge.kind} ${t.edge.id}`,
        });
      }
    }
  }
  return issues;
}

/**
 * Every travel state (edge and direction) the bike can reach from a point, honouring which
 * turns it can make. Starting on an edge you may set off either way.
 */
export function reachableStates(graph: RoadGraph, x: number, z: number): Set<number> {
  const seen = new Set<number>();
  const start = nearestOnGraph(graph, x, z, isRideable);
  if (!start) return seen;
  const stack = [stateOf(start.edge, true), stateOf(start.edge, false)];
  const scratch: number[] = [];
  while (stack.length > 0) {
    const state = stack.pop();
    if (state === undefined || seen.has(state)) continue;
    seen.add(state);
    for (const next of nextStates(graph, state, scratch)) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

/**
 * Rideable edges you cannot get onto from the start, and ones you can ride into but never
 * out of again. Turns are symmetric (a turn ridden backwards is the same corner), so a
 * reachable state whose reverse is unreachable is one you cannot come back from.
 */
export function reachabilityIssues(graph: RoadGraph, x: number, z: number): RoadIssue[] {
  const reached = reachableStates(graph, x, z);
  const issues: RoadIssue[] = [];
  for (const edge of graph.edges) {
    if (!isRideable(edge)) continue;
    const forward = reached.has(stateOf(edge.id, true));
    const backward = reached.has(stateOf(edge.id, false));
    const middle = edge.points[Math.floor(edge.points.length / 2)] ?? edge.points[0];
    if (!middle) continue;
    if (!forward && !backward) {
      issues.push({
        kind: 'unreachable',
        x: middle.x,
        z: middle.z,
        edge: edge.id,
        detail: `${edge.kind} not reachable by bike`,
      });
    } else if (
      (forward && !reached.has(reverseState(stateOf(edge.id, true)))) ||
      (backward && !reached.has(reverseState(stateOf(edge.id, false))))
    ) {
      issues.push({
        kind: 'trap',
        x: middle.x,
        z: middle.z,
        edge: edge.id,
        detail: `${edge.kind} can be ridden into but never back out of`,
      });
    }
  }
  return issues;
}

export function validateGraph(graph: RoadGraph, startX: number, startZ: number): RoadIssue[] {
  return [
    ...gradeIssues(graph),
    ...curveIssues(graph),
    ...turnIssues(graph),
    ...overlapIssues(graph),
    ...reachabilityIssues(graph, startX, startZ),
  ];
}
