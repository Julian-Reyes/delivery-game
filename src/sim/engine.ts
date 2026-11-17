import { ENGINE } from './tuning';

/**
 * The bike's engine and gearbox as plain numbers: revs from road speed and gear, a
 * slipping clutch to pull away, automatic shifts the way a rider would make them, a short
 * throttle cut while shifting, and free revving with the wheel off the ground. The sound
 * is driven from this; nothing here knows about audio.
 */

export interface EngineState {
  rpm: number;
  /** 1..ENGINE.gears. */
  gear: number;
  /** 0..1, how hard the engine is working (smoothed throttle, cut during a shift). */
  load: number;
  /** Seconds left of the throttle cut while a shift happens. */
  shifting: number;
}

export interface EngineInput {
  /** Road speed in m/s; negative while the rider paddles backwards. */
  speed: number;
  throttle: number;
  grounded: boolean;
}

export function createEngine(): EngineState {
  return { rpm: ENGINE.idleRpm, gear: 1, load: 0, shifting: 0 };
}

/** Road speed per rpm in a gear. */
function speedPerRpm(gear: number): number {
  const ratio = ENGINE.ratios[gear - 1] ?? 1;
  return (ENGINE.topSpeed / ENGINE.topGearRpm) * ratio;
}

/** Revs the wheel would turn the engine at, in a gear. */
export function wheelRpm(speed: number, gear: number): number {
  return Math.abs(speed) / speedPerRpm(gear);
}

function approach(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * Math.min(1, rate * dt);
}

/** Advance the engine one simulation step. Mutates and returns `state`. */
export function stepEngine(state: EngineState, input: EngineInput, dt: number): EngineState {
  const throttle = Math.max(0, Math.min(1, input.throttle));
  state.shifting = Math.max(0, state.shifting - dt);

  // Shift the way a rider does: up near the top when pulling, a little earlier when
  // cruising; down when the revs sag, sooner when slowing down.
  if (input.grounded && state.shifting === 0) {
    const revs = wheelRpm(input.speed, state.gear);
    const upAt = throttle > 0.5 ? ENGINE.shiftUpRpm : ENGINE.cruiseShiftRpm;
    // Nobody changes up with the throttle shut; they coast in the gear they are in.
    if (state.gear < ENGINE.gears && revs > upAt && throttle > ENGINE.shiftThrottle) {
      state.gear += 1;
      state.shifting = ENGINE.shiftTime;
    } else if (state.gear > 1 && revs < ENGINE.shiftDownRpm) {
      state.gear -= 1;
      state.shifting = ENGINE.shiftTime * 0.7;
    }
  }

  // What the revs want to be: tied to the wheel when the clutch is in, free otherwise.
  const free = ENGINE.idleRpm + throttle * (ENGINE.redlineRpm - ENGINE.idleRpm);
  let target: number;
  if (!input.grounded) {
    target = free;
  } else if (input.speed <= 0) {
    // Standing or being paddled backwards: clutch out, the engine just idles or revs.
    target = ENGINE.idleRpm + throttle * ENGINE.clutchRevs;
  } else {
    const tied = wheelRpm(input.speed, state.gear);
    // Pulling away the clutch slips, holding the revs up until the wheel catches them.
    const slipping = state.gear === 1 && tied < ENGINE.clutchRpm;
    target = slipping ? Math.max(tied, ENGINE.idleRpm + throttle * ENGINE.clutchRevs) : tied;
    target = Math.max(target, ENGINE.idleRpm);
  }
  if (state.shifting > 0) target = Math.max(ENGINE.idleRpm, target * 0.97);
  state.rpm = approach(state.rpm, Math.min(ENGINE.redlineRpm, target), ENGINE.revRate, dt);

  const wantedLoad = state.shifting > 0 ? 0 : throttle;
  state.load = approach(state.load, wantedLoad, ENGINE.loadRate, dt);
  return state;
}
