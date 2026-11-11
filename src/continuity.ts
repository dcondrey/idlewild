import { SIGNAL_STALE_MS, TAKE_LIMITS } from './contracts.ts';
import type { ControlFrame, Signal } from './contracts.ts';
import { validateFrame } from './validation.ts';

export const CONTINUITY_LIMITS = Object.freeze({ cacheMs: 8000, minimumMs: 2000, replayMs: 10000, blendMs: 500 });
const SAMPLE_MS = 1000 / TAKE_LIMITS.samplesPerSecond;
const MAX_GAP_MS = 200;
type Point = { time: number; value: number };

function fresh(signal: Signal, time: number): boolean {
  return signal.quality === 'valid' && signal.value !== null && time - signal.sampledAtMs < SIGNAL_STALE_MS;
}

function replay(points: readonly Point[], elapsed: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  const target = first.time + elapsed % (last.time - first.time + SAMPLE_MS);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].time <= target) low = middle + 1;
    else high = middle;
  }
  const before = points[low - 1] ?? first;
  const after = points[low] ?? { time: last.time + SAMPLE_MS, value: first.value };
  return before.value + (after.value - before.value) * (target - before.time) / (after.time - before.time);
}

export function createBreathContinuity(): { update(frame: ControlFrame, enabled: boolean): ControlFrame; reset(): void } {
  let session = '';
  let lastTime = -1;
  let quiet: Point[] = [];
  let lastSampleTime = -Infinity;
  let cached: Point[] | null = null;
  let speechStart: number | null = null;
  let recovery: { time: number; value: number } | null = null;
  let lastReplayed: number | null = null;

  function reset() {
    session = '';
    lastTime = -1;
    quiet = [];
    lastSampleTime = -Infinity;
    cached = null;
    speechStart = null;
    recovery = null;
    lastReplayed = null;
  }

  return {
    reset,
    update(input, enabled) {
      const frame = validateFrame(input);
      const key = `${frame.source}:${frame.sessionId}`;
      if (!enabled) {
        reset();
        return frame;
      }
      if (session !== key || frame.timeMs < lastTime) reset();
      session = key;
      lastTime = frame.timeMs;
      const time = frame.timeMs;
      const breath = frame.signals.breath;
      const talking = frame.signals.talking;
      const isTalking = fresh(talking, time) && talking.value === 1;
      const isQuiet = fresh(talking, time) && talking.value === 0;
      const validBreath = fresh(breath, time) && breath.provenance !== 'replayed';

      function output(value: number | null): ControlFrame {
        frame.signals.breath = { ...breath, value, quality: value === null ? 'missing' : 'valid', confidence: null, sampledAtMs: time, provenance: 'replayed' };
        lastReplayed = value;
        return frame;
      }

      if (isTalking) {
        recovery = null;
        if (speechStart === null) {
          speechStart = time;
          lastReplayed = null;
          const first = quiet[0];
          const last = quiet[quiet.length - 1];
          cached = first && last && last.time - first.time >= CONTINUITY_LIMITS.minimumMs && time - last.time < SIGNAL_STALE_MS ? quiet : null;
          quiet = [];
        }
        if (!cached) return frame;
        const elapsed = time - speechStart;
        if (elapsed >= CONTINUITY_LIMITS.replayMs) return output(null);
        const fade = Math.min(1, (CONTINUITY_LIMITS.replayMs - elapsed) / CONTINUITY_LIMITS.blendMs);
        return output(replay(cached, elapsed) * fade);
      }

      if (speechStart !== null) {
        if (cached && isQuiet && validBreath) recovery = { time, value: lastReplayed ?? 0 };
        cached = null;
        speechStart = null;
        lastReplayed = null;
      }

      if (isQuiet && validBreath) {
        const last = quiet[quiet.length - 1];
        if (last && time - last.time > MAX_GAP_MS) quiet = [];
        if (breath.sampledAtMs > lastSampleTime && (!last || time - last.time >= SAMPLE_MS)) {
          quiet.push({ time, value: breath.value! });
          lastSampleTime = breath.sampledAtMs;
          quiet = quiet.filter(point => time - point.time <= CONTINUITY_LIMITS.cacheMs);
        }
        if (recovery) {
          const weight = Math.min(1, (time - recovery.time) / CONTINUITY_LIMITS.blendMs);
          if (weight < 1) return output(recovery.value + (breath.value! - recovery.value) * weight);
          recovery = null;
        }
      } else {
        quiet = [];
        recovery = null;
      }
      return frame;
    },
  };
}
