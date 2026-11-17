import { Color, InstancedMesh, MeshLambertMaterial, Object3D } from 'three';
import type { Group, Scene } from 'three';
import { GeoBuilder } from './geo';
import type { Vec3 } from './geo';
import { FLOOR_HEIGHT, frontDoor } from './houses';
import type { DeliverySpot, House } from './houses';
import { wire } from './props';
import { createRandom, pick } from './random';
import { nearestOnGraph } from './roads/graph';
import type { AreaId, RoadEdge, RoadGraph } from './roads/graph';
import type { Terrain } from './terrain';

/**
 * What makes the favela feel lived in: people walking its streets and stairs, standing at
 * their doors and sitting at bar tables; washing strung across the lanes and over the
 * roofs; kites over the hill; trees and pot plants; plastic tables outside the corner
 * bars; air conditioners and satellite dishes on the walls.
 *
 * Everything static goes into the shared merged meshes. The people and kites are
 * instanced (one draw call per body part) and animated every frame. They are scenery:
 * the bike rides through them for now.
 */

const SHIRTS = [
  0xe8553b, 0xf2c14e, 0x2a9d8f, 0x3b82f6, 0xf7f4ec, 0x1d1f22, 0x9b5de5, 0x00bb6d, 0xff8fab,
] as const;
const SKIN = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5c3a1e, 0x7a4a2a] as const;
const TROUSERS = [0x2b3a55, 0x1d1f22, 0x3f4e3a, 0x6b6b6b, 0x2f5f9e, 0x5a3d2b] as const;
const CLOTHES = [
  0xf7f4ec, 0xe8553b, 0x3b82f6, 0xf2c14e, 0x1d1f22, 0xff8fab, 0x2a9d8f, 0x9bc1e8,
] as const;
const KITES = [0xe8553b, 0xf2c14e, 0x3b82f6, 0x00bb6d, 0xf15bb5, 0x9b5de5] as const;
const PLASTIC = [0xd9312b, 0xf2c14e, 0xf4f1ea, 0x2a6fdb] as const;
const LEAVES = [0x3d7d3a, 0x4c9144, 0x2f6b33, 0x5a9e4a] as const;
const TRUNK = 0x5d4630;
const AC = 0xe6e3dc;

const WALKERS = 130;
const STANDERS = 45;
const KITE_COUNT = 12;
const MAX_PEOPLE = WALKERS + STANDERS + 40;

type Random = () => number;

interface Walker {
  edge: RoadEdge;
  /** Index of the centreline segment and how far along it, in metres. */
  segment: number;
  offset: number;
  forward: boolean;
  speed: number;
  /** Sideways from the centreline: at the road edge, or anywhere across a stair. */
  side: number;
  phase: number;
}

interface Still {
  x: number;
  y: number;
  z: number;
  yaw: number;
  seated: boolean;
  phase: number;
}

interface Kite {
  x: number;
  y: number;
  z: number;
  phase: number;
}

/** One person's body parts: torso and arms, head, and the two legs. */
function personShapes(): { torso: GeoBuilder; head: GeoBuilder; leg: GeoBuilder } {
  const torso = new GeoBuilder();
  torso.box(0, 1.17, 0, 0.42, 0.6, 0.24, 0xffffff);
  torso.box(0.27, 1.12, 0, 0.11, 0.56, 0.13, 0xffffff);
  torso.box(-0.27, 1.12, 0, 0.11, 0.56, 0.13, 0xffffff);
  const head = new GeoBuilder();
  head.box(0, 1.62, 0, 0.23, 0.26, 0.24, 0xffffff);
  head.box(0, 1.77, -0.01, 0.25, 0.07, 0.26, 0x2a1d14);
  // Legs hang from the hip at the origin, so a rotation swings them.
  const leg = new GeoBuilder();
  leg.box(0, -0.42, 0, 0.16, 0.84, 0.18, 0xffffff);
  leg.box(0, -0.84, 0.05, 0.17, 0.08, 0.28, 0x222222);
  return { torso, head, leg };
}

