import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Thin wrapper around Rapier. We use it only for collision shapes and queries (raycasts,
 * sliding against walls); the bike's motion is our own code. See DESIGN.md.
 */

// Collision group bits.
const GROUND = 0x0001;
const SOLID = 0x0002;
const RIDER = 0x0004;

function groups(memberships: number, filter: number): number {
  return ((memberships << 16) | filter) >>> 0;
}

const QUERY_GROUND = groups(0xffff, GROUND);
const QUERY_SOLID = groups(0xffff, SOLID);
const QUERY_WORLD = groups(0xffff, GROUND | SOLID);

const RIDER_RADIUS = 0.45;
/** Height of the rider's collision ball above the ground contact point. */
const RIDER_CENTER = 0.95;

export interface GroundHit {
  y: number;
  /** Surface normal. */
  nx: number;
  ny: number;
  nz: number;
}

export class Physics {
  private readonly world: RAPIER.World;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly rider: RAPIER.Collider;
  private readonly scratch = { x: 0, y: 0, z: 0 };

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });

    this.controller = this.world.createCharacterController(0.03);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.disableAutostep();
    this.controller.disableSnapToGround();

    this.rider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(RIDER_RADIUS).setCollisionGroups(groups(RIDER, 0)),
    );
  }

  /** Rapier is WebAssembly and has to be initialized before anything else touches it. */
  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  /** Static triangle mesh that can be ridden on (terrain, ramps, speed bumps). */
  addGroundMesh(positions: Float32Array, indices: Uint32Array): void {
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(positions, indices).setCollisionGroups(groups(GROUND, 0xffff)),
    );
  }

  /** Static box obstacle (building, parked car, map boundary), rotated about the vertical. */
  addSolidBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0): void {
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setCollisionGroups(groups(SOLID, 0xffff)),
    );
  }

  /** Call once after adding static colliders so queries can see them. */
  commit(): void {
    this.world.step();
  }

  /**
   * Find the ground under a point, looking down from `fromY`. Returns false if there is
   * nothing within `maxDrop`.
   */
  groundAt(x: number, fromY: number, z: number, maxDrop: number, out: GroundHit): boolean {
    const { ray } = this;
    ray.origin.x = x;
    ray.origin.y = fromY;
    ray.origin.z = z;
    ray.dir.x = 0;
    ray.dir.y = -1;
    ray.dir.z = 0;
    const hit = this.world.castRayAndGetNormal(ray, maxDrop, false, undefined, QUERY_GROUND);
    if (!hit) return false;
    out.y = fromY - hit.timeOfImpact;
    out.nx = hit.normal.x;
    out.ny = hit.normal.y;
    out.nz = hit.normal.z;
    // Triangle meshes are two-sided to rays; make the normal always point up.
    if (out.ny < 0) {
      out.nx = -out.nx;
      out.ny = -out.ny;
      out.nz = -out.nz;
    }
    return true;
  }

  /**
   * Move the rider horizontally from a ground contact point, sliding along any walls.
   * Writes the movement that was actually possible into `out` and returns true if
   * something was hit.
   */
  slideRider(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    out: { x: number; z: number },
  ): boolean {
    this.scratch.x = x;
    this.scratch.y = y + RIDER_CENTER;
    this.scratch.z = z;
    this.rider.setTranslation(this.scratch);

    this.scratch.x = dx;
    this.scratch.y = 0;
    this.scratch.z = dz;
    this.controller.computeColliderMovement(this.rider, this.scratch, undefined, QUERY_SOLID);
    const moved = this.controller.computedMovement();
    out.x = moved.x;
    out.z = moved.z;
    return this.controller.numComputedCollisions() > 0;
  }

  /**
   * Distance along a ray to the first obstacle or ground, or `maxDistance` if clear.
   * The direction must be normalized. Used to stop the camera going through walls.
   */
  rayDistance(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDistance: number,
  ): number {
    const { ray } = this;
    ray.origin.x = ox;
    ray.origin.y = oy;
    ray.origin.z = oz;
    ray.dir.x = dx;
    ray.dir.y = dy;
    ray.dir.z = dz;
    const hit = this.world.castRay(ray, maxDistance, true, undefined, QUERY_WORLD);
    return hit ? hit.timeOfImpact : maxDistance;
  }
}
