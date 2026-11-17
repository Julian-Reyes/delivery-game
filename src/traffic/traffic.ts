import { createRandom } from '../world/random';
import type { RoadEdge, RoadGraph } from '../world/roads/graph';

/**
 * Moving traffic on the road graph: cars on the city streets and motorbikes on the
 * favela's roads and lanes, driving on the right. Plain numbers stepped at the fixed
 * simulation rate; the renderer interpolates between steps.
 *
 * Each vehicle follows an edge's centreline at a lane offset, picks a road at random at
 * every junction (turning round at dead ends; cars reaching a tunnel mouth come back out
 * of the other one), keeps a gap to whatever is in front of it, slows for junctions and
 * bends, and stops for the player.
 */

export type VehicleKind = 'car' | 'van' | 'bike';

export interface Vehicle {
  readonly id: number;
  readonly kind: VehicleKind;
  /** Paint, 0..1, for the renderer to pick a colour from. */
  readonly paint: number;
  edge: RoadEdge;
  /** Centreline segment and metres along it. */
  segment: number;
  offset: number;
  forward: boolean;
  speed: number;
  /** For cars on the avenue: 0 the inner lane, 1 the outer. */
  lane: number;
  /** Seconds spent stopped while blocked, to break deadlocks. */
  blocked: number;
  /** Seconds left of ignoring whatever blocks it, after a deadlock. */
  pushing: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Roll into bends, radians, positive to the right, for motorbikes. */
  lean: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  prevHeading: number;
  prevLean: number;
}

export interface TrafficOptions {
  seed: number;
  cars: number;
  bikes: number;
  /** Keep vehicles from spawning on top of the player. */
  avoid: { x: number; z: number };
}

const SPEEDS: Record<string, number> = {
  avenue: 14,
  street: 9,
  main: 9,
  secondary: 7,
  lane: 6,
  alley: 4.5,
};
const ACCEL = 3;
const BRAKE = 7;
/** Slow to this speed through junctions, starting this far out. */
const JUNCTION_SPEED = 4.5;
const JUNCTION_REACH = 14;
/** Sideways grip for bends: v² / r stays under this. */
const LATERAL_ACCEL = 3.5;
/** Distance kept to whatever is ahead, by kind. */
const GAP: Record<VehicleKind, number> = { car: 7, van: 7.5, bike: 4 };
const LOOK_AHEAD = 16;
/** Half the width of the corridor a vehicle checks in front of it. */
const CORRIDOR: Record<VehicleKind, number> = { car: 1.8, van: 1.8, bike: 1.1 };
const DEADLOCK_SECONDS = 2.5;
const PUSH_SECONDS = 1.5;

/** Distance to the right of the centreline a vehicle drives at. */
function laneOffset(vehicle: Pick<Vehicle, 'kind' | 'lane'>, edge: RoadEdge): number {
  if (vehicle.kind === 'bike') {
    // Clear of the cars parked along the wider roads.
    if (edge.kind === 'main') return 1;
    if (edge.kind === 'secondary') return 0.25;
    if (edge.kind === 'lane') return 0.6;
    return 0.35;
  }
  // The avenue has two lanes each way; the outer one keeps clear of the parked cars.
  if (edge.kind === 'avenue') return vehicle.lane === 0 ? 1.9 : 4.6;
  return 2;
}

export function carAllowed(graph: RoadGraph, edge: RoadEdge): boolean {
  if (edge.area !== 'city') return false;
  // Not the short streets out of the top of the city into the hillside.
  for (const node of [edge.from, edge.to]) {
    if (graph.edgesAt(node).some((id) => graph.getEdge(id).area !== 'city')) return false;
  }
  return true;
}

export function bikeAllowed(edge: RoadEdge): boolean {
  return edge.area === 'hillside' && edge.kind !== 'stairs';
}