function instanced(shape: GeoBuilder, count: number): InstancedMesh {
  const mesh = new InstancedMesh(
    shape.build(),
    new MeshLambertMaterial({ vertexColors: true }),
    count,
  );
  mesh.frustumCulled = false;
  return mesh;
}

export class FavelaLife {
  private readonly torsos: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly legs: InstancedMesh;
  private readonly kites: InstancedMesh;
  private readonly walkers: Walker[] = [];
  private readonly stills: Still[] = [];
  private readonly kiteSpots: Kite[] = [];
  private readonly dummy = new Object3D();
  private time = 0;

  constructor(
    scene: Group | Scene,
    city: GeoBuilder,
    wires: number[],
    private readonly graph: RoadGraph,
    houses: readonly House[],
    spots: readonly DeliverySpot[],
    terrain: Terrain,
    area: AreaId,
    seed: number,
  ) {
    const random = createRandom(seed * 2654435761 + 3);
    const shapes = personShapes();
    this.torsos = instanced(shapes.torso, MAX_PEOPLE);
    this.heads = instanced(shapes.head, MAX_PEOPLE);
    this.legs = instanced(shapes.leg, MAX_PEOPLE * 2);
    const kite = new GeoBuilder();
    kite.quadDouble([0, 0.55, 0], [0.42, 0, 0], [0, -0.6, 0], [-0.42, 0, 0], 0xffffff);
    kite.quadDouble([-0.04, -0.6, 0], [0.04, -0.6, 0], [0.04, -2.2, 0], [-0.04, -2.2, 0], 0xffffff);
    this.kites = instanced(kite, KITE_COUNT);
    scene.add(this.torsos, this.heads, this.legs, this.kites);

    const edges = graph.edges.filter((edge) => edge.area === area);
    const shops = new Set(spots.filter((s) => s.kind === 'pickup').map((s) => s.house));
    this.placeWalkers(edges, random);
    this.dressHouses(city, houses, shops, random);
    this.addBars(city, houses, shops, random);
    this.addLaundry(city, wires, houses, random);
    this.addTrees(city, houses, terrain, edges, random);
    this.addKites(wires, houses, random);
    this.paintPeople(random);
  }

  /** Move the people and the kites. Call once per rendered frame. */
  animate(dt: number): void {
    this.time += dt;
    const d = this.dummy;
    let index = 0;

    for (const walker of this.walkers) {
      this.advance(walker, dt);
      const { edge } = walker;
      const a = edge.points[walker.segment];
      const b = edge.points[walker.segment + 1];
      if (!a || !b) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const t = walker.offset / length;
      const tx = (b.x - a.x) / length;
      const tz = (b.z - a.z) / length;
      const x = a.x + (b.x - a.x) * t + tz * walker.side;
      const z = a.z + (b.z - a.z) * t - tx * walker.side;
      const y = a.y + (b.y - a.y) * t;
      const yaw = Math.atan2(tx, tz) + (walker.forward ? 0 : Math.PI);
      walker.phase += dt * walker.speed * 4.2;
      this.pose(
        index,
        x,
        y,
        z,
        yaw,
        Math.sin(walker.phase) * 0.5,
        Math.abs(Math.sin(walker.phase)) * 0.04,
      );
      index += 1;
    }
    for (const still of this.stills) {
      // People standing about shift their weight now and then.
      const sway = Math.sin(this.time * 0.8 + still.phase) * 0.06;
      this.pose(
        index,
        still.x,
        still.y,
        still.z,
        still.yaw + sway,
        still.seated ? -1.4 : 0,
        0,
        still.seated,
      );
      index += 1;
    }
    this.torsos.count = index;
    this.heads.count = index;
    this.legs.count = index * 2;
    this.torsos.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;

    this.kiteSpots.forEach((kite, i) => {
      const t = this.time * 0.9 + kite.phase;
      d.position.set(
        kite.x + Math.sin(t) * 1.2,
        kite.y + Math.sin(t * 1.7) * 0.8,
        kite.z + Math.cos(t * 0.8) * 0.9,
      );
      d.rotation.set(0.25 + Math.sin(t * 2.1) * 0.15, kite.phase, Math.sin(t * 1.3) * 0.35);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.kites.setMatrixAt(i, d.matrix);
    });
    this.kites.instanceMatrix.needsUpdate = true;
  }

