import { createRandom, pick } from './geo';
import type { GeoBuilder } from './geo';
import {
  CURB,
  HALF,
  HILL_STREETS_X,
  NORTH_EXITS_X,
  NORTH_ROW_Z,
  SEAFRONT_Z_MAX,
  CORRIDOR_HALF,
  heightAt,
  innerBlocks,
  isPark,
} from './layout';
import { APP_SIGN_SLOTS, SIGN_COUNT, signUvs } from './textures';

/**
 * Procedural buildings in the vocabulary of a Brazilian city street: shops with roller
 * shutters and hand-painted signs, painted houses with a contrasting base band and clay
 * tile roofs, unfinished brick-and-concrete houses with blue water tanks, and balconied
 * apartment blocks on the seafront.
 */

export type BuildingStyle = 'shop' | 'house' | 'raw' | 'apartment';

export interface BuildingSpec {
  /** Centre of the front wall, on the lot line. */
  x: number;
  z: number;
  /** Local +z points out of the front wall towards the street. */
  yaw: number;
  width: number;
  depth: number;
  /** Ground-floor level. */
  floorY: number;
  /** Bottom of the walls, below the lowest ground under the footprint. */
  baseY: number;
  /** Roof height above `floorY`. */
  height: number;
  floors: number;
  style: BuildingStyle;
  seed: number;
}

const GROUND_FLOOR = 3.4;
const UPPER_FLOOR = 3.0;
const PARAPET = 0.45;
/** Depth of the rows on the north and south sides of a block, which own the corners. */
const ROW_DEPTH = 11;

const PAINT = [
  0xf2c14e, 0xe9785b, 0x4fa3a5, 0x7fb7e6, 0xf4e9d4, 0xe8a0b0, 0x8fc97a, 0xd9603b, 0xf3f0e8,
  0x5b7fb5, 0xc9b28a, 0xa67cc0, 0xf6d98a, 0x6fbf9a,
] as const;
const APARTMENT_PAINT = [0xf3f0e8, 0xe9e2d0, 0xd8e6e8, 0xf1dcc4, 0xcfd8dc, 0xf0e6b8] as const;
const ACCENT = [0x2f7f86, 0xc0563d, 0x355c9a, 0xd9a03b, 0x4c8a5a, 0x7a4f8f] as const;
const BRICK = [0xa9623f, 0xb86f4a, 0x9c5a3a, 0xb0683f] as const;
const SHUTTER = [0x9aa0a6, 0x3f6fb0, 0x3d8b63, 0x8c5a3c, 0xcfd2d4, 0xb8442e, 0x6d7a80] as const;
const WINDOW_SHUTTER = [0x2f6b4f, 0x24507a, 0x6b4a2f, 0xf3f0e8, 0x8a3b2c] as const;
const AWNING = [0xd62828, 0x1f8a4c, 0x1d6fb8, 0xf7c600, 0xef7b22, 0x2b2b2b] as const;
const TRIM_WHITE = 0xf7f4ec;
const CONCRETE = 0x9a968e;
const ROOF_SLAB = 0x8a857c;
const ROOF_TILE = 0xb4532a;
const GLASS = 0x34495e;
const DARK = 0x1c1815;
const WATER_TANK = 0x2b6fd6;
const WATER_TANK_LID = 0x2460bd;
const REBAR = 0x7a4a2a;
const AC_UNIT = 0xdedbd2;

type Random = () => number;

function styleFor(z: number, facesAvenue: boolean, random: Random): BuildingStyle {
  if (facesAvenue) return 'apartment';
  const roll = random();
  if (z < -45) return roll < 0.45 ? 'shop' : roll < 0.7 ? 'apartment' : 'house';
  if (z < 75) return roll < 0.58 ? 'shop' : roll < 0.84 ? 'house' : 'raw';
  return roll < 0.55 ? 'raw' : roll < 0.8 ? 'house' : 'shop';
}

function floorsFor(style: BuildingStyle, facesAvenue: boolean, random: Random): number {
  switch (style) {
    case 'apartment':
      return facesAvenue ? 5 + Math.floor(random() * 4) : 3 + Math.floor(random() * 2);
    case 'shop':
      return 2 + Math.floor(random() * 2);
    case 'house':
      return 1 + Math.floor(random() * 2);
    case 'raw':
      return 1 + Math.floor(random() * 3);
  }
}

