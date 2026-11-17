import type { BuildingSpec } from '../world/buildings';
import type { DeliverySpot, House } from '../world/houses';
import { AVENUE_Z, AVENUE_Z_MAX, AVENUE_Z_MIN, HALF, SEA_LEVEL, surfaceAt } from '../world/layout';
import type { Surface } from '../world/layout';
import type { RoadGraph, RoadKind } from '../world/roads/graph';

/**
 * The minimap, bottom left, in the style of the radar in open-world crime games: a dark,
 * muted map with bright roads, turned so straight ahead is always up, the bike a little
 * below the middle so more of the road ahead shows, zooming out with speed.
 *
 * Inside the city the ground is painted from the layout itself, so every street has its
 * real width (the four-lane seafront avenue is half again as wide as the side streets,
 * with its yellow centre line), the beach is sand, the promenade shows its black and white
 * waves, and the park is green. Outside, the hills get relief shading and the favela
 * roads are drawn from the road graph.
 *
 * Everything is painted once into an offscreen canvas; each frame draws a rotated crop.
 * Like the 3D view, +x is on your left when facing +z (north).
 */

export interface MinimapBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface MinimapData {
  roads: RoadGraph;
  heightAt: (x: number, z: number) => number;
  bounds: MinimapBounds;
  houses: readonly House[];
  buildings: readonly BuildingSpec[];
  spots: readonly DeliverySpot[];
}

const TEXT = { north: 'N' };

/** Offscreen map resolution, pixels per metre. */
const PIXELS_PER_METRE = 2;
/** Metres from the bike to the top edge of the map, standing still and at top speed. */
const NEAR_RANGE = 75;
const FAR_RANGE = 150;
const TOP_SPEED = 28;
/** The bike sits this far down the map, so more of what is ahead shows. */
const BIKE_DOWN = 0.64;
const TERRAIN_SAMPLE = 2;

type Rgb = readonly [number, number, number];

const PALETTE = {
  deepWater: [34, 74, 112] as Rgb,
  water: [52, 102, 146] as Rgb,
  sand: [218, 198, 146] as Rgb,
  land: [64, 74, 60] as Rgb,
  highland: [86, 84, 70] as Rgb,
  park: [80, 120, 62] as Rgb,
  lot: [58, 61, 66] as Rgb,
  sidewalk: [84, 87, 92] as Rgb,
  road: [160, 163, 168] as Rgb,
  /** The seafront avenue stands out, like a highway on a road map. */
  avenue: [238, 236, 226] as Rgb,
  cobble: [168, 156, 136] as Rgb,
  mosaicDark: [36, 36, 38] as Rgb,
  mosaicLight: [236, 234, 228] as Rgb,
};
const CITY_BUILDING = '#6c7077';
const HOUSE = '#6e6660';
const APRON = '#5f6268';
const LINE_YELLOW = '#f0c419';
const ROAD_COLORS: Record<RoadKind, string> = {
  avenue: '#d6d7da',
  street: '#a0a3a8',
  main: '#e6d9a2',
  secondary: '#c4c6ca',
  lane: '#b4b7bc',
  alley: '#a6a9ae',
  stairs: '#a7abb1',
};
const PICKUP = '#2fbf71';
const DROPOFF = '#3b8cf6';

/** Promenade waves: black and white bands that ripple along the beach. */
function mosaicLight(x: number, z: number): boolean {
  return Math.sin(z * 2.1 + Math.sin(x * 0.55) * 2.4) > 0;
}

function surfaceColor(surface: Surface, x: number, z: number): Rgb {
  switch (surface) {
    case 'asphalt':
      return z > AVENUE_Z_MIN && z < AVENUE_Z_MAX ? PALETTE.avenue : PALETTE.road;
    case 'cobble':
      return PALETTE.cobble;
    case 'sidewalk':
      return PALETTE.sidewalk;
    case 'mosaic':
      return mosaicLight(x, z) ? PALETTE.mosaicLight : PALETTE.mosaicDark;
    case 'sand':
      return PALETTE.sand;
    case 'grass':
      return PALETTE.park;
    case 'lot':
      return PALETTE.lot;
  }
}

export class Minimap {
  private readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly north: HTMLSpanElement;
  private readonly image: HTMLCanvasElement;
  private readonly spots: readonly DeliverySpot[];
  private readonly bounds: MinimapBounds;
  private range = NEAR_RANGE;

  constructor(container: HTMLElement, data: MinimapData) {
    this.bounds = data.bounds;
    this.spots = data.spots;
    this.element = document.createElement('div');
    this.element.className = 'minimap';
    this.element.hidden = true;
    this.canvas = document.createElement('canvas');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is not available');
    this.context = context;
    this.north = document.createElement('span');
    this.north.className = 'minimap-north';
    this.north.textContent = TEXT.north;
    const arrow = document.createElement('i');
    arrow.className = 'minimap-arrow';
    arrow.style.top = `${BIKE_DOWN * 100}%`;
    this.element.append(this.canvas, arrow, this.north);
    container.append(this.element);
    this.image = paintMap(data);
  }

