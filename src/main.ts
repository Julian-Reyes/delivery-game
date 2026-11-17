import { ChaseCamera } from './bike/chaseCamera';
import { Rider } from './bike/rider';
import { BRAND } from './brand';
import { DebugOverlay } from './core/debugOverlay';
import { createLoop } from './core/loop';
import { FreeCamera } from './core/freeCamera';
import { Autopilot } from './dev/autopilot';
import { createRenderer } from './core/renderer';
import { GamepadSource } from './input/gamepad';
import { InputManager } from './input/inputManager';
import { KeyboardSource } from './input/keyboard';
import { Physics } from './physics/physics';
import { DebugMap } from './ui/debugMap';
import { SPAWN } from './world/layout';
import { isRideable, nearestOnGraph, pointAlong } from './world/roads/graph';
import { DEFAULT_MAP_SEED, buildRoadNetwork } from './world/roads/network';
import { validateGraph } from './world/roads/validate';
import { planHouses } from './world/houses';
import { HILLSIDE, WORLD, buildTerrain } from './world/terrain';
import { World } from './world/world';
import './style.css';

/** `?seed=123` in the address reproduces a particular generated layout. */
function mapSeed(): number {
  const value = Number(new URLSearchParams(window.location.search).get('seed'));
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAP_SEED;
}

function buildTitleCard(): HTMLElement {
  // Placeholder title card. The real title screen arrives with the delivery loop.
  const card = document.createElement('main');
  card.className = 'title-card';

  const title = document.createElement('h1');
  title.textContent = BRAND.gameName;

  const tagline = document.createElement('p');
  tagline.className = 'tagline';
  tagline.textContent = BRAND.tagline;

  const badge = document.createElement('p');
  badge.className = 'app-badge';
  badge.textContent = `Riding for ${BRAND.appName}`;

  const prompt = document.createElement('p');
  prompt.className = 'prompt';
  prompt.textContent = 'Press Enter, Ⓐ or tap to ride';

  card.append(title, tagline, badge, prompt);
  return card;
}

async function boot(): Promise<void> {
  document.title = BRAND.gameName;

  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root element');

  const view = createRenderer(app);
  const renderer = view.renderer;
  const overlay = new DebugOverlay(app, renderer);

  const input = new InputManager();
  input.addSource(new KeyboardSource());
  input.addSource(new GamepadSource());

  const seed = mapSeed();
  const roads = buildRoadNetwork(seed);
  const roadIssues = validateGraph(roads, SPAWN.x, SPAWN.z);
  if (roadIssues.length > 0) console.warn(`Road layout (seed ${seed}):`, roadIssues);
  const terrain = buildTerrain(seed, roads);
  const favela = planHouses({
    seed,
    area: { area: 'hillside', ...HILLSIDE },
    roads,
    terrain,
    start: SPAWN,
    pickups: 4,
    dropoffs: 16,
  });

  const physics = await Physics.create();
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const world = new World(physics, anisotropy, terrain, roads, favela, seed);
  const rider = new Rider(physics, SPAWN);
  world.scene.add(rider.object);
  const chase = new ChaseCamera(physics);
  // Developer tool only: fly over the layout to inspect it.
  const free = import.meta.env.DEV ? new FreeCamera((x, z) => terrain.heightAt(x, z)) : null;
  let flying = false;
  view.onResize((width, height) => {
    chase.setAspect(width / height);
    free?.setAspect(width / height);
  });

  // Clicking the map drops the rider on the nearest road there, facing along it.
  const dropOnRoad = (x: number, z: number): void => {
    const spot = nearestOnGraph(roads, x, z, isRideable);
    if (!spot) return;
    const edge = roads.getEdge(spot.edge);
    const ahead = pointAlong(edge.points, Math.min(edge.length, spot.along + 2));
    const behind = pointAlong(edge.points, Math.max(0, spot.along - 2));
    rider.teleport(spot.x, spot.z, Math.atan2(ahead.x - behind.x, ahead.z - behind.z));
    chase.snap();
  };
  const map = new DebugMap(
    app,
    roads,
    (x, z) => terrain.heightAt(x, z),
    WORLD,
    roadIssues,
    dropOnRoad,
  );
  map.setFavela(favela.houses, favela.spots);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'W/S or ↑/↓ throttle and brake (hold S when stopped to back up) · A/D or ←/→ steer · R respawn · M map · ` debug' +
    (free ? ' · C free camera (Q/E height)' : '');
  hint.hidden = true;

  const titleCard = buildTitleCard();
  app.append(titleCard, hint);

  let riding = false;
  const startRiding = (): void => {
    if (riding) return;
    riding = true;
    titleCard.remove();
    hint.hidden = false;
  };
  titleCard.addEventListener('pointerdown', startRiding);

  if (import.meta.env.DEV) {
    // Rides routes on its own: `await __game.autopilot.ride(x, z)` returns a report.
    const autopilot = new Autopilot(
      roads,
      rider.pose,
      () => rider.speedKmh / 3.6,
      () => rider.airborne,
    );
    input.addSource(autopilot);
    // Console handle for poking at the game while developing, e.g. __game.rider.teleport().
    Object.assign(window, {
      __game: { rider, chase, free, world, roads, terrain, favela, autopilot },
    });
  }

  let frameDt = 0;
  const loop = createLoop({
    frame(dt): void {
      frameDt = dt;
      input.poll();
      if (input.wasPressed('toggleDebug')) overlay.toggle();
      if (input.wasPressed('toggleMap')) map.toggle();
      if (free && riding && input.wasPressed('freeCamera')) {
        flying = !flying;
        const pose = rider.pose;
        if (flying) free.start(pose.x, pose.y, pose.z, pose.heading);
        else chase.snap();
        world.setFog(!flying);
      }
      if (free && flying) free.update(dt, input.state);
      if (input.wasPressed('confirm')) startRiding();
      if (riding && input.wasPressed('respawn')) {
        rider.respawn();
        chase.snap();
      }
    },
    step(dt): void {
      if (riding && !flying) rider.step(dt, input.state);
    },
    render(alpha): void {
      rider.render(alpha);
      chase.update(frameDt, rider.pose);
      const camera = free && flying ? free.camera : chase.camera;
      const eye = camera.position;
      world.update(eye.x, eye.y, eye.z, rider.pose.x, rider.pose.y, rider.pose.z);
      renderer.render(world.scene, camera);
      map.update(rider.pose.x, rider.pose.z, rider.pose.heading);
    },
    stats(frameMs, cpuMs): void {
      overlay.record(frameMs, cpuMs);
    },
  });
  loop.start();
}

boot().catch((error: unknown) => {
  console.error(error);
  const message = document.createElement('p');
  message.className = 'boot-error';
  message.textContent = 'The game could not start. See the browser console for details.';
  document.body.append(message);
});
