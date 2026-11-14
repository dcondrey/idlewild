import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamera } from '../src/camera.ts';
import type { DesktopBridge } from '../src/desktop';

test('camera stop cancels an unresolved permission request and releases late tracks', async () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  let resolveCamera!: (stream: MediaStream) => void;
  let requested = false;
  let stopped = 0;
  const permissions: boolean[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => null }) } });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => { requested = true; return new Promise<MediaStream>(resolve => { resolveCamera = resolve; }); } } });
  const bridge = { allowCamera: async (allowed: boolean) => { permissions.push(allowed); } } as DesktopBridge;
  const video = { srcObject: null, play: async () => {} } as unknown as HTMLVideoElement;
  try {
    const camera = createCamera(video, () => {}, bridge);
    const start = camera.start('selected-device');
    while (!requested) await new Promise(resolve => setTimeout(resolve, 0));
    const stop = camera.stop();
    resolveCamera({ getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream);
    await Promise.all([start, stop]);
    assert.equal(stopped, 1);
    assert.equal(camera.active, false);
    assert.equal(video.srcObject, null);
    assert.equal(permissions.at(-1), false);
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldMedia) Object.defineProperty(navigator, 'mediaDevices', oldMedia); else Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

test('camera cancellation during prior cleanup never opens another device', async () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let requested = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => null }) } });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => { requested++; throw new Error('Must not open'); } } });
  const bridge = { allowCamera: async () => barrier } as unknown as DesktopBridge;
  try {
    const camera = createCamera({ srcObject: null } as HTMLVideoElement, () => {}, bridge);
    const starting = camera.start('selected');
    const stopping = camera.stop();
    release();
    await Promise.all([starting, stopping]);
    assert.equal(requested, 0);
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldMedia) Object.defineProperty(navigator, 'mediaDevices', oldMedia); else Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

function fakeTrack(deviceId: string, capabilities?: object, opened = deviceId) {
  return {
    deviceId: opened, stops: 0, applied: [] as unknown[], onended: null as (() => void) | null,
    stop() { this.stops++; },
    getSettings() { return { deviceId: this.deviceId }; },
    ...(capabilities ? { getCapabilities: () => capabilities } : {}),
    async applyConstraints(constraints: unknown) { this.applied.push(constraints); },
  };
}

function streamOf(track: ReturnType<typeof fakeTrack>) {
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}

function preview() {
  return { srcObject: null as MediaStream | null, async play() {} };
}

async function withMedia(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>, run: () => Promise<void>) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => null }) } });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  try { await run(); } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldMedia) Object.defineProperty(navigator, 'mediaDevices', oldMedia); else Reflect.deleteProperty(navigator, 'mediaDevices');
  }
}

test('camera opens the widest native mode at minimum zoom and never accepts another device', async () => {
  const requests: MediaStreamConstraints[] = [];
  const wide = fakeTrack('body', { width: { max: 4032 }, height: { max: 3024 }, resizeMode: ['crop-and-scale', 'none'], zoom: { min: 0.5, max: 4 } });
  const uhd = fakeTrack('uhd', { width: { max: 3840 }, height: { max: 2160 } });
  const plain = fakeTrack('plain');
  const wrong = fakeTrack('selected', undefined, 'other');
  const queue = [wide, uhd, plain, wrong];
  await withMedia(async constraints => { requests.push(constraints); return streamOf(queue.shift()!); }, async () => {
    const permissions: boolean[] = [];
    const bridge = { allowCamera: async (allowed: boolean) => { permissions.push(allowed); } } as DesktopBridge;
    const video = preview();
    const camera = createCamera(video as unknown as HTMLVideoElement, () => {}, bridge);
    await camera.start('body');
    assert.deepEqual(requests[0], { audio: false, video: { deviceId: { exact: 'body' }, width: { ideal: 1920 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } } });
    assert.deepEqual(wide.applied, [{ width: { ideal: 1920 }, height: { ideal: 1440 }, frameRate: { ideal: 30 }, resizeMode: 'none', zoom: 0.5 }]);
    assert.equal(camera.deviceId, 'body');
    assert.ok(video.srcObject);
    await camera.start('uhd');
    assert.equal(wide.stops, 1);
    assert.deepEqual(uhd.applied, [{ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }]);
    await camera.start('plain');
    assert.deepEqual(plain.applied, []);
    assert.equal(camera.deviceId, 'plain');
    await assert.rejects(camera.start('selected'), /different device/);
    assert.equal(wrong.stops, 1);
    assert.equal(camera.active, false);
    assert.equal(video.srcObject, null);
    assert.equal(permissions.at(-1), false);
  });
});