function segmentLength(edge: RoadEdge, segment: number): number {
  const a = edge.points[segment];
  const b = edge.points[segment + 1];
  return a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0;
}

export class Traffic {
  readonly vehicles: Vehicle[] = [];
  private readonly random: () => number;

  constructor(
    private readonly graph: RoadGraph,
    options: TrafficOptions,
  ) {
    this.random = createRandom(options.seed * 2246822519 + 13);
    const cars = graph.edges.filter((edge) => carAllowed(graph, edge));
    const bikes = graph.edges.filter(bikeAllowed);
    for (let i = 0; i < options.cars; i++) {
      this.spawn(this.random() < 0.2 ? 'van' : 'car', cars, options.avoid);
    }
    for (let i = 0; i < options.bikes; i++) this.spawn('bike', bikes, options.avoid);
  }

  allowed(vehicle: Vehicle, edge: RoadEdge): boolean {
    return vehicle.kind === 'bike' ? bikeAllowed(edge) : carAllowed(this.graph, edge);
  }

  /** Advance everyone one fixed step. `player` is where the rider is. */
  step(dt: number, player: { x: number; z: number }): void {
    for (const vehicle of this.vehicles) {
      vehicle.prevX = vehicle.x;
      vehicle.prevY = vehicle.y;
      vehicle.prevZ = vehicle.z;
      vehicle.prevHeading = vehicle.heading;
      vehicle.prevLean = vehicle.lean;
    }
    for (const vehicle of this.vehicles) {
      const forTraffic = Math.min(this.cruise(vehicle), this.room(vehicle, null));
      const forPlayer = this.room(vehicle, player);
      if (forTraffic < 0.2 && vehicle.speed < 0.5) vehicle.blocked += dt;
      else vehicle.blocked = 0;
      if (vehicle.blocked > DEADLOCK_SECONDS) {
        vehicle.pushing = PUSH_SECONDS;
        vehicle.blocked = 0;
      }
      vehicle.pushing = Math.max(0, vehicle.pushing - dt);
      // Two vehicles stuck nose to nose edge through; the player is always waited for.
      const unstuck = vehicle.pushing > 0 ? Math.max(forTraffic, 2) : forTraffic;
      const wanted = Math.min(unstuck, forPlayer);
      vehicle.speed =
        wanted > vehicle.speed
          ? Math.min(wanted, vehicle.speed + ACCEL * dt)
          : Math.max(wanted, vehicle.speed - BRAKE * dt);
      this.advance(vehicle, vehicle.speed * dt);
      const before = vehicle.heading;
      this.place(vehicle);
      // Motorbikes lean into the turn they are making. Heading falls turning right, and
      // positive lean leans right, as for the player's bike.
      if (vehicle.kind === 'bike') {
        const turn = Math.atan2(
          Math.sin(vehicle.heading - before),
          Math.cos(vehicle.heading - before),
        );
        const rate = dt > 0 ? turn / dt : 0;
        const lean = Math.max(-0.5, Math.min(0.5, Math.atan((-rate * vehicle.speed) / 9.8)));
        vehicle.lean += (lean - vehicle.lean) * Math.min(1, 6 * dt);
      }
    }
  }

  /** The speed a vehicle wants on this stretch: its road, the bend ahead, the junction ahead. */
  private cruise(vehicle: Vehicle): number {
    const { edge } = vehicle;
    let speed = SPEEDS[edge.kind] ?? 6;
    if (vehicle.kind === 'van') speed *= 0.9;

    // Bends: the sharpest turn in the next few metres sets the speed.
    const points = edge.points;
    const step = vehicle.forward ? 1 : -1;
    const i = vehicle.forward ? vehicle.segment : vehicle.segment + 1;
    const a = points[i];
    const b = points[i + step * 3];
    const c = points[i + step * 6];
    if (a && b && c) {
      const h1 = Math.atan2(b.x - a.x, b.z - a.z);
      const h2 = Math.atan2(c.x - b.x, c.z - b.z);
      const turn = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
      const span = Math.hypot(c.x - a.x, c.z - a.z) / 2;
      if (turn > 0.05) speed = Math.min(speed, Math.sqrt(LATERAL_ACCEL * (span / turn)));
    }

    // Junctions: ease off as the end of the edge comes up, unless it just carries on.
    const toEnd = this.distanceToEnd(vehicle);
    const node = vehicle.forward ? edge.to : edge.from;
    if (toEnd < JUNCTION_REACH && this.graph.edgesAt(node).length !== 2) {
      speed = Math.min(speed, JUNCTION_SPEED + toEnd * 0.6);
    }
    return speed;
  }

