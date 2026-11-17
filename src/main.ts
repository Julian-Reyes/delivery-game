import { ChaseCamera } from './bike/chaseCamera';
import { Rider } from './bike/rider';
import { BRAND } from './brand';
import { DebugOverlay } from './core/debugOverlay';
import { createLoop } from './core/loop';
import { createRenderer } from './core/renderer';
import { GamepadSource } from './input/gamepad';
import { InputManager } from './input/inputManager';
import { KeyboardSource } from './input/keyboard';
import { Physics } from './physics/physics';
import { SPAWN } from './world/layout';
import { World } from './world/world';
import './style.css';

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

  const physics = await Physics.create();
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const world = new World(physics, anisotropy);
  const rider = new Rider(physics, SPAWN);
  world.scene.add(rider.object);
  const chase = new ChaseCamera(physics);
  view.onResize((width, height) => chase.setAspect(width / height));

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'W/S or ↑/↓ throttle and brake · A/D or ←/→ steer · R respawn · ` debug';
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
    // Console handle for poking at the game while developing, e.g. __game.rider.teleport().
    Object.assign(window, { __game: { rider, chase, world } });
  }

  let frameDt = 0;
  const loop = createLoop({
    frame(dt): void {
      frameDt = dt;
      input.poll();
      if (input.wasPressed('toggleDebug')) overlay.toggle();
      if (input.wasPressed('confirm')) startRiding();
      if (riding && input.wasPressed('respawn')) {
        rider.respawn();
        chase.snap();
      }
    },
    step(dt): void {
      if (riding) rider.step(dt, input.state);
    },
    render(alpha): void {
      rider.render(alpha);
      chase.update(frameDt, rider.pose);
      const eye = chase.camera.position;
      world.update(eye.x, eye.y, eye.z, rider.pose.x, rider.pose.y, rider.pose.z);
      renderer.render(world.scene, chase.camera);
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
