import type { SceneId } from '../contracts.ts';
import type { SoundParams } from './params.ts';
import { SOUND_SCENES } from './params.ts';

export const MAX_LEVEL = 0.37;
const CONTROL = 32;
const TAU = Math.PI * 2;
const semitones = (value: number) => 2 ** (value / 12);

class Rng {
  private state: number;
  constructor(seed: number) { this.state = (Math.trunc(Number.isFinite(seed) ? seed : 0) ^ 0x9e3779b9) | 0; }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  signed(): number { return this.next() * 2 - 1; }
}

/** Zero-delay-feedback state variable filter; coefficients are set per control block. */
class Svf {
  private ic1 = 0; private ic2 = 0;
  private a1 = 0; private a2 = 0; private a3 = 0;
  k = 1;
  lp = 0; bp = 0; hp = 0;
  private readonly rate: number;
  constructor(rate: number) { this.rate = rate; }
  set(cutoff: number, q: number) {
    const fc = Math.min(Math.max(cutoff, 20), this.rate * 0.45);
    const g = Math.tan(Math.PI * fc / this.rate);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  run(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.bp = v1; this.lp = v2; this.hp = x - this.k * v1 - v2;
    return v2;
  }
}

class Saw {
  phase = 0;
  next(freq: number, rate: number): number {
    const dt = Math.min(0.45, freq / rate);
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    const t = this.phase;
    let value = 2 * t - 1;
    if (t < dt) { const x = t / dt; value -= x + x - x * x - 1; }
    else if (t > 1 - dt) { const x = (t - 1) / dt; value -= x * x + x + x + 1; }
    return value;
  }
}

/** Block-smoothed controls; every field follows its target without steps. */
interface Ctl {
  voice: number; air: number; breath: number; arterial: number; pulse: number;
  jaw: number; smile: number; brow: number; pan: number; movement: number; level: number;
}

interface Instrument {
  l: number; r: number;
  block(c: Ctl): void;
  tick(): void;
}

function advance(phase: number, freq: number, rate: number): number {
  phase += freq / rate;
  return phase >= 1 ? phase - 1 : phase;
}

const sinc = (phase: number) => Math.sin(TAU * phase);

class Formants {
  readonly filters: Svf[];
  constructor(rate: number) { this.filters = [new Svf(rate), new Svf(rate), new Svf(rate)]; }
  set(f1: number, f2: number, f3: number) {
    this.filters[0].set(f1, 6); this.filters[1].set(f2, 7); this.filters[2].set(f3, 8);
  }
  run(x: number): number {
    const [a, b, c] = this.filters;
    a.run(x); b.run(x); c.run(x);
    return a.bp * a.k * 1.0 + b.bp * b.k * 0.7 + c.bp * c.k * 0.25;
  }
}

class Rex implements Instrument {
  l = 0; r = 0;
  private sawL = new Saw(); private sawR = new Saw();
  private left: Formants; private right: Formants;
  private warmL: Svf; private warmR: Svf;
  private f0 = 98; private vibrato = 0; private vibPhase = 0;
  private readonly rate: number;
  constructor(rate: number) {
    this.rate = rate;
    this.left = new Formants(rate); this.right = new Formants(rate);
    this.warmL = new Svf(rate); this.warmR = new Svf(rate);
  }
  block(c: Ctl) {
    this.f0 = 98 * semitones(c.brow * 0.7);
    this.vibrato = 0.0025 + 0.004 * c.pulse;
    const f1 = 330 + c.jaw * 480, f2 = 950 + c.jaw * 250 + c.smile * 850;
    this.left.set(f1, f2, 2700); this.right.set(f1 * 1.01, f2 * 0.99, 2750);
    this.warmL.set(500 + 900 * c.smile, 0.7); this.warmR.set(500 + 900 * c.smile, 0.7);
  }
  tick() {
    this.vibPhase = advance(this.vibPhase, 5, this.rate);
    const f = this.f0 * (1 + this.vibrato * sinc(this.vibPhase));
    const a = this.sawL.next(f * 0.998, this.rate), b = this.sawR.next(f * 1.002, this.rate);
    this.l = (this.left.run(a) * 1.3 + this.warmL.run(a) * 0.25);
    this.r = (this.right.run(b) * 1.3 + this.warmR.run(b) * 0.25);
  }
}

class Star implements Instrument {
  l = 0; r = 0;
  private static readonly ratios = [1, 1.5, 2, 3, 4.002, 5.003, 6];
  private pl = new Float64Array(7); private pr = new Float64Array(7); private lfo = new Float64Array(7);
  private weight = new Float64Array(7); private base = 261.6256;
  private readonly rate: number;
  constructor(rate: number, rng: Rng) {
    this.rate = rate;
    for (let i = 0; i < 7; i++) { this.pl[i] = rng.next(); this.pr[i] = rng.next(); this.lfo[i] = rng.next(); }
  }
  block(c: Ctl) {
    this.base = 261.6256 * semitones(c.brow * 0.7);
    const brightness = Math.min(1, Math.max(0.05, 0.3 + 0.4 * c.smile + 0.3 * c.breath + 0.15 * c.arterial + 0.1 * c.pulse));
    for (let i = 0; i < 7; i++) this.weight[i] = 0.34 * brightness ** (i * 0.55) / (1 + i * 0.35);
  }
  tick() {
    let l = 0, r = 0;
    for (let i = 0; i < 7; i++) {
      const f = this.base * Star.ratios[i], d = 0.0012 * (i + 1);
      this.pl[i] = advance(this.pl[i], f * (1 - d), this.rate);
      this.pr[i] = advance(this.pr[i], f * (1 + d), this.rate);
      this.lfo[i] = advance(this.lfo[i], 0.11 + 0.043 * i, this.rate);
      const shimmer = 0.65 + 0.35 * sinc(this.lfo[i]);
      const w = this.weight[i] * shimmer;
      l += sinc(this.pl[i]) * w; r += sinc(this.pr[i]) * w;
    }
    this.l = l; this.r = r;
  }
}

class Runner implements Instrument {
  l = 0; r = 0;
  private static readonly notes = [146.8324, 220, 293.6648, 369.9944];
  private pl = new Float64Array(4); private pr = new Float64Array(4); private swell = new Float64Array(4);
  private cutoff = 800; private lpL: Svf; private lpR: Svf;
  private readonly rate: number;
  constructor(rate: number, rng: Rng) {
    this.rate = rate;
    for (let i = 0; i < 4; i++) { this.pl[i] = rng.next(); this.pr[i] = rng.next(); this.swell[i] = rng.next(); }
    this.lpL = new Svf(rate); this.lpR = new Svf(rate);
  }
  block(c: Ctl) {
    this.cutoff = 500 + 1500 * c.breath + 800 * c.smile + 250 * c.arterial;
    this.lpL.set(this.cutoff, 0.8); this.lpR.set(this.cutoff * 1.03, 0.8);
  }
  tick() {
    let l = 0, r = 0;
    for (let i = 0; i < 4; i++) {
      const f = Runner.notes[i];
      this.pl[i] = advance(this.pl[i], f * 0.998, this.rate);
      this.pr[i] = advance(this.pr[i], f * 1.002, this.rate);
      this.swell[i] = advance(this.swell[i], 0.05 + 0.017 * i, this.rate);
      const w = (0.2 - i * 0.03) * (0.7 + 0.3 * sinc(this.swell[i]));
      l += (sinc(this.pl[i]) + 0.3 * sinc(this.pl[i] * 2)) * w;
      r += (sinc(this.pr[i]) + 0.3 * sinc(this.pr[i] * 2)) * w;
    }
    this.l = this.lpL.run(l); this.r = this.lpR.run(r);
  }
}

class Brain implements Instrument {
  l = 0; r = 0;
  private static readonly partials = [1, 1.5, 2.005, 3.01];
  private pl = new Float64Array(4); private pr = new Float64Array(4); private lfo = new Float64Array(4);
  private lpL: Svf; private lpR: Svf;
  private readonly rate: number;
  constructor(rate: number, rng: Rng) {
    this.rate = rate;
    for (let i = 0; i < 4; i++) { this.pl[i] = rng.next(); this.pr[i] = rng.next(); this.lfo[i] = rng.next(); }
    this.lpL = new Svf(rate); this.lpR = new Svf(rate);
  }
  block(c: Ctl) {
    const cutoff = 180 + 520 * c.breath + 160 * c.arterial;
    this.lpL.set(cutoff, 0.9); this.lpR.set(cutoff, 0.9);
  }
  tick() {
    let l = 0, r = 0;
    for (let i = 0; i < 4; i++) {
      const f = 55 * Brain.partials[i];
      this.pl[i] = advance(this.pl[i], f, this.rate);
      this.pr[i] = advance(this.pr[i], f + 0.35 + 0.1 * i, this.rate);
      this.lfo[i] = advance(this.lfo[i], 0.031 + 0.019 * i, this.rate);
      const w = (0.5 / (1 + i * 0.8)) * (0.5 + 0.5 * sinc(this.lfo[i]) ** 2 + 0.2);
      l += sinc(this.pl[i]) * w; r += sinc(this.pr[i]) * w;
    }
    this.l = this.lpL.run(l); this.r = this.lpR.run(r);
  }
}

class Imported implements Instrument {
  l = 0; r = 0;
  private static readonly scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  private phase = 0; private vibPhase = 0; private freq = 220; private target = 220; private step = -1;
  private vibrato = 0.01; private lpL: Svf; private lpR: Svf;
  private readonly rate: number;
  constructor(rate: number) { this.rate = rate; this.lpL = new Svf(rate); this.lpR = new Svf(rate); }
  block(c: Ctl) {
    const position = c.breath * Imported.scale.length;
    // Hysteresis keeps sensor noise near a step boundary from flipping notes.
    if (this.step < 0 || position < this.step - 0.3 || position >= this.step + 1.3) this.step = Math.max(0, Math.min(Imported.scale.length - 1, Math.floor(position)));
    this.target = 220 * semitones(Imported.scale[this.step] + c.brow * 0.7);
    this.vibrato = 0.008 + 0.02 * c.jaw;
    const cutoff = 1400 + 3200 * c.smile + 600 * c.arterial;
    this.lpL.set(cutoff, 0.7); this.lpR.set(cutoff, 0.7);
    this.freq += (this.target - this.freq) * (1 - Math.exp(-CONTROL / (this.rate * 0.06)));
  }
  tick() {
    this.vibPhase = advance(this.vibPhase, 5.8, this.rate);
    this.phase = advance(this.phase, this.freq * (1 + this.vibrato * sinc(this.vibPhase)), this.rate);
    const x = sinc(this.phase) - Math.sin(3 * TAU * this.phase) / 9 + Math.sin(2 * TAU * this.phase) * 0.12;
    this.l = this.lpL.run(x) * 0.62; this.r = this.lpR.run(x * 0.98) * 0.62;
  }
}

interface Pop { on: boolean; phase: number; freq: number; chirp: number; env: number; pan: number; gain: number }

/** Seeded pops and gurgles. Events come from exhale motion and body movement only, bounded per second. */
class Bubbles implements Instrument {
  l = 0; r = 0;
  private pops: Pop[] = Array.from({ length: 8 }, () => ({ on: false, phase: 0, freq: 0, chirp: 0, env: 0, pan: 0, gain: 0 }));
  private rate_ = 0;
  private decay: number;
  private readonly rate: number; private readonly rng: Rng;
  constructor(rate: number, rng: Rng) { this.rate = rate; this.rng = rng; this.decay = Math.exp(-1 / (rate * 0.035)); }
  block(c: Ctl) {
    const dt = CONTROL / this.rate;
    // Exhale depth, not speed, so faster breathing never earns more events.
    const exhale = c.air * 0.6 * Math.min(1, Math.max(0, 0.5 - c.breath) * 2);
    this.rate_ = Math.min(8, exhale * 8 + c.movement * 5 + c.air * 0.4 * c.breath);
    if (this.rng.next() < this.rate_ * dt) this.spawn(c);
  }
  private spawn(c: Ctl) {
    const slot = this.pops.find(pop => !pop.on) ?? null;
    const base = 260 + this.rng.next() * 900;
    const pan = this.rng.signed() * 0.7;
    const gain = 0.25 + 0.3 * this.rng.next();
    if (!slot) return;
    slot.on = true; slot.phase = 0; slot.freq = base * (0.85 + 0.3 * c.smile); slot.chirp = 0.0006 + 0.0008 * this.rng.next();
    slot.env = 1; slot.pan = pan; slot.gain = gain;
  }
  tick() {
    let l = 0, r = 0;
    for (const pop of this.pops) {
      if (!pop.on) continue;
      pop.freq *= 1 + pop.chirp; pop.chirp *= 0.9992;
      pop.phase = advance(pop.phase, Math.min(pop.freq, this.rate * 0.4), this.rate);
      pop.env *= this.decay;
      const value = sinc(pop.phase) * pop.env * pop.gain;
      l += value * (1 - pop.pan) * 0.5; r += value * (1 + pop.pan) * 0.5;
      if (pop.env < 1e-4) pop.on = false;
    }
    this.l = l; this.r = r;
  }
}

interface SceneVoice { air: number; airLow: number; airHigh: number; tick: number; gain: number }
const VOICES: Record<SceneId, SceneVoice> = {
  rex: { air: 0.05, airLow: 350, airHigh: 1400, tick: 1, gain: 0.75 },
  bubbles: { air: 0.07, airLow: 500, airHigh: 1800, tick: 0.6, gain: 2.2 },
  star: { air: 0.025, airLow: 2500, airHigh: 5500, tick: 1.2, gain: 0.7 },
  runner: { air: 0.03, airLow: 300, airHigh: 1500, tick: 0.8, gain: 0.95 },
  brain: { air: 0.03, airLow: 90, airHigh: 400, tick: 0.5, gain: 0.36 },
  imported: { air: 0.03, airLow: 600, airHigh: 2800, tick: 1.1, gain: 0.36 },
};

export interface SoundEngine {
  /** Renders `count` stereo samples starting at `offset`, advancing internal state. Never returns above MAX_LEVEL. */
  render(params: SoundParams, left: Float32Array, right: Float32Array, offset: number, count: number): void;
}

function instrument(scene: SceneId, rate: number, rng: Rng): Instrument {
  switch (scene) {
    case 'rex': return new Rex(rate);
    case 'bubbles': return new Bubbles(rate, rng);
    case 'star': return new Star(rate, rng);
    case 'runner': return new Runner(rate, rng);
    case 'brain': return new Brain(rate, rng);
    default: return new Imported(rate);
  }
}

export function createSoundEngine(scene: SceneId, seed: number, rate: number): SoundEngine {
  if (!SOUND_SCENES.includes(scene)) throw new Error('Unknown sound scene');
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192_000) throw new Error('Invalid sample rate');
  const rng = new Rng(seed);
  const voice = VOICES[scene];
  const inst = instrument(scene, rate, rng);
  const follow = (seconds: number) => 1 - Math.exp(-CONTROL / (rate * seconds));
  const fast = follow(0.04), attack = follow(0.03), release = follow(0.09), slow = follow(0.3);
  const c: Ctl = { voice: 0, air: 0, breath: 0.5, arterial: 0, pulse: 0, jaw: 0, smile: 0, brow: 0, pan: 0, movement: 0, level: 0 };
  let phrase = 0, phrasePhase = rng.next(), phraseHz = 0.12;
  let appliedVoice = 0, appliedAir = 0;
  let blinkArmed = false;
  let tickLeft = 0, tickPan = 0;
  const tickLength = Math.round(rate * 0.014), tickAttack = Math.max(1, Math.round(rate * 0.001));
  const airL = new Svf(rate), airR = new Svf(rate), tickFilter = new Svf(rate);
  tickFilter.set(3200, 1.5);

