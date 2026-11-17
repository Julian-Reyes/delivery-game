import {
  BackSide,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
} from 'three';
import type { Physics } from '../physics/physics';
import { addBuilding, planBuildings } from './buildings';
import type { BuildingSpec } from './buildings';
import { createRandom, GeoBuilder } from './geo';
import { buildGround, buildMarkings } from './ground';
import { CELL, CELLS, HALF, SEA_LEVEL } from './layout';
import type { Surface } from './layout';
import {
  addBackdrop,
  addBarTables,
  addBeach,
  addBunting,
  addParkedCars,
  addPolesAndWires,
  addRamps,
  addSpeedBumps,
  addVegetation,
} from './props';
import type { SolidBox } from './props';
import { createGroundTextures, createSignAtlas } from './textures';

const SKY_TOP = 0x3f8fdc;
const SKY_HORIZON = 0xf4dcc0;
const SEA = 0x2aa3b3;

/** Where the sun sits relative to whatever it is lighting. Late afternoon, from the sea. */
const SUN_OFFSET = { x: -20, y: 24, z: -12 } as const;
const SHADOW_RANGE = 9;
/** How dark the ground gets in a building's baked shadow. */
const SHADE = 0.6;

/**
 * Which grid cells sit in a building's shadow, worked out once at startup. Real-time
 * shadows for the whole city are far outside the phone budget; this gets most of the look
 * for free.
 */
function bakeShade(buildings: readonly BuildingSpec[]): (ix: number, iz: number) => number {
  const heights = new Float32Array(CELLS * CELLS);
  for (const b of buildings) {
    const sin = Math.sin(b.yaw);
    const cos = Math.cos(b.yaw);
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [lx, lz] of [
      [-b.width / 2, 0],
      [b.width / 2, 0],
      [-b.width / 2, -b.depth],
      [b.width / 2, -b.depth],
    ] as const) {
      const x = b.x + lx * cos + lz * sin;
      const z = b.z - lx * sin + lz * cos;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const ix0 = Math.max(0, Math.floor((x0 + HALF) / CELL + 0.5));
    const ix1 = Math.min(CELLS - 1, Math.ceil((x1 + HALF) / CELL - 0.5) - 1);
    const iz0 = Math.max(0, Math.floor((z0 + HALF) / CELL + 0.5));
    const iz1 = Math.min(CELLS - 1, Math.ceil((z1 + HALF) / CELL - 0.5) - 1);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const index = iz * CELLS + ix;
        heights[index] = Math.max(heights[index] ?? 0, b.height);
      }
    }
  }

  const horizontal = Math.hypot(SUN_OFFSET.x, SUN_OFFSET.z);
  const towardSunX = SUN_OFFSET.x / horizontal;
  const towardSunZ = SUN_OFFSET.z / horizontal;
  // Height a wall needs, per cell of distance, to still shade the ground.
  const risePerCell = (SUN_OFFSET.y / horizontal) * CELL;

  return (ix, iz) => {
    for (let k = 1; k <= 8; k++) {
      const sx = ix + Math.round(towardSunX * k);
      const sz = iz + Math.round(towardSunZ * k);
      if (sx < 0 || sz < 0 || sx >= CELLS || sz >= CELLS) break;
      if ((heights[sz * CELLS + sx] ?? 0) >= risePerCell * k) return SHADE;
    }
    return 1;
  };
}

