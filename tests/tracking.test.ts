import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4 } from 'three';
import { BODY_JOINTS, FACE_SHAPES, TRACKING_STALE_MS } from '../src/contracts.ts';
import type { CaptureStatus, ControlFrame } from '../src/contracts.ts';
import { createTrackingMapper, MIN_JOINT_CONFIDENCE, RETAIN_JOINT_CONFIDENCE } from '../src/tracking/mapping.ts';
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

test('local tracking keeps unavailable input and all physiological channels missing', () => {
  const frame = validateFrame(createTrackingMapper('local-test')(null, null, 0));
  assert.equal(frame.source, 'local-camera');
  assert.deepEqual(frame.tracking, { sampledAtMs: 0, face: null, body: null, movement: null });
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
  assert.equal(map(incomplete, null, 1).tracking?.face, null);
  const duplicate = face();
  duplicate.faceBlendshapes[0].categories.push(duplicate.faceBlendshapes[0].categories[0]);
  assert.equal(map(duplicate, null, 2).tracking?.face, null);
  const invalid = face();
  invalid.faceBlendshapes[0].categories[0].score = NaN;
  assert.equal(map(invalid, null, 3).tracking?.face, null);
  invalid.faceBlendshapes[0].categories[0].score = 1.01;
  assert.equal(map(invalid, null, 4).tracking?.face, null);
  invalid.faceBlendshapes[0].categories[0].score = 1;
  assert.equal(map(invalid, null, 5).tracking?.face?.weights.eyeBlinkLeft, 1);
});

