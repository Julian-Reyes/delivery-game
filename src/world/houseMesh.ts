import { facadeUv } from './facades';
import type { Feature } from './facades';
import type { GeoBuilder, Vec3 } from './geo';
import { FLOOR_HEIGHT } from './houses';
import type { DeliverySpot, House } from './houses';
import type { SolidBox } from './props';
import { createRandom, pick } from './random';

/**
 * Favela houses from their footprints: textured walls with a window, door or shutter in
 * every bay of every floor (one draw call for all of them, from the facade atlas), flat
 * roof slabs with a little overhang, blue water tanks, part-built top floors with rebar
 * sticking up, and a bare block foundation where the slope drops away. Pickup shops get a
 * roller shutter front and an awning.
 *
 * The same `House` data could drive real models later; nothing here feeds back into the
 * layout.
 */

const BAY = 2.8;
const SLAB = 0x9a958c;
const PARAPET = 0xb3aea4;
const TANK = 0x2a6fbd;
const TANK_LID = 0x1d4f8a;
const AWNINGS = [0x1f9d55, 0xd9472b, 0xf2b632, 0x2a6fdb] as const;
const PICKUP_POST = 0x2fbf71;
const DROPOFF_POST = 0x3b82f6;

type Random = () => number;

/** What goes in a bay, by which wall it is on and which floor. */
function featureFor(
  wall: 'front' | 'side' | 'back',
  floor: number,
  bay: number,
  doorBay: number,
  shop: boolean,
  random: Random,
): Feature {
  if (wall === 'front' && floor === 0) {
    if (shop) return 'roller';
    if (bay === doorBay) return 'door';
    return random() < 0.55 ? 'grille' : random() < 0.5 ? 'roller' : 'blank';
  }
  const roll = random();
  if (wall === 'front')
    return roll < 0.45 ? 'grille' : roll < 0.75 ? 'shutters' : roll < 0.88 ? 'small' : 'blank';
  if (wall === 'side') return roll < 0.5 ? 'blank' : roll < 0.75 ? 'small' : 'grille';
  return roll < 0.75 ? 'blank' : 'small';
}

/**
 * One wall, split into floors and bays. `a` and `b` are its bottom corners as seen from
 * outside, left then right, in the house's local frame.
 */
function wall(
  facade: GeoBuilder,
  house: House,
  a: readonly [number, number],
  b: readonly [number, number],
  side: 'front' | 'side' | 'back',
  shop: boolean,
  random: Random,
): void {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bays = Math.max(1, Math.round(length / BAY));
  const doorBay = Math.floor(random() * bays);
  for (let floor = 0; floor < house.floors; floor++) {
    const y0 = house.floorY + floor * FLOOR_HEIGHT;
    const y1 = y0 + FLOOR_HEIGHT;
    // Lower floors a touch darker, like the city's baked shading.
    const shade = 0.82 + 0.18 * Math.min(1, floor / 2);
    for (let bay = 0; bay < bays; bay++) {
      const t0 = bay / bays;
      const t1 = (bay + 1) / bays;
      const x0 = a[0] + (b[0] - a[0]) * t0;
      const z0 = a[1] + (b[1] - a[1]) * t0;
      const x1 = a[0] + (b[0] - a[0]) * t1;
      const z1 = a[1] + (b[1] - a[1]) * t1;
      const [u0, v0, u1, v1] = facadeUv(
        house.finish,
        featureFor(side, floor, bay, doorBay, shop, random),
      );
      facade.quad(
        [x0, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z0],
        house.color,
        [shade, shade, shade + 0.06, shade + 0.06],
        [
          [u0, v0],
          [u1, v0],
          [u1, v1],
          [u0, v1],
        ],
      );
    }
  }
  // Bare block below the ground floor, wherever the slope drops away under the house.
  const below = house.floorY - house.baseY;
  if (below > 0.3) {
    const [u0, v0, u1, v1] = facadeUv('block', 'blank');
    const vTop = v0 + (v1 - v0) * Math.min(1, below / FLOOR_HEIGHT);
    facade.quad(
      [a[0], house.baseY, a[1]],
      [b[0], house.baseY, b[1]],
      [b[0], house.floorY, b[1]],
      [a[0], house.floorY, a[1]],
      0xb0aca4,
      [0.7, 0.7, 0.8, 0.8],
      [
        [u0, v0],
        [u1, v0],
        [u1, vTop],
        [u0, vTop],
      ],
    );
  }
}