  /** Place one person's torso, head and legs. `swing` swings the legs; `bob` lifts the body. */
  private pose(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    swing: number,
    bob: number,
    seated = false,
  ): void {
    const d = this.dummy;
    const drop = seated ? 0.45 : 0;
    d.scale.set(1, 1, 1);
    d.rotation.set(0, yaw, 0);
    d.position.set(x, y + bob - drop, z);
    d.updateMatrix();
    this.torsos.setMatrixAt(index, d.matrix);
    this.heads.setMatrixAt(index, d.matrix);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    for (const [k, side] of [
      [0, 1],
      [1, -1],
    ] as const) {
      d.position.set(x + cos * 0.1 * side, y + 0.86 + bob - drop, z - sin * 0.1 * side);
      // Seated: both legs forward. Walking: one forward, one back.
      d.rotation.set(seated ? swing : swing * side, yaw, 0, 'YXZ');
      d.updateMatrix();
      this.legs.setMatrixAt(index * 2 + k, d.matrix);
    }
    d.rotation.order = 'XYZ';
  }

  private advance(walker: Walker, dt: number): void {
    let remaining = walker.speed * dt;
    for (let guard = 0; guard < 8 && remaining > 0; guard++) {
      const { edge } = walker;
      const a = edge.points[walker.segment];
      const b = edge.points[walker.segment + 1];
      if (!a || !b) return;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (walker.forward) {
        const room = length - walker.offset;
        if (remaining < room) {
          walker.offset += remaining;
          return;
        }
        remaining -= room;
        if (walker.segment + 2 < edge.points.length) {
          walker.segment += 1;
          walker.offset = 0;
        } else {
          this.turnOnto(walker, edge.to);
        }
      } else {
        if (remaining < walker.offset) {
          walker.offset -= remaining;
          return;
        }
        remaining -= walker.offset;
        if (walker.segment > 0) {
          walker.segment -= 1;
          const p = edge.points[walker.segment];
          const q = edge.points[walker.segment + 1];
          walker.offset = p && q ? Math.hypot(q.x - p.x, q.z - p.z) : 0;
        } else {
          this.turnOnto(walker, edge.from);
        }
      }
    }
  }

  /** At the end of a street, carry on along another from the same corner, or turn back. */
  private turnOnto(walker: Walker, node: number): void {
    const options = this.graph
      .edgesAt(node)
      .map((id) => this.graph.getEdge(id))
      .filter((edge) => edge.area === walker.edge.area && edge !== walker.edge);
    const next = options[Math.floor(Math.random() * options.length)];
    if (!next) {
      walker.forward = !walker.forward;
      return;
    }
    walker.edge = next;
    walker.forward = next.from === node;
    walker.segment = walker.forward ? 0 : next.points.length - 2;
    const p = next.points[walker.segment];
    const q = next.points[walker.segment + 1];
    walker.offset = walker.forward ? 0 : p && q ? Math.hypot(q.x - p.x, q.z - p.z) : 0;
    walker.side = this.sideFor(next, walker.side >= 0 ? 1 : -1);
  }

  /** Walk at the edge of a road, out of the bike's way; anywhere across a stair. */
  private sideFor(edge: RoadEdge, sign: number): number {
    if (edge.kind === 'stairs') return (Math.random() - 0.5) * edge.width * 0.7;
    return sign * (edge.width / 2 + 0.35);
  }

