import type { BuildingSpec } from '../world/buildings';
import type { DeliverySpot, House } from '../world/houses';
import { SEA_LEVEL } from '../world/layout';
import type { RoadGraph, RoadKind } from '../world/roads/graph';

/**
 * The minimap in the bottom-left corner: a round window on the roads and buildings around
 * the bike, turned so the way you are facing is always up, zooming out as you speed up.
 * Pickups and drop-offs show as icons; an N on the rim points north.
 *
 * The map is painted once into an offscreen canvas; each frame only draws a rotated crop
 * of it, so it costs next to nothing.
 *
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
const PIXELS_PER_METRE = 1.6;
/** World radius shown at a standstill and at top speed, metres. */
const NEAR_RADIUS = 70;
const FAR_RADIUS = 140;
const TOP_SPEED = 28;
const GROUND_SAMPLE = 4;

const WATER = '#2c6f86';
const LAND_LOW = [86, 98, 78] as const;
const LAND_HIGH = [118, 112, 92] as const;
const BUILDING = '#c9b79c';
const HOUSE = '#b59a7c';
const CASING = 'rgba(20,22,26,0.85)';
const ROAD_COLORS: Record<RoadKind, string> = {
  avenue: '#f4e9c8',
  street: '#e9e6de',
  main: '#ffd66b',
  secondary: '#f1eee6',
  lane: '#dcd8cf',
  alley: '#cfcac0',
  stairs: '#f1eee6',
};
const PICKUP = '#2fbf71';
const DROPOFF = '#3b82f6';

export class Minimap {
  private readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly north: HTMLSpanElement;
  private readonly image: HTMLCanvasElement;
  private readonly spots: readonly DeliverySpot[];
  private readonly bounds: MinimapBounds;
  private radius = NEAR_RADIUS;

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
    const size = Math.round(rect.width * ratio);
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }

    const wanted =
      NEAR_RADIUS + (FAR_RADIUS - NEAR_RADIUS) * Math.min(1, Math.abs(speed) / TOP_SPEED);
    this.radius += (wanted - this.radius) * Math.min(1, dt * 1.5);

    // Map pixels to screen pixels, and the bike's spot in the map image. The image has
    // +x to the left, like the view.
    const scale = size / 2 / (this.radius * PIXELS_PER_METRE);
    const px = (this.bounds.x1 - x) * PIXELS_PER_METRE;
    const pz = (this.bounds.z1 - z) * PIXELS_PER_METRE;
    // Facing heading h, the way ahead in the image is (-sin h, -cos h); turning the image
    // clockwise by h brings it to straight up.
    const angle = heading;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, size, size);
    context.save();
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = WATER;
    context.fillRect(0, 0, size, size);
    context.translate(size / 2, size / 2);
    context.rotate(angle);
    context.scale(scale, scale);
    // Only the part of the image that can show: a square round the bike.
    const reach = this.radius * PIXELS_PER_METRE * 1.5;
    const sx = Math.max(0, px - reach);
    const sy = Math.max(0, pz - reach);
    const sw = Math.min(this.image.width, px + reach) - sx;
    const sh = Math.min(this.image.height, pz + reach) - sy;
    if (sw > 0 && sh > 0) {
      context.drawImage(this.image, sx, sy, sw, sh, sx - px, sy - pz, sw, sh);
    }

    // Delivery spots in range.
    const icon = 5 / scale;
    for (const spot of this.spots) {
      const dx = (this.bounds.x1 - spot.x) * PIXELS_PER_METRE - px;
      const dz = (this.bounds.z1 - spot.z) * PIXELS_PER_METRE - pz;
      if (Math.hypot(dx, dz) > this.radius * PIXELS_PER_METRE) continue;
      context.fillStyle = spot.kind === 'pickup' ? PICKUP : DROPOFF;
      context.strokeStyle = '#0b0d10';
      context.lineWidth = 1.5 / scale;
      context.beginPath();
      if (spot.kind === 'pickup') context.rect(dx - icon, dz - icon, icon * 2, icon * 2);
      else context.arc(dx, dz, icon, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.restore();

    // North sits on the rim, opposite the way the map is turned.
    const rim = rect.width / 2 - 11;
    const northX = rect.width / 2 + Math.sin(angle) * rim;
    const northY = rect.height / 2 - Math.cos(angle) * rim;
    this.north.style.transform = `translate(${northX}px, ${northY}px) translate(-50%, -50%)`;
  }
}

/** Paint the whole world once: water, ground, buildings, then the roads on top. */
function paintMap(data: MinimapData): HTMLCanvasElement {
  const { bounds } = data;
  const width = Math.ceil((bounds.x1 - bounds.x0) * PIXELS_PER_METRE);
  const height = Math.ceil((bounds.z1 - bounds.z0) * PIXELS_PER_METRE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Ground: water below sea level, land shaded a little by height.
  const cols = Math.ceil((bounds.x1 - bounds.x0) / GROUND_SAMPLE);
  const rows = Math.ceil((bounds.z1 - bounds.z0) / GROUND_SAMPLE);
  const ground = ctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = bounds.x1 - (c + 0.5) * GROUND_SAMPLE;
      const z = bounds.z1 - (r + 0.5) * GROUND_SAMPLE;
      const h = data.heightAt(x, z);
      const i = (r * cols + c) * 4;
      if (h < SEA_LEVEL + 0.2) {
        ground.data[i] = 44;
        ground.data[i + 1] = 111;
        ground.data[i + 2] = 134;
      } else {
        const t = Math.min(1, Math.max(0, h / 150));
        ground.data[i] = LAND_LOW[0] + (LAND_HIGH[0] - LAND_LOW[0]) * t;
        ground.data[i + 1] = LAND_LOW[1] + (LAND_HIGH[1] - LAND_LOW[1]) * t;
        ground.data[i + 2] = LAND_LOW[2] + (LAND_HIGH[2] - LAND_LOW[2]) * t;
      }
      ground.data[i + 3] = 255;
    }
  }
  const small = document.createElement('canvas');
  small.width = cols;
  small.height = rows;
  small.getContext('2d')?.putImageData(ground, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, width, height);

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
  ctx.fillStyle = BUILDING;
  for (const b of data.buildings) {
    // City buildings are placed by the middle of their front wall.
    const cx = b.x - Math.sin(b.yaw) * (b.depth / 2);
    const cz = b.z - Math.cos(b.yaw) * (b.depth / 2);
    footprint(cx, cz, b.yaw, b.width / 2, b.depth / 2);
  }
  ctx.fillStyle = HOUSE;
  for (const h of data.houses) footprint(h.x, h.z, h.yaw, h.width / 2, h.depth / 2);

  // Roads: a dark casing first, then the surface, stairs dashed.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of ['casing', 'surface'] as const) {
    for (const edge of data.roads.edges) {
      const stairs = edge.kind === 'stairs';
      if (stairs && pass === 'casing') continue;
      ctx.beginPath();
      edge.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.z) : ctx.lineTo(p.x, p.z)));
      if (pass === 'casing') {
        ctx.setLineDash([]);
        ctx.strokeStyle = CASING;
        ctx.lineWidth = Math.max(2.5, edge.width + 1.6);
      } else {
        ctx.setLineDash(stairs ? [1.2, 1] : []);
        ctx.strokeStyle = ROAD_COLORS[edge.kind];
        ctx.lineWidth = Math.max(stairs ? 1.2 : 1.8, stairs ? 1.4 : edge.width);
      }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  return canvas;
}