function roof(city: GeoBuilder, wires: number[], house: House, top: number, random: Random): void {
  const w = house.width;
  const d = house.depth;
  // The slab, overhanging the walls a little.
  city.box(0, top + 0.08, 0, w + 0.3, 0.16, d + 0.3, SLAB, 0.7);

  const roll = random();
  if (roll < 0.3) {
    // A parapet all round.
    for (const [cx, cz, sx, sz] of [
      [0, d / 2, w, 0.15],
      [0, -d / 2, w, 0.15],
      [w / 2, 0, 0.15, d],
      [-w / 2, 0, 0.15, d],
    ] as const) {
      city.box(cx, top + 0.16 + 0.45, cz, sx, 0.9, sz, PARAPET, 0.8);
    }
  } else if (roll < 0.6) {
    // The next floor started and never finished: two low block walls and rebar.
    const wallHeight = 0.8 + random() * 1.2;
    city.box(0, top + 0.16 + wallHeight / 2, -d / 2 + 0.08, w, wallHeight, 0.16, PARAPET, 0.8);
    city.box(-w / 2 + 0.08, top + 0.16 + wallHeight / 2, 0, 0.16, wallHeight, d, PARAPET, 0.8);
  }

  // Rebar sticking up out of the corner columns, waiting for the next floor.
  if (random() < 0.55) {
    const sin = Math.sin(house.yaw);
    const cos = Math.cos(house.yaw);
    const world = (lx: number, y: number, lz: number): Vec3 => [
      house.x + lx * cos + lz * sin,
      y,
      house.z - lx * sin + lz * cos,
    ];
    for (const [cx, cz] of [
      [w / 2 - 0.15, d / 2 - 0.15],
      [-w / 2 + 0.15, d / 2 - 0.15],
      [w / 2 - 0.15, -d / 2 + 0.15],
      [-w / 2 + 0.15, -d / 2 + 0.15],
    ] as const) {
      for (const [ox, oz] of [
        [-0.06, -0.06],
        [0.06, 0.06],
      ] as const) {
        wires.push(...world(cx + ox, top + 0.16, cz + oz), ...world(cx + ox, top + 1.2, cz + oz));
      }
    }
  }

  // A blue water tank on most roofs.
  if (random() < 0.65) {
    const tx = (random() - 0.5) * (w - 1.6);
    const tz = (random() - 0.5) * (d - 1.6);
    city.cylinder(tx, tz, top + 0.16, top + 1.3, 0.55, 7, TANK);
    city.cylinder(tx, tz, top + 1.3, top + 1.38, 0.6, 7, TANK_LID);
  }
}

export function addHouses(
  facade: GeoBuilder,
  city: GeoBuilder,
  wires: number[],
  solids: SolidBox[],
  houses: readonly House[],
  spots: readonly DeliverySpot[],
): void {
  const shops = new Set(spots.filter((s) => s.kind === 'pickup').map((s) => s.house));
  for (const house of houses) {
    const random = createRandom(house.id * 7919 + 101);
    const top = house.floorY + house.floors * FLOOR_HEIGHT;
    const w = house.width / 2;
    const d = house.depth / 2;
    const shop = shops.has(house.id);
    facade.setFrame(house.x, 0, house.z, house.yaw);
    city.setFrame(house.x, 0, house.z, house.yaw);

    // Walls go round counter-clockwise seen from above, each from its own left corner.
    wall(facade, house, [-w, d], [w, d], 'front', shop, random);
    wall(facade, house, [w, d], [w, -d], 'side', false, random);
    wall(facade, house, [w, -d], [-w, -d], 'back', false, random);
    wall(facade, house, [-w, -d], [-w, d], 'side', false, random);
    roof(city, wires, house, top, random);

    if (shop) {
      // A striped awning over the shop front.
      city.box(
        0,
        house.floorY + 2.5,
        d + 0.6,
        house.width * 0.85,
        0.08,
        1.2,
        pick(random, AWNINGS),
        0.9,
      );
    }

    solids.push({
      x: house.x,
      y: (house.baseY + top) / 2,
      z: house.z,
      hx: w,
      hy: (top - house.baseY) / 2,
      hz: d,
      yaw: house.yaw,
    });
  }

  city.resetFrame();
  facade.resetFrame();
  for (const spot of spots) {
    const color = spot.kind === 'pickup' ? PICKUP_POST : DROPOFF_POST;
    // Just in front of the door, so it stands in the street rather than in the wall.
    const house = houses[spot.house];
    const x = spot.x + (house ? Math.sin(house.yaw) * 0.6 : 0);
    const z = spot.z + (house ? Math.cos(house.yaw) * 0.6 : 0);
    city.box(x, spot.y + 2, z, 0.3, 4, 0.3, color, 0.8);
  }
}
