import { createRandom, pick } from './random';
import { isRideable, nearestOnGraph, pointAlong } from './roads/graph';
import type { AreaId, RoadEdge, RoadGraph } from './roads/graph';
import { findRoute } from './roads/route';
import { inCity } from './terrain';
import type { Terrain } from './terrain';

/**
 * Building footprints for a favela, as plain data: tightly packed, irregular blocks that
 * front every road and stairway, then fill the ground behind them, leaving small
 * courtyards and footpaths between. Every house stands on the ground (its foundation goes
 * down to the lowest point under it) and is never buried by the slope behind it.
 *
 * Also picks the delivery spots: shops on the main roads to pick up from, and houses to
 * deliver to, some at a door you can ride to and some up a stair or footpath where you
 * park and walk.
 *
 * Pure like `layout.ts`. The blocks are placeholders: the mesh builder can swap them for
 * real models later without the layout changing.
 */

export const FLOOR_HEIGHT = 2.8;

export interface House {
  readonly id: number;
  readonly area: AreaId;
  /** Footprint centre. */
  readonly x: number;
  readonly z: number;
  /** The front faces (sin yaw, cos yaw): towards its street, or downhill for infill. */
  readonly yaw: number;
  /** Along the front. */
  readonly width: number;
  /** Front to back. */
  readonly depth: number;
  /** Bottom of the foundation, below the lowest ground under the house. */
  readonly baseY: number;
  /** Ground floor level, at the front door. */
  readonly floorY: number;
  readonly floors: number;
  readonly color: number;
  /** The road edge it fronts, or null for houses filling in behind. */
  readonly street: number | null;
}

export type SpotKind = 'pickup' | 'dropoff';

export interface DeliverySpot {
  readonly id: number;
  readonly kind: SpotKind;
  readonly house: number;
  /** The front door. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Where to stop the bike: the nearest point on a rideable road. */
  readonly parkX: number;
  readonly parkZ: number;
  /** Walking distance from the bike to the door, 0 when you ride right up to it. */
  readonly walk: number;
}

export interface HouseArea {
  area: AreaId;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface HousePlan {
  houses: House[];
  spots: DeliverySpot[];
}

/** Gap between a house and the edge of a road it stands beside. */
const ROAD_CLEARANCE = 0.4;
const STAIR_CLEARANCE = 0.2;
/** Tallest foundation under the downhill side of a house. */
const MAX_FOUNDATION = 8;
const MAX_FLOORS = 5;
const HASH_CELL = 16;
const COURTYARD_EVERY = 1400;
const INFILL_SPACING = 4.5;
/** Rows of houses behind the one fronting each street, and how far apart the rows start. */
const BACK_ROWS = 2;
const ROW_PITCH = 8.5;
/** Houses only this far from a street or stairway; beyond is open hillside. */
const INFILL_REACH = 35;
/** A walk-up drop-off's door is at most this far from a path or stair. */
const DOOR_TO_PATH = 20;
/** A drop-off up a stair or footpath may be this far on foot from the bike. */
export const MAX_WALK = 90;

const BRICK = [0xb5643c, 0xa8573a, 0xc0714a, 0x9f5235] as const;
const CONCRETE = [0x9e9a92, 0xb3afa6, 0x8c8880] as const;
const PAINT = [0xe8d9b5, 0x8fc1d9, 0xe7b4a0, 0xf2e3a0, 0xcfe0c3, 0xf4f1ea, 0xd9a3c6] as const;

interface Rect {
  x: number;
  z: number;
  /** Unit vectors: front and right. */
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  halfWidth: number;
  halfDepth: number;
}

function rect(x: number, z: number, yaw: number, width: number, depth: number): Rect {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return { x, z, fx, fz, rx: fz, rz: -fx, halfWidth: width / 2, halfDepth: depth / 2 };
}

function corners(r: Rect): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ] as const) {
    out.push([
      r.x + r.rx * r.halfWidth * a + r.fx * r.halfDepth * b,
      r.z + r.rz * r.halfWidth * a + r.fz * r.halfDepth * b,
    ]);
  }
  return out;
}