  show(visible: boolean): void {
    this.element.hidden = !visible;
  }

  /** Call once per rendered frame with the bike's position, heading and speed. */
  update(x: number, z: number, heading: number, speed: number, dt: number): void {
    if (this.element.hidden) return;
    const { canvas, context } = this;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const wanted = NEAR_RANGE + (FAR_RANGE - NEAR_RANGE) * Math.min(1, Math.abs(speed) / TOP_SPEED);
    this.range += (wanted - this.range) * Math.min(1, dt * 1.5);

    // Screen pixels per map-image pixel, and the bike's spot in the image.
    const cy = height * BIKE_DOWN;
    const scale = cy / (this.range * PIXELS_PER_METRE);
    const px = (this.bounds.x1 - x) * PIXELS_PER_METRE;
    const pz = (this.bounds.z1 - z) * PIXELS_PER_METRE;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = `rgb(${PALETTE.deepWater.join(',')})`;
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, cy);
    // Facing heading h, the way ahead in the image is (-sin h, -cos h); turning the image
    // clockwise by h brings it to straight up.
    context.rotate(heading);
    context.scale(scale, scale);
    // Only the part of the image that can show.
    const reach = (Math.hypot(width, height) / scale) * 0.75;
    const sx = Math.max(0, px - reach);
    const sy = Math.max(0, pz - reach);
    const sw = Math.min(this.image.width, px + reach) - sx;
    const sh = Math.min(this.image.height, pz + reach) - sy;
    if (sw > 0 && sh > 0) {
      context.drawImage(this.image, sx, sy, sw, sh, sx - px, sy - pz, sw, sh);
    }

    // Delivery spots as round blips, kept upright.
    const blip = 6 / scale;
    for (const spot of this.spots) {
      const dx = (this.bounds.x1 - spot.x) * PIXELS_PER_METRE - px;
      const dz = (this.bounds.z1 - spot.z) * PIXELS_PER_METRE - pz;
      if (Math.hypot(dx, dz) > reach) continue;
      context.fillStyle = spot.kind === 'pickup' ? PICKUP : DROPOFF;
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.6 / scale;
      context.beginPath();
      context.arc(dx, dz, blip, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = '#ffffff';
      context.beginPath();
      if (spot.kind === 'pickup') {
        context.rect(dx - blip * 0.4, dz - blip * 0.4, blip * 0.8, blip * 0.8);
      } else {
        context.arc(dx, dz, blip * 0.35, 0, Math.PI * 2);
      }
      context.fill();
    }
    context.restore();

    // North rides the edge of the map where a line due north from the bike meets it.
    const dirX = Math.sin(heading);
    const dirY = -Math.cos(heading);
    const inset = 10;
    const bx = rect.width / 2;
    const by = rect.height * BIKE_DOWN;
    const tx =
      dirX > 0 ? (rect.width - inset - bx) / dirX : dirX < 0 ? (inset - bx) / dirX : Infinity;
    const ty =
      dirY > 0 ? (rect.height - inset - by) / dirY : dirY < 0 ? (inset - by) / dirY : Infinity;
    const t = Math.min(tx, ty);
    this.north.style.transform = `translate(${bx + dirX * t}px, ${by + dirY * t}px) translate(-50%, -50%)`;
  }
}

