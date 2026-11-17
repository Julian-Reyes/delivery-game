import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Physics } from '../physics/physics';
import type { Pose } from './rider';

/** The three points of view: far behind, close behind, and through the rider's eyes. */
export type CameraView = 'far' | 'near' | 'first';
export const CAMERA_VIEWS: readonly CameraView[] = ['far', 'near', 'first'];

interface ChaseSettings {
  distance: number;
  height: number;
  focusHeight: number;
  lookAhead: number;
}

const CHASE: Record<Exclude<CameraView, 'first'>, ChaseSettings> = {
  far: { distance: 7.5, height: 3.0, focusHeight: 1.3, lookAhead: 4 },
  near: { distance: 4.2, height: 2.0, focusHeight: 1.35, lookAhead: 3 },
};
/** First person sits close to the bars, so it needs a nearer near plane. */
const NEAR_PLANE = 0.2;
const FIRST_PERSON_NEAR_PLANE = 0.04;
/** A wider view from the saddle, so the mirrors and bars show at the bottom. */
const FIELD_OF_VIEW = 62;
const FIRST_PERSON_FIELD_OF_VIEW = 75;
/** Closest the camera will be pushed in when something is behind the rider. */
const MIN_DISTANCE = 1.6;
const WALL_MARGIN = 0.45;
const GROUND_CLEARANCE = 0.6;

function dampFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/**
 * The rider camera. In the two chase views it hangs on a spring arm behind the rider,
 * swinging round with a little lag, and a ray from the rider to the camera shortens the
 * arm before it can pass through a building or dip under a hill. In first person it sits
 * at the rider's eyes, turning and pitching with the bike but kept level through corners.
 */
export class ChaseCamera {
  readonly camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, NEAR_PLANE, 2000);

  private heading = 0;
  private y = 0;
  private arm = CHASE.far.distance;
  private initialized = false;
  private view: CameraView = 'far';
  private readonly eyePosition = new Vector3();
  private readonly eyeRotation = new Quaternion();
  private readonly eyeScale = new Vector3();
  private readonly lookTarget = new Vector3();

  constructor(private readonly physics: Physics) {}

  get currentView(): CameraView {
    return this.view;
  }

  setView(view: CameraView): void {
    if (view === this.view) return;
    this.view = view;
    this.camera.near = view === 'first' ? FIRST_PERSON_NEAR_PLANE : NEAR_PLANE;
    this.camera.fov = view === 'first' ? FIRST_PERSON_FIELD_OF_VIEW : FIELD_OF_VIEW;
    this.camera.updateProjectionMatrix();
    this.snap();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the resting position, e.g. after a respawn. */
  snap(): void {
    this.initialized = false;
  }

  /** Follow the rider. `eye` is the rider's eye anchor, used in first person. */
  update(dt: number, pose: Pose, eye: Object3D): void {
    if (this.view === 'first') {
      // From the rider's eyes, but with the head held level the way riders do: follow
      // where the bike points and its pitch, not its lean into the corner.
      eye.updateWorldMatrix(true, false);
      eye.matrixWorld.decompose(this.eyePosition, this.eyeRotation, this.eyeScale);
      this.lookTarget.set(0, 0, -1).applyQuaternion(this.eyeRotation).add(this.eyePosition);
      this.camera.position.copy(this.eyePosition);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.lookTarget);
      return;
    }
    const { distance, height, focusHeight, lookAhead } = CHASE[this.view];
    if (!this.initialized) {
      this.heading = pose.heading;
      this.y = pose.y;
      this.arm = distance;
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
    const focusY = this.y + focusHeight;
    const focusZ = pose.z;

    // Unit vector from the focus point back to where the camera wants to be.
    const backX = -Math.sin(this.heading) * distance;
    const backY = height - focusHeight;
    const backZ = -Math.cos(this.heading) * distance;
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
      pose.x + Math.sin(pose.heading) * lookAhead,
      this.y + focusHeight - 0.1,
      pose.z + Math.cos(pose.heading) * lookAhead,
    );
  }
}