/**
 * Fill a stretch of lot line with buildings, wall to wall with no gaps, so a row also
 * works as a solid barrier. `(ax, az)` is the unit direction along the lot line.
 */
function frontage(
  out: BuildingSpec[],
  random: Random,
  x0: number,
  z0: number,
  ax: number,
  az: number,
  length: number,
  yaw: number,
  depthMin: number,
  depthMax: number,
): void {
  const facesAvenue = z0 === SEAFRONT_Z_MAX && az === 0 && Math.abs(yaw) > 3;
  let s = 0;
  while (s < length - 0.01) {
    const frontZ = z0 + az * s;
    const style = styleFor(frontZ, facesAvenue, random);
    const minWidth = style === 'apartment' ? 11 : 5.5;
    let width = style === 'apartment' ? 11 + random() * 6 : 5.5 + random() * 4.5;
    // The last building absorbs whatever is left rather than leaving a sliver.
    if (length - s - width < minWidth) width = length - s;

    const depth = depthMin + random() * (depthMax - depthMin);
    const floors = floorsFor(style, facesAvenue, random);
    const x = x0 + ax * (s + width / 2);
    const z = z0 + az * (s + width / 2);

    // Lowest ground under the footprint, so walls never float above a slope.
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    let lowest = Infinity;
    for (const [lx, lz] of [
      [-width / 2, 0],
      [width / 2, 0],
      [-width / 2, -depth],
      [width / 2, -depth],
    ] as const) {
      lowest = Math.min(lowest, heightAt(x + lx * cos + lz * sin, z - lx * sin + lz * cos));
    }

    const tiledRoof = style === 'house';
    out.push({
      x,
      z,
      yaw,
      width,
      depth,
      floorY: heightAt(x, z) + CURB,
      baseY: lowest - 0.6,
      height: GROUND_FLOOR + (floors - 1) * UPPER_FLOOR + (tiledRoof ? 0 : PARAPET),
      floors,
      style,
      seed: Math.floor(random() * 2147483000) + 1,
    });
    s += width;
  }
}

/** Decide where every building in the neighborhood goes. Deterministic. */
export function planBuildings(): BuildingSpec[] {
  const random = createRandom(4242);
  const out: BuildingSpec[] = [];
  const south = Math.PI;
  const north = 0;
  const east = Math.PI / 2;
  const west = -Math.PI / 2;

  for (const block of innerBlocks()) {
    if (isPark(block)) continue;
    const width = block.x1 - block.x0;
    const sideLength = block.z1 - block.z0 - ROW_DEPTH * 2;
    frontage(out, random, block.x0, block.z0, 1, 0, width, south, ROW_DEPTH, ROW_DEPTH);
    frontage(out, random, block.x0, block.z1, 1, 0, width, north, ROW_DEPTH, ROW_DEPTH);
    frontage(out, random, block.x0, block.z0 + ROW_DEPTH, 0, 1, sideLength, west, 8, 11);
    frontage(out, random, block.x1, block.z0 + ROW_DEPTH, 0, 1, sideLength, east, 8, 11);
  }

  // Outer columns: one unbroken row down each side of the map, plus the seafront corners.
  const westX = (HILL_STREETS_X[0] ?? -90) - CORRIDOR_HALF;
  const eastX = (HILL_STREETS_X[HILL_STREETS_X.length - 1] ?? 90) + CORRIDOR_HALF;
  const columnStart = SEAFRONT_Z_MAX + ROW_DEPTH;
  const columnLength = HALF - columnStart;
  frontage(out, random, westX, columnStart, 0, 1, columnLength, east, 9, 12);
  frontage(out, random, eastX, columnStart, 0, 1, columnLength, west, 9, 12);
  frontage(out, random, -HALF, SEAFRONT_Z_MAX, 1, 0, westX + HALF, south, ROW_DEPTH, ROW_DEPTH);
  frontage(out, random, eastX, SEAFRONT_Z_MAX, 1, 0, HALF - eastX, south, ROW_DEPTH, ROW_DEPTH);

  // The row along the top of the hill, broken where streets carry on up into the hillside.
  const topDepth = HALF - NORTH_ROW_Z;
  let rowStart = westX;
  for (const exit of [...NORTH_EXITS_X].sort((a, b) => a - b)) {
    const gapStart = exit - CORRIDOR_HALF;
    if (gapStart > rowStart + 0.01) {
      frontage(
        out,
        random,
        rowStart,
        NORTH_ROW_Z,
        1,
        0,
        gapStart - rowStart,
        south,
        topDepth,
        topDepth,
      );
    }
    rowStart = exit + CORRIDOR_HALF;
  }
  if (eastX > rowStart + 0.01) {
    frontage(out, random, rowStart, NORTH_ROW_Z, 1, 0, eastX - rowStart, south, topDepth, topDepth);
  }

  return out;
}

