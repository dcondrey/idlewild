import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4 } from 'three';
import { BODY_JOINTS, FACE_SHAPES, TRACKING_STALE_MS } from '../src/contracts.ts';
import type { CaptureStatus, ControlFrame, TrackingFrame } from '../src/contracts.ts';
import { createTrackingMapper, FRAMING_ENTER_MARGIN, FRAMING_EXIT_MARGIN, MIN_JOINT_CONFIDENCE, RETAIN_JOINT_CONFIDENCE } from '../src/tracking/mapping.ts';
import { createLocalTrackingSource, TRACKING_FRAME_TIMEOUT_MS, TRACKING_INTERVAL_MS, TRACKING_START_TIMEOUT_MS, TRACKING_STOP_TIMEOUT_MS } from '../src/tracking/source.ts';
import { validateFrame } from '../src/validation.ts';

function face() {
  return {
    faceLandmarks: [Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))],
    faceBlendshapes: [{ categories: FACE_SHAPES.map(categoryName => ({ categoryName, score: 0.25 })) }],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: new Matrix4().toArray() }],
  };
}

function pose(offset = 0, certainty = 1) {
  return {
    landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: certainty, presence: certainty }))],
    worldLandmarks: [Array.from({ length: 33 }, () => ({ x: 0.1 + offset, y: 0.2, z: -0.3, visibility: certainty, presence: certainty }))],
  };
}

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function setScore(result: ReturnType<typeof face>, name: string, score: number) {
  result.faceBlendshapes[0].categories.find(value => value.categoryName === name)!.score = score;
}

const REPLAY = {
  body: { base: 0.1, step: 0.3, speed: 0.3, middle: 0, noise: 0.005 },
  face: { base: 0.1, step: 0.8, speed: 0.4, middle: 0.4, noise: 0.01 },
  head: { base: 0, step: 0.5, speed: 0.5, middle: 0, noise: 0.01 },
} as const;
type ReplayChannel = keyof typeof REPLAY;
const REPLAY_CHANNELS = Object.keys(REPLAY) as ReplayChannel[];
const REPLAY_SECONDS = 0.05;

function replay(frames: number, offset: (index: number, channel: ReplayChannel) => number | null, noisy = false) {
  const map = createTrackingMapper('local-replay');
  const next = random(20261111);
  const input: Record<ReplayChannel, number[]> = { body: [], face: [], head: [] };
  const output: Record<ReplayChannel, number[]> = { body: [], face: [], head: [] };
  for (let index = 0; index < frames; index++) {
    let tracking: TrackingFrame;
    if (offset(index, 'body') === null) tracking = map(null, null, index * REPLAY_SECONDS * 1000).tracking!;
    else {
      const sample = {} as Record<ReplayChannel, number>;
      for (const channel of REPLAY_CHANNELS) {
        const noise = noisy ? REPLAY[channel].noise * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()) : 0;
        sample[channel] = REPLAY[channel].base + offset(index, channel)! + noise;
        input[channel].push(sample[channel] - REPLAY[channel].base);
      }
      const result = face();
      setScore(result, 'mouthSmileLeft', sample.face);
      result.facialTransformationMatrixes[0].data = new Matrix4().makeRotationZ(sample.head).toArray();
      tracking = map(result, pose(sample.body - 0.1), index * REPLAY_SECONDS * 1000).tracking!;
    }
    output.body.push(tracking.body!.leftShoulder![0] - REPLAY.body.base);
    output.face.push(tracking.face!.weights.mouthSmileLeft - REPLAY.face.base);
    output.head.push(2 * Math.atan2(tracking.face!.rotation![2], tracking.face!.rotation![3]));
  }
  return { input, output };
}