test('face camera needs separate consent and a different device, and is released before reopening and on every stop', async () => {
  const opened: ReturnType<typeof fakeTrack>[] = [];
  let releasedBeforeReopen = false;
  await withMedia(async constraints => {
    const deviceId = ((constraints.video as MediaTrackConstraints).deviceId as { exact: string }).exact;
    if (deviceId === 'face-2') releasedBeforeReopen = opened.at(-1)!.stops === 1;
    const track = fakeTrack(deviceId);
    opened.push(track);
    return streamOf(track);
  }, async () => {
    const permissions: boolean[] = [];
    const bridge = { allowCamera: async (allowed: boolean) => { permissions.push(allowed); } } as DesktopBridge;
    const body = preview();
    const faceView = preview();
    let lost = 0;
    const camera = createCamera(body as unknown as HTMLVideoElement, () => {}, bridge);
    const request = (deviceId: string, consent = true) => ({ video: faceView as unknown as HTMLVideoElement, deviceId, consent, onDisconnect: () => { lost++; } });
    await assert.rejects(camera.openFace(request('face')), /body camera preview/);
    await camera.start('body');
    await assert.rejects(camera.openFace(request('face', false)), /consent/);
    await assert.rejects(camera.openFace(request('body')), /different/);
    await assert.rejects(camera.openFace({ ...request('face'), video: body as unknown as HTMLVideoElement }), /own preview/);
    assert.equal(opened.length, 1);
    await camera.openFace(request('face'));
    assert.equal(camera.faceDeviceId, 'face');
    assert.ok(faceView.srcObject);
    await camera.openFace(request('face-2'));
    assert.equal(releasedBeforeReopen, true);
    assert.equal(camera.faceDeviceId, 'face-2');
    opened.at(-1)!.onended!();
    assert.equal(lost, 1);
    assert.equal(camera.faceDeviceId, null);
    assert.equal(faceView.srcObject, null);
    assert.equal(camera.active, true);
    await camera.openFace(request('face'));
    const granted = permissions.length;
    await camera.closeFace();
    assert.equal(opened.at(-1)!.stops, 1);
    assert.equal(permissions.length, granted);
    assert.equal(camera.active, true);
    await camera.openFace(request('face'));
    await camera.start('body');
    assert.equal(opened.at(-2)!.stops, 1);
    assert.equal(camera.faceDeviceId, null);
    await camera.openFace(request('face'));
    await camera.stop();
    assert.ok(opened.every(track => track.stops === 1));
    assert.equal(faceView.srcObject, null);
    assert.equal(body.srcObject, null);
    assert.equal(permissions.at(-1), false);
    assert.equal(lost, 1);
  });
});

test('SmartSpectra frames keep a constant pixel budget across camera aspect ratios', async () => {
  const { sdkFrameSize } = await import('../src/camera.ts');
  assert.deepEqual(sdkFrameSize(640, 480), [640, 480]);
  assert.deepEqual(sdkFrameSize(320, 240), [320, 240]);
  for (const [width, height] of [[1920, 1080], [1920, 1440], [4032, 3024], [1280, 720]]) {
    const [w, h] = sdkFrameSize(width, height);
    assert.ok(w % 2 === 0 && h % 2 === 0 && w <= 1280 && h <= 720);
    assert.ok(w * h <= 640 * 480 && w * h > 640 * 480 * 0.98, `${width}x${height} -> ${w}x${h}`);
    assert.ok(Math.abs(w / h - width / height) < 0.01);
  }
});

