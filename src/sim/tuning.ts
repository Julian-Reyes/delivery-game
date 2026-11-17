/**
 * Every gameplay tuning number in one place. Pure data: no three.js, physics or DOM.
 */

/**
 * A small single-cylinder commuter bike, the kind delivery riders use: about 150 cc, five
 * gears, top speed around 100 km/h.
 */
export const ENGINE = {
  idleRpm: 1450,
  redlineRpm: 9500,
  /** Revs in top gear at the bike's top speed. */
  topGearRpm: 9000,
  /** m/s, matching the rider's maximum speed. */
  topSpeed: 28,
  gears: 5,
  /** Road speed per rpm in each gear, relative to top gear. */
  ratios: [0.36, 0.55, 0.72, 0.87, 1] as readonly number[],
  /** Shift up here when pulling hard, here when just cruising, down below this. */
  shiftUpRpm: 8600,
  cruiseShiftRpm: 6200,
  shiftDownRpm: 3300,
  /** No upshift with less throttle than this. */
  shiftThrottle: 0.15,
  /** Seconds the throttle is cut while a gear changes. */
  shiftTime: 0.2,
  /** The clutch slips below these revs in first, and lets the engine rev this far over idle. */
  clutchRpm: 3600,
  clutchRevs: 3800,
  /** How quickly revs and load follow what they want to be, per second. */
  revRate: 9,
  loadRate: 12,
} as const;
