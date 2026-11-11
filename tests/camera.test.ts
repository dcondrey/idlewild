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
