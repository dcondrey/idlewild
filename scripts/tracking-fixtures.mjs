import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixtureHashes = { pose: 'c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b', portrait: 'a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e' };

export async function loadFixtures(root, prepare = false) {
  const fixtureDirectory = path.join(root, '.local/tracking-fixtures');
  await mkdir(fixtureDirectory, { recursive: true });
  return Object.fromEntries(await Promise.all(Object.entries(fixtureHashes).map(async ([name, hash]) => {
    const file = path.join(fixtureDirectory, `${name}.jpg`);
    if (prepare) {
      const response = await fetch(`https://storage.googleapis.com/mediapipe-assets/${name}.jpg`, { signal: AbortSignal.timeout(15_000) });
      assert.ok(response.ok && Number(response.headers.get('content-length')) <= 512 * 1024);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
      await writeFile(file, bytes);
    }
    const bytes = await readFile(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
    return [name, `data:image/jpeg;base64,${bytes.toString('base64')}`];
  })));
}

export async function installFixtureCamera(page, fixtures) {
  await page.evaluate(async fixtures => {
    const images = {};
    for (const [name, url] of Object.entries(fixtures)) { const image = new Image(); image.src = url; await image.decode(); images[name] = image; }
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const drawing = canvas.getContext('2d');
    window.__fixtureMode = 'pose'; window.__fixtureTracks = []; window.__trackingWorkers = 0; window.__renderTimes = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) { super(...args); this.counted = true; window.__trackingWorkers++; }
      terminate() { if (this.counted) { this.counted = false; window.__trackingWorkers--; } super.terminate(); }
    };
    let animation = null;
    let previous = 0;
    function draw(now) {
      if (!window.__fixtureTracks.some(track => track.readyState === 'live')) { animation = null; return; }
      if (previous && window.__renderTimes.length < 2000) window.__renderTimes.push(now - previous);
      previous = now;
      const image = images[window.__fixtureMode];
      const scale = Math.min(600 / image.width, 440 / image.height);
      drawing.fillStyle = '#777'; drawing.fillRect(0, 0, 640, 480);
      drawing.save(); drawing.translate(320, 240); drawing.rotate(Math.sin(now / 900) * 0.08);
      drawing.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale); drawing.restore();
      animation = requestAnimationFrame(draw);
    }
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [{ kind: 'videoinput', deviceId: 'offline-fixture', label: 'Offline image fixture' }] });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
      if (constraints.audio !== false) throw new Error('Fixture must never request microphone audio');
      const stream = canvas.captureStream(15);
      for (const track of stream.getTracks()) {
        const settings = track.getSettings.bind(track);
        Object.defineProperty(track, 'getSettings', { value: () => ({ ...settings(), deviceId: 'offline-fixture' }) });
      }
      window.__fixtureTracks.push(...stream.getTracks());
      if (animation === null) { previous = 0; animation = requestAnimationFrame(draw); }
      return stream;
    } });
  }, fixtures);
}
