import { applyDeadzone } from './actions';
import type { InputSource, RawInput } from './actions';

const STICK_DEADZONE = 0.15;
const TRIGGER_DEADZONE = 0.05;

// Indices from the W3C "standard" gamepad mapping.
const BTN = {
  a: 0,
  y: 3,
  leftTrigger: 6,
  rightTrigger: 7,
  select: 8,
  start: 9,
  dpadLeft: 14,
  dpadRight: 15,
} as const;
const AXIS_LEFT_X = 0;

export class GamepadSource implements InputSource {
  read(out: RawInput): void {
    // Not available in every context (old browsers, some embedded webviews).
    if (typeof navigator.getGamepads !== 'function') return;

    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;

      const value = (index: number): number => pad.buttons[index]?.value ?? 0;
      const held = (index: number): boolean => pad.buttons[index]?.pressed ?? false;

      out.throttle = Math.max(
        out.throttle,
        applyDeadzone(value(BTN.rightTrigger), TRIGGER_DEADZONE),
      );
      out.brake = Math.max(out.brake, applyDeadzone(value(BTN.leftTrigger), TRIGGER_DEADZONE));

      let steer = applyDeadzone(pad.axes[AXIS_LEFT_X] ?? 0, STICK_DEADZONE);
      if (held(BTN.dpadLeft)) steer = -1;
      if (held(BTN.dpadRight)) steer = 1;
      if (Math.abs(steer) > Math.abs(out.steer)) out.steer = steer;

      out.buttons.confirm ||= held(BTN.a);
      out.buttons.pause ||= held(BTN.start);
      out.buttons.respawn ||= held(BTN.y);
      out.buttons.toggleDebug ||= held(BTN.select);
    }
  }

  dispose(): void {
    // Polled, so there are no listeners to remove.
  }
}
