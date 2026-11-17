import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import type { RawInput } from '../input/actions';
import type { GroundHit, Physics } from '../physics/physics';

/**
 * Placeholder rider: the arcade handling from the first sandbox, now following the terrain,
 * leaving the ground off ramps and crests, and sliding along walls. The real bike
 * controller (wheelies, crashes, cargo signals) replaces this in the bike step.
 */

const ACCEL = 14;
const BRAKE = 26;
const DRAG = 0.6;
const MAX_SPEED = 28;
const TURN_RATE = 1.9;
const MAX_LEAN = 0.55;
const GRAVITY = 22;
/** How far below the predicted path the ground can be before we count as airborne. */
const STICK = 0.06;
const AIR_STEER = 0.35;
/** Fraction of speed kept, per second, while scraping along a wall. */
const SCRAPE_KEEP = 0.25;

export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export class Rider {
  readonly object = new Group();
  /** Interpolated pose from the last `render()` call, for the camera and lighting. */
  readonly pose: Pose = { x: 0, y: 0, z: 0, heading: 0 };

  private readonly body = new Group();
  private readonly hit: GroundHit = { y: 0, nx: 0, ny: 1, nz: 0 };
  private readonly moved = { x: 0, z: 0 };

  private x = 0;
  private y = 0;
  private z = 0;
  private heading = 0;
  private lean = 0;
  private pitch = 0;
  private speed = 0;
  private vy = 0;
  private grounded = true;

  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevHeading = 0;
  private prevLean = 0;
  private prevPitch = 0;

  constructor(
    private readonly physics: Physics,
    private readonly spawn: { x: number; z: number; heading: number },
  ) {
    this.buildMesh();
    this.respawn();
  }

  get speedKmh(): number {
    return this.speed * 3.6;
  }

  get airborne(): boolean {
    return !this.grounded;
  }

  respawn(): void {
    this.teleport(this.spawn.x, this.spawn.z, this.spawn.heading);
  }

  /** Put the rider on the ground at a point, stationary. */
  teleport(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.y = this.physics.groundAt(this.x, 200, this.z, 400, this.hit) ? this.hit.y : 0;
    this.speed = 0;
    this.vy = 0;
    this.lean = 0;
    this.pitch = 0;
    this.grounded = true;
    this.savePrevious();
  }

  step(dt: number, input: RawInput): void {
    this.savePrevious();

    const drive = this.grounded ? input.throttle * ACCEL - input.brake * BRAKE : 0;
    this.speed += (drive - this.speed * DRAG) * dt;
    this.speed = Math.min(MAX_SPEED, Math.max(0, this.speed));

    // Steering fades in with speed so the bike cannot spin on the spot.
    const grip = Math.min(1, this.speed / 6) * (this.grounded ? 1 : AIR_STEER);
    this.heading -= input.steer * TURN_RATE * grip * dt;

    const targetLean = input.steer * MAX_LEAN * Math.min(1, this.speed / 14);
    this.lean += (targetLean - this.lean) * Math.min(1, 8 * dt);

    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    const dx = sin * this.speed * dt;
    const dz = cos * this.speed * dt;

    if (this.physics.slideRider(this.x, this.y, this.z, dx, dz, this.moved)) {
      // Keep only the speed that still points where the wall let us go, and bleed some
      // off for the scrape.
      const wanted = Math.hypot(dx, dz);
      const along = wanted > 1e-6 ? (this.moved.x * dx + this.moved.z * dz) / (wanted * wanted) : 0;
      this.speed *= Math.max(0, Math.min(1, along)) * Math.pow(SCRAPE_KEEP, dt);
    }
    this.x += this.moved.x;
    this.z += this.moved.z;

    // Vertical: follow the ground while it is there, fly when it falls away.
    const ballisticY = this.y + this.vy * dt - 0.5 * GRAVITY * dt * dt;
    const found = this.physics.groundAt(this.x, this.y + 1.5, this.z, 60, this.hit);
    let targetPitch: number;

    if (found && this.hit.y >= ballisticY - STICK) {
      this.grounded = true;
      this.y = this.hit.y;
      // Rate of climb of a point sliding over this surface at our speed. Using the
      // surface normal rather than the change in height means kerbs do not launch us.
      const slope = -(this.hit.nx * sin + this.hit.nz * cos) / Math.max(0.2, this.hit.ny);
      this.vy = slope * this.speed;
      targetPitch = Math.atan(slope);
    } else {
      this.grounded = false;
      this.y = ballisticY;
      this.vy -= GRAVITY * dt;
      // Nose follows the arc.
      targetPitch = Math.atan2(this.vy, Math.max(4, this.speed)) * 0.6;
    }
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 10 * dt);
  }

  /** Position the visuals between the last two simulation steps. */
  render(alpha: number): void {
    const { pose } = this;
    pose.x = this.prevX + (this.x - this.prevX) * alpha;
    pose.y = this.prevY + (this.y - this.prevY) * alpha;
    pose.z = this.prevZ + (this.z - this.prevZ) * alpha;
    pose.heading = this.prevHeading + (this.heading - this.prevHeading) * alpha;

    this.object.position.set(pose.x, pose.y, pose.z);
    this.object.rotation.y = pose.heading;
    // Positive rotation about x dips the nose, so pitch-up is negative.
    this.body.rotation.x = -(this.prevPitch + (this.pitch - this.prevPitch) * alpha);
    this.body.rotation.z = this.prevLean + (this.lean - this.prevLean) * alpha;
  }

  private savePrevious(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.prevHeading = this.heading;
    this.prevLean = this.lean;
    this.prevPitch = this.pitch;
  }

  private buildMesh(): void {
    const paint = new MeshLambertMaterial({ color: 0xff5a3c });
    const dark = new MeshLambertMaterial({ color: 0x1d2530 });
    const bag = new MeshLambertMaterial({ color: 0x1fb5a8 });

    const frame = new Mesh(new BoxGeometry(0.4, 0.5, 1.7), paint);
    frame.position.y = 0.75;
    const wheels = new Mesh(new BoxGeometry(0.16, 0.62, 2.1), dark);
    wheels.position.y = 0.31;
    const torso = new Mesh(new BoxGeometry(0.5, 0.8, 0.42), dark);
    torso.position.set(0, 1.4, -0.1);
    const helmet = new Mesh(new BoxGeometry(0.32, 0.32, 0.34), paint);
    helmet.position.set(0, 1.96, -0.06);
    const cargoBox = new Mesh(new BoxGeometry(0.6, 0.55, 0.55), bag);
    cargoBox.position.set(0, 1.32, -0.68);

    for (const part of [frame, wheels, torso, helmet, cargoBox]) {
      part.castShadow = true;
      this.body.add(part);
    }
    this.body.rotation.order = 'YXZ';
    this.object.add(this.body);
  }
}