test('live frames come from the camera track at its own rate with anchored, increasing capture timestamps', async () => {
  const { sdkFrameSize, nextFrameStamp } = await import('../src/camera.ts');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const oldProcessor = Object.getOwnPropertyDescriptor(globalThis, 'MediaStreamTrackProcessor');
  const context = { drawImage() {}, getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }) };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
  const clone = { stops: 0, stop() { this.stops++; } };
  const source = { ...fakeTrack('body'), readyState: 'live', clone: () => clone };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => streamOf(source as unknown as ReturnType<typeof fakeTrack>) } });
  let closed = 0;
  let cancelled = 0;
  const captureUs = [5_000_000, 5_033_333, 5_066_666, 5_100_000, 5_133_333];
  try {
    const calls: string[] = [];
    const sent: { width: number; height: number; stride: number; timestampUs: number; bytes: Uint8Array }[] = [];
    let reject = false;
    let disconnects = 0;
    const bridge = {
      allowCamera: async () => {}, stopLive: async () => { calls.push('stopLive'); },
      startLive: async () => { calls.push('startLive'); },
      sendFrame: async (frame: typeof sent[number]) => { if (reject) throw new Error('ipc'); sent.push(frame); return true; },
    } as unknown as DesktopBridge;
    const camera = createCamera(preview() as unknown as HTMLVideoElement, () => { disconnects++; }, bridge);
    await camera.start('body');
    Reflect.deleteProperty(globalThis, 'MediaStreamTrackProcessor');
    await assert.rejects(camera.startLive(), /cannot read camera frames/);
    assert.deepEqual(calls, [], 'no metered session starts when frames cannot be read');

    let queue = [...captureUs];
    Object.defineProperty(globalThis, 'MediaStreamTrackProcessor', { configurable: true, writable: true, value: class {
      readable: ReadableStream<unknown>;
      constructor({ track }: { track: unknown }) {
        assert.equal(track, clone, 'the pump reads a clone so the preview keeps its own track');
        this.readable = new ReadableStream({
          pull: controller => {
            const timestamp = queue.shift();
            if (timestamp === undefined) return new Promise(() => {});
            controller.enqueue({ displayWidth: 1920, displayHeight: 1080, timestamp, close: () => { closed++; } });
          },
          cancel: () => { cancelled++; },
        }, { highWaterMark: 0 });
      }
    } });
    const before = Date.now() * 1000;
    await camera.startLive();
    while (sent.length < captureUs.length) await new Promise(resolve => setTimeout(resolve, 1));
    const [width, height] = sdkFrameSize(1920, 1080);
    assert.ok(sent.every(frame => frame.width === width && frame.height === height && frame.stride === width * 4 && frame.bytes.byteLength === width * height * 4));
    assert.deepEqual(sent.slice(1).map((frame, index) => frame.timestampUs - sent[index].timestampUs), [33333, 33333, 33334, 33333], 'spacing follows capture time, not read time');
    assert.ok(Math.abs(sent[0].timestampUs - before) < 1_000_000);
    assert.equal(closed, captureUs.length, 'every VideoFrame is closed');
    await camera.stop();
    assert.equal(clone.stops, 1);
    assert.equal(cancelled, 1);
    assert.equal(disconnects, 0);

    await camera.start('body');
    queue = [...captureUs];
    reject = true;
    await camera.startLive();
    while (disconnects === 0) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(clone.stops, 2, 'a failed submission releases the frame pump');
    assert.equal(camera.active, false);
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldMedia) Object.defineProperty(navigator, 'mediaDevices', oldMedia); else Reflect.deleteProperty(navigator, 'mediaDevices');
    if (oldProcessor) Object.defineProperty(globalThis, 'MediaStreamTrackProcessor', oldProcessor); else Reflect.deleteProperty(globalThis, 'MediaStreamTrackProcessor');
  }

  const clock = { offsetUs: null, lastUs: 0 };
  assert.equal(nextFrameStamp(clock, 100, 1_000_000_000), 1_000_000_000);
  assert.equal(nextFrameStamp(clock, 100, 1_000_000_500), 1_000_000_001, 'a repeated capture time still advances');
  assert.equal(nextFrameStamp(clock, 2_000_100, 1_001_000_000), 1_002_000_000, 'drift of exactly 1 s keeps the anchor');
  assert.equal(nextFrameStamp(clock, 3_600_101, 1_002_500_000), 1_002_500_000, 'drift beyond 1 s re-anchors to now');
  assert.equal(nextFrameStamp(clock, 3_600_000, 1_002_500_100), 1_002_500_001, 'a backwards capture time never repeats or reverses');
});
