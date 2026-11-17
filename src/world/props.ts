import { pick } from './geo';
import type { GeoBuilder, Vec3 } from './geo';
import {
  AVENUE_Z_MAX,
  AVENUE_Z_MIN,
  CORRIDOR_HALF,
  CROSS_STREETS,
  CURB,
  HALF,
  HILL_STREETS_X,
  PARK,
  RAMPS,
  ROAD_HALF,
  SAND_EDGE_Z,
  SPEED_BUMPS,
  heightAt,
  surfaceHeightAt,
} from './layout';
import { WORLD } from './terrain';

/** Street furniture, vegetation, parked cars, the beach and the offshore islands. */

type Random = () => number;

/** An upright box obstacle for the physics world. */
export interface SolidBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
}

const POLE = 0x8d8a84;
const TRUNK = 0x5d4630;
const PALM_TRUNK = 0x8a7355;
const LEAVES = [0x3d7d3a, 0x4c9144, 0x2f6b33] as const;
const FRONDS = [0x3f8f4a, 0x2f7a3d, 0x4f9a4f] as const;
const FLAGS = [0x1f9d55, 0xffd23f, 0x2a6fdb, 0xf7f4ec, 0xe24a3b, 0xef7b22] as const;
const CAR_PAINT = [0xf2f2f0, 0xc9ccd1, 0x1d1f22, 0x8e9399, 0xb3261e, 0x1f4e8c, 0xe9e2c8] as const;
const VAN_PAINT = [0xf2f2f0, 0xe9e2c8, 0x9cc3d9, 0xd9b44a] as const;
const CAR_GLASS = 0x1f2a33;
const TYRE = 0x15171a;
const PLASTIC = [0xf7c600, 0xd62828] as const;
const UMBRELLA = [0xd62828, 0xf7c600, 0x1d6fb8, 0x1f8a4c, 0xef7b22] as const;
const WHITE = 0xf7f4ec;
const FOREST = [0x3f7a45, 0x356b3c, 0x47854c] as const;
const GRANITE = 0x8b8378;

// --- Things you ride over ---------------------------------------------------------------

const BUMP_PROFILE: readonly (readonly [number, number])[] = [
  [-0.9, 0],
  [-0.45, 0.085],
  [0, 0.115],
  [0.45, 0.085],
  [0.9, 0],
];

/** Lombadas: low humps across the road with yellow and black warning stripes. */
export function addSpeedBumps(extras: GeoBuilder): void {
  extras.resetFrame();
  for (const bump of SPEED_BUMPS) {
    // `u` runs across the road, `v` along the direction of travel.
    const point = (u: number, v: number, lift: number): Vec3 => {
      const x = bump.axis === 'z' ? bump.x + u : bump.x + v;
      const z = bump.axis === 'z' ? bump.z + v : bump.z - u;
      return [x, heightAt(x, z) + lift, z];
    };
    for (let u = -ROAD_HALF; u < ROAD_HALF; u += 1) {
      const color = Math.round(u + ROAD_HALF) % 2 === 0 ? 0xe3b21f : 0x26262a;
      for (let i = 0; i + 1 < BUMP_PROFILE.length; i++) {
        const a = BUMP_PROFILE[i];
        const b = BUMP_PROFILE[i + 1];
        if (!a || !b) continue;
        extras.quad(
          point(u, b[0], b[1]),
          point(u + 1, b[0], b[1]),
          point(u + 1, a[0], a[1]),
          point(u, a[0], a[1]),
          color,
        );
      }
    }
  }
}

