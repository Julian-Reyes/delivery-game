import type { RideTelemetry } from '../bike/rider';
import type { EngineState } from '../sim/engine';
import { ENGINE } from '../sim/tuning';

/**
 * The bike's sound, synthesised with the Web Audio API so there are no recordings to
 * license.
 *
 * The engine is a single cylinder firing every second revolution: an oscillator at the
 * firing frequency with a pulse-shaped spectrum gives the putt-putt at idle that rises to
 * a buzz near the redline, noise pulsed at the same rate gives it its roughness, and a
 * soft clipper and a low-pass filter that open with throttle make it bark under load and
 * go muffled on the overrun, with a few pops when the throttle snaps shut at high revs.
 *
 * Around it: wind that grows with speed, tyre squeal under hard braking, a grinding
 * scrape along walls, a thump on landing, rumble on cobblestones, and the scuff of the
 * rider's feet while paddling backwards.
 *
 * Browsers only allow audio after a user gesture, so nothing is built until `start()`.
 */

const MASTER = 0.65;
/** How quickly sound parameters follow the bike, as a time constant in seconds. */
const SMOOTH = 0.035;
const POP_RPM = 5200;
const SCUFF_EVERY = 0.55;

interface Graph {
  context: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
  firing: OscillatorNode;
  crank: OscillatorNode;
  pulse: OscillatorNode;
  roughness: GainNode;
  roughDepth: GainNode;
  roughFilter: BiquadFilterNode;
  drive: GainNode;
  tone: BiquadFilterNode;
  engine: GainNode;
  wind: GainNode;
  windFilter: BiquadFilterNode;
  skid: GainNode;
  scrape: GainNode;
  rumble: GainNode;
  rumbleBeat: OscillatorNode;
}

function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A looping noise source through a filter into a gain that starts silent. */
function noiseVoice(
  context: AudioContext,
  noise: AudioBuffer,
  type: BiquadFilterType,
  frequency: number,
  q: number,
  out: AudioNode,
): { gain: GainNode; filter: BiquadFilterNode } {
  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  // Start each voice at a different point so they do not phase with each other.
  source.start(0, Math.random() * 2);
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(out);
  return { gain, filter };
}

/**
 * Spectrum of a single-cylinder exhaust: a train of short pulses, so every harmonic of
 * the firing rate is present and they fall off slowly.
 */