function createSky(): Mesh {
  const geometry = new SphereGeometry(900, 24, 12);
  const position = geometry.getAttribute('position');
  const colors: number[] = [];
  const top = new Color(SKY_TOP);
  const horizon = new Color(SKY_HORIZON);
  const mixed = new Color();
  for (let i = 0; i < position.count; i++) {
    // Haze hugs the horizon; the blue takes over quickly above it.
    const t = Math.min(1, Math.max(0, position.getY(i) / 900));
    mixed.copy(horizon).lerp(top, Math.pow(t, 0.55));
    colors.push(mixed.r, mixed.g, mixed.b);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const sky = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

/**
 * The whole neighborhood: builds every mesh, registers every collider, and owns the
 * lighting. Everything static is merged so the city costs a handful of draw calls.
 */
export class World {
  readonly scene = new Scene();

  private readonly sun = new DirectionalLight(0xfff1dc, 2.4);
  private readonly sky = createSky();

  constructor(physics: Physics, anisotropy: number) {
    const random = createRandom(2024);
    const { scene } = this;

    scene.fog = new Fog(SKY_HORIZON, 70, 520);
    scene.add(this.sky);
    scene.add(new HemisphereLight(0xcfe6ff, 0x8a7a66, 1.5));

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -SHADOW_RANGE;
    shadowCamera.right = SHADOW_RANGE;
    shadowCamera.top = SHADOW_RANGE;
    shadowCamera.bottom = -SHADOW_RANGE;
    shadowCamera.near = 1;
    shadowCamera.far = 90;
    this.sun.shadow.bias = -0.0005;
    scene.add(this.sun, this.sun.target);

    // Vertex-colored geometry, grouped by what it needs from the renderer.
    const city = new GeoBuilder();
    const extras = new GeoBuilder();
    const signs = new GeoBuilder(true);
    const wires: number[] = [];
    const solids: SolidBox[] = [];

    const buildings = planBuildings();
    for (const building of buildings) addBuilding(city, signs, building);

    city.resetFrame();
    const ground = buildGround(city, bakeShade(buildings));
    addSpeedBumps(extras);
    addRamps(extras);
    addPolesAndWires(city, wires, random);
    addBunting(city, wires);
    addVegetation(city, random);
    addParkedCars(city, solids, random);
    addBarTables(city, random);
    addBeach(city, solids, random);
    addBackdrop(city, solids, random);

    // Ground: one mesh per surface texture.
    const textures = createGroundTextures(anisotropy);
    for (const surface of Object.keys(ground.surfaces) as Surface[]) {
      const builder = ground.surfaces[surface];
      if (builder.triangleCount === 0) continue;
      const mesh = new Mesh(
        builder.build(),
        new MeshLambertMaterial({ map: textures[surface], vertexColors: true }),
      );
      mesh.receiveShadow = true;
      scene.add(mesh);
    }

    const paint = new MeshLambertMaterial({ vertexColors: true });
    scene.add(new Mesh(city.build(), paint));

    const extrasMesh = new Mesh(extras.build(), paint);
    extrasMesh.receiveShadow = true;
    scene.add(extrasMesh);

    const markings = new Mesh(
      buildMarkings().build(),
      new MeshLambertMaterial({
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    markings.receiveShadow = true;
    scene.add(markings);

    scene.add(
      new Mesh(
        signs.build(),
        new MeshLambertMaterial({ map: createSignAtlas(anisotropy), vertexColors: true }),
      ),
    );

    const wireGeometry = new BufferGeometry();
    wireGeometry.setAttribute('position', new Float32BufferAttribute(wires, 3));
    scene.add(new LineSegments(wireGeometry, new LineBasicMaterial({ color: 0x1b1b1d })));

    const sea = new Mesh(new PlaneGeometry(4000, 4000), new MeshLambertMaterial({ color: SEA }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = SEA_LEVEL;
    scene.add(sea);

    // Physics.
    physics.addGroundMesh(ground.colliderPositions, ground.colliderIndices);
    physics.addGroundMesh(new Float32Array(extras.positions), new Uint32Array(extras.indices));
    for (const b of buildings) {
      const centerY = (b.floorY + b.height + b.baseY) / 2;
      physics.addSolidBox(
        b.x - Math.sin(b.yaw) * (b.depth / 2),
        centerY,
        b.z - Math.cos(b.yaw) * (b.depth / 2),
        b.width / 2,
        (b.floorY + b.height - b.baseY) / 2,
        b.depth / 2,
        b.yaw,
      );
    }
    for (const s of solids) physics.addSolidBox(s.x, s.y, s.z, s.hx, s.hy, s.hz, s.yaw);
    physics.commit();
  }

  /**
   * Keep the sky centred on the camera and the single shadow-casting light (with its small
   * shadow area) on the rider.
   */
  update(cameraX: number, cameraY: number, cameraZ: number, x: number, y: number, z: number) {
    this.sky.position.set(cameraX, cameraY - 40, cameraZ);
    this.sun.position.set(x + SUN_OFFSET.x, y + SUN_OFFSET.y, z + SUN_OFFSET.z);
    this.sun.target.position.set(x, y, z);
  }
}