/** Plank ramps for getting airborne. */
export function addRamps(extras: GeoBuilder): void {
  for (const ramp of RAMPS) {
    const sin = Math.sin(ramp.heading);
    const cos = Math.cos(ramp.heading);
    const ground = (lx: number, lz: number): number =>
      heightAt(ramp.x + lx * cos + lz * sin, ramp.z - lx * sin + lz * cos);
    const w = ramp.width / 2;
    const l = ramp.length / 2;

    extras.setFrame(ramp.x, 0, ramp.z, ramp.heading);
    const planks = 6;
    for (let i = 0; i < planks; i++) {
      const t0 = i / planks;
      const t1 = (i + 1) / planks;
      const z0 = -l + ramp.length * t0;
      const z1 = -l + ramp.length * t1;
      const y = (lx: number, lz: number, t: number): number => ground(lx, lz) + ramp.height * t;
      extras.quad(
        [-w, y(-w, z1, t1), z1],
        [w, y(w, z1, t1), z1],
        [w, y(w, z0, t0), z0],
        [-w, y(-w, z0, t0), z0],
        i % 2 === 0 ? 0xb07a3f : 0x9c6a34,
      );
    }
    const topL = ground(-w, l) + ramp.height;
    const topR = ground(w, l) + ramp.height;
    extras.quad(
      [-w, ground(-w, l), l],
      [w, ground(w, l), l],
      [w, topR, l],
      [-w, topL, l],
      0x6e4a24,
    );
    extras.tri([w, ground(w, l), l], [w, ground(w, -l), -l], [w, topR, l], 0x8a5c2c);
    extras.tri([-w, ground(-w, -l), -l], [-w, ground(-w, l), l], [-w, topL, l], 0x8a5c2c);
  }
  extras.resetFrame();
}

// --- Power lines ------------------------------------------------------------------------

/** A sagging cable from `a` to `b`, as line segments appended to `wires`. */
export function wire(wires: number[], a: Vec3, b: Vec3, sag: number, segments = 6): void {
  for (let i = 0; i < segments; i++) {
    for (const t of [i / segments, (i + 1) / segments]) {
      wires.push(
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
        a[2] + (b[2] - a[2]) * t,
      );
    }
  }
}

interface PoleRun {
  points: { x: number; z: number }[];
  /** Unit vector from the pole towards the road. */
  px: number;
  pz: number;
}

function poleRuns(): PoleRun[] {
  const runs: PoleRun[] = [];
  const offset = ROAD_HALF + 1.25;
  for (const x of HILL_STREETS_X) {
    const points = [];
    for (let z = AVENUE_Z_MAX + 9; z < 140; z += 28) points.push({ x: x + offset, z });
    runs.push({ points, px: -1, pz: 0 });
  }
  for (const street of CROSS_STREETS) {
    const points = [];
    for (let x = -84; x <= 84; x += 28) {
      // Step aside where a pole would land in a hill street crossing this one.
      const blocked = HILL_STREETS_X.some((centre) => Math.abs(x - centre) < CORRIDOR_HALF + 1);
      points.push({ x: blocked ? x + 10 : x, z: street.z - offset });
    }
    runs.push({ points, px: 0, pz: 1 });
  }
  const avenue = [];
  for (let x = -140; x <= 140; x += 28) {
    // Step aside where a pole would land in the mouth of a hill street.
    const blocked = HILL_STREETS_X.some((centre) => Math.abs(x - centre) < 9);
    avenue.push({ x: blocked ? x + 10 : x, z: AVENUE_Z_MAX + 1.25 });
  }
  runs.push({ points: avenue, px: 0, pz: -1 });
  return runs;
}

/**
 * Concrete utility poles with the dense tangle of overhead cables that every Brazilian
 * street has: power lines up top, sagging telecom bundles below, and drops to each house.
 */
