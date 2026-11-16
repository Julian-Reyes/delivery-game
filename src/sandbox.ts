import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three';
import type { RawInput } from './input/actions';

/**
 * TEMPORARY test scene for step 2: a box you can drive on a flat lot, to prove the loop,
 * renderer caps, input layer and debug overlay. Replaced by world/ and bike/ in steps 4–5.
 */

const SKY = 0xf7c9a0;
const ACCEL = 14;
const BRAKE = 26;
const DRAG = 0.6;
const MAX_SPEED = 28;
const TURN_RATE = 1.9;
const MAX_LEAN = 0.55;
const SHADOW_RANGE = 10;

export class Sandbox {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, 1, 0.1, 400);

  private readonly rider = new Group();
  private readonly riderBody = new Group();
  private readonly sun = new DirectionalLight(0xfff0d8, 2.2);

  // Simulation state, with the previous step kept for render interpolation.
  private x = 0;
  private z = 0;
  private heading = 0;
  private lean = 0;
  private speed = 0;
  private prevX = 0;
  private prevZ = 0;
  private prevHeading = 0;
  private prevLean = 0;

  constructor() {
    this.scene.background = new Color(SKY);
    this.scene.fog = new Fog(SKY, 50, 240);

    this.scene.add(new HemisphereLight(0xffe6c7, 0x4a5a6a, 1.4));

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -SHADOW_RANGE;
    shadowCam.right = SHADOW_RANGE;
    shadowCam.top = SHADOW_RANGE;
    shadowCam.bottom = -SHADOW_RANGE;
    shadowCam.near = 1;
    shadowCam.far = 80;
    this.scene.add(this.sun, this.sun.target);

    const ground = new Mesh(
      new PlaneGeometry(600, 600),
      new MeshLambertMaterial({ color: 0x5b6470 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new GridHelper(600, 120, 0xffd27a, 0x717b88);
    grid.position.y = 0.01;
    this.scene.add(grid);

    this.scene.add(this.buildBlocks());
    this.buildRider();
    this.scene.add(this.rider);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  step(dt: number, input: RawInput): void {
    this.prevX = this.x;
    this.prevZ = this.z;
    this.prevHeading = this.heading;
    this.prevLean = this.lean;

    this.speed += (input.throttle * ACCEL - input.brake * BRAKE - this.speed * DRAG) * dt;
    this.speed = Math.min(MAX_SPEED, Math.max(0, this.speed));

    // Steering fades in with speed so the box cannot spin on the spot.
    const grip = Math.min(1, this.speed / 6);
    this.heading -= input.steer * TURN_RATE * grip * dt;

    const targetLean = input.steer * MAX_LEAN * Math.min(1, this.speed / 14);
    this.lean += (targetLean - this.lean) * Math.min(1, 8 * dt);

    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
  }

  /** Position the visuals between the last two simulation steps. */
  render(alpha: number): void {
    const x = this.prevX + (this.x - this.prevX) * alpha;
    const z = this.prevZ + (this.z - this.prevZ) * alpha;
    const heading = this.prevHeading + (this.heading - this.prevHeading) * alpha;
    const lean = this.prevLean + (this.lean - this.prevLean) * alpha;

    this.rider.position.set(x, 0, z);
    this.rider.rotation.y = heading;
    this.riderBody.rotation.z = lean;

    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    this.camera.position.set(x - sin * 7.5, 3.2, z - cos * 7.5);
    this.camera.lookAt(x + sin * 4, 1.2, z + cos * 4);

    // The shadow area is small and travels with the rider.
    this.sun.position.set(x + 14, 26, z + 9);
    this.sun.target.position.set(x, 0, z);
  }

  get speedKmh(): number {
    return this.speed * 3.6;
  }

  private buildRider(): void {
    const paint = new MeshLambertMaterial({ color: 0xff5a3c });
    const dark = new MeshLambertMaterial({ color: 0x1d2530 });

    const frame = new Mesh(new BoxGeometry(0.45, 0.6, 1.9), paint);
    frame.position.y = 0.75;
    const torso = new Mesh(new BoxGeometry(0.5, 0.8, 0.45), dark);
    torso.position.set(0, 1.4, -0.15);
    const cargoBox = new Mesh(new BoxGeometry(0.62, 0.55, 0.55), paint);
    cargoBox.position.set(0, 1.3, -0.75);

    for (const part of [frame, torso, cargoBox]) {
      part.castShadow = true;
      this.riderBody.add(part);
    }
    this.rider.add(this.riderBody);
  }

  /** Scattered blocks as a single instanced mesh, purely as a speed reference. */
  private buildBlocks(): InstancedMesh {
    const count = 60;
    const blocks = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({ color: 0xffffff }),
      count,
    );
    const palette = [0xf2a65a, 0xe8d5b7, 0x4fb3a5, 0xf27f6d, 0xf4e285];
    const matrix = new Matrix4();
    const color = new Color();

    // Small deterministic generator so the layout is the same every run.
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    for (let i = 0; i < count; i++) {
      const width = 6 + random() * 8;
      const height = 5 + random() * 16;
      const depth = 6 + random() * 8;
      const side = i % 2 === 0 ? 1 : -1;
      const x = side * (16 + random() * 60);
      const z = -120 + (i / count) * 420;
      matrix.makeScale(width, height, depth);
      matrix.setPosition(x, height / 2, z);
      blocks.setMatrixAt(i, matrix);
      blocks.setColorAt(i, color.setHex(palette[i % palette.length] ?? 0xffffff));
    }
    return blocks;
  }
}
