import type { WebGLRenderer } from 'three';

const REFRESH_MS = 250;
/** Main-thread budget per frame that leaves room for a 4x slower CPU at 60 FPS. */
const CPU_BUDGET_MS = 1000 / 60 / 4;
const DRAW_CALL_BUDGET = 100;

/** Toggleable readout of FPS, CPU time, draw calls and triangles. */
export class DebugOverlay {
  private readonly element: HTMLPreElement;
  private visible = false;

  private frames = 0;
  private frameMsSum = 0;
  private cpuMsSum = 0;
  private cpuMsMax = 0;
  private windowStart = performance.now();

  constructor(
    container: HTMLElement,
    private readonly renderer: WebGLRenderer,
  ) {
    this.element = document.createElement('pre');
    this.element.className = 'debug-overlay';
    this.element.hidden = true;
    container.append(this.element);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
  }

  /** Call once per rendered frame, after rendering, so renderer.info is this frame's. */
  record(frameMs: number, cpuMs: number): void {
    this.frames += 1;
    this.frameMsSum += frameMs;
    this.cpuMsSum += cpuMs;
    this.cpuMsMax = Math.max(this.cpuMsMax, cpuMs);

    const now = performance.now();
    const windowMs = now - this.windowStart;
    if (windowMs < REFRESH_MS) return;

    if (this.visible) {
      const fps = (this.frames * 1000) / windowMs;
      const frameMs_ = this.frameMsSum / this.frames;
      const cpuAvg = this.cpuMsSum / this.frames;
      const { calls, triangles } = this.renderer.info.render;
      const size = this.renderer.domElement;
      const flag = (over: boolean): string => (over ? '  OVER' : '');

      this.element.textContent = [
        `FPS    ${fps.toFixed(0)}  (${frameMs_.toFixed(1)} ms)`,
        `CPU    ${cpuAvg.toFixed(2)} avg  ${this.cpuMsMax.toFixed(2)} max ms` +
          `  / ${CPU_BUDGET_MS.toFixed(1)}${flag(cpuAvg > CPU_BUDGET_MS)}`,
        `Draws  ${calls} / ${DRAW_CALL_BUDGET}${flag(calls > DRAW_CALL_BUDGET)}`,
        `Tris   ${triangles.toLocaleString('en-US')}`,
        `Size   ${size.width}x${size.height} @${this.renderer.getPixelRatio().toFixed(2)}x`,
      ].join('\n');
    }

    this.frames = 0;
    this.frameMsSum = 0;
    this.cpuMsSum = 0;
    this.cpuMsMax = 0;
    this.windowStart = now;
  }
}
