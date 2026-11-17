import { Color, InstancedMesh, MeshLambertMaterial, Object3D } from 'three';
import { GeoBuilder } from './geo';
import type { Vec3 } from './geo';
import { FLOOR_HEIGHT } from './houses';
import type { House } from './houses';
import { addCar, wire } from './props';
import type { SolidBox } from './props';
import { createRandom, pick } from './random';
import { pointAlong } from './roads/graph';
import type { AreaId, RoadEdge, RoadGraph } from './roads/graph';

/**
 * Street life for the favela, from the road graph and the houses: concrete poles with the
 * tangle of power and phone cables strung between them and down to the houses, cars
 * parked along the wider roads, and motorbikes parked everywhere (one instanced mesh).
 */

const POLE = 0x9a968e;
const BIKE_PAINT = [0xd8d8d8, 0xc0302a, 0x1d1f22, 0x2a5fb0, 0xe0b020, 0x3a3a3c] as const;
/** Along a road, poles about this far apart. */
const POLE_SPACING = 26;
const NODE_CLEARANCE = 12;
const MAX_BIKES = 260;

interface Placement {
  edge: RoadEdge;
  along: number;
  x: number;
  y: number;
  z: number;
  /** Unit direction along the road, and the outward normal on the chosen side. */
  tx: number;
  tz: number;
  nx: number;
  nz: number;
}

/** A point on an edge, offset sideways, with the local frame. */
function placeOn(edge: RoadEdge, along: number, side: number, offset: number): Placement {
  const p = pointAlong(edge.points, along);
  const ahead = pointAlong(edge.points, Math.min(edge.length, along + 1.5));
  const behind = pointAlong(edge.points, Math.max(0, along - 1.5));
  const length = Math.hypot(ahead.x - behind.x, ahead.z - behind.z) || 1;
  const tx = (ahead.x - behind.x) / length;
  const tz = (ahead.z - behind.z) / length;
  const nx = tz * side;
  const nz = -tx * side;
  return { edge, along, x: p.x + nx * offset, y: p.y, z: p.z + nz * offset, tx, tz, nx, nz };
}

/** How sharply an edge bends around a point, in radians over a few metres. */
function bendAt(edge: RoadEdge, along: number): number {
  const a = placeOn(edge, Math.max(0, along - 5), 1, 0);
  const b = placeOn(edge, Math.min(edge.length, along + 5), 1, 0);
  return Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
}

function nearNode(graph: RoadGraph, x: number, z: number, distance: number): boolean {
  return graph.nodes.some((node) => Math.hypot(node.x - x, node.z - z) < distance);
}

export interface FavelaProps {
  bikes: InstancedMesh;
}

