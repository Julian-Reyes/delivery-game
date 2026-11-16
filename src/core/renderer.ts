import { PCFShadowMap, WebGLRenderer } from 'three';

/** Render sharpness cap. Phones report 2x–3x, which costs far more than it shows. */
export const MAX_PIXEL_RATIO = 1.5;

export interface RendererHandle {
  renderer: WebGLRenderer;
  /** Calls `listener` now and whenever the drawable size changes. */
  onResize(listener: (width: number, height: number) => void): void;
  dispose(): void;
}

export function createRenderer(container: HTMLElement): RendererHandle {
  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.className = 'game-canvas';
  container.append(renderer.domElement);

  const listeners: ((width: number, height: number) => void)[] = [];

  const resize = (): void => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    // Re-read each time: the ratio changes when the window moves between displays.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    for (const listener of listeners) listener(width, height);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  return {
    renderer,
    onResize(listener): void {
      listeners.push(listener);
      listener(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    },
    dispose(): void {
      observer.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
