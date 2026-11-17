import { describe, expect, it } from 'vitest';
import { AVENUE_Z, CROSS_STREETS, HILL_STREETS_X, SPAWN, surfaceAt } from '../layout';
import { BIKE_TURN_RADIUS, RoadGraph, isRideable, nearestOnGraph } from './graph';
import type { RoadPoint } from './graph';
import { buildRoadNetwork } from './network';
import { findRoute } from './route';
import { cornerRadius } from './turns';
import {
  curveIssues,
  gradeIssues,
  overlapIssues,
  reachabilityIssues,
  turnIssues,
  validateGraph,
} from './validate';

/** Points every `step` metres along a straight line, ends excluded, at height 0. */
function straight(x0: number, z0: number, x1: number, z1: number, step = 2): RoadPoint[] {
  const out: RoadPoint[] = [];
  const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / step);
  for (let i = 1; i < n; i++)
    out.push({ x: x0 + ((x1 - x0) * i) / n, y: 0, z: z0 + ((z1 - z0) * i) / n });
  return out;
}

describe('RoadGraph', () => {
  it('merges nodes at the same spot and records incident edges', () => {
    const graph = new RoadGraph();
    const a = graph.node(0, 0, 0);
    const b = graph.node(10, 0, 0);
    expect(graph.node(0.01, 0, 0)).toBe(a);
    const edge = graph.edge(a, b, straight(0, 0, 10, 0), { kind: 'lane', area: 'hillside' });
    expect(graph.edgesAt(a)).toEqual([edge]);
    expect(graph.getEdge(edge).length).toBeCloseTo(10);
    expect(graph.getEdge(edge).width).toBe(3);
  });

  it('keeps stacked nodes apart when their heights differ (bridges)', () => {
    const graph = new RoadGraph();
    expect(graph.node(0, 0, 0)).not.toBe(graph.node(0, 6, 0));
  });

  it('finds the nearest point on the graph', () => {
    const graph = new RoadGraph();
    graph.edge(graph.node(0, 0, 0), graph.node(10, 2, 0), [], { kind: 'lane', area: 'hillside' });
    const hit = nearestOnGraph(graph, 5, 3);
    expect(hit?.along).toBeCloseTo(5);
    expect(hit?.distance).toBeCloseTo(3);
    expect(hit?.y).toBeCloseTo(1);
  });
});

describe('turns', () => {
  it('lets a wide corner be taken in a sweep and a narrow hairpin not', () => {
    expect(cornerRadius(3, Math.PI / 2)).toBeGreaterThan(BIKE_TURN_RADIUS);
    expect(cornerRadius(3, Math.PI)).toBeLessThan(BIKE_TURN_RADIUS);
    expect(cornerRadius(5, Math.PI)).toBeGreaterThan(BIKE_TURN_RADIUS);
    expect(cornerRadius(2, 0)).toBe(Infinity);
  });

  it('flags a lane dead end with no turning pad, and not one with a pad', () => {
    const graph = new RoadGraph();
    const a = graph.node(0, 0, 0);
    graph.edge(a, graph.node(0, 0, 20), straight(0, 0, 0, 20), { kind: 'lane', area: 'hillside' });
    graph.edge(a, graph.node(20, 0, 0, { pad: 5 }), straight(0, 0, 20, 0), {
      kind: 'lane',
      area: 'hillside',
    });
    const deadEnds = turnIssues(graph).filter((issue) => issue.kind === 'dead-end');
    expect(deadEnds).toHaveLength(1);
    expect(deadEnds[0]?.z).toBe(20);
  });

  it('finds roads you can ride into but not back out of', () => {
    const graph = new RoadGraph();
    const a = graph.node(0, 0, 0, { pad: 5 });
    const b = graph.node(0, 0, 30);
    graph.edge(a, b, straight(0, 0, 0, 30), { kind: 'secondary', area: 'hillside' });
    // A lane doubling straight back from b: you can ride into it, but it is a dead end
    // with no room to turn.
    graph.edge(b, graph.node(1, 0, 10), straight(0, 30, 1, 10), {
      kind: 'alley',
      area: 'hillside',
    });
    const issues = reachabilityIssues(graph, 0, 1);
    expect(issues.some((issue) => issue.kind === 'unreachable')).toBe(true);
  });
});

