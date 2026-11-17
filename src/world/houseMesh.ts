import type { GeoBuilder } from './geo';
import { FLOOR_HEIGHT } from './houses';
import type { DeliverySpot, House } from './houses';
import type { SolidBox } from './props';

/**
 * Placeholder favela houses: one coloured block each on a bare concrete foundation where
 * the slope drops away, with a flat roof slab. Detail comes later; this is the layout.
 * Delivery spots get a tall post at the door so they are easy to find while testing.
 */

const FOUNDATION = 0x8f8a82;
const ROOF = 0x8a857c;
const PICKUP_POST = 0x2fbf71;
const DROPOFF_POST = 0x3b82f6;

export function addHouses(
  geo: GeoBuilder,
  solids: SolidBox[],
  houses: readonly House[],
  spots: readonly DeliverySpot[],
): void {
  for (const house of houses) {
    const top = house.floorY + house.floors * FLOOR_HEIGHT;
    geo.setFrame(house.x, 0, house.z, house.yaw);
    const below = house.floorY - house.baseY;
    if (below > 0.5) {
      geo.box(0, house.baseY + below / 2, 0, house.width, below, house.depth, FOUNDATION, 0.75);
    }
    geo.box(
      0,
      (house.floorY + top) / 2,
      0,
      house.width,
      top - house.floorY,
      house.depth,
      house.color,
      0.72,
      ROOF,
    );
    solids.push({
      x: house.x,
      y: (house.baseY + top) / 2,
      z: house.z,
      hx: house.width / 2,
      hy: (top - house.baseY) / 2,
      hz: house.depth / 2,
      yaw: house.yaw,
    });
  }

  geo.resetFrame();
  for (const spot of spots) {
    const color = spot.kind === 'pickup' ? PICKUP_POST : DROPOFF_POST;
    // Just in front of the door, so it stands in the street rather than in the wall.
    const house = houses[spot.house];
    const out = house ? 0.6 : 0;
    const x = spot.x + (house ? Math.sin(house.yaw) * out : 0);
    const z = spot.z + (house ? Math.cos(house.yaw) * out : 0);
    geo.box(x, spot.y + 2, z, 0.35, 4, 0.35, color, 0.8);
  }
}
