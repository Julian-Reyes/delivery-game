import { BRAND } from './brand';
import { DebugOverlay } from './core/debugOverlay';
import { createLoop } from './core/loop';
import { createRenderer } from './core/renderer';
import { GamepadSource } from './input/gamepad';
import { InputManager } from './input/inputManager';
import { KeyboardSource } from './input/keyboard';
import { Sandbox } from './sandbox';
import './style.css';

function buildTitleCard(): HTMLElement {
  // Placeholder title card. The real title screen arrives with the delivery loop (step 6).
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

function boot(): void {
  document.title = BRAND.gameName;

  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root element');

  const view = createRenderer(app);
  const renderer = view.renderer;
  const overlay = new DebugOverlay(app, renderer);

  const input = new InputManager();
  input.addSource(new KeyboardSource());
  input.addSource(new GamepadSource());

  const sandbox = new Sandbox();
  view.onResize((width, height) => sandbox.setAspect(width / height));

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'W/S or ↑/↓ throttle and brake · A/D or ←/→ steer · ` or F3 debug';
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

  const loop = createLoop({
    frame(): void {
      input.poll();
      if (input.wasPressed('toggleDebug')) overlay.toggle();
      if (input.wasPressed('confirm')) startRiding();
    },
    step(dt): void {
      if (riding) sandbox.step(dt, input.state);
    },
    render(alpha): void {
      sandbox.render(alpha);
      renderer.render(sandbox.scene, sandbox.camera);
    },
    stats(frameMs, cpuMs): void {
      overlay.record(frameMs, cpuMs);
    },
  });
  loop.start();
}

boot();