  return {
    render(p, left, right, offset, count) {
      if (p.blink < 0.3) blinkArmed = true;
      else if (blinkArmed && p.blink > 0.6) { blinkArmed = false; tickLeft = tickLength; tickPan = rng.signed() * 0.4; }
      for (let done = 0; done < count;) {
        const n = Math.min(CONTROL, count - done);
        c.voice += (p.voice - c.voice) * (p.voice > c.voice ? attack : release);
        c.air += (p.air * (0.3 + 0.7 * p.breath) - c.air) * (p.air > 0 ? attack : release);
        c.breath += (p.breath - c.breath) * fast;
        c.arterial += (p.arterial - c.arterial) * fast;
        c.pulse += (p.pulse - c.pulse) * slow;
        c.jaw += (p.jaw - c.jaw) * fast;
        c.smile += (p.smile - c.smile) * fast;
        c.brow += (p.brow - c.brow) * fast;
        c.pan += (p.pan - c.pan) * fast;
        c.movement += (p.movement - c.movement) * fast;
        c.level += (p.level - c.level) * fast;
        phraseHz += (p.phraseHz - phraseHz) * slow;
        inst.block(c);
        const cutoff = voice.airLow + (voice.airHigh - voice.airLow) * c.breath;
        airL.set(cutoff, 0.8); airR.set(cutoff, 0.8);
        const voiceStep = (c.voice - appliedVoice) / n, airStep = (c.air * voice.air - appliedAir) / n;
        const angle = (Math.max(-1, Math.min(1, c.pan)) + 1) * Math.PI / 4;
        const panL = Math.SQRT2 * Math.cos(angle), panR = Math.SQRT2 * Math.sin(angle);
        const scale = c.level * voice.gain * (0.75 + 0.25 * c.movement);
        for (let i = 0; i < n; i++) {
          appliedVoice += voiceStep; appliedAir += airStep;
          phrasePhase = advance(phrasePhase, phraseHz, rate);
          phrase = sinc(phrasePhase);
          inst.tick();
          const swell = appliedVoice * (1 + 0.12 * phrase) * (1 + 0.08 * c.arterial);
          let l = inst.l * swell + airL.run(rng.signed()) * appliedAir * 3;
          let r = inst.r * swell + airR.run(rng.signed()) * appliedAir * 3;
          l *= panL; r *= panR;
          if (tickLeft > 0) {
            const t = tickLength - tickLeft;
            const envelope = Math.min(1, (t + 1) / tickAttack) * (1 - t / tickLength) ** 2;
            tickFilter.run(rng.signed());
            const value = tickFilter.bp * tickFilter.k * envelope * 0.35 * voice.tick;
            l += value * (1 - tickPan) * 0.5; r += value * (1 + tickPan) * 0.5;
            tickLeft--;
          }
          left[offset + done + i] = MAX_LEVEL * Math.tanh(l * scale / MAX_LEVEL);
          right[offset + done + i] = MAX_LEVEL * Math.tanh(r * scale / MAX_LEVEL);
        }
        done += n;
      }
    },
  };
}