/** Whether two rectangles overlap by more than a sliver (walls may touch). */
function overlaps(a: Rect, b: Rect): boolean {
  const axes = [
    [a.fx, a.fz],
    [a.rx, a.rz],
    [b.fx, b.fz],
    [b.rx, b.rz],
  ] as const;
  for (const [ax, az] of axes) {
    const project = (r: Rect): [number, number] => {
      const centre = r.x * ax + r.z * az;
      const extent =
        Math.abs(r.fx * ax + r.fz * az) * r.halfDepth +
        Math.abs(r.rx * ax + r.rz * az) * r.halfWidth;
      return [centre - extent, centre + extent];
    };
    const [a0, a1] = project(a);
    const [b0, b1] = project(b);
    if (a1 <= b0 + 0.05 || b1 <= a0 + 0.05) return false;
  }
  return true;
}

/** Distance from a rectangle to a line segment (0 when they touch). */
function rectToSegment(r: Rect, ax: number, az: number, bx: number, bz: number): number {
  // Into the rectangle's frame, where it is an axis-aligned box.
  const local = (x: number, z: number): [number, number] => {
    const dx = x - r.x;
    const dz = z - r.z;
    return [dx * r.rx + dz * r.rz, dx * r.fx + dz * r.fz];
  };
  const [px, pz] = local(ax, az);
  const [qx, qz] = local(bx, bz);
  const w = r.halfWidth;
  const d = r.halfDepth;
  const boxToPoint = (x: number, z: number): number =>
    Math.hypot(Math.max(0, Math.abs(x) - w), Math.max(0, Math.abs(z) - d));
  // Does the segment cross the box? Clip it against the slab on each axis.
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dz = qz - pz;
  let crosses = true;
  for (const [p, delta, half] of [
    [px, dx, w],
    [pz, dz, d],
  ] as const) {
    if (Math.abs(delta) < 1e-12) {
      if (Math.abs(p) > half) crosses = false;
      continue;
    }
    let ta = (-half - p) / delta;
    let tb = (half - p) / delta;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (crosses && t0 <= t1) return 0;
  // Otherwise the closest pair involves a segment end or a box corner.
  const segmentToPoint = (x: number, z: number): number => {
    const length2 = dx * dx + dz * dz;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / length2)) : 0;
    return Math.hypot(x - (px + dx * t), z - (pz + dz * t));
  };
  return Math.min(
    boxToPoint(px, pz),
    boxToPoint(qx, qz),
    segmentToPoint(w, d),
    segmentToPoint(-w, d),
    segmentToPoint(w, -d),
    segmentToPoint(-w, -d),
  );
}

class Hash<T> {
  private readonly cells = new Map<number, T[]>();

  private key(ix: number, iz: number): number {
    return (ix + 4000) * 8000 + (iz + 4000);
  }

  add(item: T, x0: number, z0: number, x1: number, z1: number): void {
    for (let ix = Math.floor(x0 / HASH_CELL); ix <= Math.floor(x1 / HASH_CELL); ix++) {
      for (let iz = Math.floor(z0 / HASH_CELL); iz <= Math.floor(z1 / HASH_CELL); iz++) {
        const k = this.key(ix, iz);
        let bucket = this.cells.get(k);
        if (!bucket) this.cells.set(k, (bucket = []));
        bucket.push(item);
      }
    }
  }

  near(x0: number, z0: number, x1: number, z1: number): Set<T> {
    const found = new Set<T>();
    for (let ix = Math.floor(x0 / HASH_CELL); ix <= Math.floor(x1 / HASH_CELL); ix++) {
      for (let iz = Math.floor(z0 / HASH_CELL); iz <= Math.floor(z1 / HASH_CELL); iz++) {
        for (const item of this.cells.get(this.key(ix, iz)) ?? []) found.add(item);
      }
    }
    return found;
  }
}

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  clearance: number;
}