export function addPolesAndWires(city: GeoBuilder, wires: number[], random: Random): void {
  for (const run of poleRuns()) {
    const { px, pz } = run;
    // Along-street direction.
    const ax = -pz;
    const az = px;
    const attach = (pole: { x: number; z: number }, across: number, up: number): Vec3 => [
      pole.x + px * across,
      surfaceHeightAt(pole.x, pole.z) + up,
      pole.z + pz * across,
    ];

    run.points.forEach((pole, index) => {
      const base = surfaceHeightAt(pole.x, pole.z);
      city.setFrame(pole.x, base, pole.z, Math.atan2(px, pz));
      city.box(0, 4.5, 0, 0.26, 9, 0.26, POLE, 0.75);
      city.box(0, 8.5, 0, 0.12, 0.12, 1.8, POLE);
      city.box(0, 7.7, 0, 0.1, 0.1, 1.4, POLE);
      // Street lamp reaching out over the road.
      city.box(0, 7.0, 0.95, 0.08, 0.08, 1.9, POLE);
      city.box(0, 6.93, 1.9, 0.3, 0.12, 0.6, 0xf2efe2);
      if (index % 3 === 1) city.cylinder(0, -0.42, 6.2, 7.2, 0.3, 6, 0x6f7275);

      // Drops to the buildings behind the pole.
      const drops = 2 + Math.floor(random() * 2);
      for (let i = 0; i < drops; i++) {
        const along = (random() - 0.5) * 16;
        wire(
          wires,
          attach(pole, 0, 6 + random() * 1.5),
          [
            pole.x - px * 1.25 + ax * along,
            base + 3.4 + random() * 2.4,
            pole.z - pz * 1.25 + az * along,
          ],
          0.25,
          3,
        );
      }
      // And one across the street.
      if (index % 2 === 0) {
        const along = (random() - 0.5) * 8;
        wire(
          wires,
          attach(pole, 0, 7.7),
          [
            pole.x + px * 13.7 + ax * along,
            base + 5 + random() * 2,
            pole.z + pz * 13.7 + az * along,
          ],
          0.7,
        );
      }

      const next = run.points[index + 1];
      if (!next) return;
      for (const across of [-0.8, 0, 0.8]) {
        wire(wires, attach(pole, across, 8.6), attach(next, across, 8.6), 0.35);
      }
      for (const across of [-0.6, 0.6]) {
        wire(wires, attach(pole, across, 7.8), attach(next, across, 7.8), 0.45);
      }
      for (const up of [6.4, 6.1, 5.8, 5.6]) {
        wire(wires, attach(pole, 0.16, up), attach(next, 0.16, up), 0.6 + random() * 0.7);
      }
    });
  }
  city.resetFrame();
}

// --- Vegetation -------------------------------------------------------------------------

export function addPalm(city: GeoBuilder, x: number, z: number, random: Random): void {
  city.resetFrame();
  const base = surfaceHeightAt(x, z);
  const height = 6.5 + random() * 3;
  const leanAngle = random() * Math.PI * 2;
  const lean = 0.5 + random() * 0.9;
  const segments = 5;
  let tx = x;
  let tz = z;
  for (let i = 0; i < segments; i++) {
    const t = (i + 0.5) / segments;
    tx = x + Math.cos(leanAngle) * lean * t * t;
    tz = z + Math.sin(leanAngle) * lean * t * t;
    const thickness = 0.36 - 0.14 * t;
    city.box(
      tx,
      base + height * t,
      tz,
      thickness,
      height / segments + 0.05,
      thickness,
      PALM_TRUNK,
      i % 2 === 0 ? 0.82 : 0.95,
    );
  }

  const top = base + height;
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const angle = (i / fronds) * Math.PI * 2 + random() * 0.4;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    // Sideways across the frond.
    const sx = -dz;
    const sz = dx;
    const reach = 2.9 + random() * 0.9;
    const mid: Vec3 = [tx + dx * reach * 0.5, top + 0.55, tz + dz * reach * 0.5];
    const tip: Vec3 = [tx + dx * reach, top - 0.9 - random() * 0.5, tz + dz * reach];
    const color = pick(random, FRONDS);
    city.quadDouble(
      [tx - sx * 0.3, top, tz - sz * 0.3],
      [tx + sx * 0.3, top, tz + sz * 0.3],
      [mid[0] + sx * 0.42, mid[1], mid[2] + sz * 0.42],
      [mid[0] - sx * 0.42, mid[1], mid[2] - sz * 0.42],
      color,
    );
    city.quadDouble(
      [mid[0] - sx * 0.42, mid[1], mid[2] - sz * 0.42],
      [mid[0] + sx * 0.42, mid[1], mid[2] + sz * 0.42],
      [tip[0] + sx * 0.08, tip[1], tip[2] + sz * 0.08],
      [tip[0] - sx * 0.08, tip[1], tip[2] - sz * 0.08],
      color,
      0.9,
    );
  }
}

