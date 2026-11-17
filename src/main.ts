import { BikeAudio } from './audio/bikeAudio';
import { CAMERA_VIEWS, ChaseCamera } from './bike/chaseCamera';
import type { CameraView } from './bike/chaseCamera';
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
import { Traffic } from './traffic/traffic';
import { TrafficView } from './traffic/trafficView';
import { DebugMap } from './ui/debugMap';
import { Minimap } from './ui/minimap';
import { SettingsMenu } from './ui/settingsMenu';
import { planBuildings } from './world/buildings';
import { HALF, SPAWN, surfaceAt } from './world/layout';
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

const VIEW_KEY = 'moto-entrega.cameraView';

/** The camera view the player picked last time; storage can be missing or blocked. */
function savedView(): CameraView {
  try {
    const value = window.localStorage.getItem(VIEW_KEY);
    return CAMERA_VIEWS.find((view) => view === value) ?? 'far';
  } catch {
    return 'far';
  }
}

function saveView(view: CameraView): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not remembered, which is fine.
  }
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
  const traffic = new Traffic(roads, { seed, cars: 22, bikes: 30, avoid: SPAWN });
  const trafficView = new TrafficView(world.scene, physics, traffic);
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
  const minimap = new Minimap(app, {
    roads,
    heightAt: (x, z) => terrain.heightAt(x, z),
    bounds: WORLD,
    houses: favela.houses,
    buildings: planBuildings(),
    spots: favela.spots,
  });

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'W/S or ↑/↓ throttle and brake (hold S when stopped to back up) · A/D or ←/→ steer · R respawn · Esc settings · M map · ` debug' +
    (free ? ' · C free camera (Q/E height)' : '');
  hint.hidden = true;

  const titleCard = buildTitleCard();
  app.append(titleCard, hint);

  const audio = new BikeAudio();
  let riding = false;
  const startRiding = (): void => {
    if (riding) return;
    riding = true;
    // Starting to ride is the user gesture browsers require before any sound.
    audio.start();
    minimap.show(true);
    titleCard.remove();
    hint.hidden = false;
  };
  titleCard.addEventListener('pointerdown', startRiding);

  const applyView = (view: CameraView): void => {
    chase.setView(view);
    rider.setFirstPerson(view === 'first');
  };
  applyView(savedView());
  const settings = new SettingsMenu(
    app,
    chase.currentView,
    (view) => {
      applyView(view);
      saveView(view);
    },
    () => {
      settings.close();
      audio.setPaused(false);
    },
  );
  // Menu navigation from the riding controls, one step per press.
  let previousAxes = { throttle: 0, brake: 0, steer: 0 };

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
      __game: { rider, chase, free, world, roads, terrain, favela, autopilot, audio, traffic },
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
      if (input.wasPressed('confirm') && !riding) startRiding();
      if (riding && input.wasPressed('pause')) {
        if (settings.isOpen) settings.close();
        else settings.open();
        audio.setPaused(settings.isOpen);
      }
      const axes = input.state;
      if (settings.isOpen) {
        settings.handle({
          up: axes.throttle > 0.5 && previousAxes.throttle <= 0.5,
          down: axes.brake > 0.5 && previousAxes.brake <= 0.5,
          left: axes.steer < -0.5 && previousAxes.steer >= -0.5,
          right: axes.steer > 0.5 && previousAxes.steer <= 0.5,
          confirm: input.wasPressed('confirm'),
        });
      }
      previousAxes = { throttle: axes.throttle, brake: axes.brake, steer: axes.steer };
      if (riding && !settings.isOpen && input.wasPressed('respawn')) {
        rider.respawn();
        chase.snap();
      }
    },
    step(dt): void {
      if (settings.isOpen) return;
      // Traffic first, so the rider collides with where the cars are this step.
      traffic.step(dt, rider.pose);
      trafficView.syncColliders();
      physics.refresh();
      if (riding && !flying) rider.step(dt, input.state);
    },
    render(alpha): void {
      rider.render(alpha);
      trafficView.render(alpha);
      world.animate(frameDt);
      chase.update(frameDt, rider.pose, rider.eye);
      const camera = free && flying ? free.camera : chase.camera;
      const eye = camera.position;
      world.update(eye.x, eye.y, eye.z, rider.pose.x, rider.pose.y, rider.pose.z);
      renderer.render(world.scene, camera);
      map.update(rider.pose.x, rider.pose.z, rider.pose.heading);
      minimap.update(
        rider.pose.x,
        rider.pose.z,
        rider.pose.heading,
        rider.telemetry.speed,
        frameDt,
      );
      const { x, z } = rider.pose;
      const cobbles = Math.abs(x) < HALF && Math.abs(z) < HALF && surfaceAt(x, z) === 'cobble';
      audio.update(frameDt, rider.telemetry, rider.engine, cobbles, rider.takeLanding());
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