export function addFavelaProps(
  city: GeoBuilder,
  wires: number[],
  solids: SolidBox[],
  graph: RoadGraph,
  houses: readonly House[],
  area: AreaId,
  seed: number,
): FavelaProps {
  const random = createRandom(seed * 1103 + 7);
  const edges = graph.edges.filter((edge) => edge.area === area && edge.kind !== 'stairs');
  const roofs = houses.map((house) => ({
    house,
    top: house.floorY + house.floors * FLOOR_HEIGHT,
  }));

  // Poles along every street, on alternating sides, with cables between them and drops
  // to the nearest houses: the overhead tangle that every favela street has.
  for (const edge of edges) {
    let previous: Vec3 | null = null;
    const side = random() < 0.5 ? 1 : -1;
    for (
      let along = 6 + random() * 8;
      along < edge.length - 4;
      along += POLE_SPACING * (0.8 + random() * 0.4)
    ) {
      // At the very edge of the road, inside the strip the houses leave clear.
      const place = placeOn(edge, along, side, edge.width / 2 - 0.15);
      city.setFrame(place.x, place.y, place.z, Math.atan2(place.tx, place.tz));
      city.box(0, 4, 0, 0.22, 8, 0.22, POLE, 0.75);
      city.box(0, 7.4, 0, 1.2, 0.1, 0.1, POLE);
      if (random() < 0.4) city.cylinder(0.35, 0, 5.6, 6.4, 0.25, 6, 0x6f7275);
      const head: Vec3 = [place.x, place.y + 7.4, place.z];
      if (previous) {
        for (let k = 0; k < 3 + Math.floor(random() * 3); k++) {
          const drop = (random() - 0.5) * 0.6;
          wire(
            wires,
            [previous[0], previous[1] - k * 0.3 + drop, previous[2]],
            [head[0], head[1] - k * 0.3, head[2]],
            0.4 + random() * 0.9,
          );
        }
      }
      // Drops to two or three houses nearby, most of them on the far side of the street.
      const near = roofs
        .filter(({ house }) => Math.hypot(house.x - place.x, house.z - place.z) < 14)
        .slice(0, 3);
      for (const { house, top } of near) {
        wire(
          wires,
          [head[0], head[1] - 0.6, head[2]],
          [
            house.x + (random() - 0.5) * 2,
            Math.min(top, place.y + 6) - 0.5,
            house.z + (random() - 0.5) * 2,
          ],
          0.5 + random() * 0.6,
          4,
        );
      }
      previous = head;
    }
  }
  city.resetFrame();

  // Cars parked along the wider roads, nose to tail in places, never at a junction or in a
  // bend where they would block the line.
  for (const edge of edges) {
    if (edge.kind !== 'main' && edge.kind !== 'secondary') continue;
    const side = random() < 0.5 ? 1 : -1;
    for (let along = 10; along < edge.length - 10; along += 6 + random() * 18) {
      if (random() < 0.45 || bendAt(edge, along) > 0.25) continue;
      const place = placeOn(edge, along, side, edge.width / 2 - 1.05);
      if (nearNode(graph, place.x, place.z, NODE_CLEARANCE)) continue;
      addCar(city, solids, place.x, place.z, Math.atan2(place.tx, place.tz), random, place.y);
    }
  }
  city.resetFrame();

  // Motorbikes: the delivery riders' and everyone else's, parked at the edge of every
  // street, mostly in ones and twos outside houses.
  const bikeShape = new GeoBuilder();
  // A small street motorcycle: thin wheels, a step-through body, seat, bars and a light.
  bikeShape.box(0, 0.3, 0.6, 0.08, 0.6, 0.6, 0x1b1b1d);
  bikeShape.box(0, 0.3, -0.6, 0.1, 0.6, 0.6, 0x1b1b1d);
  bikeShape.box(0, 0.42, 0, 0.18, 0.16, 1.0, 0x2a2a2c);
  bikeShape.box(0, 0.68, -0.28, 0.28, 0.3, 0.7, 0xffffff);
  bikeShape.box(0, 0.86, -0.28, 0.26, 0.08, 0.66, 0x202022);
  bikeShape.box(0, 0.78, 0.48, 0.2, 0.5, 0.14, 0xffffff);
  bikeShape.box(0, 1.04, 0.5, 0.64, 0.04, 0.04, 0x333333);
  bikeShape.box(0, 0.95, 0.58, 0.16, 0.12, 0.06, 0xf4f0d8);
  // The delivery box many of them carry.
  bikeShape.box(0, 1.08, -0.62, 0.42, 0.36, 0.4, 0xffffff);
  const bikes = new InstancedMesh(
    bikeShape.build(),
    new MeshLambertMaterial({ vertexColors: true }),
    MAX_BIKES,
  );
  const dummy = new Object3D();
  const tint = new Color();
  let count = 0;
  for (const edge of edges) {
    for (let along = 5; along < edge.length - 5 && count < MAX_BIKES; along += 9 + random() * 24) {
      const side = random() < 0.5 ? 1 : -1;
      const place = placeOn(edge, along, side, edge.width / 2 - 0.45);
      if (nearNode(graph, place.x, place.z, 6)) continue;
      const group = random() < 0.3 ? 2 : 1;
      for (let k = 0; k < group && count < MAX_BIKES; k++) {
        // Parked at an angle to the kerb, leaning on the stand.
        const yaw = Math.atan2(place.tx, place.tz) + side * (0.9 + random() * 0.5);
        dummy.position.set(place.x + place.tx * k * 0.9, place.y, place.z + place.tz * k * 0.9);
        dummy.rotation.set(0, yaw, side * 0.12);
        dummy.updateMatrix();
        bikes.setMatrixAt(count, dummy.matrix);
        bikes.setColorAt(count, tint.setHex(pick(random, BIKE_PAINT)));
        count += 1;
      }
    }
  }
  bikes.count = count;
  bikes.instanceMatrix.needsUpdate = true;
  if (bikes.instanceColor) bikes.instanceColor.needsUpdate = true;
  bikes.computeBoundingSphere();
  return { bikes };
}