export function addTree(
  city: GeoBuilder,
  x: number,
  z: number,
  scale: number,
  random: Random,
): void {
  city.resetFrame();
  const base = surfaceHeightAt(x, z);
  city.box(x, base + 1.5 * scale, z, 0.4, 3 * scale, 0.4, TRUNK, 0.7);
  for (let i = 0; i < 3; i++) {
    const radius = (1.5 + random() * 0.9) * scale;
    city.blob(
      x + (random() - 0.5) * 1.8 * scale,
      base + (3.4 + random() * 1.3) * scale,
      z + (random() - 0.5) * 1.8 * scale,
      radius,
      radius * 0.78,
      radius,
      pick(random, LEAVES),
    );
  }
}

export function addVegetation(city: GeoBuilder, random: Random): void {
  // Coconut palms along the promenade and the avenue.
  for (let x = -138; x <= 138; x += 17) {
    addPalm(city, x + (random() - 0.5) * 3, SAND_EDGE_Z + 2.2, random);
    if (random() < 0.5) addPalm(city, x + 8, SAND_EDGE_Z - 4 - random() * 8, random);
  }
  // The park.
  for (let i = 0; i < 9; i++) {
    const x = PARK.x0 + 4 + random() * (PARK.x1 - PARK.x0 - 8);
    const z = PARK.z0 + 4 + random() * (PARK.z1 - PARK.z0 - 8);
    if (i % 3 === 0) addPalm(city, x, z, random);
    else addTree(city, x, z, 0.9 + random() * 0.5, random);
  }
  // Shade trees here and there on the cross-street sidewalks.
  for (const street of CROSS_STREETS) {
    for (let x = -72; x <= 72; x += 24) {
      if (random() < 0.55) {
        addTree(city, x + (random() - 0.5) * 6, street.z + ROAD_HALF + 1.2, 0.8, random);
      }
    }
  }
}

// --- Street life ------------------------------------------------------------------------

/** Festa junina bunting zig-zagging between the buildings of the cobblestone street. */
export function addBunting(city: GeoBuilder, wires: number[]): void {
  city.resetFrame();
  const street = CROSS_STREETS.find((candidate) => candidate.surface === 'cobble');
  if (!street) return;
  const reach = ROAD_HALF + 2.4;
  let side = -1;
  let flag = 0;
  for (let x = -86; x < 84; x += 4.5) {
    side = -side;
    if (HILL_STREETS_X.some((centre) => Math.abs(x + 2.25 - centre) < 9)) continue;
    const a: Vec3 = [x, heightAt(x, street.z) + 6.3, street.z + side * reach];
    const b: Vec3 = [x + 4.5, heightAt(x + 4.5, street.z) + 6.3, street.z - side * reach];
    const sag = 0.8;
    wire(wires, a, b, sag, 8);

    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const ux = (b[0] - a[0]) / length;
    const uz = (b[2] - a[2]) / length;
    const count = 13;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const px = a[0] + (b[0] - a[0]) * t;
      const py = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t);
      const pz = a[2] + (b[2] - a[2]) * t;
      city.triDouble(
        [px - ux * 0.24, py, pz - uz * 0.24],
        [px + ux * 0.24, py, pz + uz * 0.24],
        [px, py - 0.55, pz],
        FLAGS[flag++ % FLAGS.length] ?? WHITE,
      );
    }
  }
}

