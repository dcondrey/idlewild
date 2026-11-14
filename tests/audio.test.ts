import test from 'node:test';
import assert from 'node:assert/strict';
import { createSound, renderWav, soundParams, MAX_LEVEL } from '../src/audio.ts';
import { rehearsalFrame } from '../src/rehearsal.ts';
import type { ControlFrame, SceneControls, SceneFrame, SceneId, Take } from '../src/contracts.ts';

const controls: SceneControls = { motion: 1, sensitivity: 0.8, sound: 0.7 };
const scenes: SceneId[] = ['rex', 'bubbles', 'star', 'runner', 'brain', 'imported'];

function take(durationMs = 500, times = Array.from({ length: Math.ceil(durationMs / 50) }, (_, index) => index * 50)): Take {
  return {
    version: 1, id: 'audio-test', sessionId: 'audio-session', source: 'rehearsal', seed: 4, durationMs,
    samples: times.map(time => {
      const frame = rehearsalFrame(4, 'audio-session', time);
      frame.signals.breath.value = 0.4;
      frame.signals.blink.value = 0;
      return frame;
    }),
  };
}

function missing(frame: ControlFrame, ...channels: (keyof ControlFrame['signals'])[]) {
  for (const channel of channels) { frame.signals[channel].value = null; frame.signals[channel].quality = 'missing'; }
}

function cameraTake(times: number[], durationMs: number, body?: NonNullable<ControlFrame['tracking']>['body']): Take {
  return {
    version: 1, id: 'camera-test', sessionId: 'camera-session', source: 'local-camera', seed: 9, durationMs,
    samples: times.map(time => {
      const frame = rehearsalFrame(9, 'camera-session', time);
      frame.source = 'local-camera';
      missing(frame, 'breath', 'breathingRate', 'pulseRate', 'arterialTrace', 'blink', 'talking');
      frame.tracking = { sampledAtMs: time, face: null, body: body ?? { leftWrist: [0, 1, 0, 1] }, movement: 0.8 };
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
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48_000);
  assert.equal(view.getUint32(28, true), 192_000);
  assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), bytes.byteLength - 44);
  const frames = (bytes.byteLength - 44) / 4;
  const left = new Float64Array(frames), right = new Float64Array(frames);
  for (let i = 0; i < frames; i++) { left[i] = view.getInt16(44 + i * 4, true) / 32767; right[i] = view.getInt16(46 + i * 4, true) / 32767; }
  return { bytes, left, right };
}