test('column-major head transforms retain identity and signed rotation while rejecting shear and reflections', () => {
  const map = createTrackingMapper('local-test');
  const result = face();
  assert.deepEqual(map(result, null, 0).tracking?.face?.rotation, [0, 0, 0, 1]);
  result.facialTransformationMatrixes[0].data = new Matrix4().makeRotationZ(Math.PI / 3).toArray();
  const rotation = map(result, null, 1).tracking?.face?.rotation;
  assert.ok(rotation);
  assert.ok(Math.abs(rotation[2] - 0.5) < 1e-10);
  assert.ok(Math.abs(rotation[3] - Math.sqrt(3) / 2) < 5e-6);
  result.facialTransformationMatrixes[0].data = new Matrix4().makeScale(-1, 1, 1).toArray();
  assert.equal(map(result, null, 2).tracking?.face?.rotation, null);
  result.facialTransformationMatrixes[0].data = new Matrix4().makeShear(0.2, 0, 0, 0, 0, 0).toArray();
  assert.equal(map(result, null, 3).tracking?.face?.rotation, null);
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
  map(result, pose(), 11.123456789);
  const body = pose(0.023456789, 0.87654321);
  for (const point of body.worldLandmarks[0]) { point.y = 0.23456789; point.z = -0.34567891; }
  body.landmarks[0][11].visibility = RETAIN_JOINT_CONFIDENCE - 0.0000001;
  const frame = map(result, body, 100.987654321);
  assert.equal(frame.timeMs, 100.987654321);
  assert.equal(frame.tracking?.sampledAtMs, frame.timeMs);
  assert.ok(Object.values(frame.signals).every(signal => signal.sampledAtMs === frame.timeMs));
  assert.equal(frame.tracking?.face?.weights.jawOpen, 0.12346);
  assert.equal(frame.tracking?.body?.leftShoulder, undefined);
  const shoulder = frame.tracking!.body!.rightShoulder!;
  assert.ok(Math.abs(shoulder[0] - 0.12346) < 0.001 && Math.abs(shoulder[1] + 0.23457) < 0.001 && Math.abs(shoulder[2] - 0.34568) < 0.001);
  assert.equal(shoulder[3], 0.87654);
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
  const body = map(null, result, 3).tracking?.body;
  assert.ok(body);
  for (const name of ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow'] as const) assert.equal(body[name], undefined);
  assert.equal(body.leftWrist?.[2], -5);
});

test('movement requires consecutive common visible joints and resets after gaps or absence', () => {
  const map = createTrackingMapper('local-test');
  assert.equal(map(null, pose(), 0).tracking?.movement, null);
  const movement = map(null, pose(0.1), 100).tracking!.movement!;
  assert.ok(movement > 0.49 && movement <= 0.5);
  assert.equal(map(null, pose(1), 200).tracking?.movement, 1);
  assert.equal(map(null, pose(1), 300).tracking?.movement, 0);
  assert.equal(map(null, null, 400).tracking?.movement, null);
  assert.equal(map(null, pose(1), 500).tracking?.movement, null);
  assert.equal(map(null, pose(1), 500 + TRACKING_STALE_MS).tracking?.movement, 0);
  assert.equal(map(null, pose(1), 501 + 2 * TRACKING_STALE_MS).tracking?.movement, null);
  assert.throws(() => map(null, null, 501 + 2 * TRACKING_STALE_MS), /timestamp/);
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
  assert.ok(map(null, pose(0, MIN_JOINT_CONFIDENCE), 50).tracking?.body);
  assert.equal(map(null, pose(0, RETAIN_JOINT_CONFIDENCE), 100).tracking?.body?.leftShoulder?.[3], RETAIN_JOINT_CONFIDENCE);
  assert.equal(map(null, pose(0, RETAIN_JOINT_CONFIDENCE - 0.000001), 150).tracking?.body, null);
  assert.equal(map(null, pose(0, MIN_JOINT_CONFIDENCE - 0.001), 200).tracking?.body, null);
  assert.ok(map(null, pose(0, MIN_JOINT_CONFIDENCE), 250).tracking?.body);
  assert.equal(map(null, pose(0, RETAIN_JOINT_CONFIDENCE), 551).tracking?.body, null);
});

test('adaptive filtering attenuates stationary noise while preserving fast motion and single-frame blinks', () => {
  const map = createTrackingMapper('local-test');
  const result = face();
  for (const category of result.faceBlendshapes[0].categories) category.score = 0;
  map(result, pose(), 0);
  let bodyNoise = 0, faceNoise = 0, headNoise = 0;
  for (let index = 1; index <= 20; index++) {
    const sign = index % 2 ? 1 : -1;
    result.faceBlendshapes[0].categories.find(value => value.categoryName === 'mouthSmileLeft')!.score = 0.1 + sign * 0.015;
    result.facialTransformationMatrixes[0].data = new Matrix4().makeRotationZ(sign * 0.01).toArray();
    const tracking = map(result, pose(sign * 0.006), index * 50).tracking!;
    if (index > 4) {
      bodyNoise += Math.abs(tracking.body!.leftShoulder![0] - 0.1);
      faceNoise += Math.abs(tracking.face!.weights.mouthSmileLeft - 0.1);
      headNoise += Math.abs(2 * Math.atan2(tracking.face!.rotation![2], tracking.face!.rotation![3]));
    }
  }
  assert.ok(bodyNoise / 16 < 0.006 * 0.75);
  assert.ok(faceNoise / 16 < 0.015 * 0.75);
  assert.ok(headNoise / 16 < 0.01 * 0.75);
  result.faceBlendshapes[0].categories.find(value => value.categoryName === 'eyeBlinkLeft')!.score = 1;
  result.faceBlendshapes[0].categories.find(value => value.categoryName === 'jawOpen')!.score = 0.9;
  result.facialTransformationMatrixes[0].data = new Matrix4().makeRotationZ(0.5).toArray();
  const moved = map(result, pose(0.5), 1050).tracking!;
  assert.ok(moved.face!.weights.eyeBlinkLeft > 0.95 && moved.face!.weights.jawOpen > 0.85);
  assert.ok(moved.body!.leftShoulder![0] > 0.59);
  assert.ok(2 * Math.atan2(moved.face!.rotation![2], moved.face!.rotation![3]) > 0.49);
  result.faceBlendshapes[0].categories.find(value => value.categoryName === 'eyeBlinkLeft')!.score = 0;
  assert.ok(map(result, pose(0.5), 1100).tracking!.face!.weights.eyeBlinkLeft < 0.05);
});

test('filtering is deterministic, leaves dropouts explicit and resets after freshness expires', () => {
  const a = createTrackingMapper('a'), b = createTrackingMapper('a');
  for (let index = 0; index < 12; index++) {
    const result = index === 5 ? null : face();
    const body = index === 5 ? null : pose(Math.sin(index) * 0.004);
    assert.deepEqual(a(result, body, index * 50), b(result, body, index * 50));
  }
  const missing = a(null, null, 600).tracking!;
  assert.equal(missing.face, null);
  assert.equal(missing.body, null);
  assert.equal(missing.movement, null);
  const reset = a(face(), pose(0.5), 1000).tracking!;
  assert.equal(reset.body?.leftShoulder?.[0], 0.6);
  assert.equal(reset.face?.weights.jawOpen, 0.25);
  assert.equal(reset.movement, null);
});

test('independent face observations keep their own clock without repeated smoothing or stale reuse', () => {
  const map = createTrackingMapper('local-test');
  const original = map(face(), pose(), 0).tracking!.face!;
  const changed = face();
  changed.faceBlendshapes[0].categories.find(value => value.categoryName === 'jawOpen')!.score = 0.8;
  const repeated = map(changed, pose(0.01), 50, 0).tracking!;
  assert.deepEqual(repeated.face, original);
  const advanced = map(changed, pose(0.02), 100, 100).tracking!;
  assert.ok(advanced.face!.weights.jawOpen > 0.79);
  assert.equal(advanced.face!.sampledAtMs, 100);
  const stale = map(changed, pose(0.03), 400, 100).tracking!;
  assert.equal(stale.face, null);
  assert.ok(stale.body);
  assert.throws(() => map(changed, pose(), 450, 451), /face timestamp/);
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
  assert.equal(validateFrame(frame).tracking?.framing, undefined);
  assert.deepEqual(framed({ face: true, upperBody: true, fullBody: false, tooClose: true }).tracking?.framing, { face: true, upperBody: true, fullBody: false, tooClose: true });
  assert.throws(() => framed({ face: true, upperBody: true, fullBody: true }), /framing/);
  assert.throws(() => framed({ face: 1, upperBody: true, fullBody: true, tooClose: false }), /framing/);
  assert.throws(() => framed({ face: true, upperBody: false, fullBody: true, tooClose: false }), /contradicts/);
  const faceless = createTrackingMapper('local-test')(null, pose(), 0);
  assert.throws(() => validateFrame({ ...faceless, tracking: { ...faceless.tracking, framing: { face: true, upperBody: true, fullBody: true, tooClose: false } } }), /contradicts/);
});