/** A parked car or van with its collider. `y` defaults to the city ground there. */
export function addCar(
  city: GeoBuilder,
  solids: SolidBox[],
  x: number,
  z: number,
  yaw: number,
  random: Random,
  y = heightAt(x, z),
): void {
  city.setFrame(x, y, z, yaw);
  const wheels = (reach: number): void => {
    for (const wx of [-0.8, 0.8]) {
      for (const wz of [-reach, reach]) city.box(wx, 0.3, wz, 0.24, 0.6, 0.62, TYRE);
    }
  };

  if (random() < 0.2) {
    // Boxy van.
    const paint = pick(random, VAN_PAINT);
    city.box(0, 1.05, 0, 1.75, 1.5, 4.2, paint, 0.8);
    city.box(0, 1.42, 0.15, 1.78, 0.44, 3.4, CAR_GLASS);
    city.quad(
      [-0.75, 1.2, 2.11],
      [0.75, 1.2, 2.11],
      [0.75, 1.65, 2.11],
      [-0.75, 1.65, 2.11],
      CAR_GLASS,
    );
    wheels(1.35);
    solids.push({ x, y: y + 0.9, z, hx: 0.9, hy: 0.9, hz: 2.1, yaw });
  } else {
    const paint = pick(random, CAR_PAINT);
    city.box(0, 0.62, 0, 1.72, 0.62, 4.1, paint, 0.8);
    city.box(0, 1.2, -0.15, 1.5, 0.56, 2.1, CAR_GLASS, 1, paint);
    for (const lx of [-0.6, 0.6]) {
      city.box(lx, 0.7, 2.05, 0.3, 0.14, 0.04, 0xfff1c2);
      city.box(lx, 0.72, -2.05, 0.3, 0.12, 0.04, 0xc0392b);
    }
    wheels(1.3);
    solids.push({ x, y: y + 0.75, z, hx: 0.88, hy: 0.75, hz: 2.05, yaw });
  }
}

/** Cars and vans parked along the kerbs of the level streets. */
export function addParkedCars(city: GeoBuilder, solids: SolidBox[], random: Random): void {
  const nearHillStreet = (x: number): boolean =>
    HILL_STREETS_X.some((centre) => Math.abs(x - centre) < 11);

  for (const street of CROSS_STREETS) {
    for (let x = -84; x <= 84; x += 6.2) {
      if (nearHillStreet(x) || random() > 0.5) continue;
      const yaw = random() < 0.85 ? Math.PI / 2 : -Math.PI / 2;
      addCar(city, solids, x, street.z - ROAD_HALF + 1.05, yaw, random);
    }
  }
  for (let x = -140; x <= 140; x += 6.5) {
    if (nearHillStreet(x) || random() > 0.4) continue;
    addCar(city, solids, x, AVENUE_Z_MAX - 1.05, -Math.PI / 2, random);
  }
  city.resetFrame();
}

/** The yellow and red plastic tables and chairs outside every corner bar. */
export function addBarTables(city: GeoBuilder, random: Random): void {
  const cobble = CROSS_STREETS.find((street) => street.surface === 'cobble')?.z ?? 20;
  const spots: readonly (readonly [number, number])[] = [
    [-62, cobble + 6.3],
    [-58.6, cobble + 6.3],
    [8, cobble - 6.3],
    [11.4, cobble - 6.3],
    [55, cobble + 6.3],
    [58.4, cobble + 6.3],
    [-6, SAND_EDGE_Z + 5.4],
    [36, SAND_EDGE_Z + 5.4],
    [39.4, SAND_EDGE_Z + 5.4],
  ];
  for (const [x, z] of spots) {
    const color = pick(random, PLASTIC);
    const y = surfaceHeightAt(x, z);
    city.setFrame(x, y, z, random() * Math.PI);
    city.box(0, 0.36, 0, 0.08, 0.72, 0.08, color);
    city.box(0, 0.74, 0, 0.72, 0.04, 0.72, color);
    const chairs = 3 + Math.floor(random() * 2);
    for (let i = 0; i < chairs; i++) {
      const angle = (i / 4) * Math.PI * 2 + random() * 0.3;
      const cx = x + Math.sin(angle) * 0.8;
      const cz = z + Math.cos(angle) * 0.8;
      // Each chair faces the table: its back is on the far side.
      city.setFrame(cx, y, cz, angle);
      city.box(0, 0.22, 0, 0.36, 0.44, 0.36, color, 0.8);
      city.box(0, 0.66, 0.17, 0.38, 0.44, 0.04, color);
    }
  }
  city.resetFrame();
}