function rms(samples: Float64Array): number {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

const sceneFrame = (frame: ControlFrame | null, timeMs = 1000, over: Partial<SceneControls> = {}): SceneFrame =>
  ({ timeMs, seed: 4, frame, controls: { ...controls, ...over }, reducedMotion: false });

test('params are bounded, ignore visual reduced motion, and never escalate with breathing rate', () => {
  const frame = rehearsalFrame(4, 'audio-session', 1000);
  frame.signals.breath.value = 0.3;
  const base = soundParams(sceneFrame(frame), 'rex');
  assert.ok(base.voice > 0);
  assert.deepEqual(soundParams({ ...sceneFrame(frame), reducedMotion: true }, 'rex'), base);
  assert.deepEqual(soundParams({ ...sceneFrame(frame), controls: { ...controls, motion: 0 } }, 'rex'), base);
  for (const rate of [4, 15, 40, 120]) {
    frame.signals.breathingRate.value = rate;
    const params = soundParams(sceneFrame(frame), 'rex');
    assert.ok(params.phraseHz >= 0.1 && params.phraseHz <= 0.4);
    assert.equal(params.voice, base.voice);
  }
  assert.equal(soundParams(sceneFrame(frame, 1000, { sound: 0 }), 'rex').voice, 0);
  assert.throws(() => soundParams(sceneFrame(frame), 'nope' as never), /scene/);
});

test('params silence a channel that is missing, stale, unstable or malformed', () => {
  const frame = rehearsalFrame(4, 'audio-session', 2000);
  frame.signals.breath.value = 0;
  assert.ok(soundParams(sceneFrame(frame, 2000), 'rex').voice > 0);
  frame.signals.breath.sampledAtMs = 500;
  assert.equal(soundParams(sceneFrame(frame, 2000), 'rex').voice, 0);
  frame.signals.breath.sampledAtMs = 2001;
  assert.equal(soundParams(sceneFrame(frame, 2000), 'rex').voice, 0);
  frame.signals.breath.sampledAtMs = 2000;
  frame.signals.breath.quality = 'unstable';
  assert.equal(soundParams(sceneFrame(frame, 2000), 'rex').voice, 0);
  frame.signals.breath.quality = 'valid';
  frame.signals.breath.value = NaN;
  assert.equal(soundParams(sceneFrame(frame, 2000), 'rex').voice, 0);
  assert.equal(soundParams(sceneFrame(null), 'rex').voice, 0);
});

test('local tracking drives the voice without inventing breath and expires at the tracking limit', () => {
  const [frame] = cameraTake([1000], 2000).samples;
  assert.ok(soundParams(sceneFrame(frame, 1000), 'star').voice > 0);
  assert.equal(soundParams(sceneFrame(frame, 1000), 'star').air, 0);
  assert.ok(soundParams(sceneFrame(frame, 1100), 'star').voice > 0);
  assert.equal(soundParams(sceneFrame(frame, 1300), 'star').voice, 0);
  frame.tracking!.movement = 0;
  assert.equal(soundParams(sceneFrame(frame, 1000), 'star').voice, 0);
});

test('WAV is bounded, stereo, click-free at the edges and deterministic for every scene', async () => {
  const source = take();
  const previous: Float64Array[] = [];
  for (const scene of scenes) {
    const result = await renderWav(source, scene, controls);
    assert.equal(result.type, 'audio/wav');
    const { bytes, left, right } = await decode(result);
    assert.equal(left.length, 24_000);
    assert.equal(left[0], 0); assert.equal(right[0], 0);
    assert.equal(left.at(-1), 0); assert.equal(right.at(-1), 0);
    const peak = Math.max(...left.map(Math.abs), ...right.map(Math.abs));
    assert.ok(peak > 0.005 && peak <= MAX_LEVEL + 1 / 32767, `${scene} peak ${peak}`);
    assert.ok(rms(left) > 0.002 && rms(right) > 0.002, scene);
    assert.deepEqual(await (await renderWav(source, scene, controls)).arrayBuffer(), bytes);
    for (const other of previous) assert.notDeepEqual(other, left);
    previous.push(left);
  }
  const seeded = await decode(await renderWav({ ...source, seed: 5 }, 'bubbles', controls));
  assert.notDeepEqual(seeded.left, previous[1]);
});

test('WAV level follows the sound control and sensitivity changes the result', async () => {
  const source = take();
  const loud = await decode(await renderWav(source, 'star', controls));
  const quiet = await decode(await renderWav(source, 'star', { ...controls, sound: 0.2 }));
  assert.ok(rms(quiet.left) < rms(loud.left) * 0.5);
  const flat = await decode(await renderWav(source, 'star', { ...controls, sensitivity: 0 }));
  assert.notDeepEqual(flat.left, loud.left);
  const muted = await decode(await renderWav(source, 'star', { ...controls, sound: 0 }));
  assert.ok(muted.left.every(value => value === 0) && muted.right.every(value => value === 0));
});

test('WAV is silent with no usable input and a missing breath channel silences the breath layer', async () => {
  const single = take(2000, [0]);
  const gap = await decode(await renderWav(single, 'rex', controls));
  assert.ok(rms(gap.left.subarray(0, 2400)) > 0.002);
  assert.ok(gap.left.subarray(57_600).every(value => value === 0) && gap.right.subarray(57_600).every(value => value === 0), 'sound releases once the frame expires');
  for (const scene of scenes) {
    const source = take();
    for (const frame of source.samples) {
      missing(frame, 'breath');
      frame.signals.arterialTrace.value = 0.9; frame.signals.pulseRate.value = 120; frame.signals.breathingRate.value = 30;
    }
    const result = await decode(await renderWav(source, scene, controls));
    assert.ok(result.left.every(value => value === 0) && result.right.every(value => value === 0), `${scene} sounds without breath`);
  }
  const stale = take();
  for (const frame of stale.samples) { frame.signals.breath.value = 0.8; frame.signals.breath.quality = 'stale'; }
  assert.ok((await decode(await renderWav(stale, 'star', controls))).left.every(value => value === 0));
});

test('a blink rising edge ticks once and silence precedes it', async () => {
  const source = take(600);
  for (const frame of source.samples) { missing(frame, 'breath'); if (frame.timeMs >= 200) frame.signals.blink.value = 1; }
  const { left, right } = await decode(await renderWav(source, 'star', controls));
  assert.ok(left.subarray(0, 9600).every(value => value === 0) && right.subarray(0, 9600).every(value => value === 0));
  assert.ok(rms(left.subarray(9600, 10_400)) > 0.0015 || rms(right.subarray(9600, 10_400)) > 0.0015);
  assert.ok(rms(left.subarray(14_400, 28_800)) < 0.0005 && rms(right.subarray(14_400, 28_800)) < 0.0005);
});

test('WAV holds a tracked camera frame as long as playback does', async () => {
  const source = cameraTake([0, 200], 900);
  const { left, right } = await decode(await renderWav(source, 'star', controls));
  const held = rms(left.subarray(4800, 9120));
  assert.ok(held > 0.003 && rms(right.subarray(4800, 9120)) > 0.003);
  assert.ok(rms(left.subarray(38_400, 43_200)) < held * 0.2);
});

test('turning the body pans the stereo image', async () => {
  const turned = { leftShoulder: [-0.3, 0, 0.2, 1], rightShoulder: [0.3, 0, -0.2, 1] } as never;
  const mirrored = { leftShoulder: [-0.3, 0, -0.2, 1], rightShoulder: [0.3, 0, 0.2, 1] } as never;
  const a = await decode(await renderWav(cameraTake([0, 200, 400], 600, turned), 'star', controls));
  const b = await decode(await renderWav(cameraTake([0, 200, 400], 600, mirrored), 'star', controls));
  assert.ok(rms(a.right) > rms(a.left) * 1.3);
  assert.ok(rms(b.left) > rms(b.right) * 1.3);
});

test('WAV rejects invalid allocation inputs and cancels before or during rendering', async () => {
  await assert.rejects(renderWav(take(0, []), 'rex', controls), /nonempty/);
  await assert.rejects(renderWav({ ...take(), durationMs: NaN }, 'rex', controls), /duration/);
  await assert.rejects(renderWav(take(), 'rex', { ...controls, sound: Infinity }), /controls/);
  await assert.rejects(renderWav(take(), 'not-a-scene' as never, controls), /scene/);
  const cancelled = AbortSignal.abort(new Error('cancelled'));
  for (const duration of [179_999, 180_000]) await assert.rejects(renderWav(take(duration, [0]), 'rex', controls, cancelled), /cancelled/);
  await assert.rejects(renderWav(take(180_001, [0]), 'rex', controls, cancelled), /duration/);
  const controller = new AbortController();
  const rendering = renderWav(take(5000), 'rex', controls, controller.signal);
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

test('live engine renders stereo contiguous blocks only while enabled and restarts on scene change', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const buffers: { channels: Float32Array[] }[] = [];
  const started: number[] = [];
  let stopped = 0;
  const param = { cancelScheduledValues() {}, setValueAtTime() {}, cancelAndHoldAtTime() {}, linearRampToValueAtTime() {} };
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    sampleRate = 48_000;
    destination = {};
    createGain() { return { connect() {}, disconnect() {}, gain: param }; }
    createBuffer(channels: number, length: number) {
      const buffer = { channels: Array.from({ length: channels }, () => new Float32Array(length)), getChannelData(index: number) { return this.channels[index]; } };
      buffers.push(buffer);
      return buffer;
    }
    createBufferSource() {
      return { buffer: null, onended: null, connect() {}, disconnect() {}, start(time: number) { started.push(time); }, stop() { stopped++; } };
    }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'AudioContext', original); else Reflect.deleteProperty(globalThis, 'AudioContext'); });
  const frame = rehearsalFrame(4, 'live-session', 1000);
  const input = sceneFrame(frame);
  const sound = createSound();
  sound.update(input, 'rex');
  assert.equal(buffers.length, 0);
  await sound.enable();
  sound.update(input, 'rex');
  assert.ok(buffers.length >= 4);
  assert.ok(buffers.every(buffer => buffer.channels.length === 2));
  assert.ok(buffers.some(buffer => buffer.channels[0].some(value => value !== 0) && buffer.channels[1].some(value => value !== 0)));
  assert.ok(buffers.every(buffer => buffer.channels.every(channel => channel.every(value => Math.abs(value) <= MAX_LEVEL))));
  for (let i = 1; i < started.length; i++) assert.ok(Math.abs(started[i] - started[i - 1] - 1024 / 48_000) < 1e-9);
  const count = buffers.length;
  sound.update(input, 'rex');
  assert.equal(buffers.length, count);
  sound.update(input, 'star');
  assert.ok(stopped > 0 && buffers.length > count);
  await sound.disable();
  const after = buffers.length;
  sound.update(input, 'star');
  assert.equal(buffers.length, after);
  await sound.dispose();
});
