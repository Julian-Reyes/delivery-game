import { CAMERA_VIEWS } from '../bike/chaseCamera';
import type { CameraView } from '../bike/chaseCamera';

/**
 * The pause menu, opened with Esc (the pause action): the game stops underneath it and
 * the player can pick the camera view, then resume. Mouse and touch click its buttons;
 * keyboard and gamepad drive it through the game's input actions, passed in as simple
 * menu commands by the caller.
 */

const TEXT = {
  title: 'Paused',
  camera: 'Camera view',
  views: {
    far: 'Far chase',
    near: 'Close chase',
    first: 'First person',
  } satisfies Record<CameraView, string>,
  resume: 'Resume',
  hint: 'Esc to resume',
};

export interface MenuCommands {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
}

type Row = 'view' | 'resume';

export class SettingsMenu {
  private readonly element: HTMLDivElement;
  private readonly viewButtons = new Map<CameraView, HTMLButtonElement>();
  private readonly resumeButton: HTMLButtonElement;
  private focus: Row = 'view';
  private view: CameraView;

  constructor(
    container: HTMLElement,
    initial: CameraView,
    private readonly onView: (view: CameraView) => void,
    private readonly onResume: () => void,
  ) {
    this.view = initial;
    this.element = document.createElement('div');
    this.element.className = 'settings-menu';
    this.element.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    const title = document.createElement('h2');
    title.textContent = TEXT.title;
    const label = document.createElement('p');
    label.className = 'settings-label';
    label.textContent = TEXT.camera;
    const views = document.createElement('div');
    views.className = 'settings-options';
    for (const view of CAMERA_VIEWS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = TEXT.views[view];
      button.addEventListener('click', () => {
        this.focus = 'view';
        this.choose(view);
      });
      this.viewButtons.set(view, button);
      views.append(button);
    }
    this.resumeButton = document.createElement('button');
    this.resumeButton.type = 'button';
    this.resumeButton.className = 'settings-resume';
    this.resumeButton.textContent = TEXT.resume;
    this.resumeButton.addEventListener('click', () => this.onResume());
    const hint = document.createElement('p');
    hint.className = 'settings-hint';
    hint.textContent = TEXT.hint;

    panel.append(title, label, views, this.resumeButton, hint);
    this.element.append(panel);
    container.append(this.element);
    this.render();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    this.element.hidden = false;
    this.focus = 'view';
    this.render();
  }

  close(): void {
    this.element.hidden = true;
  }

  /** Keyboard or gamepad navigation, one command per press. */
  handle(commands: MenuCommands): void {
    if (!this.isOpen) return;
    if (commands.up || commands.down) this.focus = this.focus === 'view' ? 'resume' : 'view';
    if (this.focus === 'view' && (commands.left || commands.right)) {
      const index = CAMERA_VIEWS.indexOf(this.view);
      const step = commands.right ? 1 : -1;
      const next = CAMERA_VIEWS[(index + step + CAMERA_VIEWS.length) % CAMERA_VIEWS.length];
      if (next) this.choose(next);
    }
    if (commands.confirm && this.focus === 'resume') {
      this.onResume();
      return;
    }
    this.render();
  }

  private choose(view: CameraView): void {
    this.view = view;
    this.onView(view);
    this.render();
  }

  private render(): void {
    for (const [view, button] of this.viewButtons) {
      button.classList.toggle('selected', view === this.view);
      button.classList.toggle('focused', this.focus === 'view' && view === this.view);
    }
    this.resumeButton.classList.toggle('focused', this.focus === 'resume');
  }
}
