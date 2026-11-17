/**
 * The road graph: the single description of where you can ride and walk. Navigation,
 * delivery routing, road meshes and the debug map all read it. Pure data and functions,
 * like `layout.ts`.
 *
 * Nodes are intersections, bends that join two edges, and dead ends. Each edge carries its
 * full centreline with heights, so grades and curves can be checked without the terrain.
 */

export type RoadKind =
  /** The flat seafront avenue. */
  | 'avenue'
  /** The original grid streets of the city. Steep, straight and wide. */
  | 'street'
  /** Two-lane roads that wind up the hills; buses could run here. */
  | 'main'
  /** One car wide, branching off the main roads. */
  | 'secondary'
  /** Motorcycle-width lanes between the houses. */
  | 'lane'
  /** The narrowest a motorcycle fits through. */
  | 'alley'
  /** Pedestrian-only steps. */
  | 'stairs';

export type AreaId = 'city' | 'hillside' | 'niemeyer' | 'vidigal';

export type RoadSurface = 'asphalt' | 'cobble' | 'concrete' | 'steps';

export interface RoadKindSpec {
  /** Kerb-to-kerb width, in metres. */
  width: number;
  /** Steepest rise over run allowed along the centreline. */
  maxGrade: number;
  /** Tightest centreline curve allowed, in metres. */
  minRadius: number;
  motorcycle: boolean;
}

/**
 * Design limits per kind, sized around the bike: it turns no tighter than a 3.2 m radius
 * (see `BIKE_TURN_RADIUS`). The city's grid streets keep the steep straight climbs the
 * game started with.
 */
export const ROAD_KINDS: Readonly<Record<RoadKind, RoadKindSpec>> = {
  avenue: { width: 15, maxGrade: 0.02, minRadius: 40, motorcycle: true },
  street: { width: 10, maxGrade: 0.36, minRadius: 20, motorcycle: true },
  main: { width: 7, maxGrade: 0.12, minRadius: 10, motorcycle: true },
  secondary: { width: 5, maxGrade: 0.18, minRadius: 7, motorcycle: true },
  lane: { width: 3, maxGrade: 0.25, minRadius: 4.5, motorcycle: true },
  alley: { width: 2, maxGrade: 0.25, minRadius: 4.5, motorcycle: true },
  stairs: { width: 2, maxGrade: Infinity, minRadius: 0, motorcycle: false },
};

/**
 * Tightest circle the bike can ride. Steering fades out below 6 m/s at 1.9 rad/s
 * (`bike/rider.ts`), so the radius never drops under 6 / 1.9; the rest is the bike's
 * half-width plus a little slack for a player rather than a perfect line.
 */
export const BIKE_TURN_RADIUS = 6 / 1.9 + 0.5;

export interface RoadPoint {
  x: number;
  y: number;
  z: number;
}

export interface RoadNode extends RoadPoint {
  readonly id: number;
  /**
   * Radius of open paved space around the node, for dead ends where you turn round, and
   * small squares. 0 when the node is just where edges meet.
   */
  readonly pad: number;
  /** The map edge (a tunnel mouth). Dead ends here are fine. */
  readonly boundary: boolean;
}

export interface RoadEdge {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly kind: RoadKind;
  readonly area: AreaId;
  readonly surface: RoadSurface;
  readonly width: number;
  /** Centreline from `from` to `to`, both ends included. */
  readonly points: readonly RoadPoint[];
  /** Horizontal length of the centreline. */
  readonly length: number;
  readonly name: string;
}

export interface EdgeOptions {
  kind: RoadKind;
  area: AreaId;
  surface?: RoadSurface;
  width?: number;
  name?: string;
}

export interface NodeOptions {
  pad?: number;
  boundary?: boolean;
}

/** Nodes closer than this are the same node. */
const MERGE_DISTANCE = 0.05;

export function horizontalLength(points: readonly RoadPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
}

export class RoadGraph {
  readonly nodes: RoadNode[] = [];
  readonly edges: RoadEdge[] = [];
  private readonly incident: number[][] = [];

