import { PerspectiveCamera } from 'three';
import type { Physics } from '../physics/physics';
import type { Pose } from './rider';

const DISTANCE = 7.5;
const HEIGHT = 3.0;
const FOCUS_HEIGHT = 1.3;
const LOOK_AHEAD = 4;
/** Closest the camera will be pushed in when something is behind the rider. */
const MIN_DISTANCE = 1.6;
const WALL_MARGIN = 0.45;
const GROUND_CLEARANCE = 0.6;

function dampFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/**
 * Third-person camera on a spring arm. It swings round behind the rider with a little lag,
 * and a ray from the rider to the camera shortens the arm before it can pass through a
 * building or dip under a hill.
 */
export class ChaseCamera {
  readonly camera = new PerspectiveCamera(62, 1, 0.2, 2000);

  private heading = 0;
  private y = 0;
  private arm = DISTANCE;
  private initialized = false;

  constructor(private readonly physics: Physics) {}

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the resting position, e.g. after a respawn. */
  snap(): void {
    this.initialized = false;
  }

  update(dt: number, pose: Pose): void {
    if (!this.initialized) {
      this.heading = pose.heading;
      this.y = pose.y;
      this.arm = DISTANCE;
      this.initialized = true;
    }

    // Shortest way round to the rider's heading.
    const turn = Math.atan2(
      Math.sin(pose.heading - this.heading),
      Math.cos(pose.heading - this.heading),
    );
    this.heading += turn * dampFactor(5, dt);
    this.y += (pose.y - this.y) * dampFactor(9, dt);

    const focusX = pose.x;
    const focusY = this.y + FOCUS_HEIGHT;
    const focusZ = pose.z;

    // Unit vector from the focus point back to where the camera wants to be.
    const backX = -Math.sin(this.heading) * DISTANCE;
    const backY = HEIGHT - FOCUS_HEIGHT;
    const backZ = -Math.cos(this.heading) * DISTANCE;
    const length = Math.hypot(backX, backY, backZ);
    const dirX = backX / length;
    const dirY = backY / length;
    const dirZ = backZ / length;

    const clear = this.physics.rayDistance(focusX, focusY, focusZ, dirX, dirY, dirZ, length);
    const allowed = Math.max(MIN_DISTANCE, clear - WALL_MARGIN);
    // Pull in at once so the wall never shows through; ease back out.
    this.arm = allowed < this.arm ? allowed : this.arm + (allowed - this.arm) * dampFactor(3, dt);
    const arm = Math.min(this.arm, length);

    let cameraY = focusY + dirY * arm;
    const cameraX = focusX + dirX * arm;
    const cameraZ = focusZ + dirZ * arm;
    // Never let a hill crest come between the camera and the ground under it.
    const drop = this.physics.rayDistance(
      cameraX,
      cameraY + 3,
      cameraZ,
      0,
      -1,
      0,
      3 + GROUND_CLEARANCE,
    );
    if (drop < 3 + GROUND_CLEARANCE) cameraY += 3 + GROUND_CLEARANCE - drop;

    this.camera.position.set(cameraX, cameraY, cameraZ);
    this.camera.lookAt(
      pose.x + Math.sin(pose.heading) * LOOK_AHEAD,
      this.y + FOCUS_HEIGHT - 0.1,
      pose.z + Math.cos(pose.heading) * LOOK_AHEAD,
    );
  }
}
