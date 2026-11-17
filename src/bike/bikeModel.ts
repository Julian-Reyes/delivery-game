import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The delivery rider and their bike: a small commuter motorcycle with spinning wheels, a
 * front end that turns with the bars, a fuel tank, engine, exhaust, shocks, mirrors and
 * the delivery box on the rack; and a rider in helmet and jacket whose hands follow the
 * bars and whose feet sit on the pegs, drop to the ground when stopped, and paddle when
 * backing up.
 *
 * Every rigid part is merged into one vertex-coloured mesh per moving piece (frame, front
 * end, each wheel, helmet), and the rider's limbs are rewritten into a single mesh every
 * frame, so the whole thing is six draw calls.
 *
 * Local axes: +z forward, y up, origin on the ground between the wheels.
 */

const WHEEL_RADIUS = 0.3;
const FRONT_AXLE = new Vector3(0, WHEEL_RADIUS, 0.66);
const REAR_AXLE = new Vector3(0, WHEEL_RADIUS, -0.64);
const STEERING_HEAD = new Vector3(0, 0.96, 0.5);

const PAINT = 0xd23a2a;
const DARK = 0x1c1d20;
const METAL = 0x9aa0a6;
const CHROME = 0xc9ccd0;
const RUBBER = 0x141414;
const SEAT = 0x1a1a1a;
const JACKET = 0x1fb5a8;
const TROUSERS = 0x2b3140;
const GLOVES = 0x1e1e1e;
const BOOTS = 0x2a211b;
const SKIN = 0xc68642;
const HELMET = 0xf4f1ea;
const VISOR = 0x1a2630;
const BOX = 0x1fb5a8;
const BOX_TRIM = 0xf4f1ea;

/** Limb lengths, metres. */
const THIGH = 0.44;
const SHIN = 0.45;
const UPPER_ARM = 0.3;
const FOREARM = 0.3;

type Part = BufferGeometry;

function paint(geometry: BufferGeometry, color: number): Part {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new Color(color);
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  flat.deleteAttribute('uv');
  return flat;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
  rx = 0,
): Part {
  const g = new BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A round tube between two points. */
function tube(from: Vector3, to: Vector3, radius: number, color: number, sides = 8): Part {
  const axis = new Vector3().subVectors(to, from);
  const g = new CylinderGeometry(radius, radius, axis.length(), sides);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.normalize()));
  const mid = new Vector3().addVectors(from, to).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return paint(g, color);
}