/** Promenade kiosks sit halfway between the palms, which stand every 17 m from x = -138. */
const KIOSK_X: readonly number[] = [-129.5, -95.5, -61.5, -27.5, 6.5, 40.5, 74.5, 108.5];

/** Parasols and towels on the sand, kiosks on the promenade. */
export function addBeach(city: GeoBuilder, solids: SolidBox[], random: Random): void {
  for (let i = 0; i < 16; i++) {
    const x = -140 + random() * 280;
    const z = SAND_EDGE_Z - 3 - random() * 13;
    const y = heightAt(x, z);
    const a = pick(random, UMBRELLA);
    const b = random() < 0.6 ? WHITE : a;
    city.setFrame(x, y, z, random() * Math.PI);
    city.box(0, 1.05, 0, 0.06, 2.1, 0.06, WHITE);
    const sides = 8;
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * Math.PI * 2;
      const a1 = ((s + 1) / sides) * Math.PI * 2;
      city.triDouble(
        [0, 2.3, 0],
        [Math.cos(a1) * 1.4, 1.85, Math.sin(a1) * 1.4],
        [Math.cos(a0) * 1.4, 1.85, Math.sin(a0) * 1.4],
        s % 2 === 0 ? a : b,
      );
    }
    // A towel beside it.
    city.quad(
      [1, 0.03, 1.4],
      [1.9, 0.03, 1.4],
      [1.9, 0.03, -0.4],
      [1, 0.03, -0.4],
      pick(random, FLAGS),
    );
  }

  // Kiosks along the promenade, midway between the palms, with plastic tables at every
  // other one.
  const roofs = [0x1f8a4c, 0xd62828, 0x1d6fb8, 0xef7b22, 0xf2b632] as const;
  KIOSK_X.forEach((x, index) => {
    const z = SAND_EDGE_Z + 3.6;
    const y = heightAt(x, z) + CURB;
    const roof = roofs[index % roofs.length] ?? 0x1f8a4c;
    city.setFrame(x, y, z, 0);
    city.box(0, 1.3, 0, 3.2, 2.6, 2.6, WHITE, 0.8);
    city.box(0, 2.7, 0, 4.6, 0.2, 4, roof, 0.85);
    // Serving hatches front and back.
    city.quad([-1.3, 1, 1.31], [1.3, 1, 1.31], [1.3, 2.1, 1.31], [-1.3, 2.1, 1.31], 0x1c1815);
    city.quad([1.3, 1, -1.31], [-1.3, 1, -1.31], [-1.3, 2.1, -1.31], [1.3, 2.1, -1.31], 0x1c1815);
    city.box(0, 0.95, 1.45, 2.8, 0.08, 0.35, roof);
    // A stack of green coconuts on the counter.
    for (let c = 0; c < 4; c++) city.blob(-0.9 + c * 0.25, 1.1, 1.5, 0.12, 0.12, 0.12, 0x5a8f3a);
    solids.push({ x, y: y + 1.3, z, hx: 1.6, hy: 1.3, hz: 1.3, yaw: 0 });
    if (index % 2 === 0) {
      for (const side of [-1, 1]) {
        const tx = x + side * 4.2;
        const color = pick(random, PLASTIC);
        city.setFrame(tx, y, z, random() * Math.PI);
        city.box(0, 0.36, 0, 0.08, 0.72, 0.08, color);
        city.box(0, 0.74, 0, 0.72, 0.04, 0.72, color);
        for (let k = 0; k < 2; k++) {
          const angle = k * Math.PI + random() * 0.4;
          city.setFrame(tx + Math.sin(angle) * 0.8, y, z + Math.cos(angle) * 0.8, angle);
          city.box(0, 0.22, 0, 0.36, 0.44, 0.36, color, 0.8);
          city.box(0, 0.66, 0.17, 0.38, 0.44, 0.04, color);
        }
      }
    }
  });
  city.resetFrame();
}

