import { describe, expect, it } from 'vitest';
import { RoadPlan, filletPath, fitProfile } from './design';
import { RoadGraph } from './graph';
import { curveIssues } from './validate';

describe('filletPath', () => {
  it('rounds corners with the given radius and samples densely', () => {
    const path = filletPath(
      [
        [0, 0],
        [0, 50, 10],
        [50, 50],
      ],
      10,
    );
    const first = path[0];
    const last = path[path.length - 1];
    expect(first).toEqual({ x: 0, z: 0 });
    expect(last?.x).toBeCloseTo(50);
    expect(last?.z).toBeCloseTo(50);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (a && b) expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThanOrEqual(2.01);
    }
    // The arc's centre is (10, 40): every point near the corner is 10 m from it.
    const onArc = path.filter((p) => p.x > 0.5 && p.z < 49.5 && p.z > 40.5);
    expect(onArc.length).toBeGreaterThan(3);
    for (const p of onArc) expect(Math.hypot(p.x - 10, p.z - 40)).toBeCloseTo(10, 4);
  });

  it('refuses a corner whose arc does not fit', () => {
    expect(() =>
      filletPath(
        [
          [0, 0],
          [0, 5, 20],
          [5, 5],
        ],
        20,
      ),
    ).toThrow();
  });

  it('makes hairpins from two corners that pass the curve check', () => {
    const plan = new RoadPlan();
    plan.design({
      name: 'test',
      kind: 'main',
      area: 'hillside',
      controls: [
        [0, 0],
        [80, 0, 12],
        [80, 30, 12],
        [0, 30],
      ],
      groundAt: () => 0,
    });
    const graph = new RoadGraph();
    plan.commit(graph);
    expect(curveIssues(graph)).toEqual([]);
  });
});

describe('fitProfile', () => {
  const straight = Array.from({ length: 101 }, (_, i) => ({ x: 0, z: i * 2 }));

  it('never exceeds the grade limit, even up a cliff', () => {
    const y = fitProfile(straight, (_, z) => (z > 100 ? 40 : 0), 0.1, 0);
    for (let i = 1; i < y.length; i++) {
      expect(Math.abs((y[i] ?? 0) - (y[i - 1] ?? 0)) / 2).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it('holds pinned ends and follows gentle ground', () => {
    const y = fitProfile(straight, (_, z) => z * 0.05, 0.1, 0, 10);
    expect(y[0]).toBe(0);
    expect(y[y.length - 1]).toBe(10);
    expect(y[50]).toBeCloseTo(5, 0);
  });
});

describe('RoadPlan', () => {
  it('splits a road where a branch joins it, sharing the node', () => {
    const plan = new RoadPlan();
    const trunk = plan.design({
      name: 'trunk',
      kind: 'secondary',
      area: 'hillside',
      controls: [
        [0, 0],
        [0, 100],
      ],
      groundAt: () => 0,
    });
    const join = plan.junction(trunk, 3, 50);
    plan.design({
      name: 'branch',
      kind: 'secondary',
      area: 'hillside',
      controls: [
        [40, 50],
        [join.x, join.z],
      ],
      groundAt: () => 0,
      endY: join.y,
    });
    const graph = new RoadGraph();
    plan.commit(graph);
    expect(graph.edges).toHaveLength(3);
    const junction = graph.nodes.find((node) => graph.edgesAt(node.id).length === 3);
    expect(junction?.z).toBeCloseTo(50);
  });
});
