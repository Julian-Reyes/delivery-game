import { PerspectiveCamera } from 'three';
import type { RawInput } from '../input/actions';

const MIN_SPEED = 20;
/** Extra speed per metre above the ground, so crossing the map from high up is quick. */
const SPEED_PER_METRE = 0.9;
const TURN_RATE = 1.6;
const CLIMB_RATE = 40;
/** The view tilts from a shallow look-ahead near the ground to straight down up high. */
const TILT_LOW = 0.35;
const TILT_HIGH = 1.5;
const TILT_HEIGHT = 350;

/**
 * Developer camera for inspecting the layout: fly over the map with the riding controls
 * (throttle and brake to move, steer to turn) plus lift to climb and descend. It tilts
 * towards a top-down view the higher it goes.
 */
export class FreeCamera {
  readonly camera = new PerspectiveCamera(62, 1, 0.5, 4000);

  private x = 0;
  private y = 0;
  private z = 0;
  private heading = 0;

  constructor(private readonly groundAt: (x: number, z: number) => number) {
    this.camera.rotation.order = 'YXZ';
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Start from a point a little above and behind somewhere, facing along `heading`. */
  start(x: number, y: number, z: number, heading: number): void {
    this.heading = heading;
    this.x = x - Math.sin(heading) * 20;
    this.z = z - Math.cos(heading) * 20;
    this.y = y + 25;
  }

  update(dt: number, input: RawInput): void {
    const ground = this.groundAt(this.x, this.z);
    const altitude = Math.max(0, this.y - ground);
    const speed = MIN_SPEED + altitude * SPEED_PER_METRE;

    this.heading -= input.steer * TURN_RATE * dt;
    const move = (input.throttle - input.brake) * speed * dt;
    this.x += Math.sin(this.heading) * move;
    this.z += Math.cos(this.heading) * move;
    this.y += input.lift * (CLIMB_RATE + altitude * 0.5) * dt;
    this.y = Math.max(this.y, this.groundAt(this.x, this.z) + 2);

    const tilt = TILT_LOW + (TILT_HIGH - TILT_LOW) * Math.min(1, altitude / TILT_HEIGHT);
    this.camera.position.set(this.x, this.y, this.z);
    // three.js cameras look down -z; turn round so heading 0 looks north (+z).
    this.camera.rotation.set(-tilt, this.heading + Math.PI, 0);
  }
}
