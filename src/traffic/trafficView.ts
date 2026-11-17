import { Color, InstancedMesh, MeshLambertMaterial, Object3D } from 'three';
import type { Scene } from 'three';
import type { MovingBox, Physics } from '../physics/physics';
import { GeoBuilder } from '../world/geo';
import type { Traffic, Vehicle, VehicleKind } from './traffic';

/**
 * Draws the traffic: one instanced mesh per vehicle shape (cars, vans, motorbikes, the
 * riders on them), each tinted per vehicle, placed every frame between the last two
 * simulation steps. Cars and vans also carry a collider so the player cannot ride
 * through them; motorbikes do not, so the narrow lanes stay passable.
 */

const CAR_PAINT = [
  0xf2f2f0, 0xc9ccd1, 0x1d1f22, 0x8e9399, 0xb3261e, 0x1f4e8c, 0xe9e2c8, 0x2e6b3a,
] as const;
const VAN_PAINT = [0xf4f4f2, 0xd9d4c4, 0x2a5fb0, 0xe0b020] as const;
const BIKE_PAINT = [0xd8d8d8, 0xc0302a, 0x1d1f22, 0x2a5fb0, 0xe0b020, 0x3a3a3c] as const;
const JACKET = [0x1fb5a8, 0xe8553b, 0x2b3a55, 0xf2c14e, 0x1d1f22, 0x7a2f8f, 0xf7f4ec] as const;
const GLASS = 0x22303a;
const TYRE = 0x161616;

function carShape(): GeoBuilder {
  const g = new GeoBuilder();
  g.box(0, 0.62, 0, 1.78, 0.62, 4.15, 0xffffff, 0.8);
  g.box(0, 1.12, -0.25, 1.58, 0.5, 2.1, GLASS);
  g.box(0, 1.39, -0.25, 1.5, 0.06, 1.95, 0xffffff);
  for (const x of [-0.82, 0.82]) {
    for (const z of [-1.3, 1.3]) g.box(x, 0.32, z, 0.24, 0.62, 0.64, TYRE);
  }
  g.box(-0.6, 0.72, 2.08, 0.32, 0.14, 0.02, 0xfff4d0);
  g.box(0.6, 0.72, 2.08, 0.32, 0.14, 0.02, 0xfff4d0);
  g.box(-0.62, 0.75, -2.08, 0.3, 0.14, 0.02, 0xd8261c);
  g.box(0.62, 0.75, -2.08, 0.3, 0.14, 0.02, 0xd8261c);
  return g;
}

function vanShape(): GeoBuilder {
  const g = new GeoBuilder();
  g.box(0, 1.08, -0.1, 1.85, 1.55, 4.4, 0xffffff, 0.8);
  g.box(0, 1.45, 1.6, 1.88, 0.45, 1.05, GLASS);
  for (const x of [-0.84, 0.84]) {
    for (const z of [-1.45, 1.45]) g.box(x, 0.33, z, 0.26, 0.66, 0.66, TYRE);
  }
  g.box(-0.62, 0.7, 2.13, 0.3, 0.14, 0.02, 0xfff4d0);
  g.box(0.62, 0.7, 2.13, 0.3, 0.14, 0.02, 0xfff4d0);
  return g;
}

function bikeShape(): GeoBuilder {
  const g = new GeoBuilder();
  g.box(0, 0.3, 0.6, 0.08, 0.6, 0.6, TYRE);
  g.box(0, 0.3, -0.6, 0.1, 0.6, 0.6, TYRE);
  g.box(0, 0.42, 0, 0.18, 0.16, 1.0, 0x2a2a2c);
  g.box(0, 0.68, -0.28, 0.28, 0.3, 0.7, 0xffffff);
  g.box(0, 0.86, -0.28, 0.26, 0.08, 0.66, 0x202022);
  g.box(0, 0.78, 0.48, 0.2, 0.5, 0.14, 0xffffff);
  g.box(0, 1.04, 0.5, 0.64, 0.04, 0.04, 0x333333);
  g.box(0, 0.95, 0.58, 0.16, 0.12, 0.06, 0xfff4d0);
  return g;
}

/** A rider sitting on the bike, hands on the bars; jacket tinted per rider. */
function riderShape(): GeoBuilder {
  const g = new GeoBuilder();
  g.box(0, 1.25, -0.2, 0.4, 0.55, 0.26, 0xffffff);
  g.box(0.22, 1.18, 0.12, 0.1, 0.1, 0.58, 0xffffff);
  g.box(-0.22, 1.18, 0.12, 0.1, 0.1, 0.58, 0xffffff);
  g.box(0.13, 0.9, 0.0, 0.14, 0.14, 0.5, 0x2b3140);
  g.box(-0.13, 0.9, 0.0, 0.14, 0.14, 0.5, 0x2b3140);
  g.box(0.16, 0.6, 0.22, 0.12, 0.5, 0.12, 0x2b3140);
  g.box(-0.16, 0.6, 0.22, 0.12, 0.5, 0.12, 0x2b3140);
  g.blob(0, 1.66, -0.16, 0.16, 0.17, 0.18, 0xffffff);
  g.box(0, 1.64, -0.03, 0.22, 0.09, 0.06, 0x1a2630);
  return g;
}

