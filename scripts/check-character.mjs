import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelFlag = process.argv.indexOf('--model');
const modelId = modelFlag >= 0 ? process.argv[modelFlag + 1] : process.argv[2] ? null : 'sprite';
if (modelId !== null && !/^[a-z0-9-]{1,32}$/.test(modelId ?? '')) throw new Error('Usage: check-character.mjs [--model <id> | <path.glb>]');
const model = modelId ? path.join(root, 'public/models', `${modelId}.glb`) : path.resolve(process.argv[2]);
const bundled = modelId !== null;
const fromMenu = modelId === 'sprite';
const output = path.join(root, 'artifacts/character', modelId ?? path.basename(model, '.glb'));
await mkdir(output, { recursive: true });
const prior = JSON.parse(await readFile(path.join(root, 'artifacts/ui/report.json'), 'utf8'));
const template = JSON.parse(await readFile(prior.exports.control.path, 'utf8'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const userData = await mkdtemp(path.join(os.tmpdir(), 'idlewild-check-'));
const app = await electron.launch({ args: [root, `--idlewild-user-data=${userData}`], cwd: root, env });
const errors = [];
const report = { model, poses: [], exports: [] };
let expressionClips = [];
try {
  if (bundled) {
    const bytes = await readFile(model);
    const jsonLength = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
    const binaryOffset = 28 + jsonLength;
    const names = gltf.animations.map(clip => clip.name);
    {
      assert.ok(names.includes('Idle'), 'Bundled characters need an Idle clip');
      expressionClips = names.filter(name => name !== 'Idle' && name !== 'Run');
      assert.ok(expressionClips.length >= 2, 'Bundled characters need at least two expression clips');
    }
    assert.ok(typeof gltf.asset.copyright === 'string' && gltf.asset.copyright.length > 0, 'Bundled characters need asset.copyright');
    for (const clip of gltf.animations) for (const sampler of clip.samplers) {
      const accessor = gltf.accessors[sampler.output];
      const view = gltf.bufferViews[accessor.bufferView];
      const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type];
      assert.equal(accessor.componentType, 5126);
      assert.ok(components && !view.byteStride && !accessor.sparse);
      const values = accessor.count * components;
      const width = values / gltf.accessors[sampler.input].count;
      assert.ok(Number.isInteger(width) && width > 0);
      const offset = binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      for (let index = 0; index < width; index++) {
        assert.ok(Math.abs(bytes.readFloatLE(offset + index * 4) - bytes.readFloatLE(offset + (values - width + index) * 4)) < 1e-6, `${clip.name} must have matching loop endpoints`);
      }
    }
    report.loopClips = gltf.animations.map(clip => clip.name);
  }
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setIgnoreMouseEvents(true));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
  await expect(page.locator('#stage-state')).toHaveText('READY');
  const resources = () => page.locator('#stage').evaluate(canvas => {
    const { geometries, textures } = JSON.parse(canvas.dataset.diagnostics);
    return { geometries, textures };
  });
  await expect.poll(() => page.locator('#stage').evaluate(canvas => Object.values(JSON.parse(canvas.dataset.diagnostics).assets).every(asset => asset.phase === 'ready'))).toBe(true);
  const baseline = await resources();
  await app.evaluate(({ BrowserWindow }, directory) => {
    globalThis.__characterDownloads = [];
    BrowserWindow.getAllWindows()[0].webContents.session.on('will-download', (_event, item) => {
      const destination = process.getBuiltinModule('node:path').join(directory, item.getFilename());
      item.setSavePath(destination);
      item.once('done', (_event, state) => globalThis.__characterDownloads.push({ path: destination, state }));
    });
  }, output);
  if (fromMenu) { await page.locator('#character-button').click(); await page.locator('[data-scene="sprite"]').click(); }
  else { await page.locator('#open-import').click(); await page.locator('#import-model').setInputFiles(model); }
  await expect(page.locator('#message')).toContainText('Import ready', { timeout: 20_000 });
  await page.locator('#reduced-motion').uncheck();
  let neutral;
  for (const [name, blink, talking] of [['neutral', 0, 0], ['blink', 1, 0], ['jaw', 0, 1], ['combined', 1, 1], ...expressionClips.map(clip => [clip, 0, 0])]) {
    const slug = name.toLowerCase().replaceAll(' ', '-');
    const take = structuredClone(template);
    take.id = `character-${slug}`;
    take.sessionId = `character-${slug}`;
    take.durationMs = 1500;
    take.samples = take.samples.filter(frame => frame.timeMs < take.durationMs);
    for (const frame of take.samples) {
      frame.sessionId = take.sessionId;
      for (const [channel, value] of [['breath', 0], ['blink', frame.timeMs >= 500 ? blink : 0], ['talking', frame.timeMs >= 500 ? talking : 0]]) {
        Object.assign(frame.signals[channel], { value, sampledAtMs: frame.timeMs, quality: 'valid', provenance: 'synthetic' });
      }
    }
    const fixture = path.join(output, `${slug}.json`);
    await writeFile(fixture, JSON.stringify(take));
    await page.locator('#open-import').click();
    await page.locator('#import-data').setInputFiles(fixture);
    await expect(page.locator('#message')).toContainText('Control take imported');
    if (expressionClips.includes(name)) {
      await page.locator('#open-import').click();
      await page.locator('#imported-clip').selectOption({ label: name });
      await page.keyboard.press('Escape');
    }
    await page.locator('#motion').fill('100');
    await page.locator('#timeline').fill('750');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (name === 'neutral') {
      await page.locator('#stage').screenshot({ path: path.join(output, 'full-body.png') });
      await page.locator('#detail-view').click();
    }
    const screenshot = await page.locator('#stage').screenshot({ path: path.join(output, `${slug}.png`) });
    if (name === 'neutral') neutral = screenshot;
    else assert.ok(!screenshot.equals(neutral), `${name} must change the rendered character`);
    report.poses.push({ name, ...await page.locator('#stage').evaluate(canvas => JSON.parse(canvas.dataset.diagnostics)) });
  }
  await page.locator('#open-export').click();
  await page.locator('#export-glb').click();
  await expect.poll(async () => (await app.evaluate(() => globalThis.__characterDownloads)).length, { timeout: 30_000 }).toBe(1);
  const saved = (await app.evaluate(() => globalThis.__characterDownloads))[0];
  assert.equal(saved.state, 'completed');
  const bytes = await readFile(saved.path);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  assert.match(json.asset.copyright, /CC BY 4.0/);
  assert.ok(json.animations[0].channels.some(channel => channel.target.path === 'weights'));
  report.exports.push({ ...saved, bytes: bytes.length, channels: json.animations[0].channels.length });
  await page.locator('#open-import').click();
  await page.locator('#import-model').setInputFiles(saved.path);
  await expect(page.locator('#message')).toContainText('Import ready', { timeout: 20_000 });
  await page.locator('#open-export').click();
  await page.locator('#export-video').click();
  await expect(page.locator('#cancel-export')).toBeVisible();
  assert.deepEqual(await page.evaluate(() => ['imported-clip', 'remove-model', 'character-button', 'detail-view'].map(id => document.getElementById(id).disabled)), [true, true, true, true]);
  await page.locator('#cancel-export').click();
  await expect(page.locator('#message')).toContainText('canceled');
  await page.setViewportSize({ width: 760, height: 620 });
  await page.locator('#detail-view').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), true, 'Imported character controls fit the smallest supported viewport');
  await page.screenshot({ path: path.join(output, 'small-window.png'), fullPage: true });
  await page.locator('#open-import').click();
  await page.locator('#remove-model').click();
  await expect.poll(resources).toEqual(baseline);
  report.resources = { before: baseline, afterRemoval: await resources() };
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await app.close(); await rm(userData, { recursive: true, force: true }); }
