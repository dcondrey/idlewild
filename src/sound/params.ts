import { SIGNAL_STALE_MS } from '../contracts.ts';
import type { Channel, SceneFrame, SceneId } from '../contracts.ts';
import { clamp, sceneDynamics } from '../scenes/dynamics.ts';
import { trackingAt } from '../tracking-frame.ts';

export const SOUND_SCENES: readonly SceneId[] = ['rex', 'bubbles', 'star', 'runner', 'brain', 'imported'];

/** Control values for one instant; all fields are finite. Absent inputs are exactly 0. */
export interface SoundParams {
  /** User sound control, 0..1. */
  level: number;
  /** Amplitude of the sustained instrument layer: fresh breath or tracked body/face activity. */
  voice: number;
  /** Fresh-breath weight gating the breath/air layer, 0..1. */
  air: number;
  /** Breath trace position, 0 (low) .. 1 (high); 0.5 when absent. */
  breath: number;
  /** Phrase swell rate in Hz, bounded to a comfortable breathing range. */
  phraseHz: number;
  /** Measured, uncalibrated arterial waveform, -1..1. */
  arterial: number;
  /** Slow pulse-rate colour only, 0..1. Never used to time events. */
  pulse: number;
  jaw: number;
  smile: number;
  brow: number;
  /** Stereo balance -1..1. */
  pan: number;
  movement: number;
  /** Raw blink level; edges are detected by the stateful engine. */
  blink: number;
}

export const PHRASE_HZ = Object.freeze({ min: 0.1, max: 0.4, idle: 0.12 });

const UNITS: Record<Channel, string> = {
  breath: 'relative', breathingRate: 'breaths/min', pulseRate: 'beats/min',
  arterialTrace: 'relative', blink: 'boolean', talking: 'boolean',
};

function signal(input: SceneFrame, channel: Channel): { value: number; weight: number } | null {
  const frame = input.frame;
  const sample = frame?.signals[channel];
  if (!frame || !sample || sample.quality !== 'valid' || sample.unit !== UNITS[channel] || sample.value === null || !Number.isFinite(sample.value) ||
      !Number.isFinite(sample.sampledAtMs) || !Number.isFinite(input.timeMs) || sample.sampledAtMs > frame.timeMs) return null;
  const age = Math.max(input.timeMs, frame.timeMs) - sample.sampledAtMs;
  if (!(age < SIGNAL_STALE_MS)) return null;
  const weight = clamp((SIGNAL_STALE_MS - age) / 500);
  return weight > 0 ? { value: sample.value, weight } : null;
}

export const silentParams = (): SoundParams => ({
  level: 0, voice: 0, air: 0, breath: 0.5, phraseHz: PHRASE_HZ.idle, arterial: 0, pulse: 0,
  jaw: 0, smile: 0, brow: 0, pan: 0, movement: 0, blink: 0,
});

/** Shared by live playback and offline rendering. Depends on the sound and sensitivity controls, never on visual motion settings. */
export function soundParams(input: SceneFrame, scene: SceneId): SoundParams {
  if (!SOUND_SCENES.includes(scene)) throw new Error('Unknown sound scene');
  const params = silentParams();
  params.level = clamp(input.controls.sound);
  if (params.level === 0) return params;
  const sensitivity = clamp(input.controls.sensitivity);
  const dynamics = sceneDynamics({ ...input, reducedMotion: false, controls: { ...input.controls, motion: 1 } });

  const breath = signal(input, 'breath');
  let breathAmp = 0;
  if (breath) {
    params.air = breath.weight;
    params.breath = clamp(0.5 + 0.5 * clamp(breath.value, -1, 1) * sensitivity);
    breathAmp = breath.weight * (0.3 + 0.7 * params.breath);
  }
  const activity = Math.max(dynamics.movement, dynamics.jaw * 0.9);
  const trackAmp = trackingAt(input) || dynamics.jaw > 0 ? (activity > 0.02 ? 0.15 + 0.85 * activity : 0) : 0;
  params.voice = Math.max(breathAmp, trackAmp);

  const rate = signal(input, 'breathingRate');
  if (rate) params.phraseHz = clamp(rate.value / 60, PHRASE_HZ.min, PHRASE_HZ.max);
  const arterial = signal(input, 'arterialTrace');
  if (arterial) params.arterial = clamp(arterial.value, -1, 1) * arterial.weight * sensitivity;
  const pulse = signal(input, 'pulseRate');
  if (pulse) params.pulse = clamp((pulse.value - 45) / 90) * pulse.weight * sensitivity;

  params.jaw = clamp(dynamics.jaw);
  params.smile = clamp(dynamics.smile);
  params.brow = clamp(dynamics.brow);
  params.pan = clamp(dynamics.turn * 0.7 + dynamics.lean * 0.5, -1, 1);
  params.movement = clamp(dynamics.movement);
  params.blink = clamp(dynamics.blink);
  return params;
}