function sphere(
  r: number,
  x: number,
  y: number,
  z: number,
  color: number,
  sx = 1,
  sy = 1,
  sz = 1,
): Part {
  const g = new SphereGeometry(r, 12, 8);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A cylinder lying along x (a hub, a lamp facing forward is along z). */
function disc(
  r: number,
  width: number,
  x: number,
  y: number,
  z: number,
  color: number,
  alongZ = false,
): Part {
  const g = new CylinderGeometry(r, r, width, 16);
  g.rotateZ(Math.PI / 2);
  if (alongZ) g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

function merged(parts: Part[], castShadow = true): Mesh {
  const geometry = mergeGeometries(parts);
  if (!geometry) throw new Error('Could not merge bike geometry');
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = castShadow;
  return mesh;
}

function wheelMesh(): Mesh {
  const tyre = new TorusGeometry(WHEEL_RADIUS - 0.05, 0.05, 8, 24);
  tyre.rotateY(Math.PI / 2);
  const rim = new TorusGeometry(WHEEL_RADIUS - 0.1, 0.014, 6, 24);
  rim.rotateY(Math.PI / 2);
  const parts: Part[] = [paint(tyre, RUBBER), paint(rim, CHROME), disc(0.05, 0.12, 0, 0, 0, METAL)];
  // Spokes, so you can see it turn.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI;
    const g = new BoxGeometry(0.012, (WHEEL_RADIUS - 0.1) * 2, 0.012);
    g.rotateX(angle);
    parts.push(paint(g, CHROME));
  }
  // Brake disc on the left.
  parts.push(disc(0.11, 0.008, -0.07, 0, 0, METAL));
  return merged(parts);
}

/** The frame, engine, tank, seat, exhaust, rear suspension and the delivery box. */
function frameMesh(): Mesh {
  const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
  const parts: Part[] = [
    // Main frame: from the steering head down under the tank and back under the seat.
    tube(STEERING_HEAD, v(0, 0.55, 0.12), 0.03, DARK),
    tube(v(0, 0.92, 0.42), v(0, 0.82, -0.12), 0.028, DARK),
    tube(v(0, 0.82, -0.12), v(0, 0.86, -0.55), 0.024, DARK),
    tube(v(0, 0.55, 0.12), v(0, 0.42, -0.12), 0.03, DARK),
    // The single-cylinder engine with its cooling fins.
    box(0.26, 0.26, 0.34, 0, 0.42, 0.02, 0x3a3c40),
    box(0.2, 0.2, 0.18, 0, 0.62, 0.18, 0x55585d, -0.5),
    box(0.22, 0.02, 0.2, 0, 0.6, 0.2, METAL, -0.5),
    box(0.22, 0.02, 0.2, 0, 0.66, 0.17, METAL, -0.5),
    box(0.3, 0.12, 0.1, 0, 0.36, -0.14, 0x2e3034),
    // Fuel tank, side panels and seat.
    sphere(0.17, 0, 0.92, 0.22, PAINT, 0.95, 0.62, 1.6),
    box(0.04, 0.16, 0.26, 0.12, 0.7, -0.22, PAINT),
    box(0.04, 0.16, 0.26, -0.12, 0.7, -0.22, PAINT),
    box(0.24, 0.07, 0.62, 0, 0.88, -0.24, SEAT),
    box(0.22, 0.05, 0.3, 0, 0.93, -0.36, SEAT),
    // Rear fender, tail light and number plate.
    box(0.14, 0.03, 0.42, 0, 0.82, -0.68, PAINT, 0.35),
    box(0.12, 0.05, 0.04, 0, 0.84, -0.82, 0xff2a1a),
    box(0.18, 0.11, 0.01, 0, 0.72, -0.84, 0xf4f1ea),
    // Swingarm and the twin rear shocks.
    tube(v(0.09, 0.4, -0.1), v(0.09, REAR_AXLE.y, REAR_AXLE.z), 0.022, DARK),
    tube(v(-0.09, 0.4, -0.1), v(-0.09, REAR_AXLE.y, REAR_AXLE.z), 0.022, DARK),
    tube(v(0.1, 0.36, -0.52), v(0.1, 0.84, -0.42), 0.028, 0xe0b020),
    tube(v(-0.1, 0.36, -0.52), v(-0.1, 0.84, -0.42), 0.028, 0xe0b020),
    // Exhaust from the cylinder head down the right side to the silencer.
    tube(v(0.06, 0.52, 0.22), v(0.12, 0.3, 0.12), 0.025, CHROME),
    tube(v(0.12, 0.3, 0.12), v(0.16, 0.32, -0.3), 0.025, CHROME),
    tube(v(0.16, 0.34, -0.3), v(0.17, 0.42, -0.66), 0.05, 0x7d8085),
    // Footpegs and the kickstand.
    tube(v(0.06, 0.36, 0.0), v(0.22, 0.36, 0.0), 0.016, DARK),
    tube(v(-0.06, 0.36, 0.0), v(-0.22, 0.36, 0.0), 0.016, DARK),
    // Rear rack and the delivery box.
    box(0.36, 0.02, 0.36, 0, 0.98, -0.66, DARK),
    box(0.48, 0.42, 0.46, 0, 1.2, -0.68, BOX),
    box(0.5, 0.06, 0.48, 0, 1.42, -0.68, BOX_TRIM),
    box(0.49, 0.05, 0.47, 0, 1.08, -0.68, BOX_TRIM),
  ];
  return merged(parts);
}

/** Forks, bars, headlight, mirrors and front fender: everything that turns with the bars. */
function frontMesh(): Mesh {
  // Built around the steering head, with -y running down the fork to the axle.
  const fork = FRONT_AXLE.clone().sub(STEERING_HEAD);
  const forkLength = fork.length();
  const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
  const parts: Part[] = [
    tube(v(0.08, 0.04, 0), v(0.08, -forkLength, 0), 0.025, CHROME),
    tube(v(-0.08, 0.04, 0), v(-0.08, -forkLength, 0), 0.025, CHROME),
    box(0.22, 0.04, 0.06, 0, 0.02, 0, DARK),
    box(0.22, 0.04, 0.06, 0, -0.12, 0, DARK),
    // Handlebars, grips and levers.
    tube(v(-0.32, 0.14, -0.04), v(0.32, 0.14, -0.04), 0.014, DARK),
    tube(v(0.22, 0.14, -0.04), v(0.33, 0.14, -0.04), 0.022, RUBBER),
    tube(v(-0.22, 0.14, -0.04), v(-0.33, 0.14, -0.04), 0.022, RUBBER),
    tube(v(0, 0.04, 0), v(0, 0.14, -0.04), 0.02, DARK),
    // Headlight and the little instrument pod.
    disc(0.09, 0.08, 0, -0.06, 0.12, PAINT, true),
    disc(0.075, 0.02, 0, -0.06, 0.165, 0xfff4d0, true),
    box(0.12, 0.06, 0.06, 0, 0.12, 0.04, DARK),
    // Mirrors on stalks.
    tube(v(0.2, 0.14, -0.04), v(0.26, 0.38, -0.02), 0.008, DARK),
    tube(v(-0.2, 0.14, -0.04), v(-0.26, 0.38, -0.02), 0.008, DARK),
    box(0.1, 0.06, 0.02, 0.27, 0.4, -0.02, DARK),
    box(0.1, 0.06, 0.02, -0.27, 0.4, -0.02, DARK),
    // Front fender over the wheel.
    box(0.13, 0.025, 0.36, 0, -forkLength + WHEEL_RADIUS + 0.06, 0.02, PAINT),
  ];
  return merged(parts);
}

/**
 * Oriented boxes rewritten every frame into one mesh: the rider's torso and limbs. Each
 * box runs between two points with a given width and depth.
 */
class Limbs {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly geometry = new BufferGeometry();
  private readonly axis = new Vector3();
  private readonly side = new Vector3();
  private readonly front = new Vector3();
  private readonly corners = Array.from({ length: 8 }, () => new Vector3());
  private count = 0;

  constructor(private readonly capacity: number) {
    const vertices = capacity * 24;
    this.positions = new Float32Array(vertices * 3);
    this.normals = new Float32Array(vertices * 3);
    const colors = new Float32Array(vertices * 3);
    const index: number[] = [];
    for (let b = 0; b < capacity; b++) {
      for (let f = 0; f < 6; f++) {
        const o = b * 24 + f * 4;
        index.push(o, o + 1, o + 2, o, o + 2, o + 3);
      }
    }
    const position = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    const normal = new BufferAttribute(this.normals, 3).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', position);
    this.geometry.setAttribute('normal', normal);
    this.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    this.geometry.setIndex(index);
    this.mesh = new Mesh(this.geometry, new MeshLambertMaterial({ vertexColors: true }));
    this.mesh.castShadow = true;
    // Rewritten every frame and always near the camera; no point culling it.
    this.mesh.frustumCulled = false;
  }

  /** Set the colour of each box once; their order must match `segment` calls. */
  setColors(colors: readonly number[]): void {
    const attribute = this.geometry.getAttribute('color');
    const c = new Color();
    colors.forEach((color, b) => {
      c.setHex(color);
      for (let v = 0; v < 24; v++) attribute.setXYZ(b * 24 + v, c.r, c.g, c.b);
    });
    attribute.needsUpdate = true;
  }

  begin(): void {
    this.count = 0;
  }

  /** A box from `a` to `b`; `width` across the rider, `depth` front to back. */
  segment(a: Vector3, b: Vector3, width: number, depth: number): void {
    if (this.count >= this.capacity) return;
    const { axis, side, front, corners } = this;
    axis.subVectors(b, a);
    const length = axis.length() || 1e-6;
    axis.divideScalar(length);
    // Sideways stays as close to the rider's x as the limb allows.
    side.set(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
    front.crossVectors(side, axis).normalize();
    const hw = width / 2;
    const hd = depth / 2;
    let k = 0;
    for (const end of [a, b]) {
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const corner = corners[k++];
        if (corner)
          corner
            .copy(end)
            .addScaledVector(side, sx * hw)
            .addScaledVector(front, sz * hd);
      }
    }
    // Faces: bottom-ring corners 0-3, top-ring 4-7.
    const faces: readonly [number, number, number, number][] = [
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
      [3, 2, 1, 0],
      [4, 5, 6, 7],
    ];
    const base = this.count * 24;
    faces.forEach((face, f) => {
      const [p, q, r] = [corners[face[0]], corners[face[1]], corners[face[2]]];
      if (!p || !q || !r) return;
      const nx = (q.y - p.y) * (r.z - p.z) - (q.z - p.z) * (r.y - p.y);
      const ny = (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z);
      const nz = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const nl = Math.hypot(nx, ny, nz) || 1;
      face.forEach((ci, j) => {
        const c = corners[ci];
        if (!c) return;
        const i = (base + f * 4 + j) * 3;
        this.positions[i] = c.x;
        this.positions[i + 1] = c.y;
        this.positions[i + 2] = c.z;
        this.normals[i] = nx / nl;
        this.normals[i + 1] = ny / nl;
        this.normals[i + 2] = nz / nl;
      });
    });
    this.count += 1;
  }

  end(): void {
    this.geometry.setDrawRange(0, this.count * 36);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('normal').needsUpdate = true;
  }
}

/**
 * Where the middle joint of a two-bone limb goes: the knee or elbow, bent towards `bend`
 * (a direction), given the limb's two lengths. Writes into `out`.
 */
function joint(
  from: Vector3,
  to: Vector3,
  upper: number,
  lower: number,
  bend: Vector3,
  out: Vector3,
): Vector3 {
  const reach = Math.min(upper + lower - 1e-4, Math.max(1e-4, from.distanceTo(to)));
  // Distance along the from-to line to the foot of the joint, and the height off it.
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const off = Math.sqrt(Math.max(0, upper * upper - along * along));
  const dx = (to.x - from.x) / reach;
  const dy = (to.y - from.y) / reach;
  const dz = (to.z - from.z) / reach;
  // The bend direction with its along-limb part removed.
  const dot = bend.x * dx + bend.y * dy + bend.z * dz;
  let px = bend.x - dot * dx;
  let py = bend.y - dot * dy;
  let pz = bend.z - dot * dz;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  return out.set(
    from.x + dx * along + px * off,
    from.y + dy * along + py * off,
    from.z + dz * along + pz * off,
  );
}

export interface BikePose {
  /** Visual steering angle of the bars, radians, positive to the right. */
  steer: number;
  /** Wheel rotation, radians. */
  wheel: number;
  /** 0 with feet on the pegs, 1 with both feet down. */
  feetDown: number;
  /** Paddling phase while backing up, or null. */
  paddle: number | null;
}

export class BikeModel {
  readonly object = new Group();
  private readonly steering = new Group();
  private readonly frontWheel: Mesh;
  private readonly rearWheel: Mesh;
  private readonly limbs = new Limbs(14);
  private readonly helmet: Mesh;
  /**
   * The rider's eyes, for the first-person view: a camera placed here looks where the
   * rider looks, leaning and pitching with the bike. Cameras look down their -z, so it is
   * turned to face the bike's +z, tipped a little down towards the road.
   */
  readonly eye = new Object3D();

  // Scratch, so posing allocates nothing per frame.
  private readonly hip = new Vector3();
  private readonly knee = new Vector3();
  private readonly foot = new Vector3();
  private readonly toe = new Vector3();
  private readonly shoulder = new Vector3();
  private readonly elbow = new Vector3();
  private readonly hand = new Vector3();
  private readonly pelvis = new Vector3(0, 0.98, -0.2);
  private readonly chest = new Vector3(0, 1.42, -0.02);
  private readonly neck = new Vector3(0, 1.52, 0.02);
  private readonly kneeBend = new Vector3(0, 0.3, 1);
  private readonly elbowBend = new Vector3();
  private readonly reachDir = new Vector3();
  private readonly grip = new Vector3();

  constructor() {
    this.object.add(frameMesh());

    // The front end pivots about the steering head, along the fork's rake.
    const head = new Group();
    head.position.copy(STEERING_HEAD);
    const fork = FRONT_AXLE.clone().sub(STEERING_HEAD);
    head.rotation.x = -Math.atan2(fork.z, -fork.y);
    head.add(this.steering);
    this.steering.add(frontMesh());
    this.frontWheel = wheelMesh();
    this.frontWheel.position.set(0, -fork.length(), 0);
    this.steering.add(this.frontWheel);
    this.object.add(head);

    this.rearWheel = wheelMesh();
    this.rearWheel.position.copy(REAR_AXLE);
    this.object.add(this.rearWheel);

    // The rider: helmet as its own mesh, everything else rewritten each frame.
    const helmet = merged([
      sphere(0.15, 0, 0, 0, HELMET, 1, 1.05, 1.1),
      sphere(0.13, 0, -0.01, 0.06, VISOR, 1.02, 0.6, 1),
      box(0.27, 0.04, 0.1, 0, -0.12, 0.08, DARK),
      sphere(0.152, 0, 0.005, 0, JACKET, 0.25, 1.06, 1.11),
    ]);
    helmet.position.set(0, 1.68, 0.06);
    this.helmet = helmet;
    this.eye.position.set(0, 1.64, -0.04);
    this.eye.rotation.set(-0.28, Math.PI, 0, 'YXZ');
    this.object.add(helmet, this.limbs.mesh, this.eye);
    this.limbs.setColors([
      JACKET,
      SKIN,
      TROUSERS,
      TROUSERS,
      BOOTS,
      TROUSERS,
      TROUSERS,
      BOOTS,
      JACKET,
      JACKET,
      GLOVES,
      JACKET,
      JACKET,
      GLOVES,
    ]);
  }

  /** In first person the camera sits inside the helmet, so hide it. */
  setFirstPerson(firstPerson: boolean): void {
    this.helmet.visible = !firstPerson;
  }

  update(pose: BikePose): void {
    this.steering.rotation.y = -pose.steer;
    this.frontWheel.rotation.x = pose.wheel;
    this.rearWheel.rotation.x = pose.wheel;

    const limbs = this.limbs;
    limbs.begin();
    limbs.segment(this.pelvis, this.chest, 0.4, 0.26);
    limbs.segment(this.chest, this.neck, 0.12, 0.12);

    for (const side of [1, -1]) {
      // Legs: from the hip to the peg, or down to the ground, or paddling backwards.
      this.hip.set(side * 0.12, 0.92, -0.2);
      const peg = { x: side * 0.21, y: 0.4, z: 0.0 };
      let downZ = 0.12;
      if (pose.paddle !== null)
        downZ = 0.1 + Math.sin(pose.paddle + (side > 0 ? 0 : Math.PI)) * 0.28;
      const t = pose.feetDown;
      this.foot.set(
        peg.x + (side * 0.36 - peg.x) * t,
        peg.y + (0.06 - peg.y) * t,
        peg.z + (downZ - peg.z) * t,
      );
      joint(this.hip, this.foot, THIGH, SHIN, this.kneeBend, this.knee);
      this.toe.set(this.foot.x, this.foot.y - 0.02, this.foot.z + 0.2);
      limbs.segment(this.hip, this.knee, 0.15, 0.17);
      limbs.segment(this.knee, this.foot, 0.12, 0.13);
      limbs.segment(this.foot, this.toe, 0.12, 0.09);
    }

    for (const side of [1, -1]) {
      // Arms: shoulder to the grip, which moves as the bars turn.
      this.shoulder.set(side * 0.21, 1.4, -0.02);
      const gx = side * 0.29;
      const turn = pose.steer;
      // Turning right pushes the left grip forward and pulls the right one back.
      this.grip.set(
        gx * Math.cos(turn),
        STEERING_HEAD.y + 0.13,
        STEERING_HEAD.z - 0.06 + gx * Math.sin(turn),
      );
      // Elbows out and a little down, the way riders hold the bars.
      this.elbowBend.set(side * 0.7, -0.5, -0.3);
      joint(this.shoulder, this.grip, UPPER_ARM, FOREARM, this.elbowBend, this.elbow);
      this.reachDir.subVectors(this.grip, this.elbow).normalize();
      this.hand.copy(this.grip).addScaledVector(this.reachDir, -0.09);
      limbs.segment(this.shoulder, this.elbow, 0.11, 0.11);
      limbs.segment(this.elbow, this.hand, 0.09, 0.09);
      limbs.segment(this.hand, this.grip, 0.09, 0.1);
    }
    limbs.end();
  }
}