/** Paint the whole world once: ground, buildings, roads, then road markings. */
function paintMap(data: MinimapData): HTMLCanvasElement {
  const { bounds } = data;
  const width = Math.ceil((bounds.x1 - bounds.x0) * PIXELS_PER_METRE);
  const height = Math.ceil((bounds.z1 - bounds.z0) * PIXELS_PER_METRE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Terrain heights on a coarse grid, for water, height tint and relief shading.
  const cols = Math.ceil((bounds.x1 - bounds.x0) / TERRAIN_SAMPLE) + 1;
  const rows = Math.ceil((bounds.z1 - bounds.z0) / TERRAIN_SAMPLE) + 1;
  const heights = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[r * cols + c] = data.heightAt(
        bounds.x1 - c * TERRAIN_SAMPLE,
        bounds.z1 - r * TERRAIN_SAMPLE,
      );
    }
  }
  const h = (c: number, r: number): number =>
    heights[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))] ?? 0;

  const image = ctx.createImageData(width, height);
  const out = image.data;
  for (let py = 0; py < height; py++) {
    const z = bounds.z1 - (py + 0.5) / PIXELS_PER_METRE;
    const r = Math.round((bounds.z1 - z) / TERRAIN_SAMPLE);
    for (let px = 0; px < width; px++) {
      const x = bounds.x1 - (px + 0.5) / PIXELS_PER_METRE;
      const c = Math.round((bounds.x1 - x) / TERRAIN_SAMPLE);
      const ground = h(c, r);
      let color: Rgb;
      let shade = 1;
      if (ground < SEA_LEVEL + 0.15) {
        // Shallow water near the shore, deeper further out.
        const t = Math.min(1, (SEA_LEVEL - ground) / 6);
        color = [
          PALETTE.water[0] + (PALETTE.deepWater[0] - PALETTE.water[0]) * t,
          PALETTE.water[1] + (PALETTE.deepWater[1] - PALETTE.water[1]) * t,
          PALETTE.water[2] + (PALETTE.deepWater[2] - PALETTE.water[2]) * t,
        ];
      } else if (Math.abs(x) < HALF && Math.abs(z) < HALF) {
        color = surfaceColor(surfaceAt(x, z), x, z);
      } else {
        const t = Math.min(1, ground / 140);
        color = [
          PALETTE.land[0] + (PALETTE.highland[0] - PALETTE.land[0]) * t,
          PALETTE.land[1] + (PALETTE.highland[1] - PALETTE.land[1]) * t,
          PALETTE.land[2] + (PALETTE.highland[2] - PALETTE.land[2]) * t,
        ];
        if (ground < 1.5) color = PALETTE.sand;
        // Relief: lit from the upper left of the map.
        const slope = (h(c + 1, r + 1) - h(c - 1, r - 1)) / (TERRAIN_SAMPLE * 2.8);
        shade = Math.max(0.6, Math.min(1.35, 1 + slope * 0.9));
      }
      const i = (py * width + px) * 4;
      out[i] = color[0] * shade;
      out[i + 1] = color[1] * shade;
      out[i + 2] = color[2] * shade;
      out[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // From here on draw in world metres: +x to the left, +z up.
  ctx.setTransform(
    -PIXELS_PER_METRE,
    0,
    0,
    -PIXELS_PER_METRE,
    bounds.x1 * PIXELS_PER_METRE,
    bounds.z1 * PIXELS_PER_METRE,
  );

  const footprint = (cx: number, cz: number, yaw: number, w: number, d: number): void => {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = fz;
    const rz = -fx;
    ctx.beginPath();
    ctx.moveTo(cx + rx * w + fx * d, cz + rz * w + fz * d);
    ctx.lineTo(cx + rx * w - fx * d, cz + rz * w - fz * d);
    ctx.lineTo(cx - rx * w - fx * d, cz - rz * w - fz * d);
    ctx.lineTo(cx - rx * w + fx * d, cz - rz * w + fz * d);
    ctx.closePath();
    ctx.fill();
  };

  // Hillside roads from the graph: paved edges first, then the surface.
  const hillEdges = data.roads.edges.filter((edge) => edge.area !== 'city');
  const trace = (points: readonly { x: number; z: number }[]): void => {
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.z) : ctx.lineTo(p.x, p.z)));
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const edge of hillEdges) {
    if (edge.kind === 'stairs') continue;
    trace(edge.points);
    ctx.strokeStyle = APRON;
    ctx.lineWidth = edge.width + 2.8;
    ctx.stroke();
  }

  // Buildings: the city's, then the favela houses.
  ctx.fillStyle = CITY_BUILDING;
  for (const b of data.buildings) {
    // City buildings are placed by the middle of their front wall.
    footprint(
      b.x - Math.sin(b.yaw) * (b.depth / 2),
      b.z - Math.cos(b.yaw) * (b.depth / 2),
      b.yaw,
      b.width / 2,
      b.depth / 2,
    );
  }
  ctx.fillStyle = HOUSE;
  for (const house of data.houses)
    footprint(house.x, house.z, house.yaw, house.width / 2, house.depth / 2);

  for (const edge of hillEdges) {
    const stairs = edge.kind === 'stairs';
    trace(edge.points);
    ctx.setLineDash(stairs ? [1.4, 0.9] : []);
    ctx.strokeStyle = ROAD_COLORS[edge.kind];
    ctx.lineWidth = stairs ? 1.6 : edge.width;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The seafront avenue's markings: double yellow down the middle, white lane lines.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = LINE_YELLOW;
  ctx.lineWidth = 0.7;
  for (const offset of [-0.5, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(-HALF, AVENUE_Z + offset);
    ctx.lineTo(HALF, AVENUE_Z + offset);
    ctx.stroke();
  }
  ctx.strokeStyle = '#8f9196';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 4]);
  for (const offset of [-3.75, 3.75]) {
    ctx.beginPath();
    ctx.moveTo(-HALF, AVENUE_Z + offset);
    ctx.lineTo(HALF, AVENUE_Z + offset);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  return canvas;
}