function instanced(shape: GeoBuilder, count: number): InstancedMesh {
  const mesh = new InstancedMesh(
    shape.build(),
    new MeshLambertMaterial({ vertexColors: true }),
    Math.max(1, count),
  );
  // They roam the whole map; culling the merged set would hide them all at once.
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  return mesh;
}

const COLLIDER: Record<
  Exclude<VehicleKind, 'bike'>,
  { hx: number; hy: number; hz: number; y: number }
> = {
  car: { hx: 0.9, hy: 0.7, hz: 2.1, y: 0.75 },
  van: { hx: 0.93, hy: 0.9, hz: 2.2, y: 0.95 },
};

export class TrafficView {
  private readonly meshes: Record<VehicleKind, InstancedMesh>;
  private readonly riders: InstancedMesh;
  private readonly slots = new Map<Vehicle, number>();
  private readonly colliders = new Map<Vehicle, MovingBox>();
  private readonly dummy = new Object3D();

  constructor(
    scene: Scene,
    physics: Physics,
    private readonly traffic: Traffic,
  ) {
    const count = (kind: VehicleKind): number =>
      traffic.vehicles.filter((v) => v.kind === kind).length;
    this.meshes = {
      car: instanced(carShape(), count('car')),
      van: instanced(vanShape(), count('van')),
      bike: instanced(bikeShape(), count('bike')),
    };
    this.riders = instanced(riderShape(), count('bike'));
    scene.add(this.meshes.car, this.meshes.van, this.meshes.bike, this.riders);
    this.dummy.rotation.order = 'YXZ';

    const next: Record<VehicleKind, number> = { car: 0, van: 0, bike: 0 };
    const tint = new Color();
    const pickPaint = (palette: readonly number[], paint: number): number =>
      palette[Math.floor(paint * palette.length) % palette.length] ?? 0xffffff;
    for (const vehicle of traffic.vehicles) {
      const slot = next[vehicle.kind]++;
      this.slots.set(vehicle, slot);
      const palette =
        vehicle.kind === 'car' ? CAR_PAINT : vehicle.kind === 'van' ? VAN_PAINT : BIKE_PAINT;
      this.meshes[vehicle.kind].setColorAt(slot, tint.setHex(pickPaint(palette, vehicle.paint)));
      if (vehicle.kind === 'bike') {
        this.riders.setColorAt(slot, tint.setHex(pickPaint(JACKET, (vehicle.paint * 7.3) % 1)));
      } else {
        const size = COLLIDER[vehicle.kind];
        this.colliders.set(vehicle, physics.addMovingBox(size.hx, size.hy, size.hz));
      }
    }
    for (const mesh of [...Object.values(this.meshes), this.riders]) {
      mesh.count = 0;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.meshes.car.count = next.car;
    this.meshes.van.count = next.van;
    this.meshes.bike.count = next.bike;
    this.riders.count = next.bike;
    this.syncColliders();
  }

  /** Move the cars' colliders to where the last simulation step put them. */
  syncColliders(): void {
    for (const [vehicle, box] of this.colliders) {
      const size = COLLIDER[vehicle.kind === 'van' ? 'van' : 'car'];
      box.place(vehicle.x, vehicle.y + size.y, vehicle.z, vehicle.heading);
    }
  }

  /** Place every vehicle between the last two steps. Call once per rendered frame. */
  render(alpha: number): void {
    const d = this.dummy;
    for (const vehicle of this.traffic.vehicles) {
      const slot = this.slots.get(vehicle);
      if (slot === undefined) continue;
      const turn = Math.atan2(
        Math.sin(vehicle.heading - vehicle.prevHeading),
        Math.cos(vehicle.heading - vehicle.prevHeading),
      );
      d.position.set(
        vehicle.prevX + (vehicle.x - vehicle.prevX) * alpha,
        vehicle.prevY + (vehicle.y - vehicle.prevY) * alpha,
        vehicle.prevZ + (vehicle.z - vehicle.prevZ) * alpha,
      );
      const lean = vehicle.prevLean + (vehicle.lean - vehicle.prevLean) * alpha;
      d.rotation.set(0, vehicle.prevHeading + turn * alpha, lean);
      d.updateMatrix();
      this.meshes[vehicle.kind].setMatrixAt(slot, d.matrix);
      if (vehicle.kind === 'bike') this.riders.setMatrixAt(slot, d.matrix);
    }
    for (const mesh of [...Object.values(this.meshes), this.riders])
      mesh.instanceMatrix.needsUpdate = true;
  }
}
