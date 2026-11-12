import type { SceneFrame, SceneId, Take, SceneControls } from './contracts.ts';
import { SIGNAL_STALE_MS, TAKE_LIMITS } from './contracts.ts';
import { validateTake } from './validation.ts';
import { trackingAt } from './tracking-frame.ts';

const pitches: Record<SceneId, number> = { rex: 110, bubbles: 220, star: 261.6256, dragon: 73.4162, runner: 146.8324, brain: 130.8128, imported: 164.8138 };
const FADE_SECONDS = 0.01;
const MAX_LEVEL = 0.37;
const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export function audioLevel(input: SceneFrame): number {
  const frame = input.frame;
  if (frame?.source === 'local-camera') return clamp(input.controls.sound) * clamp(trackingAt(input)?.movement ?? 0) * clamp(input.controls.sensitivity) * MAX_LEVEL;
  const signal = frame?.signals.breath;
  if (!frame || !signal || signal.unit !== 'relative' || signal.value === null || !Number.isFinite(signal.value) || signal.quality !== 'valid' ||
      !Number.isFinite(input.timeMs) || !Number.isFinite(signal.sampledAtMs) || signal.sampledAtMs > frame.timeMs || input.timeMs < frame.timeMs) return 0;
  const age = input.timeMs - signal.sampledAtMs;
  const freshness = clamp((SIGNAL_STALE_MS - age) / 500);
  return clamp(input.controls.sound) * (0.12 + clamp(signal.value) * clamp(input.controls.sensitivity) * 0.25) * freshness;
}

export function sampleSound(timeSeconds: number, scene: SceneId, level: number): number {
  const pitch = pitches[scene];
  if (!Object.hasOwn(pitches, scene)) throw new Error('Unknown sound scene');
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || !Number.isFinite(level)) return 0;
  const phase = 2 * Math.PI * pitch * timeSeconds;
  return Math.min(MAX_LEVEL, Math.max(0, level)) * (Math.sin(phase) * 0.76 + Math.sin(phase * 2) * 0.16 + Math.sin(phase * 3) * 0.08);
}

function approachLevel(level: number, target: number, sampleRate: number): number {
  const step = MAX_LEVEL / (sampleRate * FADE_SECONDS);
  return level + Math.max(-step, Math.min(step, target - level));
}