export function addBuilding(city: GeoBuilder, signs: GeoBuilder, spec: BuildingSpec): void {
  const random = createRandom(spec.seed);
  const { width: w, depth: d, height: H, floors } = spec;
  const below = spec.baseY - spec.floorY;

  city.setFrame(spec.x, spec.floorY, spec.z, spec.yaw);
  signs.setFrame(spec.x, spec.floorY, spec.z, spec.yaw);

  /** A flat panel on the front wall, `out` metres proud of it. */
  const front = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    out: number,
    color: number,
    shadeBottom = 1,
    shadeTop = 1,
  ): void => {
    city.quad([x0, y0, out], [x1, y0, out], [x1, y1, out], [x0, y1, out], color, [
      shadeBottom,
      shadeBottom,
      shadeTop,
      shadeTop,
    ]);
  };

  const body = (wall: number, roof: number): void => {
    city.box(0, (H + below) / 2, -d / 2, w, H - below, d, wall, 0.66, roof);
  };

  const windowAt = (
    cx: number,
    sill: number,
    ww: number,
    wh: number,
    frame: number | null,
    fill: number,
  ): void => {
    if (frame !== null) {
      front(cx - ww / 2 - 0.1, sill - 0.1, cx + ww / 2 + 0.1, sill + wh + 0.1, 0.03, frame);
    }
    if (fill === GLASS) {
      front(cx - ww / 2, sill, cx + ww / 2, sill + wh, 0.06, fill, 0.7, 1.35);
    } else {
      front(cx - ww / 2, sill, cx + ww / 2, sill + wh, 0.06, fill, 0.85, 1);
    }
  };

  const upperWindows = (
    frame: number | null,
    fills: readonly number[],
    acChance: number,
    skipTop = false,
  ): void => {
    const last = skipTop ? floors - 1 : floors;
    for (let floor = 1; floor < last; floor++) {
      const sill = GROUND_FLOOR + (floor - 1) * UPPER_FLOOR + 0.95;
      const bays = Math.max(1, Math.floor(w / 2.7));
      const spacing = w / bays;
      for (let bay = 0; bay < bays; bay++) {
        const cx = -w / 2 + spacing * (bay + 0.5);
        windowAt(cx, sill, 1.15, 1.35, frame, pick(random, fills));
        if (random() < acChance) city.box(cx, sill - 0.5, 0.22, 0.75, 0.45, 0.4, AC_UNIT, 0.8);
      }
    }
  };

  const waterTank = (): void => {
    const tx = (random() - 0.5) * w * 0.5;
    const tz = -d * (0.3 + random() * 0.4);
    city.box(tx, H + 0.2, tz, 1.3, 0.4, 1.3, CONCRETE, 0.8);
    city.cylinder(tx, tz, H + 0.4, H + 1.5, 0.68, 8, WATER_TANK, WATER_TANK_LID);
  };

  switch (spec.style) {
    case 'shop': {
      const wall = pick(random, PAINT);
      const trim = random() < 0.7 ? TRIM_WHITE : pick(random, ACCENT);
      body(wall, ROOF_SLAB);

      const bays = w > 8.5 ? 2 : 1;
      const bayWidth = (w - 0.8) / bays;
      const shutter = pick(random, SHUTTER);
      for (let bay = 0; bay < bays; bay++) {
        const cx = -w / 2 + 0.4 + bayWidth * (bay + 0.5);
        const half = (bayWidth - 0.5) / 2;
        if (random() < 0.38) {
          // Open for business: dark interior, a counter, the shutter rolled up above.
          front(cx - half, 0, cx + half, 2.7, 0.03, DARK);
          front(cx - half, 2.45, cx + half, 2.75, 0.05, shutter, 0.8, 0.95);
          city.box(cx, 0.5, 0.22, half * 1.4, 1, 0.45, pick(random, ACCENT), 0.75, TRIM_WHITE);
        } else {
          const slats = 6;
          for (let slat = 0; slat < slats; slat++) {
            const shade = slat % 2 === 0 ? 0.86 : 1;
            front(
              cx - half,
              slat * 0.45,
              cx + half,
              (slat + 1) * 0.45,
              0.03,
              shutter,
              shade,
              shade,
            );
          }
        }
      }

      if (random() < 0.82) {
        const slot =
          random() < 0.07
            ? pick(random, APP_SIGN_SLOTS)
            : Math.floor(random() * (SIGN_COUNT - APP_SIGN_SLOTS.length));
        const half = Math.min(w - 0.8, 4.6) / 2;
        signs.quad(
          [-half, 2.85, 0.09],
          [half, 2.85, 0.09],
          [half, 3.85, 0.09],
          [-half, 3.85, 0.09],
          0xffffff,
          [1, 1, 1, 1],
          signUvs(slot),
        );
      }

      if (random() < 0.45) {
        const a = pick(random, AWNING);
        const b = random() < 0.6 ? TRIM_WHITE : a;
        const stripes = Math.max(3, Math.round((w - 0.4) / 0.9));
        const stripeWidth = (w - 0.4) / stripes;
        for (let stripe = 0; stripe < stripes; stripe++) {
          const xa = -w / 2 + 0.2 + stripe * stripeWidth;
          const xb = xa + stripeWidth;
          city.quadDouble(
            [xa, 2.3, 1.45],
            [xb, 2.3, 1.45],
            [xb, 2.8, 0.1],
            [xa, 2.8, 0.1],
            stripe % 2 === 0 ? a : b,
          );
        }
      }

      const fills = random() < 0.5 ? [GLASS] : [GLASS, pick(random, WINDOW_SHUTTER)];
      upperWindows(trim, fills, 0.2);
      if (floors > 1 && random() < 0.35) {
        // One long balcony across the first floor.
        city.box(0, GROUND_FLOOR + 0.05, 0.45, w - 0.6, 0.12, 0.9, CONCRETE, 0.8);
        city.box(0, GROUND_FLOOR + 0.55, 0.87, w - 0.6, 0.9, 0.05, 0x2b2b2b);
      }
      city.box(0, H - 0.15, 0.1, w, 0.3, 0.25, trim, 0.85);
      if (random() < 0.5) waterTank();
      break;
    }

    case 'house': {
      const wall = pick(random, PAINT);
      const band = pick(random, ACCENT);
      body(wall, ROOF_TILE);

      // The contrasting painted base band.
      front(-w / 2, below, w / 2, 0.95, 0.02, band, 0.7, 1);
      const doorX = -w / 4;
      front(doorX - 0.55, 0, doorX + 0.55, 2.2, 0.04, TRIM_WHITE);
      front(doorX - 0.45, 0, doorX + 0.45, 2.1, 0.07, pick(random, WINDOW_SHUTTER), 0.8, 1);
      windowAt(w / 4, 1.05, 1.3, 1.2, TRIM_WHITE, GLASS);
      upperWindows(TRIM_WHITE, [GLASS, pick(random, WINDOW_SHUTTER)], 0.12);

      // Clay tile roof with its ridge parallel to the street.
      const ridge = 1.5;
      const eave = 0.4;
      city.quad(
        [-w / 2, H, eave],
        [w / 2, H, eave],
        [w / 2, H + ridge, -d / 2],
        [-w / 2, H + ridge, -d / 2],
        ROOF_TILE,
        [0.82, 0.82, 1.08, 1.08],
      );
      city.quad(
        [w / 2, H, -d],
        [-w / 2, H, -d],
        [-w / 2, H + ridge, -d / 2],
        [w / 2, H + ridge, -d / 2],
        ROOF_TILE,
        [0.82, 0.82, 1.08, 1.08],
      );
      city.tri([w / 2, H, 0], [w / 2, H, -d], [w / 2, H + ridge, -d / 2], wall);
      city.tri([-w / 2, H, -d], [-w / 2, H, 0], [-w / 2, H + ridge, -d / 2], wall);
      break;
    }

    case 'raw': {
      const brick = pick(random, BRICK);
      body(brick, CONCRETE);
      if (random() < 0.3) front(-w / 2, 0, w / 2, H, 0.015, pick(random, PAINT), 0.8, 1);

      // Exposed concrete frame: columns and a slab edge at every floor.
      for (const cx of w > 7.5 ? [-w / 2 + 0.17, 0, w / 2 - 0.17] : [-w / 2 + 0.17, w / 2 - 0.17]) {
        front(cx - 0.17, below, cx + 0.17, H, 0.03, CONCRETE, 0.7, 1);
      }
      for (let floor = 1; floor <= floors; floor++) {
        const y = GROUND_FLOOR + (floor - 1) * UPPER_FLOOR;
        front(-w / 2, y - 0.14, w / 2, y + 0.14, 0.035, CONCRETE);
      }

      if (random() < 0.35) {
        const shutter = pick(random, SHUTTER);
        for (let slat = 0; slat < 5; slat++) {
          const shade = slat % 2 === 0 ? 0.86 : 1;
          front(
            -w / 4 - 1.3,
            slat * 0.5,
            -w / 4 + 1.3,
            (slat + 1) * 0.5,
            0.04,
            shutter,
            shade,
            shade,
          );
        }
      } else {
        front(-w / 4 - 0.45, 0, -w / 4 + 0.45, 2.1, 0.04, pick(random, SHUTTER), 0.8, 1);
      }
      windowAt(w / 4, 1.1, 1.1, 1.1, null, DARK);

      const unfinished = floors > 1 && random() < 0.3;
      upperWindows(null, [DARK, GLASS, DARK], 0.08, unfinished);

      // Rebar left sticking up for the floor that will be built "one day".
      if (random() < 0.6) {
        for (const [rx, rz] of [
          [-w / 2 + 0.25, -0.25],
          [w / 2 - 0.25, -0.25],
          [-w / 2 + 0.25, -d + 0.25],
          [w / 2 - 0.25, -d + 0.25],
        ] as const) {
          city.box(rx, H + 0.5, rz, 0.07, 1, 0.07, REBAR);
        }
      }
      if (random() < 0.3) {
        // A rooftop room added later.
        city.box(
          w * 0.12,
          H + 1.4,
          -d * 0.6,
          w * 0.55,
          2.8,
          d * 0.5,
          pick(random, BRICK),
          0.8,
          CONCRETE,
        );
      }
      if (random() < 0.85) waterTank();
      break;
    }

    case 'apartment': {
      const wall = pick(random, APARTMENT_PAINT);
      const accent = pick(random, ACCENT);
      body(wall, ROOF_SLAB);

      // Recessed ground floor behind columns, with a glazed entrance.
      front(-w / 2 + 0.3, 0, w / 2 - 0.3, 2.9, 0.03, 0x2a2d33, 0.8, 1);
      const columns = Math.max(2, Math.round(w / 3.6));
      for (let column = 0; column <= columns; column++) {
        const cx = -w / 2 + 0.3 + ((w - 0.6) * column) / columns;
        front(cx - 0.22, below, cx + 0.22, 2.9, 0.06, wall, 0.7, 1);
      }
      front(-0.9, 0, 0.9, 2.5, 0.05, 0x4d6a7a, 0.8, 1.2);
      front(-w / 2, below, -w / 2 + 0.6, H, 0.02, accent, 0.7, 1);
      front(w / 2 - 0.6, below, w / 2, H, 0.02, accent, 0.7, 1);

      const rail = random() < 0.5 ? 0x8fbdb6 : random() < 0.5 ? TRIM_WHITE : accent;
      const span = w - 1.6;
      for (let floor = 1; floor < floors; floor++) {
        const y = GROUND_FLOOR + (floor - 1) * UPPER_FLOOR;
        front(-span / 2, y + 0.1, span / 2, y + 2.3, 0.03, GLASS, 0.75, 1.3);
        city.box(0, y, 0.55, span, 0.14, 1.1, TRIM_WHITE, 0.8);
        city.box(0, y + 0.55, 1.07, span, 0.95, 0.05, rail);
        if (random() < 0.25) city.box(span / 2 - 0.6, y + 1.2, 0.3, 0.75, 0.45, 0.4, AC_UNIT, 0.8);
      }

      city.box(w * 0.2, H + 1.2, -d / 2, 3, 2.4, 3, wall, 0.75, ROOF_SLAB);
      waterTank();
      waterTank();
      break;
    }
  }
}
