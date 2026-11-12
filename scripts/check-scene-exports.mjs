import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/scene-exports');
await mkdir(output, { recursive: true });
const prior = JSON.parse(await readFile(path.join(root, 'artifacts/ui/report.json'), 'utf8'));
const take = JSON.parse(await readFile(prior.exports.control.path, 'utf8'));
take.durationMs = 1500;
take.samples = take.samples.filter(frame => frame.timeMs < 1500);
const fixture = path.join(output, 'take.json');
await writeFile(fixture, JSON.stringify(take));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [root], cwd: root, env });
const results = [];
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
  await app.evaluate(({ BrowserWindow }, directory) => {
    globalThis.__exports = [];
    BrowserWindow.getAllWindows()[0].webContents.session.on('will-download', (_event, item) => {
      const destination = process.getBuiltinModule('node:path').join(directory, item.getFilename());
      item.setSavePath(destination);
      item.once('done', (_event, state) => globalThis.__exports.push({ path: destination, state }));
    });
  }, output);
  await page.waitForFunction(() => { const stats = JSON.parse(document.querySelector('#stage')?.dataset.diagnostics || '{}'); return stats.assets?.robot.phase === 'ready' && stats.assets?.dragon.phase === 'ready' && stats.assets?.runner.phase === 'ready' && stats.assets?.brain.phase === 'ready'; });
  await page.locator('#open-import').click();
  await page.locator('#import-data').setInputFiles(fixture);
  await expect(page.locator('#take-count')).toHaveText('1 / 6');
  await page.locator('#reduced-motion').uncheck();
  let extraDownloads = 0;
  for (const scene of ['robot', 'bubbles', 'star', 'dragon', 'baby-dragon', 'runner', 'brain']) {
    await page.locator('#character-button').click();
    await page.locator(`[data-scene="${scene}"]`).click();
    if (scene === 'brain') await expect(page.locator('#brain-caption')).toContainText('not your measured brain activity');
    await page.locator('#open-export').click();
    await page.locator('#export-glb').click();
    await expect.poll(async () => (await app.evaluate(() => globalThis.__exports)).length, { timeout: 30_000 }).toBe(results.length + extraDownloads + 1);
    const saved = (await app.evaluate(() => globalThis.__exports)).at(-1);
    assert.equal(saved.state, 'completed');
    const bytes = await readFile(saved.path);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    assert.ok(json.animations?.[0].channels.length > 0);
    if (scene === 'robot' || scene === 'dragon') assert.match(json.asset.copyright, /CC0 1.0/);
    if (scene === 'brain') assert.match(json.asset.copyright, /CC BY-SA 3\.0/);
    if (scene === 'runner') assert.match(json.asset.copyright, /CC BY 4\.0/);
    if (scene === 'brain' || scene === 'runner') {
      const before = (await app.evaluate(() => globalThis.__exports)).length;
      await page.locator('#open-export').click();
      await page.locator('#export-video').click();
      await expect.poll(async () => (await app.evaluate(() => globalThis.__exports)).length, { timeout: 60_000 }).toBe(before + 2);
      const files = (await app.evaluate(() => globalThis.__exports)).slice(before);
      assert.ok(files.every(file => file.state === 'completed'));
      const credits = files.find(file => file.path.endsWith('-credits.txt'));
      assert.ok(credits && files.some(file => file.path.endsWith('.webm')), `${scene} video export saves a WebM and a credits file`);
      assert.match(await readFile(credits.path, 'utf8'), scene === 'brain' ? /CC BY-SA 3\.0/ : /CC BY 4\.0/);
      extraDownloads += 2;
    }
    await page.locator('#open-import').click();
    await page.locator('#import-model').setInputFiles(saved.path);
    await expect(page.locator('#message')).toContainText('Import ready', { timeout: 15_000 });
    await page.locator('#timeline').fill('700');
    await page.screenshot({ path: path.join(output, `${scene}.png`) });
    await page.locator('#open-import').click();
    await page.locator('#remove-model').click();
    await page.keyboard.press('Escape');
    results.push({ scene, bytes: bytes.length, nodes: json.nodes.length, animationChannels: json.animations[0].channels.length });
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await app.close(); }