  private placeWalkers(edges: readonly RoadEdge[], random: Random): void {
    // Stairs and lanes are busier than the main roads.
    const weighted = edges.flatMap((edge) =>
      edge.kind === 'stairs' || edge.kind === 'lane' || edge.kind === 'alley'
        ? [edge, edge, edge]
        : [edge],
    );
    for (let i = 0; i < WALKERS && weighted.length > 0; i++) {
      const edge = weighted[Math.floor(random() * weighted.length)];
      if (!edge || edge.points.length < 2) continue;
      const segment = Math.floor(random() * (edge.points.length - 1));
      this.walkers.push({
        edge,
        segment,
        offset: 0,
        forward: random() < 0.5,
        speed: 0.9 + random() * 0.7,
        side: this.sideFor(edge, random() < 0.5 ? 1 : -1),
        phase: random() * Math.PI * 2,
      });
    }
  }

  /** Air conditioners under windows, satellite dishes, pot plants, people at their doors. */
  private dressHouses(
    city: GeoBuilder,
    houses: readonly House[],
    shops: ReadonlySet<number>,
    random: Random,
  ): void {
    let standers = 0;
    for (const house of houses) {
      const top = house.floorY + house.floors * FLOOR_HEIGHT;
      city.setFrame(house.x, 0, house.z, house.yaw);
      const d = house.depth / 2;
      for (let floor = 1; floor < house.floors; floor++) {
        if (random() < 0.3) {
          const x = (random() - 0.5) * (house.width - 1.2);
          city.box(
            x,
            house.floorY + floor * FLOOR_HEIGHT + 0.55,
            d + 0.2,
            0.75,
            0.45,
            0.4,
            AC,
            0.75,
          );
        }
      }
      if (random() < 0.18) {
        // A satellite dish on a short post at the roof edge.
        const x = (random() - 0.5) * (house.width - 1);
        city.box(x, top + 0.5, d - 0.3, 0.05, 0.7, 0.05, 0x777777);
        city.cylinder(x, d - 0.2, top + 0.75, top + 0.8, 0.32, 8, 0xd8d8d8);
      }
      if (house.street !== null && random() < 0.12) {
        // Pot plants either side of the door.
        for (const side of [-0.9, 0.9]) {
          city.box(side, house.floorY + 0.18, d + 0.25, 0.32, 0.36, 0.32, 0xb5643c, 0.8);
          city.blob(side, house.floorY + 0.55, d + 0.25, 0.32, 0.32, 0.32, pick(random, LEAVES));
        }
      }
      if (random() < 0.06) {
        // Plants on the roof.
        city.blob(
          (random() - 0.5) * 2,
          top + 0.6,
          (random() - 0.5) * 2,
          0.6,
          0.5,
          0.6,
          pick(random, LEAVES),
        );
      }
      if (house.street !== null && !shops.has(house.id) && standers < STANDERS && random() < 0.08) {
        const door = frontDoor(house);
        const out = 0.6 + random() * 0.6;
        this.stills.push({
          x: door.x + Math.sin(house.yaw) * out + Math.cos(house.yaw) * (random() - 0.5) * 2,
          y: house.floorY - 0.15,
          z: door.z + Math.cos(house.yaw) * out - Math.sin(house.yaw) * (random() - 0.5) * 2,
          yaw: house.yaw + (random() - 0.5) * 1.2,
          seated: false,
          phase: random() * 10,
        });
        standers += 1;
      }
    }
    city.resetFrame();
  }