function exhaustWave(context: AudioContext): PeriodicWave {
  const harmonics = 48;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  const duty = 0.22;
  for (let n = 1; n < harmonics; n++) {
    imag[n] = (Math.abs(Math.sin(n * Math.PI * duty)) / n) * (n % 2 === 0 ? 0.8 : 1);
  }
  return context.createPeriodicWave(real, imag);
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export class BikeAudio {
  private graph: Graph | null = null;
  private lastLoad = 0;
  private scuffClock = 0;

  /** Build the sound graph. Call from a user gesture (a click or key press). */
  start(): void {
    if (this.graph) {
      void this.graph.context.resume();
      return;
    }
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = MASTER;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(context.destination);
    const noise = noiseBuffer(context);

    // Engine: exhaust pulses plus a little crank whine, clipped and filtered.
    const drive = context.createGain();
    const shaper = context.createWaveShaper();
    shaper.curve = softClip(2.2);
    shaper.oversample = '2x';
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.9;
    const engine = context.createGain();
    engine.gain.value = 0;
    drive.connect(shaper).connect(tone).connect(engine).connect(master);

    const firing = context.createOscillator();
    firing.setPeriodicWave(exhaustWave(context));
    const firingLevel = context.createGain();
    firingLevel.gain.value = 0.55;
    firing.connect(firingLevel).connect(drive);

    const crank = context.createOscillator();
    crank.type = 'sawtooth';
    const crankLevel = context.createGain();
    crankLevel.gain.value = 0.06;
    crank.connect(crankLevel).connect(drive);

    // Combustion roughness: noise whose level is pulsed at the firing rate.
    const rough = noiseVoice(context, noise, 'bandpass', 1400, 0.7, drive);
    const pulse = context.createOscillator();
    pulse.type = 'sine';
    const roughDepth = context.createGain();
    roughDepth.gain.value = 0.2;
    pulse.connect(roughDepth).connect(rough.gain.gain);

    for (const oscillator of [firing, crank, pulse]) oscillator.start();

    const wind = noiseVoice(context, noise, 'lowpass', 800, 0.5, master);
    const skid = noiseVoice(context, noise, 'bandpass', 2300, 7, master);
    const scrape = noiseVoice(context, noise, 'bandpass', 650, 1.3, master);
    const rumble = noiseVoice(context, noise, 'lowpass', 220, 0.7, master);
    // Cobblestones come as a beat of bumps; this oscillator is the beat.
    const rumbleBeat = context.createOscillator();
    rumbleBeat.type = 'square';
    const beatDepth = context.createGain();
    beatDepth.gain.value = 0;
    rumbleBeat.connect(beatDepth).connect(rumble.gain.gain);
    rumbleBeat.start();

    this.graph = {
      context,
      master,
      noise,
      firing,
      crank,
      pulse,
      roughness: rough.gain,
      roughDepth,
      roughFilter: rough.filter,
      drive,
      tone,
      engine,
      wind: wind.gain,
      windFilter: wind.filter,
      skid: skid.gain,
      scrape: scrape.gain,
      rumble: beatDepth,
      rumbleBeat,
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void context.suspend();
      else void context.resume();
    });
  }

  /**
   * Follow the bike. Call once per rendered frame. `cobbles` is true when the bike is on
   * a cobblestone street; `landing` is the strongest landing since the last frame.
   */
  update(
    dt: number,
    ride: RideTelemetry,
    engine: EngineState,
    cobbles: boolean,
    landing: number,
  ): void {
    const g = this.graph;
    if (!g || g.context.state !== 'running') return;
    const now = g.context.currentTime;
    const set = (param: AudioParam, value: number): void => {
      param.setTargetAtTime(value, now, SMOOTH);
    };

    const revs = (engine.rpm - ENGINE.idleRpm) / (ENGINE.redlineRpm - ENGINE.idleRpm);
    const load = engine.load;
    const firingHz = engine.rpm / 120;
    set(g.firing.frequency, firingHz);
    set(g.pulse.frequency, firingHz);
    set(g.crank.frequency, engine.rpm / 60);
    set(g.drive.gain, 0.8 + load * 2.4);
    set(g.tone.frequency, 320 + revs * 2300 + load * 2400);
    set(g.roughFilter.frequency, 900 + revs * 2200);
    set(g.roughness.gain, 0.12 + load * 0.35);
    set(g.roughDepth.gain, 0.1 + load * 0.3);
    set(g.engine.gain, 0.16 + load * 0.2 + revs * 0.12);

    // Shutting the throttle at high revs: a few pops from the exhaust.
    if (this.lastLoad > 0.6 && load < 0.25 && engine.rpm > POP_RPM) this.pops(g);
    this.lastLoad = load;

    const speed = Math.abs(ride.speed);
    set(g.wind.gain, Math.min(0.45, (speed / 28) ** 2 * 0.4));
    set(g.windFilter.frequency, 500 + speed * 45);

    const skidding = ride.grounded && ride.brake > 0.6 && ride.speed > 5;
    set(g.skid.gain, skidding ? Math.min(0.22, 0.06 + ride.speed / 120) : 0);
    set(g.scrape.gain, ride.scrape * 0.55);

    const onCobbles = cobbles && ride.grounded && speed > 1;
    set(g.rumble.gain, onCobbles ? Math.min(0.35, speed / 30) : 0);
    set(g.rumbleBeat.frequency, 4 + speed * 2.2);

    if (landing > 2.5) this.thump(g, Math.min(1, landing / 10));

    // Paddling backwards: the rider's feet scuffing the ground, one step at a time.
    if (ride.reversing) {
      this.scuffClock += dt;
      if (this.scuffClock > SCUFF_EVERY) {
        this.scuffClock = 0;
        this.burst(g, 'lowpass', 700, 0.12, 0.14);
      }
    } else {
      this.scuffClock = SCUFF_EVERY * 0.8;
    }
  }

  /** A short filtered noise burst, fading out. */
  private burst(
    g: Graph,
    type: BiquadFilterType,
    frequency: number,
    level: number,
    length: number,
    delay = 0,
  ): void {
    const start = g.context.currentTime + delay;
    const source = g.context.createBufferSource();
    source.buffer = g.noise;
    const filter = g.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = g.context.createGain();
    gain.gain.setValueAtTime(level, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + length);
    source.connect(filter).connect(gain).connect(g.master);
    source.start(start, Math.random() * 1.5, length + 0.05);
  }

  private pops(g: Graph): void {
    const count = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      this.burst(g, 'bandpass', 700 + Math.random() * 600, 0.35, 0.05, 0.05 + Math.random() * 0.7);
    }
  }

  private thump(g: Graph, strength: number): void {
    const start = g.context.currentTime;
    const body = g.context.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(95, start);
    body.frequency.exponentialRampToValueAtTime(38, start + 0.25);
    const gain = g.context.createGain();
    gain.gain.setValueAtTime(0.7 * strength, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
    body.connect(gain).connect(g.master);
    body.start(start);
    body.stop(start + 0.35);
    // The suspension bottoming out.
    this.burst(g, 'lowpass', 500, 0.4 * strength, 0.12);
  }
}