function rms(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

test('local tracking keeps unavailable input and all physiological channels missing', () => {
  const frame = validateFrame(createTrackingMapper('local-test')(null, null, 0));
  assert.equal(frame.source, 'local-camera');
  assert.deepEqual(frame.tracking, { sampledAtMs: 0, face: null, body: null, movement: null, framing: { face: false, upperBody: false, fullBody: false, tooClose: false } });
  for (const signal of Object.values(frame.signals)) {
    assert.equal(signal.quality, 'missing');
    assert.equal(signal.value, null);
    assert.equal(signal.confidence, null);
  }
});

test('face blendshapes preserve measured weights and reject missing, duplicate and nonfinite values', () => {
  const map = createTrackingMapper('local-test');
  assert.equal(map(face(), null, 0).tracking?.face?.weights.jawOpen, 0.25);
  const incomplete = face();
  incomplete.faceBlendshapes[0].categories.pop();
  assert.equal(map(incomplete, null, 1000).tracking?.face, null);
  const duplicate = face();
  duplicate.faceBlendshapes[0].categories.push(duplicate.faceBlendshapes[0].categories[0]);
  assert.equal(map(duplicate, null, 2000).tracking?.face, null);
  const invalid = face();
  invalid.faceBlendshapes[0].categories[0].score = NaN;
  assert.equal(map(invalid, null, 3000).tracking?.face, null);
  invalid.faceBlendshapes[0].categories[0].score = 1.01;
  assert.equal(map(invalid, null, 4000).tracking?.face, null);
  invalid.faceBlendshapes[0].categories[0].score = 1;
  assert.equal(map(invalid, null, 5000).tracking?.face?.weights.eyeBlinkLeft, 1);
});

test('column-major head transforms retain identity and signed rotation while rejecting shear and reflections', () => {
  const map = createTrackingMapper('local-test');
  const result = face();
  assert.deepEqual(map(result, null, 0).tracking?.face?.rotation, [0, 0, 0, 1]);
  result.facialTransformationMatrixes[0].data = new Matrix4().makeRotationZ(Math.PI / 3).toArray();
  const rotation = map(result, null, 1000).tracking?.face?.rotation;
  assert.ok(rotation);
  assert.ok(Math.abs(rotation[2] - 0.5) < 1e-10);
  assert.ok(Math.abs(rotation[3] - Math.sqrt(3) / 2) < 5e-6);
  result.facialTransformationMatrixes[0].data = new Matrix4().makeScale(-1, 1, 1).toArray();
  assert.equal(map(result, null, 2000).tracking?.face?.rotation, null);
  result.facialTransformationMatrixes[0].data = new Matrix4().makeShear(0.2, 0, 0, 0, 0, 0).toArray();
  assert.equal(map(result, null, 3000).tracking?.face?.rotation, null);
});

test('body coordinates use meters with up and camera-facing positive axes', () => {
  const frame = createTrackingMapper('local-test')(null, pose(), 0);
  assert.deepEqual(frame.tracking?.body?.leftShoulder, [0.1, -0.2, 0.3, 1]);
  assert.deepEqual(Object.keys(frame.tracking!.body!), [...BODY_JOINTS]);
  assert.doesNotThrow(() => validateFrame(frame));
});

test('recorded estimates use five decimal places without rounding timestamps or confidence filtering', () => {
  const map = createTrackingMapper('local-test');
  const result = face();
  for (const category of result.faceBlendshapes[0].categories) category.score = 0.123456789;
  result.facialTransformationMatrixes[0].data = new Matrix4().makeRotationZ(0.54321).toArray();
  const body = pose(0.023456789, 0.87654321);
  for (const point of body.worldLandmarks[0]) { point.y = 0.23456789; point.z = -0.34567891; }
  body.landmarks[0][11].visibility = RETAIN_JOINT_CONFIDENCE - 0.0000001;
  map(result, body, 11.123456789);
  const frame = map(result, body, 100.987654321);
  assert.equal(frame.timeMs, 100.987654321);
  assert.equal(frame.tracking?.sampledAtMs, frame.timeMs);
  assert.ok(Object.values(frame.signals).every(signal => signal.sampledAtMs === frame.timeMs));
  assert.equal(frame.tracking?.face?.weights.jawOpen, 0.12346);
  assert.equal(frame.tracking?.body?.leftShoulder, undefined);
  assert.deepEqual(frame.tracking!.body!.rightShoulder, [0.12346, -0.23457, 0.34568, 0.87654]);
  const rotation = frame.tracking!.face!.rotation!;
  assert.ok(Math.abs(Math.hypot(...rotation) - 1) < 1e-5);
  const values = [...FACE_SHAPES.map(name => frame.tracking!.face!.weights[name]!), ...rotation, ...Object.values(frame.tracking!.body!).flat(), frame.tracking!.movement!];
  assert.ok(values.every(value => Math.abs(value * 100000 - Math.round(value * 100000)) < 1e-8));
  assert.doesNotThrow(() => validateFrame(frame));
});

test('visibility and coordinate boundaries omit unreliable joints instead of inventing positions', () => {
  const map = createTrackingMapper('local-test');
  assert.equal(map(null, pose(0, MIN_JOINT_CONFIDENCE - 0.001), 0).tracking?.body, null);
  assert.ok(map(null, pose(0, MIN_JOINT_CONFIDENCE), 1).tracking?.body);
  assert.ok(map(null, pose(0, MIN_JOINT_CONFIDENCE + 0.001), 2).tracking?.body);
  const result = pose();
  result.worldLandmarks[0][11].x = NaN;
  result.landmarks[0][12].presence = 0;
  result.landmarks[0][13].x = 1.001;
  result.worldLandmarks[0][14].z = 5.001;
  result.worldLandmarks[0][15].z = 5;
  const body = createTrackingMapper('local-test')(null, result, 3).tracking?.body;
  assert.ok(body);
  for (const name of ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow'] as const) assert.equal(body[name], undefined);
  assert.equal(body.leftWrist?.[2], -5);
});

test('movement uses filtered joints measured in consecutive frames and resets after gaps or absence', () => {
  const map = createTrackingMapper('local-test');
  assert.equal(map(null, pose(), 0).tracking?.movement, null);
  const started = map(null, pose(0.1), 100).tracking!.movement!;
  assert.ok(started > 0 && started < 0.5);
  assert.equal(map(null, pose(1), 200).tracking?.movement, 1);
  let settled = 1;
  for (let time = 250; time <= 700; time += 50) {
    const movement = map(null, pose(1), time).tracking!.movement!;
    assert.ok(movement <= settled);
    settled = movement;
  }
  assert.ok(settled < 0.001);
  const absent = map(null, null, 750).tracking!;
  assert.equal(absent.movement, null);
  assert.ok(absent.body);
  assert.equal(map(null, pose(1), 850).tracking?.movement, null);
  assert.equal(map(null, pose(1), 850 + TRACKING_STALE_MS).tracking?.movement, 0);
  assert.equal(map(null, pose(1), 851 + 2 * TRACKING_STALE_MS).tracking?.movement, null);
  assert.throws(() => map(null, null, 851 + 2 * TRACKING_STALE_MS), /timestamp/);
  assert.throws(() => map(null, null, NaN), /timestamp/);
});

test('movement does not infer activity from fewer than three common visible joints', () => {
  const map = createTrackingMapper('local-test');
  map(null, pose(), 0);
  const result = pose(0.1, 0);
  for (const index of [11, 12]) {
    result.landmarks[0][index].presence = result.landmarks[0][index].visibility = 1;
    result.worldLandmarks[0][index].presence = result.worldLandmarks[0][index].visibility = 1;
  }
  assert.equal(map(null, result, 100).tracking?.movement, null);
});

test('joint hysteresis keeps measured confidence and requires reacquisition after real loss', () => {
  const map = createTrackingMapper('local-test');
  assert.equal(map(null, pose(0, MIN_JOINT_CONFIDENCE - 0.001), 0).tracking?.body, null);
  assert.equal(map(null, pose(0, MIN_JOINT_CONFIDENCE), 50).tracking?.body?.leftShoulder?.[3], MIN_JOINT_CONFIDENCE);
  assert.equal(map(null, pose(0, RETAIN_JOINT_CONFIDENCE), 100).tracking?.body?.leftShoulder?.[3], RETAIN_JOINT_CONFIDENCE);
  const lost = map(null, pose(0, RETAIN_JOINT_CONFIDENCE - 0.000001), 150).tracking!;
  assert.equal(lost.body?.leftShoulder?.[3], RETAIN_JOINT_CONFIDENCE);
  assert.equal(lost.movement, null);
  assert.equal(map(null, pose(0, MIN_JOINT_CONFIDENCE - 0.001), 200).tracking?.body?.leftShoulder?.[3], RETAIN_JOINT_CONFIDENCE);
  assert.equal(map(null, pose(0, MIN_JOINT_CONFIDENCE), 250).tracking?.body?.leftShoulder?.[3], MIN_JOINT_CONFIDENCE);
  assert.equal(map(null, pose(0, RETAIN_JOINT_CONFIDENCE), 551).tracking?.body, null);
});

test('short dropouts hold the last estimate with fading confidence and expire at the freshness limit', () => {
  const map = createTrackingMapper('local-test');
  const measured = map(face(), pose(), 0).tracking!;
  const held = validateFrame(map(null, null, 150)).tracking!;
  assert.deepEqual(held.body!.leftShoulder!.slice(0, 3), measured.body!.leftShoulder!.slice(0, 3));
  assert.equal(held.body!.leftShoulder![3], 0.725);
  assert.deepEqual(held.face, measured.face);
  assert.equal(held.movement, null);
  assert.deepEqual(held.framing, measured.framing);
  const last = validateFrame(map(null, null, TRACKING_STALE_MS - 1)).tracking!;
  assert.ok(last.face && last.body!.leftShoulder![3] > RETAIN_JOINT_CONFIDENCE);
  const expired = validateFrame(map(null, null, TRACKING_STALE_MS)).tracking!;
  assert.equal(expired.body, null);
  assert.equal(expired.face, null);
  assert.deepEqual(expired.framing, { face: false, upperBody: false, fullBody: false, tooClose: false });
});

test('deterministic replay meets calibrated jitter, step, ramp, dropout, fine-motion and blink bounds', t => {
  const noisy = replay(200, (_, channel) => REPLAY[channel].middle, true);
  const step = replay(20, (index, channel) => index >= 5 ? REPLAY[channel].step : 0);
  const ramp = replay(40, (index, channel) => REPLAY[channel].speed * index * REPLAY_SECONDS);
  const dropped = replay(30, (index, channel) => index >= 10 && index < 14 ? null : REPLAY[channel].speed * index * REPLAY_SECONDS);
  const fine = replay(200, (index, channel) => REPLAY[channel].middle + 0.02 * Math.sin(2 * Math.PI * index * REPLAY_SECONDS));
  const metrics: Record<string, Record<string, number>> = {};
  for (const channel of REPLAY_CHANNELS) {
    const { step: size, speed, middle } = REPLAY[channel];
    const response = step.output[channel];
    const recovered = dropped.output[channel];
    const gap = speed * 14 * REPLAY_SECONDS - recovered[13];
    const tail = fine.output[channel].slice(100);
    const lag = ramp.output[channel].slice(20).map((value, index) => (speed * (index + 20) * REPLAY_SECONDS - value) / speed * 1000);
    const result = metrics[channel] = {
      jitterReduction: 1 - rms(noisy.output[channel].slice(20).map(value => value - middle)) / rms(noisy.input[channel].slice(20).map(value => value - middle)),
      stepAt100Ms: response[7] / size,
      overshoot: Math.max(...response) - size,
      rampLagMs: lag.reduce((sum, value) => sum + value, 0) / lag.length,
      recoveryFirstFrame: (recovered[14] - recovered[13]) / gap,
      recoveryOvershoot: Math.max(...recovered.slice(14).map((value, index) => value - speed * (index + 14) * REPLAY_SECONDS)),
      recoveryResidualAt250Ms: Math.abs(recovered[19] - ramp.output[channel][19]) / gap,
      fineGain: (Math.max(...tail) - Math.min(...tail)) / 0.04,
    };
    assert.ok(result.jitterReduction >= 0.7, `${channel} jitter`);
    assert.ok(result.stepAt100Ms >= 0.9, `${channel} step`);
    assert.ok(result.overshoot <= 1e-4, `${channel} overshoot`);
    for (let index = 10; index < 14; index++) assert.equal(recovered[index], recovered[9], `${channel} hold`);
    assert.ok(result.recoveryFirstFrame > 0 && result.recoveryFirstFrame <= 0.6, `${channel} recovery snap`);
    assert.ok(result.recoveryOvershoot <= 1e-4, `${channel} recovery overshoot`);
    assert.ok(result.recoveryResidualAt250Ms <= 0.1, `${channel} recovery`);
    assert.ok(result.fineGain >= 0.4, `${channel} fine motion`);
  }
  const map = createTrackingMapper('local-blink');
  const blink: number[] = [];
  for (let index = 0; index < 12; index++) {
    const result = face();
    setScore(result, 'eyeBlinkLeft', index === 5 || index === 6 ? 1 : 0);
    blink.push(map(result, pose(), index * REPLAY_SECONDS * 1000).tracking!.face!.weights.eyeBlinkLeft);
  }
  metrics.blink = { peak: Math.max(...blink), at100MsAfterRelease: blink[8] };
  assert.ok(metrics.blink.peak >= 0.9 && metrics.blink.at100MsAfterRelease <= 0.1);
  t.diagnostic(`replay ${JSON.stringify(metrics)}`);
});

test('filtering is deterministic and resets after freshness expires', () => {
  const a = createTrackingMapper('a'), b = createTrackingMapper('a');
  for (let index = 0; index < 12; index++) {
    const result = index === 5 ? null : face();
    const body = index === 5 ? null : pose(Math.sin(index) * 0.004);
    assert.deepEqual(a(result, body, index * 50), b(result, body, index * 50));
  }
  const reset = a(face(), pose(0.5), 1000).tracking!;
  assert.equal(reset.body?.leftShoulder?.[0], 0.6);
  assert.equal(reset.face?.weights.jawOpen, 0.25);
  assert.equal(reset.movement, null);
});

test('independent face observations keep their own clock without repeated smoothing or stale reuse', () => {
  const map = createTrackingMapper('local-test');
  const original = map(face(), pose(), 0).tracking!.face!;
  const changed = face();
  setScore(changed, 'jawOpen', 0.8);
  const repeated = map(changed, pose(0.01), 50, 0).tracking!;
  assert.deepEqual(repeated.face, original);
  const advanced = map(changed, pose(0.02), 100, 100).tracking!;
  assert.ok(advanced.face!.weights.jawOpen > 0.5 && advanced.face!.weights.jawOpen < 0.8);
  assert.equal(advanced.face!.sampledAtMs, 100);
  const stale = map(changed, pose(0.03), 400, 100).tracking!;
  assert.equal(stale.face, null);
  assert.ok(stale.body);
  assert.throws(() => map(changed, pose(), 450, 451), /face timestamp/);
});

test('switching the face camera restarts face filtering instead of blending viewpoints', () => {
  const map = createTrackingMapper('local-test');
  map(face(), pose(), 0, 0, 'face');
  const changed = face();
  setScore(changed, 'jawOpen', 0.8);
  assert.equal(map(changed, pose(), 50, 50, 'body').tracking?.face?.weights.jawOpen, 0.8);
  const filtered = map(face(), pose(), 100, 100, 'body').tracking!.face!.weights.jawOpen;
  assert.ok(filtered > 0.25 && filtered < 0.8);
});

test('framing flags follow emitted landmarks and hold too-close prompts across the margin band', () => {
  const map = createTrackingMapper('local-test');
  let time = 0;
  const framing = (margin: number | null) => {
    const body = margin === null ? null : pose();
    if (body) body.landmarks[0][27].x = margin!;
    time += 50;
    return validateFrame(map(face(), body, time)).tracking!.framing!;
  };
  assert.deepEqual(framing(0.5), { face: true, upperBody: true, fullBody: true, tooClose: false });
  assert.equal(framing(FRAMING_ENTER_MARGIN + 0.001).tooClose, false);
  assert.equal(framing(FRAMING_ENTER_MARGIN).tooClose, true);
  assert.equal(framing(FRAMING_EXIT_MARGIN - 0.001).tooClose, true);
  assert.equal(framing(FRAMING_EXIT_MARGIN).tooClose, false);
  assert.equal(framing(FRAMING_ENTER_MARGIN - 0.001).tooClose, true);
  assert.equal(framing(FRAMING_EXIT_MARGIN + 0.001).tooClose, false);
  assert.equal(framing(FRAMING_ENTER_MARGIN).tooClose, true);
  time += TRACKING_STALE_MS - 50;
  assert.equal(framing(null).tooClose, true);
  time -= 49;
  assert.equal(framing(null).tooClose, false);
  assert.equal(framing(FRAMING_EXIT_MARGIN - 0.001).tooClose, false);
  const cut = pose();
  cut.landmarks[0][27].y = cut.landmarks[0][28].y = 1.2;
  assert.deepEqual(validateFrame(createTrackingMapper('local-test')(face(), cut, 0)).tracking!.framing, { face: true, upperBody: true, fullBody: false, tooClose: true });
  assert.deepEqual(validateFrame(createTrackingMapper('local-test')(face(), null, 0)).tracking!.framing, { face: true, upperBody: false, fullBody: false, tooClose: false });
});

class Timers {
  time = 0;
  next = 0;
  jobs = new Map<number, { at: number; callback: () => void }>();
  set = (callback: () => void, delay: number) => {
    const id = ++this.next;
    this.jobs.set(id, { at: this.time + delay, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clear = (id: ReturnType<typeof setTimeout> | number) => { this.jobs.delete(id as unknown as number); };
  advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const first = [...this.jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      this.time = first[1].at;
      this.jobs.delete(first[0]);
      first[1].callback();
    }
    this.time = end;
  }
}

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  messages: { type: string; id?: number; timeMs?: number; bitmap?: ImageBitmap; faceBitmap?: ImageBitmap | null; faceTimeMs?: number | null; transfer?: Transferable[] }[] = [];
  terminated = false;
  acknowledgeStop = true;
  postMessage(message: unknown, transfer?: Transferable[]) {
    const data = message as typeof this.messages[number];
    this.messages.push({ ...data, transfer });
    if (data.type === 'stop' && this.acknowledgeStop) this.emit({ type: 'stopped' });
  }
  emit(data: unknown) { this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}

function harness(bitmap?: (video: HTMLVideoElement, options: ImageBitmapOptions) => Promise<ImageBitmap>, faceVideo?: HTMLVideoElement) {
  const timers = new Timers();
  const workers: FakeWorker[] = [];
  const video = { currentTime: 0, videoWidth: 1920, videoHeight: 1080, readyState: 2 } as HTMLVideoElement;
  const frames: ControlFrame[] = [];
  const phases: string[] = [];
  const bitmaps: { width: number; height: number; closed: boolean; close(): void }[] = [];
  const source = createLocalTrackingSource(video, {
    faceVideo,
    createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    createBitmap: bitmap ?? (async (_video, options) => {
      const result = { width: options.resizeWidth!, height: options.resizeHeight!, closed: false, close() { this.closed = true; } };
      bitmaps.push(result);
      return result as ImageBitmap;
    }),
    now: () => timers.time, setTimer: timers.set, clearTimer: timers.clear,
    assetsBase: 'https://idlewild.test/tracking/', sessionId: () => 'local-test',
  });
  const onFrame = (frame: ControlFrame) => { frames.push(frame); };
  const onStatus = (status: CaptureStatus) => { phases.push(status.phase); };
  return { source, timers, workers, video, frames, phases, bitmaps, onFrame, onStatus };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

function secondaryVideo() {
  return { currentTime: 0, videoWidth: 1280, videoHeight: 720, readyState: 2 } as HTMLVideoElement;
}

function ownedImage() {
  return { width: 960, height: 540, closes: 0, close() { this.closes++; } } as ImageBitmap & { closes: number };
}

test('two-camera jobs transfer distinct images and keep missing, stale and resumed face input independent', async () => {
  const secondary = secondaryVideo();
  Object.defineProperty(secondary, 'readyState', { value: 1, configurable: true });
  const h = harness(undefined, secondary);
  const map = createTrackingMapper('local-test');
  const starting = h.source.start(h.onFrame, h.onStatus);
  h.workers[0].emit({ type: 'ready' });
  await starting;
  h.timers.advance(0);
  await settle();
  const first = h.workers[0].messages.at(-1)!;
  assert.equal(first.faceBitmap, null);
  assert.equal(first.faceTimeMs, null);
  assert.equal(first.transfer?.length, 1);
  h.workers[0].emit({ type: 'frame', id: first.id, frame: map(null, pose(), first.timeMs!) });
  assert.ok(h.frames.at(-1)?.tracking?.body);
  assert.equal(h.frames.at(-1)?.tracking?.face, null);

  async function next(at: number) {
    h.timers.advance(at - h.timers.time - 1);
    h.video.currentTime += 1;
    h.timers.advance(1);
    await settle();
    return h.workers[0].messages.at(-1)!;
  }
  Object.defineProperty(secondary, 'readyState', { value: 2, configurable: true });
  const withFace = await next(50);
  assert.ok(withFace.faceBitmap);
  assert.notEqual(withFace.bitmap, withFace.faceBitmap);
  assert.deepEqual(withFace.transfer, [withFace.bitmap, withFace.faceBitmap]);
  assert.equal(withFace.faceTimeMs, 50);
  h.workers[0].emit({ type: 'frame', id: withFace.id, frame: map(face(), pose(), 50, 50) });
  const repeated = await next(100);
  assert.equal(repeated.faceBitmap, null);
  assert.equal(repeated.faceTimeMs, 50);
  h.workers[0].emit({ type: 'frame', id: repeated.id, frame: map(face(), pose(), 100, 50) });
  assert.equal(h.frames.at(-1)?.tracking?.face?.sampledAtMs, 50);
  const stale = await next(350);
  assert.equal(stale.faceBitmap, null);
  assert.equal(stale.faceTimeMs, null);
  h.workers[0].emit({ type: 'frame', id: stale.id, frame: map(null, pose(), 350) });
  assert.ok(h.frames.at(-1)?.tracking?.body);
  assert.equal(h.frames.at(-1)?.tracking?.face, null);
  secondary.currentTime = 1;
  const resumed = await next(400);
  assert.ok(resumed.faceBitmap);
  assert.equal(resumed.faceTimeMs, 400);
  h.workers[0].emit({ type: 'frame', id: resumed.id, frame: map(face(), pose(), 400, 400) });
  assert.equal(h.phases.at(-1), 'ready');
  await h.source.stop();
  assert.equal(h.timers.jobs.size, 0);
});

test('stopping a dual-camera copy closes both owned and late images exactly once', async () => {
  const secondary = secondaryVideo();
  const primaryImage = ownedImage(), faceImage = ownedImage();
  let completePrimary!: (bitmap: ImageBitmap) => void;
  const h = harness(video => video === secondary ? Promise.resolve(faceImage) : new Promise(resolve => { completePrimary = resolve; }), secondary);
  const starting = h.source.start(h.onFrame, h.onStatus);
  h.workers[0].emit({ type: 'ready' });
  await starting;
  h.timers.advance(0);
  await settle();
  await h.source.stop();
  assert.equal(faceImage.closes, 1);
  completePrimary(primaryImage);
  await settle();
  assert.equal(primaryImage.closes, 1);
  assert.equal(faceImage.closes, 1);
  assert.equal(h.workers[0].messages.filter(message => message.type === 'frame').length, 0);
  assert.equal(h.timers.jobs.size, 0);
});

test('a stalled secondary bitmap does not block primary body input or enqueue more face copies', async () => {
  const secondary = secondaryVideo();
  const late = ownedImage();
  let completeFace!: (bitmap: ImageBitmap) => void;
  let faceCopies = 0;
  const h = harness(video => {
    if (video !== secondary) return Promise.resolve(ownedImage());
    faceCopies++;
    return faceCopies === 1 ? new Promise(resolve => { completeFace = resolve; }) : Promise.resolve(ownedImage());
  }, secondary);
  const starting = h.source.start(h.onFrame, h.onStatus);
  h.workers[0].emit({ type: 'ready' });
  await starting;
  h.timers.advance(0);
  await settle();
  h.timers.advance(TRACKING_INTERVAL_MS);
  await settle();
  const first = h.workers[0].messages.at(-1)!;
  assert.equal(first.type, 'frame');
  assert.equal(first.faceBitmap, null);
  assert.equal(first.faceTimeMs, null);
  h.workers[0].emit({ type: 'frame', id: first.id, frame: createTrackingMapper('local-test')(null, pose(), first.timeMs!) });
  h.video.currentTime = 1;
  h.timers.advance(0);
  await settle();
  const second = h.workers[0].messages.at(-1)!;
  assert.equal(second.id, 2);
  assert.equal(faceCopies, 1);
  completeFace(late);
  await settle();
  assert.equal(late.closes, 1);
  h.workers[0].emit({ type: 'frame', id: second.id, frame: createTrackingMapper('local-test')(null, pose(), second.timeMs!) });
  h.video.currentTime = 2;
  secondary.currentTime = 1;
  h.timers.advance(TRACKING_INTERVAL_MS);
  await settle();
  assert.equal(faceCopies, 2);
  assert.ok(h.workers[0].messages.at(-1)?.faceBitmap);
  await h.source.stop();
  assert.equal(late.closes, 1);
  assert.equal(h.timers.jobs.size, 0);
});

test('source requires worker readiness, bounds images and keeps one frame in flight', async () => {
  const h = harness();
  const starting = h.source.start(h.onFrame, h.onStatus);
  assert.equal(h.workers[0].messages.length, 1);
  h.workers[0].emit({ type: 'ready' });
  await starting;
  h.timers.advance(0);
  await Promise.resolve();
  assert.equal(h.workers[0].messages.length, 2);
  assert.deepEqual([h.bitmaps[0].width, h.bitmaps[0].height], [960, 540]);
  h.timers.advance(TRACKING_INTERVAL_MS * 2);
  assert.equal(h.bitmaps.length, 1);
  const frame = createTrackingMapper('local-test')(face(), pose(), 0);
  h.workers[0].emit({ type: 'frame', id: 1, frame });
  assert.equal(h.frames[0].timeMs, TRACKING_INTERVAL_MS * 2);
  assert.equal(h.frames[0].tracking?.sampledAtMs, 0);
  h.timers.advance(0);
  assert.equal(h.bitmaps.length, 1);
  await h.source.stop();
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.timers.jobs.size, 0);
  await h.source.dispose();
  await assert.rejects(h.source.start(h.onFrame, h.onStatus), /disposed/);
});

test('source startup deadline is bounded and waits for shutdown before rejection', async () => {
  const h = harness();
  const starting = h.source.start(h.onFrame, h.onStatus);
  const rejection = assert.rejects(starting, /startup timed out/);
  h.workers[0].acknowledgeStop = false;
  h.timers.advance(TRACKING_START_TIMEOUT_MS - 1);
  assert.equal(h.workers[0].messages.length, 1);
  h.timers.advance(1);
  assert.equal(h.workers[0].messages.at(-1)?.type, 'stop');
  assert.equal(h.workers[0].terminated, false);
  await assert.rejects(h.source.start(h.onFrame, h.onStatus), /already active/);
  h.timers.advance(TRACKING_STOP_TIMEOUT_MS);
  await rejection;
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.timers.jobs.size, 0);
});

test('missing initial video frames become stale at 300ms and stop at 3000ms without extending on retries', async () => {
  const h = harness();
  Object.defineProperty(h.video, 'readyState', { value: 1 });
  const starting = h.source.start(h.onFrame, h.onStatus);
  h.workers[0].emit({ type: 'ready' });
  await starting;
  h.timers.advance(TRACKING_STALE_MS - 1);
  assert.equal(h.phases.at(-1), 'warming');
  h.timers.advance(1);
  assert.equal(h.phases.at(-1), 'poor-signal');
  const phaseCount = h.phases.length;
  h.timers.advance(1);
  assert.equal(h.phases.length, phaseCount);
  h.timers.advance(TRACKING_FRAME_TIMEOUT_MS - TRACKING_STALE_MS - 2);
  assert.equal(h.workers[0].terminated, false);
  h.workers[0].acknowledgeStop = false;
  h.timers.advance(1);
  assert.equal(h.phases.at(-1), 'error');
  assert.equal(h.workers[0].messages.at(-1)?.type, 'stop');
  let stopped = false;
  const stopping = h.source.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  await assert.rejects(h.source.start(h.onFrame, h.onStatus), /already active/);
  h.timers.advance(1);
  assert.equal(h.workers[0].terminated, false);
  h.timers.advance(TRACKING_STOP_TIMEOUT_MS - 1);
  await stopping;
  assert.equal(stopped, true);
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.bitmaps.length, 0);
  assert.equal(h.timers.jobs.size, 0);
});

test('video freezing after a successful result preserves the progress deadline and cleans up on restart', async () => {
  const h = harness();
  const starting = h.source.start(h.onFrame, h.onStatus);
  h.workers[0].emit({ type: 'ready' });
  await starting;
  h.timers.advance(0);
  await Promise.resolve();
  h.workers[0].emit({ type: 'frame', id: 1, frame: createTrackingMapper('local-test')(face(), pose(), 0) });
  assert.equal(h.phases.at(-1), 'ready');
  const lateCallbacks = [...h.timers.jobs.values()].map(job => job.callback);
  h.timers.advance(TRACKING_STALE_MS - 1);
  assert.equal(h.phases.at(-1), 'ready');
  h.timers.advance(1);
  assert.equal(h.phases.at(-1), 'poor-signal');
  h.timers.advance(1);
  assert.equal(h.frames.length, 1);
  h.timers.advance(TRACKING_FRAME_TIMEOUT_MS - TRACKING_STALE_MS - 2);
  assert.equal(h.workers[0].terminated, false);
  h.timers.advance(1);
  assert.equal(h.workers[0].terminated, true);
  h.timers.advance(1);
  assert.equal(h.timers.jobs.size, 0);
  const restarting = h.source.start(h.onFrame, h.onStatus);
  h.workers[1].emit({ type: 'ready' });
  await restarting;
  const phaseCount = h.phases.length;
  const timerCount = h.timers.jobs.size;
  for (const callback of lateCallbacks) callback();
  assert.equal(h.phases.length, phaseCount);
  assert.equal(h.timers.jobs.size, timerCount);
  h.timers.advance(0);
  await Promise.resolve();
  h.workers[1].emit({ type: 'frame', id: 1, frame: createTrackingMapper('local-test')(face(), pose(), 0) });
  assert.equal(h.phases.at(-1), 'ready');
  await h.source.stop();
  assert.equal(h.workers[1].terminated, true);
  assert.equal(h.timers.jobs.size, 0);
});

test('only an advancing video frame resets the watchdog and cancels its queued predecessor', async () => {
  const h = harness();
  const starting = h.source.start(h.onFrame, h.onStatus);
  h.workers[0].emit({ type: 'ready' });
  await starting;
  const oldWatchdog = [...h.timers.jobs.values()].find(job => job.at === TRACKING_STALE_MS)!.callback;
  h.timers.advance(TRACKING_INTERVAL_MS);
  await Promise.resolve();
  h.workers[0].emit({ type: 'frame', id: 1, frame: createTrackingMapper('local-test')(face(), pose(), 0) });
  oldWatchdog();
  assert.equal(h.phases.at(-1), 'ready');
  h.video.currentTime = 1;
  h.timers.advance(TRACKING_INTERVAL_MS);
  await Promise.resolve();
  const second = h.workers[0].messages.filter(message => message.type === 'frame')[1];
  assert.ok(second);
  h.workers[0].emit({ type: 'frame', id: second.id, frame: createTrackingMapper('local-test')(face(), pose(), second.timeMs!) });
  h.timers.advance(second.timeMs! + TRACKING_STALE_MS - 1 - h.timers.time);
  assert.equal(h.phases.at(-1), 'ready');
  h.timers.advance(1);
  assert.equal(h.phases.at(-1), 'poor-signal');
  await h.source.stop();
  assert.equal(h.timers.jobs.size, 0);
});

test('pending bitmap is closed after stop and never reaches a replacement worker', async () => {
  let complete!: (bitmap: ImageBitmap) => void;
  const h = harness(() => new Promise(resolve => { complete = resolve; }));
  const starting = h.source.start(h.onFrame, h.onStatus);
  h.workers[0].emit({ type: 'ready' });
  await starting;
  h.timers.advance(0);
  await h.source.stop();
  const replacement = h.source.start(h.onFrame, h.onStatus);
  h.workers[1].emit({ type: 'ready' });
  await replacement;
  let closed = false;
  complete({ close: () => { closed = true; } } as ImageBitmap);
  await Promise.resolve();
  assert.equal(closed, true);
  assert.equal(h.workers[1].messages.length, 1);
  assert.equal(h.frames.length, 0);
  await h.source.stop();
});

test('inference deadline ignores late output and permanently releases that worker', async () => {
  const h = harness();
  const starting = h.source.start(h.onFrame, h.onStatus);
  h.workers[0].emit({ type: 'ready' });
  await starting;
  h.timers.advance(0);
  await Promise.resolve();
  const lateHandler = h.workers[0].onmessage;
  h.timers.advance(TRACKING_FRAME_TIMEOUT_MS - 1);
  assert.equal(h.workers[0].terminated, false);
  h.timers.advance(1);
  assert.equal(h.workers[0].terminated, true);
  lateHandler?.({ data: { type: 'frame', id: 1, frame: createTrackingMapper('local-test')(face(), pose(), 0) } });
  h.timers.advance(1);
  assert.equal(h.frames.length, 0);
  assert.equal(h.timers.jobs.size, 0);
});

test('source rejects altered worker identity and timestamps without exposing output', async () => {
  for (const change of ['identity', 'timestamp'] as const) {
    const h = harness();
    const starting = h.source.start(h.onFrame, h.onStatus);
    h.workers[0].emit({ type: 'ready' });
    await starting;
    h.timers.advance(0);
    await Promise.resolve();
    h.timers.advance(10);
    const frame = createTrackingMapper(change === 'identity' ? 'wrong-session' : 'local-test')(face(), pose(), change === 'timestamp' ? 1 : 0);
    h.workers[0].emit({ type: 'frame', id: 1, frame });
    assert.equal(h.workers[0].terminated, true);
    assert.equal(h.frames.length, 0);
    assert.equal(h.phases.at(-1), 'error');
  }
});

test('reentrant startup cancellation and callback failures release resources', async () => {
  const h = harness();
  const starting = h.source.start(h.onFrame, status => {
    if (status.phase === 'starting') void h.source.stop();
  });
  await assert.rejects(starting, /cancelled/);
  assert.equal(h.workers[0].terminated, true);
  assert.deepEqual(h.workers[0].messages.map(message => message.type), ['stop']);
  const failing = h.source.start(h.onFrame, status => { if (status.phase === 'warming') throw new Error('consumer'); });
  h.workers[1].emit({ type: 'ready' });
  await assert.rejects(failing, /invalid result/);
  assert.equal(h.workers[1].terminated, true);
  assert.equal(h.timers.jobs.size, 0);
});

test('framing summaries validate as optional flags consistent with tracked landmarks', () => {
  const frame = createTrackingMapper('local-test')(face(), pose(), 0);
  const framed = (framing: unknown) => validateFrame({ ...frame, tracking: { ...frame.tracking, framing } });
  assert.deepEqual(validateFrame(frame).tracking?.framing, { face: true, upperBody: true, fullBody: true, tooClose: false });
  assert.deepEqual(framed({ face: true, upperBody: true, fullBody: false, tooClose: true }).tracking?.framing, { face: true, upperBody: true, fullBody: false, tooClose: true });
  assert.throws(() => framed({ face: true, upperBody: true, fullBody: true }), /framing/);
  assert.throws(() => framed({ face: 1, upperBody: true, fullBody: true, tooClose: false }), /framing/);
  assert.throws(() => framed({ face: true, upperBody: false, fullBody: true, tooClose: false }), /contradicts/);
  const faceless = createTrackingMapper('local-test')(null, pose(), 0);
  assert.throws(() => validateFrame({ ...faceless, tracking: { ...faceless.tracking, framing: { face: true, upperBody: true, fullBody: true, tooClose: false } } }), /contradicts/);
});
