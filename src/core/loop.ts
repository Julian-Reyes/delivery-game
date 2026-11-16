/** Fixed simulation step, in seconds. All gameplay runs at this rate. */
export const STEP = 1 / 60;

const MAX_FPS = 60;
// rAF timestamps jitter around the display interval; without slack a 60 Hz screen would
// randomly skip frames.
const FRAME_SLACK_MS = 1.5;
const FRAME_MS = 1000 / MAX_FPS;
// After a long stall, simulate at most this much time rather than spiralling.
const MAX_FRAME_DT = 0.1;

export interface LoopCallbacks {
  /** Once per rendered frame, before any fixed steps. `dt` is real elapsed seconds. */
  frame(dt: number): void;
  /** Zero or more times per frame, always with `dt === STEP`. */
  step(dt: number): void;
  /** Once per rendered frame. `alpha` (0..1) is how far we are into the next step. */
  render(alpha: number): void;
  /** Timing for the debug overlay: time between frames and main-thread time spent. */
  stats?(frameMs: number, cpuMs: number): void;
}

export interface Loop {
  start(): void;
  stop(): void;
}

/**
 * requestAnimationFrame loop with a fixed-step accumulator, a 60 FPS cap for high refresh
 * displays, and a full stop while the tab is hidden.
 */
export function createLoop(callbacks: LoopCallbacks): Loop {
  let rafId = 0;
  let running = false;
  let last = 0;
  let nextDue = 0;
  let accumulator = 0;

  const tick = (now: number): void => {
    rafId = requestAnimationFrame(tick);

    // Frames are due on a 60 Hz schedule rather than "at least 16 ms after the last one".
    // That keeps the average at 60 on displays that are not a multiple of 60 (75, 90 Hz),
    // where a simple minimum gap would drop to half the refresh rate.
    if (now < nextDue - FRAME_SLACK_MS) return;
    nextDue += FRAME_MS;
    if (nextDue < now) nextDue = now + FRAME_MS;

    const elapsedMs = now - last;
    last = now;

    const cpuStart = performance.now();
    const dt = Math.min(elapsedMs / 1000, MAX_FRAME_DT);

    callbacks.frame(dt);

    accumulator += dt;
    while (accumulator >= STEP) {
      callbacks.step(STEP);
      accumulator -= STEP;
    }

    callbacks.render(accumulator / STEP);
    callbacks.stats?.(elapsedMs, performance.now() - cpuStart);
  };

  const resume = (): void => {
    if (!running || rafId !== 0 || document.hidden) return;
    last = performance.now();
    nextDue = last;
    rafId = requestAnimationFrame(tick);
  };

  const suspend = (): void => {
    if (rafId !== 0) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const onVisibilityChange = (): void => {
    if (document.hidden) suspend();
    else resume();
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      document.addEventListener('visibilitychange', onVisibilityChange);
      resume();
    },
    stop(): void {
      running = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      suspend();
    },
  };
}