describe('validation checks', () => {
  it('reports a grade above the limit for its kind', () => {
    const graph = new RoadGraph();
    graph.edge(
      graph.node(0, 0, 0),
      graph.node(0, 4, 20),
      straight(0, 0, 0, 20).map((p) => ({ ...p, y: p.z / 5 })),
      {
        kind: 'main',
        area: 'hillside',
      },
    );
    expect(gradeIssues(graph)).toHaveLength(1);
  });

  it('reports a curve tighter than its kind allows', () => {
    const graph = new RoadGraph();
    const points: RoadPoint[] = [];
    // A quarter circle of radius 5: fine for a lane, too tight for a main road.
    for (let i = 1; i < 8; i++) {
      const angle = (i / 8) * (Math.PI / 2);
      points.push({ x: 5 - 5 * Math.cos(angle), y: 0, z: 5 * Math.sin(angle) });
    }
    const a = graph.node(0, 0, 0);
    const b = graph.node(5, 0, 5);
    graph.edge(a, b, points, { kind: 'lane', area: 'hillside' });
    expect(curveIssues(graph)).toHaveLength(0);
    graph.edge(
      graph.node(100, 0, 0),
      graph.node(105, 0, 5),
      points.map((p) => ({ ...p, x: p.x + 100 })),
      {
        kind: 'main',
        area: 'hillside',
      },
    );
    expect(curveIssues(graph)).toHaveLength(1);
  });

  it('reports roads crossing without a junction, but not a bridge', () => {
    const graph = new RoadGraph();
    graph.edge(graph.node(-20, 0, 0), graph.node(20, 0, 0), straight(-20, 0, 20, 0), {
      kind: 'lane',
      area: 'hillside',
    });
    graph.edge(graph.node(0, 0, -20), graph.node(0, 0, 20), straight(0, -20, 0, 20), {
      kind: 'lane',
      area: 'hillside',
    });
    expect(overlapIssues(graph)).toHaveLength(1);

    const bridged = new RoadGraph();
    bridged.edge(bridged.node(-20, 0, 0), bridged.node(20, 0, 0), straight(-20, 0, 20, 0), {
      kind: 'lane',
      area: 'hillside',
    });
    bridged.edge(
      bridged.node(0, 6, -20),
      bridged.node(0, 6, 20),
      straight(0, -20, 0, 20).map((p) => ({ ...p, y: 6 })),
      { kind: 'lane', area: 'hillside' },
    );
    expect(overlapIssues(bridged)).toHaveLength(0);
  });
});

describe('the city network', () => {
  const graph = buildRoadNetwork();

  it('passes every check', () => {
    expect(validateGraph(graph, SPAWN.x, SPAWN.z)).toEqual([]);
  });

  it('has a node at every intersection', () => {
    // Avenue ends and junctions, then each hill street at each cross street.
    expect(graph.nodes).toHaveLength(2 + HILL_STREETS_X.length * (1 + CROSS_STREETS.length));
  });

  it('lies on the asphalt and cobblestones of the city ground', () => {
    for (const edge of graph.edges) {
      for (const point of edge.points) {
        expect(['asphalt', 'cobble']).toContain(surfaceAt(point.x, point.z));
      }
    }
  });

  it('spawns the rider on a road', () => {
    const hit = nearestOnGraph(graph, SPAWN.x, SPAWN.z, isRideable);
    expect(hit?.distance).toBeLessThan(3);
  });

  it('routes from the seafront to the top of the hill', () => {
    const route = findRoute(graph, -120, AVENUE_Z, 60, 135, 'ride');
    expect(route).not.toBeNull();
    // At least the straight-line distance, no more than a sensible detour.
    const crow = Math.hypot(180, 135 - AVENUE_Z);
    expect(route?.length).toBeGreaterThan(crow);
    expect(route?.length).toBeLessThan(crow * 1.5);
    expect(route?.edges[0]).toBe(nearestOnGraph(graph, -120, AVENUE_Z)?.edge);
  });

  it('routes along a single edge', () => {
    const route = findRoute(graph, -140, AVENUE_Z, -100, AVENUE_Z, 'ride');
    expect(route?.length).toBeCloseTo(40);
    expect(route?.edges).toHaveLength(1);
  });
});
