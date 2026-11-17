import { BufferGeometry, Color, Float32BufferAttribute } from 'three';

export type Vec3 = readonly [number, number, number];

const scratchColor = new Color();
const WHITE: readonly [number, number, number, number] = [1, 1, 1, 1];
const NO_UVS: readonly (readonly [number, number])[] = [];

// Icosahedron, used for foliage and rocks.
const T = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS: readonly Vec3[] = (
  [
    [-1, T, 0],
    [1, T, 0],
    [-1, -T, 0],
    [1, -T, 0],
    [0, -1, T],
    [0, 1, T],
    [0, -1, -T],
    [0, 1, -T],
    [T, 0, -1],
    [T, 0, 1],
    [-T, 0, -1],
    [-T, 0, 1],
  ] as const
).map(([x, y, z]) => {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length] as const;
});
const ICO_FACES: readonly Vec3[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

/**
 * Accumulates many small shapes into one vertex-colored geometry, so a whole street of
 * buildings and props costs a single draw call.
 *
 * Shapes are given in a local frame (set with `setFrame`): an origin plus a rotation about
 * the vertical axis. Local +z maps to (sin yaw, 0, cos yaw), the same as three.js.
 */
export class GeoBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];

  private ox = 0;
  private oy = 0;
  private oz = 0;
  private cos = 1;
  private sin = 0;

  constructor(private readonly withUvs = false) {}

  setFrame(x: number, y: number, z: number, yaw = 0): void {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
  }

  resetFrame(): void {
    this.setFrame(0, 0, 0, 0);
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  /**
   * A four-sided face. Corners go counter-clockwise as seen from the visible side.
   * `shades` darkens or brightens each corner (1 = unchanged), used for baked shading.
   */
  quad(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    color: number,
    shades: readonly [number, number, number, number] = WHITE,
    uvs: readonly (readonly [number, number])[] = NO_UVS,
  ): void {
    const nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]);
    const ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
    const nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const length = Math.hypot(nx, ny, nz) || 1;
    const normal: Vec3 = [nx / length, ny / length, nz / length];

    const base = this.positions.length / 3;
    this.vertex(a, normal, color, shades[0], uvs[0]);
    this.vertex(b, normal, color, shades[1], uvs[1]);
    this.vertex(c, normal, color, shades[2], uvs[2]);
    this.vertex(d, normal, color, shades[3], uvs[3]);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Same as `quad`, visible from both sides (awnings, flags, palm fronds). */
  quadDouble(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: number, shade = 1): void {
    const shades = [shade, shade, shade, shade] as const;
    this.quad(a, b, c, d, color, shades);
    this.quad(d, c, b, a, color, [shade * 0.8, shade * 0.8, shade * 0.8, shade * 0.8]);
  }

  tri(a: Vec3, b: Vec3, c: Vec3, color: number, shade = 1): void {
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const length = Math.hypot(nx, ny, nz) || 1;
    const normal: Vec3 = [nx / length, ny / length, nz / length];

    const base = this.positions.length / 3;
    this.vertex(a, normal, color, shade, undefined);
    this.vertex(b, normal, color, shade, undefined);
    this.vertex(c, normal, color, shade, undefined);
    this.indices.push(base, base + 1, base + 2);
  }

  triDouble(a: Vec3, b: Vec3, c: Vec3, color: number, shade = 1): void {
    this.tri(a, b, c, color, shade);
    this.tri(c, b, a, color, shade * 0.8);
  }

  /**
   * An axis-aligned box in the local frame, given by its centre and size. The underside is
   * left out. `baseShade` darkens the bottom edge of the walls, a cheap stand-in for the
   * grime and contact shadow where a wall meets the ground.
   */
  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    color: number,
    baseShade = 1,
    topColor = color,
  ): void {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const wall = [baseShade, baseShade, 1, 1] as const;

    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, wall); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, wall); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, wall); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, wall); // -x
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], topColor); // top
  }

  /** An upright cylinder with a flat lid, from `y0` to `y1`. */
  cylinder(
    cx: number,
    cz: number,
    y0: number,
    y1: number,
    radius: number,
    sides: number,
    color: number,
    topColor = color,
  ): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const ax = cx + Math.cos(a0) * radius;
      const az = cz + Math.sin(a0) * radius;
      const bx = cx + Math.cos(a1) * radius;
      const bz = cz + Math.sin(a1) * radius;
      this.quad([bx, y0, bz], [ax, y0, az], [ax, y1, az], [bx, y1, bz], color, [0.8, 0.8, 1, 1]);
      this.tri([cx, y1, cz], [bx, y1, bz], [ax, y1, az], topColor);
    }
  }

  /** A faceted lump (stretched icosahedron) for foliage. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: number) {
    for (const [ia, ib, ic] of ICO_FACES) {
      const a = ICO_VERTS[ia];
      const b = ICO_VERTS[ib];
      const c = ICO_VERTS[ic];
      if (!a || !b || !c) continue;
      // Faces that point down sit in the tree's own shade.
      const shade = 0.72 + 0.28 * Math.max(0, (a[1] + b[1] + c[1]) / 3 + 0.6);
      this.tri(
        [cx + a[0] * rx, cy + a[1] * ry, cz + a[2] * rz],
        [cx + b[0] * rx, cy + b[1] * ry, cz + b[2] * rz],
        [cx + c[0] * rx, cy + c[1] * ry, cz + c[2] * rz],
        color,
        Math.min(1.1, shade),
      );
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    if (this.withUvs) geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private vertex(
    point: Vec3,
    normal: Vec3,
    color: number,
    shade: number,
    uv: readonly [number, number] | undefined,
  ): void {
    const { cos, sin } = this;
    this.positions.push(
      this.ox + point[0] * cos + point[2] * sin,
      this.oy + point[1],
      this.oz - point[0] * sin + point[2] * cos,
    );
    this.normals.push(
      normal[0] * cos + normal[2] * sin,
      normal[1],
      -normal[0] * sin + normal[2] * cos,
    );
    scratchColor.setHex(color);
    this.colors.push(scratchColor.r * shade, scratchColor.g * shade, scratchColor.b * shade);
    if (this.withUvs) this.uvs.push(uv?.[0] ?? 0, uv?.[1] ?? 0);
  }
}

// Kept here too so the mesh builders can import everything from one place.
export { createRandom, pick } from './random';
