import test from 'node:test';
import assert from 'node:assert/strict';
import { audioLevel, createSound, renderWav, sampleSound } from '../src/audio.ts';
import { rehearsalFrame } from '../src/rehearsal.ts';
import type { SceneControls, SceneFrame, Take } from '../src/contracts.ts';

const controls: SceneControls = { motion: 1, sensitivity: 0.8, sound: 0.7 };

function take(durationMs = 500, times = Array.from({ length: Math.ceil(durationMs / 50) }, (_, index) => index * 50)): Take {
  return {
    version: 1, id: 'audio-test', sessionId: 'audio-session', source: 'rehearsal', seed: 4, durationMs,
    samples: times.map(time => {
      const frame = rehearsalFrame(4, 'audio-session', time);
      frame.signals.breath.value = 0.4;
      return frame;
    }),
  };
}

async function decode(blob: Blob) {
  const bytes = await blob.arrayBuffer();
  const view = new DataView(bytes);
  const text = (start: number, length: number) => new TextDecoder().decode(bytes.slice(start, start + length));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(12, 4), 'fmt ');
  assert.equal(text(36, 4), 'data');
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 48_000);
  assert.equal(view.getUint32(28, true), 96_000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), bytes.byteLength - 44);
  const samples = new Float64Array((bytes.byteLength - 44) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32767;
  return { bytes, samples };
}

function rms(samples: Float64Array): number {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

test('audio separates valid zero from missing, unstable, stale and malformed signals', () => {
  const frame = rehearsalFrame(4, 'audio-session', 2000);
  const input: SceneFrame = { timeMs: 2000, seed: 4, frame, controls, reducedMotion: false };
  frame.signals.breath.value = 0;
  assert.ok(audioLevel(input) > 0);
  frame.signals.breath.sampledAtMs = 501;
  assert.ok(audioLevel(input) > 0);
  frame.signals.breath.sampledAtMs = 500;
  assert.equal(audioLevel(input), 0);
  frame.signals.breath.sampledAtMs = 499;
  assert.equal(audioLevel(input), 0);
  frame.signals.breath.sampledAtMs = 2001;
  assert.equal(audioLevel(input), 0);
  frame.signals.breath.sampledAtMs = 2000;
  frame.signals.breath.quality = 'unstable';
  assert.equal(audioLevel(input), 0);
  frame.signals.breath.quality = 'valid';
  frame.signals.breath.value = NaN;
  assert.equal(audioLevel(input), 0);
  frame.signals.breath.value = null;
  assert.equal(audioLevel(input), 0);
  input.frame = null;
  assert.equal(audioLevel(input), 0);
});

test('local movement controls sound without inventing breath and expires at the tracking limit', () => {
  const frame = rehearsalFrame(1, 'local', 1000);
  frame.source = 'local-camera';
  frame.signals.breath.value = null;
  frame.tracking = { sampledAtMs: 1000, face: null, body: { leftWrist: [0, 1, 0, 1] }, movement: 0.8 };
  const input = { frame, timeMs: 1000, seed: 1, controls, reducedMotion: false };
  assert.ok(audioLevel(input) > 0);
  input.timeMs = 1299; assert.ok(audioLevel(input) > 0);
  input.timeMs = 1300; assert.equal(audioLevel(input), 0);
  input.timeMs = 1301; assert.equal(audioLevel(input), 0);
  input.timeMs = 1000; frame.tracking.movement = 0; assert.equal(audioLevel(input), 0);
  frame.tracking.movement = null; assert.equal(audioLevel(input), 0);
});

test('WAV decodes to bounded deterministic PCM with the shared pitch and amplitude model', async () => {
  const source = take();
  const result = await renderWav(source, 'robot', controls);
  assert.equal(result.type, 'audio/wav');
  const { bytes, samples } = await decode(result);
  assert.equal(samples.length, 24_000);
  assert.equal(samples[0], 0);
  assert.equal(samples.at(-1), 0);
  assert.ok(rms(samples) > 0.07 && rms(samples) < 0.13);
  assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) <= 0.37));
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  assert.ok(Math.abs(crossings - 55) <= 1);
  const index = 6240;
  const level = audioLevel({ timeMs: 130, seed: 4, frame: source.samples[2], controls, reducedMotion: false });
  assert.ok(Math.abs(samples[index] - sampleSound(index / 48_000, 'robot', level)) <= 1 / 32767);
  assert.deepEqual(await (await renderWav(source, 'robot', controls)).arrayBuffer(), bytes);
  const other = await decode(await renderWav(source, 'bubbles', controls));
  assert.notDeepEqual(other.bytes, bytes);
  const quieter = await decode(await renderWav(source, 'robot', { ...controls, sound: controls.sound / 2 }));
  assert.ok(Math.abs(rms(quieter.samples) / rms(samples) - 0.5) < 0.02);
  const insensitive = await decode(await renderWav(source, 'robot', { ...controls, sensitivity: 0 }));
  assert.ok(rms(insensitive.samples) < rms(samples));
});