  /** Plastic tables and chairs outside a few houses on the bigger roads, with people at them. */
  private addBars(
    city: GeoBuilder,
    houses: readonly House[],
    shops: ReadonlySet<number>,
    random: Random,
  ): void {
    let bars = 0;
    for (const house of houses) {
      if (bars >= 9 || house.street === null || shops.has(house.id)) continue;
      const street = this.graph.getEdge(house.street);
      if (street.kind !== 'main' && street.kind !== 'secondary') continue;
      if (random() > 0.06) continue;
      bars += 1;
      const color = pick(random, PLASTIC);
      const door = frontDoor(house);
      const fx = Math.sin(house.yaw);
      const fz = Math.cos(house.yaw);
      const rx = fz;
      const rz = -fx;
      for (const along of [-1.6, 1.6]) {
        const x = door.x + fx * 1.1 + rx * along;
        const z = door.z + fz * 1.1 + rz * along;
        const y = house.floorY - 0.15;
        city.setFrame(x, y, z, house.yaw);
        city.box(0, 0.36, 0, 0.08, 0.72, 0.08, color);
        city.box(0, 0.74, 0, 0.72, 0.04, 0.72, color);
        for (let i = 0; i < 3; i++) {
          const angle = (i / 3) * Math.PI * 2 + 0.4;
          const cx = x + Math.sin(house.yaw + angle) * 0.75;
          const cz = z + Math.cos(house.yaw + angle) * 0.75;
          city.setFrame(cx, y, cz, house.yaw + angle);
          city.box(0, 0.22, 0, 0.36, 0.44, 0.36, color, 0.8);
          city.box(0, 0.66, 0.17, 0.38, 0.44, 0.04, color);
          if (random() < 0.6) {
            this.stills.push({
              x: cx,
              y,
              z: cz,
              yaw: house.yaw + angle + Math.PI,
              seated: true,
              phase: random() * 10,
            });
          }
        }
      }
      // Its awning.
      city.setFrame(house.x, 0, house.z, house.yaw);
      city.box(
        0,
        house.floorY + 2.5,
        house.depth / 2 + 0.7,
        house.width * 0.9,
        0.08,
        1.4,
        pick(random, PLASTIC),
        0.9,
      );
    }
    city.resetFrame();
  }

  /** Washing on lines across the lanes, between houses facing each other, and on the roofs. */
  private addLaundry(
    city: GeoBuilder,
    wires: number[],
    houses: readonly House[],
    random: Random,
  ): void {
    const hang = (a: Vec3, b: Vec3): void => {
      wire(wires, a, b, 0.25, 4);
      const pieces = 3 + Math.floor(random() * 5);
      for (let i = 0; i < pieces; i++) {
        const t = (i + 0.5 + (random() - 0.5) * 0.4) / pieces;
        const sag = 0.25 * 4 * t * (1 - t);
        const x = a[0] + (b[0] - a[0]) * t;
        const y = a[1] + (b[1] - a[1]) * t - sag;
        const z = a[2] + (b[2] - a[2]) * t;
        const w = 0.25 + random() * 0.3;
        const h = 0.4 + random() * 0.5;
        const length = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
        const ux = ((b[0] - a[0]) / length) * w;
        const uz = ((b[2] - a[2]) / length) * w;
        city.quadDouble(
          [x - ux, y - h, z - uz],
          [x + ux, y - h, z + uz],
          [x + ux, y, z + uz],
          [x - ux, y, z - uz],
          pick(random, CLOTHES),
          0.95,
        );
      }
    };

    // Across the street: a house front and another front facing it a few metres away.
    const fronting = houses.filter((house) => house.street !== null && house.floors >= 2);
    let lines = 0;
    for (const house of fronting) {
      if (lines >= 110 || random() > 0.35) continue;
      const door = frontDoor(house);
      const opposite = fronting.find((other) => {
        if (other === house) return false;
        const od = frontDoor(other);
        const distance = Math.hypot(od.x - door.x, od.z - door.z);
        const facing = Math.cos(other.yaw - house.yaw) < -0.6;
        return distance > 3 && distance < 11 && facing;
      });
      if (!opposite) continue;
      const od = frontDoor(opposite);
      const y = Math.min(house.floorY, opposite.floorY) + FLOOR_HEIGHT + 1.9;
      hang([door.x, y, door.z], [od.x, y, od.z]);
      lines += 1;
    }

    // On the roofs, between corners.
    for (const house of houses) {
      if (random() > 0.12) continue;
      const top = house.floorY + house.floors * FLOOR_HEIGHT + 0.16;
      const fx = Math.sin(house.yaw);
      const fz = Math.cos(house.yaw);
      const w = house.width / 2 - 0.3;
      const d = house.depth / 2 - 0.3;
      const at = (lx: number, lz: number): Vec3 => [
        house.x + lx * fz + lz * fx,
        top + 1.5,
        house.z - lx * fx + lz * fz,
      ];
      const a = at(-w, d * (random() - 0.5));
      const b = at(w, d * (random() - 0.5));
      // Posts to tie the line to.
      wires.push(a[0], top, a[2], ...a, b[0], top, b[2], ...b);
      hang(a, b);
    }
  }

