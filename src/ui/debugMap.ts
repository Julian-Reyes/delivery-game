import { isRideable } from '../world/roads/graph';
import type { AreaId, RoadGraph } from '../world/roads/graph';
import type { RoadIssue } from '../world/roads/validate';

/**
 * Overhead map of the road graph for checking the layout: elevation with contour lines,
 * every road coloured by area, pedestrian routes dashed, the junctions where areas meet,
 * and any validation problems. Scroll to zoom, drag to pan, double-click to reset.
 */

export interface MapBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const TEXT = {
  title: 'Road map',
  ride: 'Motorcycle',
  walk: 'Pedestrian only',
  entrance: 'Area entrance',
  issues: (count: number) => (count === 0 ? 'No layout problems' : `${count} layout problems`),
  areas: {
    city: 'City',
    hillside: 'Hillside',
    niemeyer: 'Avenida Niemeyer',
    vidigal: 'Vidigal',
  } satisfies Record<AreaId, string>,
};

const AREA_COLORS: Record<AreaId, string> = {
  city: '#f2efe6',
  hillside: '#ffae3d',
  niemeyer: '#4fd1e8',
  vidigal: '#ff5fa2',
};

/** Ground colour by height: sea, beach, then green to brown up the hill. */
const RAMP: readonly [number, [number, number, number]][] = [
  [-1, [38, 120, 150]],
  [-0.1, [214, 196, 150]],
  [0.6, [92, 130, 84]],
  [40, [120, 132, 78]],
  [90, [140, 112, 76]],
  [160, [176, 164, 150]],
];
const CONTOUR_STEP = 5;
const ELEVATION_METRES_PER_PIXEL = 1.5;

function rampColor(height: number): [number, number, number] {
  let previous = RAMP[0];
  if (!previous) return [0, 0, 0];
  if (height <= previous[0]) return previous[1];
  for (const stop of RAMP) {
    if (height <= stop[0]) {
      const t = (height - previous[0]) / (stop[0] - previous[0]);
      return [
        previous[1][0] + (stop[1][0] - previous[1][0]) * t,
        previous[1][1] + (stop[1][1] - previous[1][1]) * t,
        previous[1][2] + (stop[1][2] - previous[1][2]) * t,
      ];
    }
    previous = stop;
  }
  return previous[1];
}

export class DebugMap {
  private readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private elevation: HTMLCanvasElement | null = null;
  private visible = false;

  /** World metres per CSS pixel and the world point at the canvas centre. */
  private scale = 1;
  private centerX = 0;
  private centerZ = 0;
  private dragging = false;

  private riderX = 0;
  private riderZ = 0;
  private riderHeading = 0;

  constructor(
    container: HTMLElement,
    private readonly graph: RoadGraph,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly bounds: MapBounds,
    private readonly issues: readonly RoadIssue[],
  ) {
    this.element = document.createElement('div');
    this.element.className = 'debug-map';
    this.element.hidden = true;

    this.canvas = document.createElement('canvas');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is not available');
    this.context = context;

    this.element.append(this.canvas, this.buildLegend());
    container.append(this.element);

    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('dblclick', this.resetView);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
    if (this.visible) {
      this.resetView();
      this.draw();
    }
  }

  /** Call once per rendered frame; does nothing while the map is hidden. */
  update(x: number, z: number, heading: number): void {
    this.riderX = x;
    this.riderZ = z;
    this.riderHeading = heading;
    if (this.visible) this.draw();
  }

  private buildLegend(): HTMLElement {
    const legend = document.createElement('div');
    legend.className = 'debug-map-legend';
    const row = (swatch: string, label: string): void => {
      const item = document.createElement('span');
      const mark = document.createElement('i');
      mark.style.cssText = swatch;
      item.append(mark, label);
      legend.append(item);
    };
    const title = document.createElement('strong');
    title.textContent = TEXT.title;
    legend.append(title);
    const areas = new Set(this.graph.edges.map((edge) => edge.area));
    for (const area of Object.keys(AREA_COLORS) as AreaId[]) {
      if (areas.has(area)) row(`background:${AREA_COLORS[area]}`, TEXT.areas[area]);
    }
    row('border-top:3px solid #ddd', TEXT.ride);
    row('border-top:3px dashed #ddd', TEXT.walk);
    row('border:2px solid #fff;border-radius:50%', TEXT.entrance);
    row('background:#ff3b30', TEXT.issues(this.issues.length));
    return legend;
  }

