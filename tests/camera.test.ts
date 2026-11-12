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