export interface HouseOptions {
  seed: number;
  area: HouseArea;
  roads: RoadGraph;
  terrain: Terrain;
  /** Where riders start, for checking every delivery spot can be reached. */
  start: { x: number; z: number };
  pickups: number;
  dropoffs: number;
}

export function planHouses(options: HouseOptions): HousePlan {
  const { area, roads, terrain } = options;
  const random = createRandom(options.seed * 22695477 + 5);
  const houses: House[] = [];
  const houseHash = new Hash<{ house: House; rect: Rect }>();
  const roadHash = new Hash<Segment>();
  const blockers: { x: number; z: number; radius: number }[] = [];

  const areaEdges = roads.edges.filter((edge) => edge.area === area.area);
  for (const edge of roads.edges) {
    const clearance = edge.width / 2 + (edge.kind === 'stairs' ? STAIR_CLEARANCE : ROAD_CLEARANCE);
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (!a || !b) continue;
      const pad = clearance + 1;
      roadHash.add(
        { ax: a.x, az: a.z, bx: b.x, bz: b.z, clearance },
        Math.min(a.x, b.x) - pad,
        Math.min(a.z, b.z) - pad,
        Math.max(a.x, b.x) + pad,
        Math.max(a.z, b.z) + pad,
      );
    }
  }
  // Turning pads and squares are open paving.
  for (const node of roads.nodes) {
    if (node.pad > 0) blockers.push({ x: node.x, z: node.z, radius: node.pad + ROAD_CLEARANCE });
  }

  const insideArea = (x: number, z: number): boolean =>
    x > area.x0 && x < area.x1 && z > area.z0 && z < area.z1 && !inCity(x, z);

  /**
   * Try to build a house on a footprint. Returns it, or null if the footprint is off the
   * area, on a road or pad, over a neighbour, or on ground too steep to build on.
   */
  const tryHouse = (
    x: number,
    z: number,
    yaw: number,
    width: number,
    depth: number,
    street: RoadEdge | null,
  ): House | null => {
    const r = rect(x, z, yaw, width, depth);
    const pts = corners(r);
    if (!pts.every(([px, pz]) => insideArea(px, pz))) return null;
    const reach = Math.hypot(r.halfWidth, r.halfDepth);
    for (const b of blockers) {
      if (Math.hypot(b.x - x, b.z - z) < b.radius + reach) {
        if (rectToSegment(r, b.x, b.z, b.x, b.z) < b.radius) return null;
      }
    }
    for (const s of roadHash.near(x - reach, z - reach, x + reach, z + reach)) {
      if (rectToSegment(r, s.ax, s.az, s.bx, s.bz) < s.clearance) return null;
    }
    for (const other of houseHash.near(x - reach, z - reach, x + reach, z + reach)) {
      if (overlaps(r, other.rect)) return null;
    }

    // Stand it on the ground: the floor at the front door, the foundation down to the
    // lowest point underneath, and never with the hill behind it above the roof.
    const ground = [...pts, [x, z] as [number, number]].map(([px, pz]) => terrain.heightAt(px, pz));
    const lowest = Math.min(...ground);
    const highest = Math.max(...ground);
    const doorX = x + r.fx * r.halfDepth;
    const doorZ = z + r.fz * r.halfDepth;
    const floorY = terrain.heightAt(doorX, doorZ) + 0.15;
    if (floorY - lowest > MAX_FOUNDATION) return null;
    const nearMain = street?.kind === 'main';
    // Dug into the slope: a house with the hill rising behind it gains storeys until its
    // roof clears the ground at the back.
    const needed = Math.ceil((highest - floorY + 1.2) / FLOOR_HEIGHT);
    const floors = Math.max(pickFloors(random, nearMain), needed);
    if (floors > MAX_FLOORS) return null;

    const roll = random();
    const color =
      roll < 0.45 ? pick(random, BRICK) : roll < 0.7 ? pick(random, CONCRETE) : pick(random, PAINT);
    const house: House = {
      id: houses.length,
      area: area.area,
      x,
      z,
      yaw,
      width,
      depth,
      baseY: lowest - 0.4,
      floorY,
      floors,
      color,
      street: street?.id ?? null,
    };
    houses.push(house);
    houseHash.add({ house, rect: r }, x - reach, z - reach, x + reach, z + reach);
    return house;
  };

  // 1. Rows along every street and stairway, both sides, facing it. The bigger roads go
  // first so their frontages are the most complete.
  const order = ['main', 'secondary', 'lane', 'alley', 'stairs'];
  const streets = [...areaEdges].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  // Every street's front row first, then the rows behind, so no back row takes ground a
  // later street's frontage needs.
  for (let row = 0; row < BACK_ROWS + 1; row++) {
    for (const edge of streets) {
      for (const side of [1, -1]) {
        // Rows behind the street face it too; they are reached by footpaths between houses.
        const rowOffset = row * ROW_PITCH + (row > 0 ? (random() - 0.5) * 1.5 : 0);
        let s = random() * 2 + row * 1.7;
        while (s < edge.length - 2) {
          const big = edge.kind === 'main' || edge.kind === 'secondary';
          const width = big ? 5.5 + random() * 5 : 4 + random() * 3.5;
          const depth = big ? 6 + random() * 5 : 5 + random() * 4;
          const centreAlong = s + width / 2;
          if (centreAlong > edge.length) break;
          const p = pointAlong(edge.points, centreAlong);
          const ahead = pointAlong(edge.points, Math.min(edge.length, centreAlong + 1.5));
          const behind = pointAlong(edge.points, Math.max(0, centreAlong - 1.5));
          const tx = ahead.x - behind.x;
          const tz = ahead.z - behind.z;
          const length = Math.hypot(tx, tz) || 1;
          // Outward normal on this side of the road.
          const nx = (tz / length) * side;
          const nz = (-tx / length) * side;
          const setback = edge.width / 2 + ROAD_CLEARANCE + 0.1 + random() * 0.8 + rowOffset;
          const yaw = Math.atan2(-nx, -nz) + (random() - 0.5) * 0.12;
          const built = tryHouse(
            p.x + nx * (setback + depth / 2),
            p.z + nz * (setback + depth / 2),
            yaw,
            width,
            depth,
            row === 0 ? edge : null,
          );
          // A footpath between houses now and then, otherwise wall to wall.
          const gap = random() < 0.12 ? 1.5 + random() : 0;
          s += built ? width + gap : 1.5;
        }
      }
    }
  }

  // 2. Small courtyards, kept open before the infill takes the ground.
  const courtyards = Math.round(((area.x1 - area.x0) * (area.z1 - area.z0)) / COURTYARD_EVERY);
  for (let i = 0; i < courtyards; i++) {
    blockers.push({
      x: area.x0 + random() * (area.x1 - area.x0),
      z: area.z0 + random() * (area.z1 - area.z0),
      radius: 3 + random() * 3,
    });
  }

  // 3. Fill the ground behind the rows, houses facing downhill, in a shuffled jittered
  // grid so the blocks come out irregular.
  const slots: [number, number][] = [];
  for (let x = area.x0; x < area.x1; x += INFILL_SPACING) {
    for (let z = area.z0; z < area.z1; z += INFILL_SPACING) {
      slots.push([x + random() * INFILL_SPACING, z + random() * INFILL_SPACING]);
    }
  }
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = slots[i];
    const b = slots[j];
    if (a && b) {
      slots[i] = b;
      slots[j] = a;
    }
  }
  const nearStreet = (x: number, z: number): boolean => {
    for (const s of roadHash.near(
      x - INFILL_REACH,
      z - INFILL_REACH,
      x + INFILL_REACH,
      z + INFILL_REACH,
    )) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const length2 = dx * dx + dz * dz;
      const t =
        length2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / length2)) : 0;
      if (Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) < INFILL_REACH) return true;
    }
    return false;
  };
  for (const [x, z] of slots) {
    if (!nearStreet(x, z)) continue;
    const gx = terrain.heightAt(x + 2, z) - terrain.heightAt(x - 2, z);
    const gz = terrain.heightAt(x, z + 2) - terrain.heightAt(x, z - 2);
    const downhill = Math.hypot(gx, gz) > 0.05 ? Math.atan2(-gx, -gz) : random() * Math.PI * 2;
    for (const scale of [1, 0.8, 0.6]) {
      const width = (4 + random() * 3.5) * scale;
      const depth = (4.5 + random() * 3.5) * scale;
      if (tryHouse(x, z, downhill + (random() - 0.5) * 0.5, width, depth, null)) break;
    }
  }

  return { houses, spots: pickSpots(options, houses, random) };
}