  /** Shaded relief with contour lines, drawn once. */
  private buildElevation(): HTMLCanvasElement {
    const { x0, x1, z0, z1 } = this.bounds;
    const width = Math.ceil((x1 - x0) / ELEVATION_METRES_PER_PIXEL);
    const height = Math.ceil((z1 - z0) / ELEVATION_METRES_PER_PIXEL);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return canvas;
    const image = context.createImageData(width, height);

    const heights = new Float32Array(width * height);
    for (let py = 0; py < height; py++) {
      const z = z1 - (py + 0.5) * ELEVATION_METRES_PER_PIXEL;
      for (let px = 0; px < width; px++) {
        heights[py * width + px] = this.heightAt(x0 + (px + 0.5) * ELEVATION_METRES_PER_PIXEL, z);
      }
    }
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const h = heights[py * width + px] ?? 0;
        const east = heights[py * width + Math.min(width - 1, px + 1)] ?? h;
        const south = heights[Math.min(height - 1, py + 1) * width + px] ?? h;
        // Light from the north-west.
        const relief = 1 + Math.max(-0.35, Math.min(0.35, (h - east + (h - south)) * 0.25));
        const contour =
          Math.floor(h / CONTOUR_STEP) !== Math.floor(east / CONTOUR_STEP) ||
          Math.floor(h / CONTOUR_STEP) !== Math.floor(south / CONTOUR_STEP);
        const [r, g, b] = rampColor(h);
        const k = contour && h > 0.5 ? relief * 0.72 : relief;
        const i = (py * width + px) * 4;
        image.data[i] = r * k;
        image.data[i + 1] = g * k;
        image.data[i + 2] = b * k;
        image.data[i + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  private readonly resetView = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    const { x0, x1, z0, z1 } = this.bounds;
    this.scale = Math.max(
      (x1 - x0) / Math.max(1, rect.width),
      (z1 - z0) / Math.max(1, rect.height),
    );
    this.centerX = (x0 + x1) / 2;
    this.centerZ = (z0 + z1) / 2;
  };

  private draw(): void {
    const { canvas, context, graph } = this;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(rect.width * ratio);
    const pixelHeight = Math.round(rect.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    this.elevation ??= this.buildElevation();

    // World to CSS pixels: +x right, +z (north) up.
    const k = 1 / this.scale;
    const ox = rect.width / 2 - this.centerX * k;
    const oz = rect.height / 2 + this.centerZ * k;
    context.setTransform(ratio * k, 0, 0, -ratio * k, ratio * ox, ratio * oz);

    context.fillStyle = '#12202c';
    context.fillRect(
      this.centerX - rect.width * this.scale,
      this.centerZ - rect.height * this.scale,
      rect.width * this.scale * 2,
      rect.height * this.scale * 2,
    );
    const { x0, x1, z0, z1 } = this.bounds;
    context.save();
    // The relief image is stored north-up, so flip it back against the world transform.
    context.translate(x0, z1);
    context.scale(1, -1);
    context.imageSmoothingEnabled = true;
    context.drawImage(this.elevation, 0, 0, x1 - x0, z1 - z0);
    context.restore();

    const minLine = 1.5 * this.scale;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const pass of ['casing', 'fill'] as const) {
      for (const edge of graph.edges) {
        const rideable = isRideable(edge);
        context.beginPath();
        for (const [i, p] of edge.points.entries()) {
          if (i === 0) context.moveTo(p.x, p.z);
          else context.lineTo(p.x, p.z);
        }
        if (pass === 'casing') {
          if (!rideable) continue;
          context.setLineDash([]);
          context.strokeStyle = 'rgba(0,0,0,0.55)';
          context.lineWidth = Math.max(minLine, edge.width) + 2 * this.scale;
        } else {
          context.setLineDash(rideable ? [] : [edge.width * 1.2, edge.width]);
          context.strokeStyle = AREA_COLORS[edge.area];
          context.lineWidth = Math.max(minLine, rideable ? edge.width : edge.width * 0.6);
        }
        context.stroke();
      }
    }
    context.setLineDash([]);

    // Entrances: nodes where roads from two areas meet. Turning pads as rings too.
    context.lineWidth = 2 * this.scale;
    for (const node of graph.nodes) {
      const areas = new Set(graph.edgesAt(node.id).map((id) => graph.getEdge(id).area));
      if (areas.size > 1) {
        context.strokeStyle = '#ffffff';
        context.beginPath();
        context.arc(node.x, node.z, Math.max(9 * this.scale, 8), 0, Math.PI * 2);
        context.stroke();
      }
      if (node.pad > 0) {
        context.strokeStyle = 'rgba(255,255,255,0.6)';
        context.beginPath();
        context.arc(node.x, node.z, node.pad, 0, Math.PI * 2);
        context.stroke();
      }
    }

    context.strokeStyle = '#ff3b30';
    context.lineWidth = 2.5 * this.scale;
    const cross = Math.max(6 * this.scale, 3);
    for (const issue of this.issues) {
      context.beginPath();
      context.moveTo(issue.x - cross, issue.z - cross);
      context.lineTo(issue.x + cross, issue.z + cross);
      context.moveTo(issue.x - cross, issue.z + cross);
      context.lineTo(issue.x + cross, issue.z - cross);
      context.stroke();
    }

    // The rider, as an arrow pointing the way it faces.
    const size = Math.max(8 * this.scale, 4);
    const sin = Math.sin(this.riderHeading);
    const cos = Math.cos(this.riderHeading);
    const at = (forward: number, side: number): [number, number] => [
      this.riderX + sin * forward + cos * side,
      this.riderZ + cos * forward - sin * side,
    ];
    context.fillStyle = '#ff5a3c';
    context.strokeStyle = '#000';
    context.lineWidth = 1.5 * this.scale;
    context.beginPath();
    context.moveTo(...at(size, 0));
    context.lineTo(...at(-size * 0.7, size * 0.6));
    context.lineTo(...at(-size * 0.4, 0));
    context.lineTo(...at(-size * 0.7, -size * 0.6));
    context.closePath();
    context.fill();
    context.stroke();
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    // Keep the world point under the cursor fixed while zooming.
    const px = event.clientX - rect.left - rect.width / 2;
    const pz = event.clientY - rect.top - rect.height / 2;
    const worldX = this.centerX + px * this.scale;
    const worldZ = this.centerZ - pz * this.scale;
    this.scale = Math.min(4, Math.max(0.05, this.scale * Math.exp(event.deltaY * 0.0015)));
    this.centerX = worldX - px * this.scale;
    this.centerZ = worldZ + pz * this.scale;
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.centerX -= event.movementX * this.scale;
    this.centerZ += event.movementY * this.scale;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.dragging = false;
    this.canvas.releasePointerCapture(event.pointerId);
  };
}
