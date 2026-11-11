import { SIGNAL_STALE_MS, type Channel, type SceneFrame } from '../contracts.ts';

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function randomFor(seed: number, index: number): number {
  let value = (Math.trunc(Number.isFinite(seed) ? seed : 0) ^ Math.imul(index + 1, 0x9e3779b1)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
}

export function signalValue(input: SceneFrame, channel: Channel): number | null {
  const frame = input.frame;
  const signal = frame?.signals[channel];
  if (!frame || !signal || signal.quality !== 'valid' || signal.value === null || !Number.isFinite(signal.value) ||
      !Number.isFinite(signal.sampledAtMs) || signal.sampledAtMs > frame.timeMs) return null;
  const unit = channel === 'pulseRate' ? 'beats/min' : channel === 'breathingRate' ? 'breaths/min' : channel === 'blink' || channel === 'talking' ? 'boolean' : 'relative';
  if (signal.unit !== unit) return null;
  const age = Math.max(input.timeMs, frame.timeMs) - signal.sampledAtMs;
  if (age >= SIGNAL_STALE_MS) return null;
  return signal.value * clamp((SIGNAL_STALE_MS - age) / 500);
}

export function sceneDynamics(input: SceneFrame) {
  const motion = input.reducedMotion ? 0 : clamp(input.controls.motion);
  const sensitivity = clamp(input.controls.sensitivity);
  return {
    time: motion === 0 ? 0 : Math.max(0, Number.isFinite(input.timeMs) ? input.timeMs : 0) / 1000,
    motion,
    breath: motion === 0 ? 0 : clamp(signalValue(input, 'breath') ?? 0, -1, 1) * sensitivity * motion,
    blink: clamp(signalValue(input, 'blink') ?? 0) * motion,
    talking: clamp(signalValue(input, 'talking') ?? 0) * motion,
  };
}