  /** Add a node, or return the existing one at the same spot (upgrading its options). */
  node(x: number, y: number, z: number, options: NodeOptions = {}): number {
    for (const existing of this.nodes) {
      if (Math.hypot(existing.x - x, existing.z - z) < MERGE_DISTANCE) {
        if (Math.abs(existing.y - y) > 0.5) continue;
        const merged: RoadNode = {
          ...existing,
          pad: Math.max(existing.pad, options.pad ?? 0),
          boundary: existing.boundary || (options.boundary ?? false),
        };
        this.nodes[existing.id] = merged;
        return existing.id;
      }
    }
    const id = this.nodes.length;
    this.nodes.push({ id, x, y, z, pad: options.pad ?? 0, boundary: options.boundary ?? false });
    this.incident.push([]);
    return id;
  }

  /**
   * Add an edge between two nodes. `between` is the centreline strictly between them; the
   * node positions are added at each end.
   */
  edge(from: number, to: number, between: readonly RoadPoint[], options: EdgeOptions): number {
    const a = this.nodes[from];
    const b = this.nodes[to];
    if (!a || !b) throw new Error(`Edge between unknown nodes ${from} and ${to}`);
    if (from === to) throw new Error(`Edge from node ${from} to itself`);
    const spec = ROAD_KINDS[options.kind];
    const points: RoadPoint[] = [
      { x: a.x, y: a.y, z: a.z },
      ...between.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      { x: b.x, y: b.y, z: b.z },
    ];
    const id = this.edges.length;
    this.edges.push({
      id,
      from,
      to,
      kind: options.kind,
      area: options.area,
      surface: options.surface ?? (options.kind === 'stairs' ? 'steps' : 'asphalt'),
      width: options.width ?? spec.width,
      points,
      length: horizontalLength(points),
      name: options.name ?? '',
    });
    this.incident[from]?.push(id);
    this.incident[to]?.push(id);
    return id;
  }

  /** Ids of the edges that start or end at a node. */
  edgesAt(node: number): readonly number[] {
    return this.incident[node] ?? [];
  }

  getNode(id: number): RoadNode {
    const node = this.nodes[id];
    if (!node) throw new Error(`Unknown node ${id}`);
    return node;
  }

  getEdge(id: number): RoadEdge {
    const edge = this.edges[id];
    if (!edge) throw new Error(`Unknown edge ${id}`);
    return edge;
  }
}

export function isRideable(edge: RoadEdge): boolean {
  return ROAD_KINDS[edge.kind].motorcycle;
}

export function otherEnd(edge: RoadEdge, node: number): number {
  return edge.from === node ? edge.to : edge.from;
}

/**
 * Unit direction you leave `node` in when setting off along `edge`, measured over the first
 * `reach` metres so a tiny kink right at the node does not dominate.
 */
export function departure(edge: RoadEdge, node: number, reach: number): { x: number; z: number } {
  const points = edge.points;
  const forward = edge.from === node;
  const start = forward ? points[0] : points[points.length - 1];
  if (!start) return { x: 0, z: 1 };
  let target = start;
  for (let k = 1; k < points.length; k++) {
    const p = forward ? points[k] : points[points.length - 1 - k];
    if (!p) break;
    target = p;
    if (Math.hypot(p.x - start.x, p.z - start.z) >= reach) break;
  }
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

/** The point `distance` metres (horizontally) along a centreline, clamped to its ends. */
export function pointAlong(points: readonly RoadPoint[], distance: number): RoadPoint {
  let remaining = distance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= segment && segment > 0) {
      const t = Math.max(0, remaining / segment);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= segment;
  }
  const last = points[points.length - 1] ?? { x: 0, y: 0, z: 0 };
  return { x: last.x, y: last.y, z: last.z };
}

export interface GraphPosition {
  edge: number;
  /** Horizontal distance along the edge from its `from` node. */
  along: number;
  /** Horizontal distance from the query point to the centreline. */
  distance: number;
  x: number;
  y: number;
  z: number;
}

/** Closest point on any edge that passes `accept`. Null if no edge does. */
export function nearestOnGraph(
  graph: RoadGraph,
  x: number,
  z: number,
  accept: (edge: RoadEdge) => boolean = () => true,
): GraphPosition | null {
  let best: GraphPosition | null = null;
  for (const edge of graph.edges) {
    if (!accept(edge)) continue;
    let along = 0;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segment = Math.hypot(dx, dz);
      const t =
        segment > 0
          ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (segment * segment)))
          : 0;
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (!best || distance < best.distance) {
        best = {
          edge: edge.id,
          along: along + segment * t,
          distance,
          x: px,
          y: a.y + (b.y - a.y) * t,
          z: pz,
        };
      }
      along += segment;
    }
  }
  return best;
}
