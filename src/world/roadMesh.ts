import { GeoBuilder } from './geo';
import type { RoadEdge, RoadGraph, RoadKind } from './roads/graph';
import { inCity } from './terrain';

/**
 * Road surfaces for everything outside the original city, built straight from the road
 * graph: a strip along each centreline, a concrete retaining wall down each side (so a road
 * perched above the lane below it, or on a fill, never shows daylight underneath), and a
 * disc at every turning pad.
 */

const SURFACE_COLORS: Record<RoadKind, number> = {
  avenue: 0x3a3a3c,
  street: 0x3a3a3c,
  main: 0x3d3d40,
  secondary: 0x56534f,
  lane: 0x8f8b83,
  alley: 0x9d978c,
  stairs: 0xb0aaa0,
};
const SKIRT = 0x8d877c;
const SKIRT_DEPTH = 6;
/** Concrete paving from the road edge to the house fronts. */
const APRON = 1.4;
const APRON_COLOR = 0x9a958b;
const PAD_SEGMENTS = 20;

export interface RoadGeometry {
  surfaces: GeoBuilder;
  colliderPositions: Float32Array;
  colliderIndices: Uint32Array;
}

/**
 * Overlapping strips at a junction would flicker against each other, so each edge sits a
 * hair higher than the last. A few millimetres is invisible and below what the bike feels.
 */
function lift(edge: RoadEdge): number {
  return 0.004 * (edge.id % 6);
}

export function buildRoadGeometry(graph: RoadGraph): RoadGeometry {
  const surfaces = new GeoBuilder();
  const colliderPositions: number[] = [];
  const colliderIndices: number[] = [];

  const collide = (corners: readonly (readonly [number, number, number])[]): void => {
    const base = colliderPositions.length / 3;
    for (const corner of corners) colliderPositions.push(...corner);
    colliderIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (const edge of graph.edges) {
    if (edge.area === 'city') continue;
    const half = edge.width / 2;
    const color = SURFACE_COLORS[edge.kind];
    const raise = lift(edge);
    const points = edge.points;

    // Cross-section at each point, perpendicular to the averaged direction there.
    const left: [number, number, number][] = [];
    const right: [number, number, number][] = [];
    // The concrete apron beyond each edge, out to the house fronts.
    const apron = edge.kind === 'stairs' ? 0 : APRON;
    const leftOut: [number, number, number][] = [];
    const rightOut: [number, number, number][] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(points.length - 1, i + 1)];
      if (!p || !before || !after) continue;
      const dx = after.x - before.x;
      const dz = after.z - before.z;
      const length = Math.hypot(dx, dz) || 1;
      const ox = (dz / length) * half;
      const oz = (-dx / length) * half;
      left.push([p.x + ox, p.y + raise, p.z + oz]);
      right.push([p.x - ox, p.y + raise, p.z - oz]);
      const wide = (half + apron) / half;
      leftOut.push([p.x + ox * wide, p.y + raise - 0.03, p.z + oz * wide]);
      rightOut.push([p.x - ox * wide, p.y + raise - 0.03, p.z - oz * wide]);
    }

    for (let i = 1; i < left.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      // Where a road leaves the city, the city's own ground covers the part inside it.
      if (!a || !b || (inCity(a.x, a.z) && inCity(b.x, b.z))) continue;
      const l0 = left[i - 1];
      const l1 = left[i];
      const r0 = right[i - 1];
      const r1 = right[i];
      const lo0 = leftOut[i - 1];
      const lo1 = leftOut[i];
      const ro0 = rightOut[i - 1];
      const ro1 = rightOut[i];
      if (!l0 || !l1 || !r0 || !r1 || !lo0 || !lo1 || !ro0 || !ro1) continue;
      const shade = 0.96 + 0.08 * (((i * 7919) % 13) / 13);
      surfaces.quad(r0, r1, l1, l0, color, [shade, shade, shade, shade]);
      collide([r0, r1, l1, l0]);
      if (apron > 0) {
        surfaces.quad(l0, l1, lo1, lo0, APRON_COLOR, [shade, shade, shade, shade]);
        surfaces.quad(ro0, ro1, r1, r0, APRON_COLOR, [shade, shade, shade, shade]);
        collide([l0, l1, lo1, lo0]);
        collide([ro0, ro1, r1, r0]);
      }
      for (const [top0, top1] of [
        [lo0, lo1],
        [ro0, ro1],
      ] as const) {
        surfaces.quadDouble(
          top0,
          top1,
          [top1[0], top1[1] - SKIRT_DEPTH, top1[2]],
          [top0[0], top0[1] - SKIRT_DEPTH, top0[2]],
          SKIRT,
          0.8,
        );
      }
    }
  }

  // Turning pads: a disc at the node, level with it.
  for (const node of graph.nodes) {
    if (node.pad <= 0 || inCity(node.x, node.z)) continue;
    const y = node.y + 0.03;
    for (let s = 0; s < PAD_SEGMENTS; s++) {
      const a0 = (s / PAD_SEGMENTS) * Math.PI * 2;
      const a1 = ((s + 1) / PAD_SEGMENTS) * Math.PI * 2;
      const p0 = [node.x + Math.cos(a0) * node.pad, y, node.z + Math.sin(a0) * node.pad] as const;
      const p1 = [node.x + Math.cos(a1) * node.pad, y, node.z + Math.sin(a1) * node.pad] as const;
      const centre = [node.x, y, node.z] as const;
      // Wound so the face points up.
      surfaces.tri(centre, p1, p0, SURFACE_COLORS.secondary);
      const base = colliderPositions.length / 3;
      colliderPositions.push(...centre, ...p1, ...p0);
      colliderIndices.push(base, base + 1, base + 2);
    }
  }

  return {
    surfaces,
    colliderPositions: new Float32Array(colliderPositions),
    colliderIndices: new Uint32Array(colliderIndices),
  };
}
