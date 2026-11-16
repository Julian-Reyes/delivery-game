import { BUTTONS, createRawInput, mergeInto, resetRawInput } from './actions';
import type { ButtonAction, InputSource, RawInput } from './actions';

/**
 * Combines every input source into one state. Call `poll()` once per rendered frame.
 *
 * Axes (`state.throttle` etc.) can be read from the fixed-step simulation. Button presses
 * (`wasPressed`) are per-frame edges, so handle them in the per-frame callback: a frame
 * can run zero fixed steps and a press read only there would be missed.
 */
export class InputManager {
  readonly state: RawInput = createRawInput();

  private readonly sources: InputSource[] = [];
  private readonly scratch: RawInput = createRawInput();
  private readonly previous: Record<ButtonAction, boolean> = createRawInput().buttons;
  private readonly pressed: Record<ButtonAction, boolean> = createRawInput().buttons;

  addSource(source: InputSource): void {
    this.sources.push(source);
  }

  poll(): void {
    for (const button of BUTTONS) this.previous[button] = this.state.buttons[button];

    resetRawInput(this.state);
    for (const source of this.sources) {
      resetRawInput(this.scratch);
      source.read(this.scratch);
      mergeInto(this.state, this.scratch);
    }

    for (const button of BUTTONS) {
      this.pressed[button] = this.state.buttons[button] && !this.previous[button];
    }
  }

  /** True only on the frame the button went down. */
  wasPressed(button: ButtonAction): boolean {
    return this.pressed[button];
  }

  dispose(): void {
    for (const source of this.sources) source.dispose();
    this.sources.length = 0;
  }
}
