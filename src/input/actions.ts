/**
 * The game's input vocabulary. Keyboard, gamepad and touch all produce a RawInput;
 * game code never sees device events.
 */

export const BUTTONS = ['confirm', 'pause', 'respawn', 'toggleDebug'] as const;
export type ButtonAction = (typeof BUTTONS)[number];

export interface RawInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (full left) .. +1 (full right). Steering and lean are one axis. */
  steer: number;
  /** Held state of each button this poll. */
  buttons: Record<ButtonAction, boolean>;
}

export interface InputSource {
  /** Write this device's current state into `out`, which arrives zeroed. */
  read(out: RawInput): void;
  dispose(): void;
}

export function createRawInput(): RawInput {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    buttons: { confirm: false, pause: false, respawn: false, toggleDebug: false },
  };
}

export function resetRawInput(input: RawInput): void {
  input.throttle = 0;
  input.brake = 0;
  input.steer = 0;
  for (const button of BUTTONS) input.buttons[button] = false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fold one device's input into the combined state: the strongest signal wins on each
 * axis, and a button is held if any device holds it.
 */
export function mergeInto(target: RawInput, source: RawInput): void {
  target.throttle = Math.max(target.throttle, clamp(source.throttle, 0, 1));
  target.brake = Math.max(target.brake, clamp(source.brake, 0, 1));
  const steer = clamp(source.steer, -1, 1);
  if (Math.abs(steer) > Math.abs(target.steer)) target.steer = steer;
  for (const button of BUTTONS) {
    target.buttons[button] = target.buttons[button] || source.buttons[button];
  }
}

/** Ignore stick drift inside the deadzone and rescale the rest to the full -1..1 range. */
export function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return (Math.sign(value) * (Math.min(magnitude, 1) - deadzone)) / (1 - deadzone);
}