test('WAV preserves gaps with a bounded release and does not turn absent channels into sound', async () => {
  const source = take(500, [0, 300]);
  const { samples } = await decode(await renderWav(source, 'star', controls));
  assert.ok(rms(samples.subarray(480, 1920)) > 0.02);
  assert.ok(samples.subarray(2880, 14_400).every(value => value === 0));
  assert.ok(rms(samples.subarray(15_360, 16_320)) > 0.02);
  const muted = await decode(await renderWav(source, 'star', { ...controls, sound: 0 }));
  assert.ok(muted.samples.every(value => value === 0));
  for (const frame of source.samples) { frame.signals.breath.value = null; frame.signals.breath.quality = 'missing'; }
  const missing = await decode(await renderWav(source, 'star', controls));
  assert.ok(missing.samples.every(value => value === 0));
  for (const frame of source.samples) { frame.signals.breath.value = 0.8; frame.signals.breath.quality = 'stale'; }
  const stale = await decode(await renderWav(source, 'star', controls));
  assert.ok(stale.samples.every(value => value === 0));
});

test('WAV rejects invalid allocation inputs and cancels before or during rendering', async () => {
  await assert.rejects(renderWav(take(0, []), 'robot', controls), /nonempty/);
  await assert.rejects(renderWav({ ...take(), durationMs: NaN }, 'robot', controls), /duration/);
  await assert.rejects(renderWav(take(), 'robot', { ...controls, sound: Infinity }), /controls/);
  await assert.rejects(renderWav(take(), 'not-a-scene' as never, controls), /scene/);
  const cancelled = AbortSignal.abort(new Error('cancelled'));
  for (const duration of [179_999, 180_000]) await assert.rejects(renderWav(take(duration, [0]), 'robot', controls, cancelled), /cancelled/);
  await assert.rejects(renderWav(take(180_001, [0]), 'robot', controls, cancelled), /duration/);
  const controller = new AbortController();
  const rendering = renderWav(take(5000), 'robot', controls, controller.signal);
  controller.abort(new Error('cancelled while rendering'));
  await assert.rejects(rendering, /cancelled while rendering/);
});

test('sound stays dormant until enabled and closes when disposed during a pending resume', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  let created = 0, closed = 0;
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    constructor() { created++; }
    createGain() { return { connect() {}, disconnect() {}, gain: { cancelScheduledValues() {}, setValueAtTime() {} } }; }
    async resume() { await gate; this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; closed++; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'AudioContext', original); else Reflect.deleteProperty(globalThis, 'AudioContext'); });
  const sound = createSound();
  assert.equal(created, 0);
  const enabling = sound.enable();
  const disabling = sound.disable();
  const disposing = sound.dispose();
  resume();
  await Promise.all([enabling, disabling, disposing]);
  assert.equal(sound.enabled, false);
  assert.equal(created, 1);
  assert.equal(closed, 1);
  await sound.dispose();
  assert.equal(closed, 1);
  await assert.rejects(sound.enable(), /disposed/);
});
