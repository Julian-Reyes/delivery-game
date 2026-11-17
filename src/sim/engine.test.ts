import { describe, expect, it } from 'vitest';
import { createEngine, stepEngine, wheelRpm } from './engine';
import type { EngineState } from './engine';
import { ENGINE } from './tuning';

const DT = 1 / 60;

function run(
  engine: EngineState,
  seconds: number,
  input: (t: number) => { speed: number; throttle: number; grounded?: boolean },
): void {
  for (let t = 0; t < seconds; t += DT) {
    const i = input(t);
    stepEngine(engine, { speed: i.speed, throttle: i.throttle, grounded: i.grounded ?? true }, DT);
  }
}

describe('engine', () => {
  it('idles when standing still', () => {
    const engine = createEngine();
    run(engine, 2, () => ({ speed: 0, throttle: 0 }));
    expect(engine.rpm).toBeCloseTo(ENGINE.idleRpm, -1);
    expect(engine.gear).toBe(1);
    expect(engine.load).toBeLessThan(0.01);
  });

  it('revs up on the clutch when you open the throttle standing still', () => {
    const engine = createEngine();
    run(engine, 1, () => ({ speed: 0, throttle: 1 }));
    expect(engine.rpm).toBeGreaterThan(ENGINE.idleRpm + ENGINE.clutchRevs * 0.9);
    expect(engine.load).toBeGreaterThan(0.95);
  });

  it('shifts up through every gear accelerating to top speed, never past the redline', () => {
    const engine = createEngine();
    const gears = new Set<number>();
    let maxRpm = 0;
    run(engine, 12, (t) => {
      gears.add(engine.gear);
      maxRpm = Math.max(maxRpm, engine.rpm);
      return { speed: Math.min(ENGINE.topSpeed, t * 3), throttle: 1 };
    });
    expect([...gears].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(maxRpm).toBeLessThanOrEqual(ENGINE.redlineRpm);
    expect(engine.gear).toBe(ENGINE.gears);
  });

  it('does not change up when the throttle is shut', () => {
    const engine = createEngine();
    engine.gear = 2;
    run(engine, 2, () => ({ speed: 15, throttle: 0 }));
    expect(engine.gear).toBe(2);
  });

  it('cuts the load briefly during a shift', () => {
    const engine = createEngine();
    let cut = false;
    run(engine, 6, (t) => {
      if (engine.shifting > 0 && engine.load < 0.5) cut = true;
      return { speed: t * 3, throttle: 1 };
    });
    expect(cut).toBe(true);
  });

  it('shifts down as the bike slows, back to first at a stop', () => {
    const engine = createEngine();
    run(engine, 10, (t) => ({ speed: Math.min(25, t * 3), throttle: 1 }));
    expect(engine.gear).toBeGreaterThan(3);
    run(engine, 10, (t) => ({ speed: Math.max(0, 25 - t * 4), throttle: 0 }));
    expect(engine.gear).toBe(1);
  });

  it('ties the revs to the wheel in gear', () => {
    const engine = createEngine();
    engine.gear = 3;
    run(engine, 2, () => ({ speed: 12, throttle: 0.2 }));
    expect(engine.gear).toBe(3);
    expect(engine.rpm).toBeCloseTo(wheelRpm(12, 3), -2);
  });

  it('free revs in the air', () => {
    const engine = createEngine();
    engine.gear = 3;
    run(engine, 1, () => ({ speed: 15, throttle: 1, grounded: false }));
    expect(engine.rpm).toBeGreaterThan(ENGINE.redlineRpm * 0.95);
  });

  it('just idles while the rider paddles backwards', () => {
    const engine = createEngine();
    run(engine, 2, () => ({ speed: -1, throttle: 0 }));
    expect(engine.rpm).toBeCloseTo(ENGINE.idleRpm, -1);
  });
});
