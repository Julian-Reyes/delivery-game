import {
  AVENUE_Z,
  AVENUE_Z_MAX,
  AVENUE_Z_MIN,
  CELL,
  CROSS_STREETS,
  HALF,
  HILL_STREETS_X,
  ROAD_HALF,
  heightAt,
} from '../layout';
import type { RoadGraph, RoadPoint } from './graph';

/**
 * The original grid city as graph edges. Its ground and markings are still built from
 * `layout.ts` cell by cell; this mirrors the same streets so routing and the debug map see
 * one connected network. `city.test.ts` checks the two agree.
 */

/** Centreline points strictly between two values, one per cell, following the ground. */
function along(
  from: number,
  to: number,
  point: (t: number) => { x: number; z: number },
): RoadPoint[] {
  const out: RoadPoint[] = [];
  const steps = Math.round(Math.abs(to - from) / CELL);
  for (let i = 1; i < steps; i++) {
    const { x, z } = point(from + ((to - from) * i) / steps);
    out.push({ x, y: heightAt(x, z), z });
  }
  return out;
}

export function addCityStreets(graph: RoadGraph): void {
  const node = (x: number, z: number, boundary = false): number =>
    graph.node(x, heightAt(x, z), z, { boundary });

  // The avenue, west tunnel mouth to east tunnel mouth, with a node at every hill street.
  const avenueXs = [-HALF, ...HILL_STREETS_X, HALF];
  for (let i = 1; i < avenueXs.length; i++) {
    const x0 = avenueXs[i - 1];
    const x1 = avenueXs[i];
    if (x0 === undefined || x1 === undefined) continue;
    graph.edge(
      node(x0, AVENUE_Z, i === 1),
      node(x1, AVENUE_Z, i === avenueXs.length - 1),
      along(x0, x1, (x) => ({ x, z: AVENUE_Z })),
      { kind: 'avenue', area: 'city', width: AVENUE_Z_MAX - AVENUE_Z_MIN, name: 'Seafront' },
    );
  }

  // Hill streets climb from the avenue to the top cross street.
  const crossZs = CROSS_STREETS.map((street) => street.z);
  HILL_STREETS_X.forEach((x, column) => {
    const stops = [AVENUE_Z, ...crossZs];
    for (let i = 1; i < stops.length; i++) {
      const z0 = stops[i - 1];
      const z1 = stops[i];
      if (z0 === undefined || z1 === undefined) continue;
      graph.edge(
        node(x, z0),
        node(x, z1),
        along(z0, z1, (z) => ({ x, z })),
        { kind: 'street', area: 'city', width: ROAD_HALF * 2, name: `Hill street ${column + 1}` },
      );
    }
  });

  // Cross streets join neighbouring hill streets on each terrace.
  CROSS_STREETS.forEach((street, row) => {
    for (let i = 1; i < HILL_STREETS_X.length; i++) {
      const x0 = HILL_STREETS_X[i - 1];
      const x1 = HILL_STREETS_X[i];
      if (x0 === undefined || x1 === undefined) continue;
      graph.edge(
        node(x0, street.z),
        node(x1, street.z),
        along(x0, x1, (x) => ({ x, z: street.z })),
        {
          kind: 'street',
          area: 'city',
          surface: street.surface,
          width: ROAD_HALF * 2,
          name: `Cross street ${row + 1}`,
        },
      );
    }
  });
}