  /** Trees in the open patches: courtyards, gaps between houses, the edge of the favela. */
  private addTrees(
    city: GeoBuilder,
    houses: readonly House[],
    terrain: Terrain,
    edges: readonly RoadEdge[],
    random: Random,
  ): void {
    if (edges.length === 0) return;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const house of houses) {
      x0 = Math.min(x0, house.x);
      x1 = Math.max(x1, house.x);
      z0 = Math.min(z0, house.z);
      z1 = Math.max(z1, house.z);
    }
    const cell = 8;
    const occupied = new Set<string>();
    for (const house of houses) {
      occupied.add(`${Math.floor(house.x / cell)},${Math.floor(house.z / cell)}`);
    }
    let trees = 0;
    for (let attempt = 0; attempt < 600 && trees < 45; attempt++) {
      const x = x0 + random() * (x1 - x0);
      const z = z0 + random() * (z1 - z0);
      if (occupied.has(`${Math.floor(x / cell)},${Math.floor(z / cell)}`)) continue;
      const clear = houses.every(
        (house) =>
          Math.hypot(house.x - x, house.z - z) > Math.max(house.width, house.depth) / 2 + 2.5,
      );
      if (!clear) continue;
      const road = nearestOnGraph(this.graph, x, z);
      if (road && road.distance < this.graph.getEdge(road.edge).width / 2 + 2.5) continue;
      const scale = 0.8 + random() * 0.6;
      const base = terrain.heightAt(x, z) - 0.2;
      city.resetFrame();
      city.box(x, base + 1.6 * scale, z, 0.35, 3.2 * scale, 0.35, TRUNK, 0.7);
      for (let i = 0; i < 3; i++) {
        const radius = (1.4 + random() * 0.9) * scale;
        city.blob(
          x + (random() - 0.5) * 1.6 * scale,
          base + (3.5 + random() * 1.2) * scale,
          z + (random() - 0.5) * 1.6 * scale,
          radius,
          radius * 0.8,
          radius,
          pick(random, LEAVES),
        );
      }
      occupied.add(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
      trees += 1;
    }
  }

  /** Kites high over the hill, each on a long string down to a roof. */
  private addKites(wires: number[], houses: readonly House[], random: Random): void {
    const tall = houses.filter((house) => house.floors >= 3);
    for (let i = 0; i < KITE_COUNT && tall.length > 0; i++) {
      const house = pick(random, tall);
      const top = house.floorY + house.floors * FLOOR_HEIGHT + 1.2;
      const kite: Kite = {
        x: house.x + (random() - 0.5) * 50,
        y: top + 28 + random() * 30,
        z: house.z + (random() - 0.5) * 50,
        phase: random() * Math.PI * 2,
      };
      this.kiteSpots.push(kite);
      wire(wires, [house.x, top, house.z], [kite.x, kite.y - 0.6, kite.z], 4, 8);
    }
    const tint = new Color();
    this.kiteSpots.forEach((_, i) => this.kites.setColorAt(i, tint.setHex(pick(random, KITES))));
    this.kites.count = this.kiteSpots.length;
    if (this.kites.instanceColor) this.kites.instanceColor.needsUpdate = true;
  }

  /** Clothes and skin for everyone, fixed for the session. */
  private paintPeople(random: Random): void {
    const tint = new Color();
    for (let i = 0; i < MAX_PEOPLE; i++) {
      this.torsos.setColorAt(i, tint.setHex(pick(random, SHIRTS)));
      this.heads.setColorAt(i, tint.setHex(pick(random, SKIN)));
      const trousers = pick(random, TROUSERS);
      this.legs.setColorAt(i * 2, tint.setHex(trousers));
      this.legs.setColorAt(i * 2 + 1, tint.setHex(trousers));
    }
    for (const mesh of [this.torsos, this.heads, this.legs]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
