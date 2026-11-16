import { describe, expect, it } from 'vitest';
import { applyDeadzone, createRawInput, mergeInto, resetRawInput } from './actions';

describe('mergeInto', () => {
  it('takes the strongest throttle and brake', () => {
    const target = createRawInput();
    const keyboard = createRawInput();
    const gamepad = createRawInput();
    keyboard.throttle = 1;
    gamepad.throttle = 0.4;
    gamepad.brake = 0.6;
    mergeInto(target, keyboard);
    mergeInto(target, gamepad);
    expect(target.throttle).toBe(1);
    expect(target.brake).toBe(0.6);
  });

  it('keeps the steer value with the largest magnitude, preserving sign', () => {
    const target = createRawInput();
    const a = createRawInput();
    const b = createRawInput();
    a.steer = 0.3;
    b.steer = -0.8;
    mergeInto(target, a);
    mergeInto(target, b);
    expect(target.steer).toBe(-0.8);
  });

  it('holds a button if any source holds it', () => {
    const target = createRawInput();
    const a = createRawInput();
    const b = createRawInput();
    b.buttons.confirm = true;
    mergeInto(target, a);
    mergeInto(target, b);
    expect(target.buttons.confirm).toBe(true);
    expect(target.buttons.pause).toBe(false);
  });

  it('clamps out-of-range source values', () => {
    const target = createRawInput();
    const wild = createRawInput();
    wild.throttle = 3;
    wild.brake = -2;
    wild.steer = -5;
    mergeInto(target, wild);
    expect(target.throttle).toBe(1);
    expect(target.brake).toBe(0);
    expect(target.steer).toBe(-1);
  });
});

describe('resetRawInput', () => {
  it('zeroes axes and releases buttons', () => {
    const input = createRawInput();
    input.throttle = 1;
    input.steer = -1;
    input.buttons.respawn = true;
    resetRawInput(input);
    expect(input).toEqual(createRawInput());
  });
});

describe('applyDeadzone', () => {
  it('returns 0 inside the deadzone', () => {
    expect(applyDeadzone(0.1, 0.15)).toBe(0);
    expect(applyDeadzone(-0.15, 0.15)).toBe(0);
  });

  it('rescales so the edge of the deadzone is 0 and full deflection is 1', () => {
    expect(applyDeadzone(1, 0.15)).toBeCloseTo(1);
    expect(applyDeadzone(-1, 0.15)).toBeCloseTo(-1);
    expect(applyDeadzone(0.575, 0.15)).toBeCloseTo(0.5);
  });

  it('never exceeds the -1..1 range', () => {
    expect(applyDeadzone(1.2, 0.15)).toBeCloseTo(1);
  });
});