// --- Backdrop ---------------------------------------------------------------------------

interface Dome {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
  /** Bare granite summit, like the morros around Guanabara Bay. */
  rocky: boolean;
}

/** Generic rounded hills. Deliberately not modelled on any real, recognizable peak. */
// The hills around the city are real terrain now (`terrain.ts`); only the islands remain.
const DOMES: readonly Dome[] = [
  { cx: -170, cy: -3, cz: -330, rx: 45, ry: 24, rz: 32, rocky: true },
  { cx: 210, cy: -3, cz: -380, rx: 70, ry: 34, rz: 45, rocky: false },
];

function addDome(city: GeoBuilder, dome: Dome, random: Random): void {
  const rings = 6;
  const segments = 22;
  const point = (segment: number, ring: number): Vec3 => {
    const theta = (segment / segments) * Math.PI * 2;
    const phi = (ring / rings) * (Math.PI / 2);
    return [
      dome.cx + dome.rx * Math.cos(phi) * Math.cos(theta),
      dome.cy + dome.ry * Math.sin(phi),
      dome.cz + dome.rz * Math.cos(phi) * Math.sin(theta),
    ];
  };
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const rock = dome.rocky && ring >= rings - 2 - (segment % 3 === 0 ? 1 : 0);
      const shade = 0.88 + random() * 0.18;
      city.quad(
        point(segment + 1, ring),
        point(segment, ring),
        point(segment, ring + 1),
        point(segment + 1, ring + 1),
        rock ? GRANITE : pick(random, FOREST),
        [shade, shade, shade, shade],
      );
    }
  }
}

/** Offshore islands, the tunnel mouths on the avenue, and the walls that keep you in. */
export function addBackdrop(city: GeoBuilder, solids: SolidBox[], random: Random): void {
  city.resetFrame();
  for (const dome of DOMES) addDome(city, dome, random);

  // The avenue disappears into a tunnel at each end.
  const mid = (AVENUE_Z_MIN + AVENUE_Z_MAX) / 2;
  for (const side of [-1, 1]) {
    const x = side * (HALF + 3);
    city.box(x, 5.5, mid, 6, 11, 28, 0xa39f96, 0.7);
    const face = side * (HALF - 0.02);
    const z0 = AVENUE_Z_MIN + 1;
    const z1 = AVENUE_Z_MAX - 1;
    if (side < 0) {
      city.quad([face, 0, z1], [face, 0, z0], [face, 6.2, z0], [face, 6.2, z1], 0x0d0d10);
    } else {
      city.quad([face, 0, z0], [face, 0, z1], [face, 6.2, z1], [face, 6.2, z0], 0x0d0d10);
    }
    // Stop at the top edge of the city: beyond it the hillside is open.
    solids.push({ x: side * (HALF + 0.5), y: 10, z: -5, hx: 0.5, hy: 40, hz: HALF + 5, yaw: 0 });
  }
  // Keep riders out of the sea, and inside the land edges of the world, where the terrain
  // rises steeply enough to hide the walls.
  solids.push({ x: 0, y: 10, z: -137, hx: HALF + 10, hy: 40, hz: 0.5, yaw: 0 });
  const midX = (WORLD.x0 + WORLD.x1) / 2;
  const midZ = (WORLD.z0 + WORLD.z1) / 2;
  const spanX = (WORLD.x1 - WORLD.x0) / 2;
  const spanZ = (WORLD.z1 - WORLD.z0) / 2;
  solids.push({ x: midX, y: 150, z: WORLD.z1 - 6, hx: spanX, hy: 250, hz: 0.5, yaw: 0 });
  solids.push({ x: WORLD.x0 + 6, y: 150, z: midZ, hx: 0.5, hy: 250, hz: spanZ, yaw: 0 });
  solids.push({ x: WORLD.x1 - 6, y: 150, z: midZ, hx: 0.5, hy: 250, hz: spanZ, yaw: 0 });
}