export function createSound() {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  const sources = new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();
  let enabled = false;
  let disposed = false;
  let generation = 0;
  let transition: Promise<void> = Promise.resolve();
  let disposal: Promise<void> | null = null;
  let nextTime = 0;
  let previousLevel = 0;
  let timelineOffset: number | null = null;
  let previousScene: SceneId | null = null;
  let previousSession: string | null = null;
  let previousTime = 0;

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const result = transition.then(operation);
    transition = result.catch(() => {});
    return result;
  }

  function clearSources() {
    for (const item of sources) {
      item.source.onended = null;
      item.source.stop();
      item.source.disconnect();
      item.gain.disconnect();
    }
    sources.clear();
    timelineOffset = null;
    previousScene = null;
    previousSession = null;
    previousLevel = 0;
  }

  async function silence() {
    if (!context || !master) return;
    if (context.state === 'running' && sources.size) {
      const now = context.currentTime;
      master.gain.cancelAndHoldAtTime(now);
      master.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
      await new Promise(resolve => setTimeout(resolve, FADE_SECONDS * 1000 + 5));
    }
    clearSources();
  }

  return {
    get enabled() { return enabled; },
    enable(): Promise<void> {
      if (disposed) return Promise.reject(new Error('Sound is disposed'));
      if (enabled) return Promise.resolve();
      const current = ++generation;
      if (!context) {
        context = new AudioContext();
        master = context.createGain();
        master.connect(context.destination);
      }
      const active = context;
      const activation = active.resume().then(() => true, () => false);
      return enqueue(async () => {
        const activated = await activation;
        if (disposed || current !== generation) return;
        if (!activated) throw new Error('Audio could not start. Try enabling sound again.');
        await active.resume();
        if (disposed || current !== generation) return;
        master!.gain.cancelScheduledValues(active.currentTime);
        master!.gain.setValueAtTime(1, active.currentTime);
        nextTime = active.currentTime;
        enabled = true;
      });
    },
    update(input: SceneFrame, scene: SceneId) {
      if (!enabled || !context || !master || context.state !== 'running') return;
      if (!Object.hasOwn(pitches, scene)) throw new Error('Unknown sound scene');
      const now = context.currentTime;
      const timeSeconds = Number.isFinite(input.timeMs) && input.timeMs >= 0 ? input.timeMs / 1000 : 0;
      const session = input.frame?.sessionId ?? null;
      if (timelineOffset === null || previousScene !== scene || previousSession !== session || timeSeconds < previousTime || Math.abs(timeSeconds - now - timelineOffset) > 0.025) {
        for (const item of sources) {
          item.gain.gain.cancelAndHoldAtTime(now);
          item.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
          item.source.stop(now + FADE_SECONDS);
        }
        timelineOffset = timeSeconds - now;
        nextTime = now;
        previousLevel = 0;
        previousScene = scene;
        previousSession = session;
      }
      previousTime = timeSeconds;
      const rate = context.sampleRate;
      const fadeSamples = Math.max(2, Math.round(rate * FADE_SECONDS));
      const count = fadeSamples * 4;
      const hop = count - fadeSamples;
      const target = audioLevel(input);
      while (nextTime < now + 0.04 && sources.size < 8) {
        const starts = Math.max(Math.ceil((now + 0.002) * rate) / rate, nextTime);
        const buffer = context.createBuffer(1, count, rate);
        const samples = buffer.getChannelData(0);
        let level = previousLevel;
        for (let index = 0; index < count; index++) {
          level = approachLevel(level, target, rate);
          const envelope = Math.min(1, index / (fadeSamples - 1), (count - 1 - index) / (fadeSamples - 1));
          samples[index] = sampleSound(Math.max(0, starts + timelineOffset + index / rate), scene, level) * envelope;
          if (index === hop - 1) previousLevel = level;
        }
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(master);
        const item = { source, gain };
        source.onended = () => { source.disconnect(); gain.disconnect(); sources.delete(item); };
        try {
          source.start(starts);
          sources.add(item);
        } catch (error) {
          source.onended = null;
          source.disconnect();
          gain.disconnect();
          throw error;
        }
        nextTime = starts + hop / rate;
      }
    },
    disable(): Promise<void> {
      enabled = false;
      generation++;
      if (disposed) return disposal!;
      return enqueue(async () => {
        await silence();
        if (context && context.state !== 'closed') await context.suspend();
      });
    },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      disposed = true;
      enabled = false;
      generation++;
      disposal = enqueue(async () => {
        await silence();
        if (context && context.state !== 'closed') await context.close();
        master?.disconnect();
        master = null;
        context = null;
      });
      return disposal;
    },
  };
}

export async function renderWav(take: Take, scene: SceneId, controls: SceneControls, signal?: AbortSignal): Promise<Blob> {
  take = validateTake(take);
  if (take.durationMs <= 0 || !take.samples.length) throw new Error('Record a nonempty take first.');
  if (!Object.hasOwn(pitches, scene)) throw new Error('Unknown sound scene');
  for (const value of [controls.motion, controls.sensitivity, controls.sound]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Sound controls must be between zero and one');
  }
  controls = { ...controls };
  signal?.throwIfAborted();
  const rate = 48_000;
  const count = Math.ceil(take.durationMs / 1000 * rate);
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
  let cursor = 0;
  let level = 0;
  const sampleMs = 1000 / TAKE_LIMITS.samplesPerSecond;
  const input: SceneFrame = { timeMs: 0, seed: take.seed, controls, frame: null, reducedMotion: false };
  for (let i = 0; i < count; i++) {
    if (i % rate === 0) {
      signal?.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    }
    const timeMs = i / rate * 1000;
    while (cursor + 1 < take.samples.length && take.samples[cursor + 1].timeMs <= timeMs) cursor++;
    const frame = take.samples[cursor];
    input.timeMs = timeMs;
    input.frame = frame.timeMs <= timeMs && timeMs - frame.timeMs < sampleMs ? frame : null;
    level = approachLevel(level, audioLevel(input), rate);
    const envelope = Math.min(1, i / (rate * FADE_SECONDS), (count - 1 - i) / (rate * FADE_SECONDS));
    view.setInt16(44 + i * 2, Math.round(sampleSound(i / rate, scene, level) * envelope * 32767), true);
  }
  signal?.throwIfAborted();
  return new Blob([bytes], { type: 'audio/wav' });
}