function pickFloors(random: () => number, nearMain: boolean): number {
  const roll = random();
  if (nearMain) return roll < 0.2 ? 2 : roll < 0.6 ? 3 : roll < 0.9 ? 4 : 5;
  return roll < 0.3 ? 1 : roll < 0.7 ? 2 : roll < 0.92 ? 3 : 4;
}

/** The middle of a house's front wall. */
export function frontDoor(house: House): { x: number; z: number } {
  return {
    x: house.x + Math.sin(house.yaw) * (house.depth / 2),
    z: house.z + Math.cos(house.yaw) * (house.depth / 2),
  };
}

function pickSpots(
  options: HouseOptions,
  houses: readonly House[],
  random: () => number,
): DeliverySpot[] {
  const { roads, start } = options;
  const spots: DeliverySpot[] = [];
  const shuffled = [...houses];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    if (a && b) {
      shuffled[i] = b;
      shuffled[j] = a;
    }
  }

  const spacedFrom = (x: number, z: number, distance: number): boolean =>
    spots.every((spot) => Math.hypot(spot.x - x, spot.z - z) >= distance);

  /** A spot at this house if the bike can reach it and the walk is short enough. */
  const spotAt = (house: House, kind: SpotKind): DeliverySpot | null => {
    const door = frontDoor(house);
    const park = nearestOnGraph(roads, door.x, door.z, isRideable);
    if (!park) return null;
    if (!findRoute(roads, start.x, start.z, park.x, park.z, 'ride')) return null;
    let walk = 0;
    // Riding right to the door: the house fronts a road you can ride on.
    const fronting = house.street === null ? null : roads.getEdge(house.street);
    if (!fronting || !isRideable(fronting) || park.edge !== fronting.id) {
      // Otherwise walk: along the paths and stairs from the bike to the nearest point on
      // any of them, then the last stretch to the door.
      const near = nearestOnGraph(roads, door.x, door.z);
      if (!near || near.distance > DOOR_TO_PATH) return null;
      const path = findRoute(roads, park.x, park.z, near.x, near.z, 'walk');
      if (!path) return null;
      walk = path.length + near.distance;
      if (walk > MAX_WALK) return null;
    }
    return {
      id: spots.length,
      kind,
      house: house.id,
      x: door.x,
      y: house.floorY,
      z: door.z,
      parkX: park.x,
      parkZ: park.z,
      walk: Math.round(walk),
    };
  };

  // Pickups: shops on the main roads, spread out along them.
  for (const house of shuffled) {
    if (spots.length >= options.pickups) break;
    if (house.street === null || roads.getEdge(house.street).kind !== 'main') continue;
    const door = frontDoor(house);
    if (!spacedFrom(door.x, door.z, 90)) continue;
    const spot = spotAt(house, 'pickup');
    if (spot) spots.push(spot);
  }

  // Drop-offs: half at doors you ride to, half up stairs and footpaths.
  const wantRide = Math.ceil(options.dropoffs / 2);
  let ridden = 0;
  let walked = 0;
  for (const house of shuffled) {
    if (ridden + walked >= options.dropoffs) break;
    const door = frontDoor(house);
    if (!spacedFrom(door.x, door.z, 30)) continue;
    const spot = spotAt(house, 'dropoff');
    if (!spot) continue;
    if (spot.walk === 0 && ridden < wantRide) {
      spots.push(spot);
      ridden += 1;
    } else if (spot.walk > 0 && walked < options.dropoffs - wantRide) {
      spots.push(spot);
      walked += 1;
    }
  }
  return spots;
}