  /**
   * The most speed the vehicle can carry and still stop behind what is ahead: other
   * traffic, or with `player` given, only the player.
   */
  private room(vehicle: Vehicle, player: { x: number; z: number } | null): number {
    const fx = Math.sin(vehicle.heading);
    const fz = Math.cos(vehicle.heading);
    const corridor = CORRIDOR[vehicle.kind];
    let clear = Infinity;
    const consider = (x: number, z: number, ownLength: number): void => {
      const dx = x - vehicle.x;
      const dz = z - vehicle.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > LOOK_AHEAD) return;
      const across = Math.abs(dx * fz - dz * fx);
      if (across > corridor) return;
      clear = Math.min(clear, ahead - ownLength);
    };
    if (player) {
      consider(player.x, player.z, 1.2);
    } else {
      for (const other of this.vehicles) {
        if (other === vehicle) continue;
        // Only what is in the way: going the same way, or crossing in front.
        const facing = Math.cos(other.heading - vehicle.heading);
        if (facing < -0.5) continue;
        consider(other.x, other.z, other.kind === 'bike' ? 1 : 2.2);
      }
    }
    if (!Number.isFinite(clear)) return Infinity;
    const gap = GAP[vehicle.kind];
    return Math.max(0, (clear - gap * 0.5) * 1.2);
  }

  private distanceToEnd(vehicle: Vehicle): number {
    const { edge } = vehicle;
    let distance = vehicle.forward
      ? segmentLength(edge, vehicle.segment) - vehicle.offset
      : vehicle.offset;
    if (vehicle.forward) {
      for (
        let s = vehicle.segment + 1;
        s < edge.points.length - 1 && distance < JUNCTION_REACH;
        s++
      ) {
        distance += segmentLength(edge, s);
      }
    } else {
      for (let s = vehicle.segment - 1; s >= 0 && distance < JUNCTION_REACH; s--) {
        distance += segmentLength(edge, s);
      }
    }
    return distance;
  }

  private advance(vehicle: Vehicle, metres: number): void {
    let remaining = metres;
    for (let guard = 0; guard < 16 && remaining > 0; guard++) {
      const length = segmentLength(vehicle.edge, vehicle.segment);
      if (vehicle.forward) {
        const room = length - vehicle.offset;
        if (remaining < room) {
          vehicle.offset += remaining;
          return;
        }
        remaining -= room;
        if (vehicle.segment + 2 < vehicle.edge.points.length) {
          vehicle.segment += 1;
          vehicle.offset = 0;
        } else {
          this.junction(vehicle, vehicle.edge.to);
        }
      } else {
        if (remaining < vehicle.offset) {
          vehicle.offset -= remaining;
          return;
        }
        remaining -= vehicle.offset;
        if (vehicle.segment > 0) {
          vehicle.segment -= 1;
          vehicle.offset = segmentLength(vehicle.edge, vehicle.segment);
        } else {
          this.junction(vehicle, vehicle.edge.from);
        }
      }
    }
  }

  /** At the end of an edge: on to another road, out of the far tunnel, or turn round. */
  private junction(vehicle: Vehicle, node: number): void {
    const here = this.graph.getNode(node);
    if (here.boundary && vehicle.kind !== 'bike') {
      // Into the tunnel; out of the one at the other end of the avenue.
      const exits = this.graph.nodes.filter((n) => n.boundary && n.id !== node);
      const exit = exits[Math.floor(this.random() * exits.length)];
      const road = exit
        ? this.graph
            .edgesAt(exit.id)
            .map((id) => this.graph.getEdge(id))
            .find((edge) => this.allowed(vehicle, edge))
        : undefined;
      if (exit && road) {
        this.enter(vehicle, road, exit.id);
        return;
      }
    }
    const options = this.graph
      .edgesAt(node)
      .map((id) => this.graph.getEdge(id))
      .filter((edge) => edge !== vehicle.edge && this.allowed(vehicle, edge));
    const next = options[Math.floor(this.random() * options.length)];
    this.enter(vehicle, next ?? vehicle.edge, node);
  }

  /** Start along `edge` away from `node`. */
  private enter(vehicle: Vehicle, edge: RoadEdge, node: number): void {
    vehicle.edge = edge;
    vehicle.forward = edge.from === node;
    vehicle.segment = vehicle.forward ? 0 : edge.points.length - 2;
    vehicle.offset = vehicle.forward ? 0 : segmentLength(edge, vehicle.segment);
  }

  /** Work out the world position and heading from where the vehicle is on its edge. */
  private place(vehicle: Vehicle): void {
    const { edge } = vehicle;
    const a = edge.points[vehicle.segment];
    const b = edge.points[vehicle.segment + 1];
    if (!a || !b) return;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const t = vehicle.offset / length;
    let dx = (b.x - a.x) / length;
    let dz = (b.z - a.z) / length;
    if (!vehicle.forward) {
      dx = -dx;
      dz = -dz;
    }
    // Facing +z in this world, +x is on the left, so the right-hand side is (-dz, dx).
    const lane = laneOffset(vehicle, edge);
    vehicle.x = a.x + (b.x - a.x) * t - dz * lane;
    vehicle.z = a.z + (b.z - a.z) * t + dx * lane;
    vehicle.y = a.y + (b.y - a.y) * t;
    vehicle.heading = Math.atan2(dx, dz);
  }

  private spawn(
    kind: VehicleKind,
    edges: readonly RoadEdge[],
    avoid: { x: number; z: number },
  ): void {
    const total = edges.reduce((sum, edge) => sum + edge.length, 0);
    for (let attempt = 0; attempt < 30; attempt++) {
      // Weighted by length, so long roads get their share.
      let pick = this.random() * total;
      const edge = edges.find((e) => (pick -= e.length) <= 0) ?? edges[0];
      if (!edge || edge.points.length < 2) return;
      const segment = Math.floor(this.random() * (edge.points.length - 1));
      const vehicle: Vehicle = {
        id: this.vehicles.length,
        kind,
        paint: this.random(),
        edge,
        segment,
        offset: segmentLength(edge, segment) * this.random(),
        forward: this.random() < 0.5,
        speed: 0,
        lane: this.random() < 0.5 ? 0 : 1,
        blocked: 0,
        pushing: 0,
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        lean: 0,
        prevX: 0,
        prevY: 0,
        prevZ: 0,
        prevHeading: 0,
        prevLean: 0,
      };
      this.place(vehicle);
      const crowded = this.vehicles.some(
        (other) => Math.hypot(other.x - vehicle.x, other.z - vehicle.z) < 14,
      );
      if (crowded || Math.hypot(avoid.x - vehicle.x, avoid.z - vehicle.z) < 25) continue;
      vehicle.speed = (SPEEDS[edge.kind] ?? 6) * 0.6;
      vehicle.prevX = vehicle.x;
      vehicle.prevY = vehicle.y;
      vehicle.prevZ = vehicle.z;
      vehicle.prevHeading = vehicle.heading;
      this.vehicles.push(vehicle);
      return;
    }
  }
}
