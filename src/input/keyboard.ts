import type { ButtonAction, InputSource, RawInput } from './actions';

const THROTTLE = ['KeyW', 'ArrowUp'];
const BRAKE = ['KeyS', 'ArrowDown', 'Space'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const UP = ['KeyE'];
const DOWN = ['KeyQ'];

const BUTTON_KEYS: Record<ButtonAction, readonly string[]> = {
  confirm: ['Enter', 'NumpadEnter'],
  pause: ['Escape', 'KeyP'],
  respawn: ['KeyR'],
  // Backquote as well because F3 is taken by the OS on many laptops.
  toggleDebug: ['F3', 'Backquote'],
  toggleMap: ['KeyM'],
  freeCamera: ['KeyC'],
};

const HANDLED = new Set<string>([
  ...THROTTLE,
  ...BRAKE,
  ...LEFT,
  ...RIGHT,
  ...UP,
  ...DOWN,
  ...Object.values(BUTTON_KEYS).flat(),
]);

export class KeyboardSource implements InputSource {
  private readonly down = new Set<string>();
  /** Keys pressed since the last read, so a tap shorter than a frame still counts once. */
  private readonly tapped = new Set<string>();

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  read(out: RawInput): void {
    out.throttle = this.any(THROTTLE) ? 1 : 0;
    out.brake = this.any(BRAKE) ? 1 : 0;
    out.steer = (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0);
    out.buttons.confirm = this.any(BUTTON_KEYS.confirm);
    out.buttons.pause = this.any(BUTTON_KEYS.pause);
    out.buttons.respawn = this.any(BUTTON_KEYS.respawn);
    out.buttons.toggleDebug = this.any(BUTTON_KEYS.toggleDebug);
    out.lift = (this.any(UP) ? 1 : 0) - (this.any(DOWN) ? 1 : 0);
    out.buttons.toggleMap = this.any(BUTTON_KEYS.toggleMap);
    out.buttons.freeCamera = this.any(BUTTON_KEYS.freeCamera);
    this.tapped.clear();
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.down.clear();
  }

  private any(codes: readonly string[]): boolean {
    for (const code of codes) if (this.down.has(code) || this.tapped.has(code)) return true;
    return false;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Leave browser and OS shortcuts alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!HANDLED.has(event.code)) return;
    event.preventDefault();
    this.down.add(event.code);
    this.tapped.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };

  // Keyup never arrives if focus leaves mid-press, which would leave the throttle stuck.
  private readonly onBlur = (): void => {
    this.down.clear();
    this.tapped.clear();
  };
}
