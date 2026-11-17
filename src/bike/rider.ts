import { Group } from 'three';
import { BikeModel } from './bikeModel';
import type { RawInput } from '../input/actions';
import type { GroundHit, Physics } from '../physics/physics';
import { createEngine, stepEngine } from '../sim/engine';

/**
 * Placeholder rider: the arcade handling from the first sandbox, now following the terrain,
 * leaving the ground off ramps and crests, and sliding along walls. The real bike
 * controller (wheelies, crashes, cargo signals) replaces this in the bike step.
 */

const ACCEL = 14;
const BRAKE = 26;
const DRAG = 0.6;
const MAX_SPEED = 28;
const TURN_RATE = 2.5;
const MAX_LEAN = 0.7;
/** Below this speed steering fades out, so the bike cannot spin on the spot. */
const FULL_STEER_SPEED = 4.5;
const GRAVITY = 22;
/** How far below the predicted path the ground can be before we count as airborne. */
const STICK = 0.06;
const AIR_STEER = 0.35;
/** Fraction of speed kept, per second, while scraping along a wall. */
const SCRAPE_KEEP = 0.25;
/**
 * Backing up: hold the brake at a standstill and the rider paddles the bike backwards
 * with their feet, at walking pace and no faster.
 */
const REVERSE_SPEED = 1.6;
const REVERSE_ACCEL = 2.2;
/** How long the brake is held at a standstill before the feet start paddling. */
const REVERSE_DELAY = 0.35;
/** Stopped means slower than this. */
const STOPPED = 0.05;
/** How much of the full steering rate paddling backwards allows. */
const REVERSE_STEER = 0.45;
/** How far the bars turn on full lock: a lot at walking pace, a touch at speed. */
const BAR_LOCK_SLOW = 0.55;
const BAR_LOCK_FAST = 0.08;
const WHEEL_RADIUS = 0.3;
/** Below this speed the rider puts their feet down. */
const FEET_DOWN_SPEED = 1.8;

/**
 * What the rider is doing, refreshed every simulation step, for sound now and the cargo
 * model later (see the `RideSample` in DESIGN.md).
 */
