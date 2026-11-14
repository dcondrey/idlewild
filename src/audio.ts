import type { SceneFrame, SceneId, Take, SceneControls } from './contracts.ts';
import { TAKE_LIMITS } from './contracts.ts';
import { validateTake } from './validation.ts';
import { frameAt } from './recording.ts';
import { createSoundEngine } from './sound/dsp.ts';
import type { SoundEngine } from './sound/dsp.ts';
import { SOUND_SCENES, soundParams } from './sound/params.ts';

export { soundParams } from './sound/params.ts';
export { MAX_LEVEL } from './sound/dsp.ts';

const FADE_SECONDS = 0.01;
const LIVE_BLOCK = 1024;
const LIVE_HORIZON_SECONDS = 0.1;
const MAX_LIVE_SOURCES = 12;
const WAV_RATE = 48_000;
const CONTROL_SECONDS = 0.01;

// The live engine feeds short stereo AudioBuffers from the main thread rather than an AudioWorklet. The DSP and parameter
// mapping are the same modules the WAV render uses; a worklet would need a Vite-only asset URL that the unit tests cannot load.
export function createSound() {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  const sources = new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();
  let enabled = false;
  let disposed = false;
  let generation = 0;
  let transition: Promise<void> = Promise.resolve();
  let disposal: Promise<void> | null = null;
  let engine: SoundEngine | null = null;
  let nextFrame = 0;
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
    engine = null;
    previousScene = null;
    previousSession = null;
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
        engine = null;
        enabled = true;
      });
    },
    update(input: SceneFrame, scene: SceneId) {
      if (!enabled || !context || !master || context.state !== 'running') return;
      const params = soundParams(input, scene);
      const now = context.currentTime;
      const rate = context.sampleRate;
      const timeSeconds = Number.isFinite(input.timeMs) && input.timeMs >= 0 ? input.timeMs / 1000 : 0;
      const session = input.frame?.sessionId ?? null;
      if (!engine || previousScene !== scene || previousSession !== session || timeSeconds < previousTime) {
        for (const item of sources) {
          item.gain.gain.cancelAndHoldAtTime(now);
          item.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
          item.source.stop(now + FADE_SECONDS);
        }
        engine = createSoundEngine(scene, input.seed, rate);
        nextFrame = Math.ceil((now + 0.002) * rate);
        previousScene = scene;
        previousSession = session;
      }
      previousTime = timeSeconds;
      const earliest = Math.ceil((now + 0.002) * rate);
      if (nextFrame < earliest) nextFrame = earliest;
      while (nextFrame / rate < now + LIVE_HORIZON_SECONDS && sources.size < MAX_LIVE_SOURCES) {
        const buffer = context.createBuffer(2, LIVE_BLOCK, rate);
        engine.render(params, buffer.getChannelData(0), buffer.getChannelData(1), 0, LIVE_BLOCK);
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(master);
        const item = { source, gain };
        source.onended = () => { source.disconnect(); gain.disconnect(); sources.delete(item); };
        try {
          source.start(nextFrame / rate);
          sources.add(item);
        } catch (error) {
          source.onended = null;
          source.disconnect();
          gain.disconnect();
          throw error;
        }
        nextFrame += LIVE_BLOCK;
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
  if (!SOUND_SCENES.includes(scene)) throw new Error('Unknown sound scene');
  for (const value of [controls.motion, controls.sensitivity, controls.sound]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Sound controls must be between zero and one');
  }
  controls = { ...controls };
  signal?.throwIfAborted();
  const rate = WAV_RATE;
  const count = Math.ceil(take.durationMs / 1000 * rate);
  const dataBytes = count * 4;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, dataBytes, true);
  const engine = createSoundEngine(scene, take.seed, rate);
  const block = Math.round(rate * CONTROL_SECONDS);
  const left = new Float32Array(block), right = new Float32Array(block);
  const fade = rate * FADE_SECONDS;
  const input: SceneFrame = { timeMs: 0, seed: take.seed, controls, frame: null, reducedMotion: false };
  const pcm = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * 32767);
  for (let start = 0; start < count; start += block) {
    if (start % rate < block) {
      signal?.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    }
    const n = Math.min(block, count - start);
    input.timeMs = start / rate * 1000;
    input.frame = frameAt(take, input.timeMs);
    engine.render(soundParams(input, scene), left, right, 0, n);
    for (let i = 0; i < n; i++) {
      const index = start + i;
      const envelope = Math.min(1, index / fade, (count - 1 - index) / fade);
      view.setInt16(44 + index * 4, pcm(left[i] * envelope), true);
      view.setInt16(46 + index * 4, pcm(right[i] * envelope), true);
    }
  }
  signal?.throwIfAborted();
  return new Blob([bytes], { type: 'audio/wav' });
}
