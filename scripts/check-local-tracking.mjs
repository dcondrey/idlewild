import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/local-tracking');
await mkdir(output, { recursive: true });
const fixtureHashes = { pose: 'c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b', portrait: 'a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e' };
const fixtureDirectory = path.join(root, '.local/tracking-fixtures');
await mkdir(fixtureDirectory, { recursive: true });
const fixtures = Object.fromEntries(await Promise.all(Object.entries(fixtureHashes).map(async ([name, hash]) => {
  const file = path.join(fixtureDirectory, `${name}.jpg`);
  if (process.argv.includes('--prepare-fixtures')) {
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
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [root], cwd: root, env });
const errors = [];
const requests = new Set();
const report = {};
let page;
try {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { requests.add(request.url().split('?')[0]); });
  await expect(page.locator('#stage-state')).toHaveText('READY');
  await app.evaluate(({ BrowserWindow }, directory) => {
    globalThis.__localDownloads = [];
    globalThis.__externalRequests = [];
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      globalThis.__externalRequests.push(new URL(details.url).origin);
      callback({ cancel: true });
    });
    session.on('will-download', (_event, item) => {
      const destination = process.getBuiltinModule('node:path').join(directory, process.getBuiltinModule('node:path').basename(item.getFilename()));
      item.setSavePath(destination);
      item.once('done', (_event, state) => globalThis.__localDownloads.push({ path: destination, state }));
    });
  }, output);
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
  await page.locator('#character-button').click(); await page.locator('[data-scene="snow"]').click();
  await expect(page.locator('#message')).toContainText('Import ready', { timeout: 20_000 });
  await page.locator('#open-camera').click();
  await expect(page.locator('#local-tracking')).toBeDisabled();
  await page.locator('#camera-consent').check(); await page.locator('#preview').click();
  await expect(page.locator('#local-tracking')).toBeEnabled();
  await expect(page.locator('#live')).toBeDisabled();
  await page.locator('#local-tracking').click();
  await expect(page.locator('#source-badge')).toHaveText('LOCAL CAMERA', { timeout: 30_000 });
  await page.locator('#motion').fill('100');
  await expect(page.locator('#tracking-summary')).toContainText(/\d+ body joints tracked/, { timeout: 20_000 });
  await page.locator('#record').click();
  await page.waitForTimeout(2200);
  await page.locator('#stage').screenshot({ path: path.join(output, 'body.png') });
  await page.locator('#character-button').click(); await page.locator('[data-scene="brain"]').click();
  const brainRows = page.locator('#brain-regions li:not([hidden]):not(.baseline)');
  await expect(brainRows.first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  const brainRegions = await brainRows.allTextContents();
  assert.ok(brainRegions.length > 0, 'Tracked body pose highlights brain regions');
  report.brainRegions = brainRegions;
  await page.locator('#stage').screenshot({ path: path.join(output, 'brain-body.png') });
  await page.locator('#character-button').click(); await page.locator('[data-scene="snow"]').click();
  await page.evaluate(() => { window.__fixtureMode = 'portrait'; });
  await expect(page.locator('#tracking-summary')).toContainText('Face tracked', { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.locator('#detail-view').click();
  await page.locator('#stage').screenshot({ path: path.join(output, 'face.png') });
  await page.locator('#open-camera').click();
  await page.locator('#measurement-settings').evaluate(element => { element.open = true; });
  await page.locator('#api-key').fill('local-only-fixture'); await page.locator('#save-key').click(); await page.locator('#clear-key').click();
  await expect(page.locator('#source-badge')).toHaveText('LOCAL CAMERA');
  assert.equal(await page.evaluate(() => window.__trackingWorkers), 1, 'Clearing an unrelated SDK key must preserve local tracking');
  await page.keyboard.press('Escape');
  await page.locator('#record').click();
  await expect.poll(() => page.evaluate(() => window.__trackingWorkers)).toBe(0);
  assert.equal(await page.evaluate(() => window.__fixtureTracks.every(track => track.readyState === 'ended')), true);
  const downloads = () => app.evaluate(() => globalThis.__localDownloads);
  async function download(id) {
    const before = (await downloads()).length;
    await page.locator('#open-export').click(); await page.locator(id).click();
    await expect.poll(async () => (await downloads()).length, { timeout: 30_000 }).toBe(before + 1);
    const saved = (await downloads()).at(-1); assert.equal(saved.state, 'completed'); return saved.path;
  }
  const controlPath = await download('#export-data');
  const take = JSON.parse(await readFile(controlPath, 'utf8'));
  assert.equal(take.source, 'local-camera');
  assert.ok(take.samples.some(frame => frame.tracking.face));
  assert.ok(take.samples.some(frame => frame.tracking.body?.leftAnkle || frame.tracking.body?.rightAnkle), 'Body tracking must include visible legs');
  assert.ok(take.samples.some(frame => frame.tracking.movement > 0));
  assert.ok(take.samples.every(frame => Object.values(frame.signals).every(signal => signal.value === null)));
  const glbPath = await download('#export-glb');
  const bytes = await readFile(glbPath);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  assert.ok(gltf.animations[0].channels.some(channel => channel.target.path === 'rotation'));
  assert.ok(gltf.animations[0].channels.some(channel => channel.target.path === 'weights'));
  assert.match(gltf.asset.copyright, /CC BY 4.0/);
  const wavPath = await download('#export-wav');
  const wav = await readFile(wavPath); assert.ok(wav.subarray(44).some(value => value !== 0));
  await page.locator('#open-import').click(); await page.locator('#import-model').setInputFiles(glbPath);
  await expect(page.locator('#message')).toContainText('Import ready', { timeout: 20_000 });
  await page.setViewportSize({ width: 760, height: 620 });
  await page.locator('#open-camera').click(); await page.locator('#preview').click();
  await page.locator('#local-tracking').click();
  await expect(page.locator('#tracking-summary')).toContainText('Face tracked', { timeout: 20_000 });
  assert.equal(await page.evaluate(() => window.__trackingWorkers), 1, 'Restart owns exactly one worker');
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), true, 'Local tracking fits the smallest supported viewport');
  await page.screenshot({ path: path.join(output, 'small-window.png'), fullPage: true });
  await page.locator('#open-camera').click(); await page.locator('#camera-consent').uncheck();
  await expect.poll(() => page.evaluate(() => window.__trackingWorkers)).toBe(0);
  assert.equal(await page.evaluate(() => window.__fixtureTracks.every(track => track.readyState === 'ended')), true, 'Revoking consent releases every camera stream');
  assert.equal(await app.evaluate(() => Object.keys(process.getBuiltinModule('node:module').createRequire(process.cwd() + '/package.json').cache).some(file => file.includes('@smartspectra/node-sdk/'))), false);
  assert.ok([...requests].every(url => url.startsWith('idlewild://studio/') || url.startsWith('data:') || url.startsWith('blob:')), 'Local tracking must not contact external services');
  assert.deepEqual(await app.evaluate(() => globalThis.__externalRequests), [], 'Both model inference paths work with external network blocked');
  assert.deepEqual(errors, []);
  const ages = take.samples.map(frame => frame.timeMs - frame.tracking.sampledAtMs).sort((a, b) => a - b);
  const spacing = (await page.evaluate(() => window.__renderTimes)).sort((a, b) => a - b);
  Object.assign(report, { controlPath, glbPath, wavPath, samples: take.samples.length, faceSamples: take.samples.filter(frame => frame.tracking.face).length, bodySamples: take.samples.filter(frame => frame.tracking.body).length, inferenceAgeMedianMs: ages[Math.floor(ages.length / 2)], inferenceAgeP95Ms: ages[Math.floor(ages.length * 0.95)], frameSpacingMedianMs: spacing[Math.floor(spacing.length / 2)], frameSpacingP95Ms: spacing[Math.floor(spacing.length * 0.95)], requests: [...requests] });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(error);
  console.error(JSON.stringify({ errors, requests: [...requests] }));
  if (page && !page.isClosed()) console.error(JSON.stringify(await page.evaluate(() => {
    const video = document.getElementById('camera-preview');
    return { status: document.getElementById('status').textContent, message: document.getElementById('message').textContent, consent: document.getElementById('camera-consent').checked, video: { readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, paused: video.paused }, tracks: window.__fixtureTracks?.map(track => track.readyState), workers: window.__trackingWorkers };
  })));
  throw error;
} finally { await app.close(); }