export interface RideTelemetry {
  /** Metres per second along the heading; negative while backing up. */
  speed: number;
  throttle: number;
  brake: number;
  grounded: boolean;
  /** Seconds off the ground so far, 0 when grounded. */
  airtime: number;
  /** Strongest landing since the last `takeLanding()`, as downward speed in m/s. */
  landing: number;
  /** 0..1, how hard the bike is scraping along a wall this step. */
  scrape: number;
  reversing: boolean;
}

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
  private readonly model = new BikeModel();
  private readonly hit: GroundHit = { y: 0, nx: 0, ny: 1, nz: 0 };
  private readonly moved = { x: 0, z: 0 };
  readonly telemetry: RideTelemetry = {
    speed: 0,
    throttle: 0,
    brake: 0,
    grounded: true,
    airtime: 0,
    landing: 0,
    scrape: 0,
    reversing: false,
  };
  private stoppedFor = 0;
  /** Revs, gear and load, for the engine sound. */
  readonly engine = createEngine();

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
  private bars = 0;
  private prevBars = 0;
  private wheel = 0;
  private prevWheel = 0;
  private feetDown = 1;
  private prevFeetDown = 1;
  private paddle = 0;

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
    this.stoppedFor = 0;
    this.lean = 0;
    this.pitch = 0;
    this.grounded = true;
    this.savePrevious();
  }

  step(dt: number, input: RawInput): void {
    this.savePrevious();

    const braking = input.brake > 0.5 && input.throttle < 0.1;
    this.stoppedFor = Math.abs(this.speed) < STOPPED && braking ? this.stoppedFor + dt : 0;
    const reversing =
      this.grounded && braking && (this.speed < -STOPPED || this.stoppedFor > REVERSE_DELAY);

    if (reversing) {
      this.speed = Math.max(-REVERSE_SPEED, this.speed - REVERSE_ACCEL * dt);
    } else if (this.speed < 0) {
      // Feet down: rolling backwards stops as soon as the brake is let go.
      this.speed = Math.min(0, this.speed + REVERSE_ACCEL * 3 * dt);
    } else {
      const drive = this.grounded ? input.throttle * ACCEL - input.brake * BRAKE : 0;
      this.speed += (drive - this.speed * DRAG) * dt;
      this.speed = Math.min(MAX_SPEED, Math.max(0, this.speed));
    }

    // Steering fades in with speed so the bike cannot spin on the spot. Pushed backwards,
    // the turned front wheel swings the bike the other way, and only slowly.
    const grip =
      this.speed >= 0
        ? Math.min(1, this.speed / FULL_STEER_SPEED) * (this.grounded ? 1 : AIR_STEER)
        : -REVERSE_STEER * (-this.speed / REVERSE_SPEED);
    this.heading -= input.steer * TURN_RATE * grip * dt;

    const targetLean = input.steer * MAX_LEAN * Math.min(1, Math.max(0, this.speed) / 14);
    this.lean += (targetLean - this.lean) * Math.min(1, 8 * dt);

    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    const dx = sin * this.speed * dt;
    const dz = cos * this.speed * dt;

    let scrape = 0;
    if (this.physics.slideRider(this.x, this.y, this.z, dx, dz, this.moved)) {
      // Keep only the speed that still points where the wall let us go, and bleed some
      // off for the scrape.
      const wanted = Math.hypot(dx, dz);
      const along = wanted > 1e-6 ? (this.moved.x * dx + this.moved.z * dz) / (wanted * wanted) : 0;
      scrape = Math.min(
        1,
        (Math.abs(this.speed) / 12) * (1 - Math.max(0, Math.min(1, along)) * 0.5),
      );
      this.speed *= Math.max(0, Math.min(1, along)) * Math.pow(SCRAPE_KEEP, dt);
    }
    this.x += this.moved.x;
    this.z += this.moved.z;

    // Vertical: follow the ground while it is there, fly when it falls away.
    const ballisticY = this.y + this.vy * dt - 0.5 * GRAVITY * dt * dt;
    const found = this.physics.groundAt(this.x, this.y + 1.5, this.z, 60, this.hit);
    let targetPitch: number;

    const wasGrounded = this.grounded;
    const fallSpeed = -this.vy;
    if (found && this.hit.y >= ballisticY - STICK) {
      if (!wasGrounded) {
        this.telemetry.landing = Math.max(this.telemetry.landing, fallSpeed);
      }
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

    const t = this.telemetry;
    t.speed = this.speed;
    t.throttle = input.throttle;
    t.brake = input.brake;
    t.grounded = this.grounded;
    t.airtime = this.grounded ? 0 : t.airtime + dt;
    t.scrape = scrape;
    t.reversing = this.speed < -STOPPED;
    stepEngine(
      this.engine,
      { speed: this.speed, throttle: input.throttle, grounded: this.grounded },
      dt,
    );

    // What the model shows: bars turned by the steering, wheels rolling, feet down when
    // nearly stopped, paddling when backing up.
    const lock =
      BAR_LOCK_FAST + (BAR_LOCK_SLOW - BAR_LOCK_FAST) * Math.max(0, 1 - Math.abs(this.speed) / 10);
    this.bars += (input.steer * lock - this.bars) * Math.min(1, 10 * dt);
    if (this.grounded) this.wheel += (this.speed / WHEEL_RADIUS) * dt;
    const down = this.grounded && Math.abs(this.speed) < FEET_DOWN_SPEED ? 1 : 0;
    this.feetDown += (down - this.feetDown) * Math.min(1, 6 * dt);
    if (this.speed < -STOPPED) this.paddle += -this.speed * 5 * dt;
  }

  /** The strongest landing since the last call, then forget it. */
  takeLanding(): number {
    const landing = this.telemetry.landing;
    this.telemetry.landing = 0;
    return landing;
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
    this.model.update({
      steer: this.prevBars + (this.bars - this.prevBars) * alpha,
      wheel: this.prevWheel + (this.wheel - this.prevWheel) * alpha,
      feetDown: this.prevFeetDown + (this.feetDown - this.prevFeetDown) * alpha,
      paddle: this.speed < -STOPPED ? this.paddle : null,
    });
  }

  private savePrevious(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.prevHeading = this.heading;
    this.prevLean = this.lean;
    this.prevPitch = this.pitch;
    this.prevBars = this.bars;
    this.prevWheel = this.wheel;
    this.prevFeetDown = this.feetDown;
  }

  private buildMesh(): void {
    this.body.add(this.model.object);
    this.body.rotation.order = 'YXZ';
    this.object.add(this.body);
  }
}
