import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/ui');
await mkdir(output, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const started = performance.now();
const app = await electron.launch({ args: [root], cwd: root, env, timeout: 30_000 });
const errors = [];
const report = { scenes: {}, exports: {}, checks: [] };
let page;
try {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', item => { if (item.type() === 'error') errors.push(item.text()); });
  await app.evaluate(({ BrowserWindow }, directory) => {
    globalThis.__idlewildDownloads = [];
    BrowserWindow.getAllWindows()[0].webContents.session.on('will-download', (_event, item) => {
      const target = process.getBuiltinModule('node:path').join(directory, item.getFilename());
      item.setSavePath(target);
      item.once('done', (_event, state) => globalThis.__idlewildDownloads.push({ path: target, state }));
    });
  }, output);
  await expect(page.locator('#stage-state')).toHaveText('READY', { timeout: 30_000 });
  await page.waitForFunction(() => {
    const diagnostics = JSON.parse(document.querySelector('#stage').dataset.diagnostics || '{}');
    return diagnostics.assets?.robot.phase === 'ready' && diagnostics.assets?.dragon.phase === 'ready';
  });
  report.loadMs = Math.round(performance.now() - started);
  await page.screenshot({ path: path.join(output, 'welcome.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), true, 'Main studio must fit the viewport');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  assert.equal(await app.evaluate(() => Object.keys(process.getBuiltinModule('node:module').createRequire(process.cwd() + '/package.json').cache).some(file => file.includes('@smartspectra/node-sdk/'))), false);
  await expect(page.locator('#preview')).toBeDisabled();
  await expect(page.locator('#live')).toBeDisabled();
  await expect(page.locator('#source-badge')).toHaveText('NO INPUT');
  report.checks.push('isolated renderer; no SDK load, media or key on startup');
  await page.locator('#open-camera').click();
  await page.locator('#measurement-settings summary').click();
  await page.locator('#api-key').fill('test-only-invalid-credential');
  await page.locator('#save-key').click();
  await expect(page.locator('#api-key')).toHaveValue('');
  await expect(page.locator('#key-status')).toContainText('memory');
  assert.equal(await page.evaluate(() => window.idlewild.startLive(false).then(() => false, () => true)), true);
  assert.equal(await app.evaluate(() => Object.keys(process.getBuiltinModule('node:module').createRequire(process.cwd() + '/package.json').cache).some(file => file.includes('@smartspectra/node-sdk/'))), false);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.locator('#clear-key').click();
  await expect(page.locator('#key-status')).toHaveText('Key cleared.');
  await page.keyboard.press('Escape');
  report.checks.push('key entry and rejected nonconsented live action never load the SDK or persist data');
  await page.locator('#help').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#guide')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#guide')).not.toBeVisible();
  await page.locator('#rehearse').press('Enter');
  await expect(page.locator('#source-badge')).toHaveText('SYNTHETIC REHEARSAL');
  await page.locator('#record').press('Enter');
  await page.waitForTimeout(2200);
  await page.locator('#record').press('Enter');
  await expect(page.locator('#take-count')).toHaveText('1 / 6');
  await expect(page.locator('#status')).toContainText('stopped');
  await expect(page.locator('#export-data')).toBeEnabled();
  const downloads = () => app.evaluate(() => globalThis.__idlewildDownloads);
  async function download(button, credited = false) {
    const before = (await downloads()).length;
    await page.locator('#open-export').click();
    await page.locator(button).click();
    try {
      await expect.poll(async () => (await downloads()).length, { timeout: 30_000 }).toBe(before + (credited ? 2 : 1));
    } catch (error) {
      await page.screenshot({ path: path.join(output, 'export-failure.png') });
      throw new Error(`${button} did not download: ${await page.locator('#message').textContent()}`, { cause: error });
    }
    const files = (await downloads()).slice(before);
    assert.ok(files.every(file => file.state === 'completed'));
    const result = files.find(file => !file.path.endsWith('-credits.txt'));
    if (credited) {
      const credits = files.find(file => file.path.endsWith('-credits.txt'));
      assert.match(await readFile(credits.path, 'utf8'), /CC0 1.0/);
      report.exports.credits = credits.path;
    }
    return result.path;
  }
  const jsonPath = await download('#export-data');
  const take = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(take.source, 'rehearsal');
  assert.ok(take.durationMs >= 2000 && take.durationMs < 4000);
  assert.ok(take.samples.length >= 35);
  assert.equal(take.samples[0].timeMs, 0);
  report.exports.control = { path: jsonPath, durationMs: take.durationMs, samples: take.samples.length };
  await page.locator('#open-edit').click();
  await page.locator('#trim-start').fill('0.25');
  await page.locator('#trim-end').fill('1.75');
  await page.locator('#trim').click();
  await expect(page.locator('#trim-end')).toHaveValue('1.5');
  report.trimmedDurationMs = 1500;
  await page.locator('#play').press('Enter');
  await page.waitForTimeout(1750);
  await expect(page.locator('#play')).toHaveText('Pause');
  await page.locator('#play').click();
  report.checks.push('record, trim, replay and loop');
  await page.locator('#timeline').fill('500');
  const sceneIds = ['robot', 'bubbles', 'star', 'dragon', 'baby-dragon', 'runner', 'brain'];
  for (const scene of sceneIds) {
    await page.locator(`[data-scene="${scene}"]`).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, `${scene}.png`), fullPage: true });
    report.scenes[scene] = await page.evaluate(async () => {
      const times = [];
      let previous = performance.now();
      await new Promise(resolve => {
        function sample(now) { times.push(now - previous); previous = now; if (times.length < 40) requestAnimationFrame(sample); else resolve(); }
        requestAnimationFrame(sample);
      });
      const sorted = times.slice(1).sort((a, b) => a - b);
      return { ...JSON.parse(document.querySelector('#stage').dataset.diagnostics), frameMedianMs: sorted[Math.floor(sorted.length / 2)], frameP95Ms: sorted[Math.floor(sorted.length * 0.95)], heapBytes: performance.memory?.usedJSHeapSize ?? null };
    });
  }
  await page.locator('[data-scene="baby-dragon"]').click();
  report.exports.wav = await download('#export-wav');
  report.exports.glb = await download('#export-glb');
  report.exports.video = await download('#export-video');
  await page.locator('[data-scene="robot"]').click();
  await download('#export-video', true);
  await page.locator('[data-scene="baby-dragon"]').click();
  await page.locator('#open-export').click();
  await page.locator('#export-video').click();
  await expect(page.locator('#cancel-export')).toBeVisible();
  await page.locator('#cancel-export').click();
  await expect(page.locator('#message')).toContainText('canceled');
  const importPath = report.exports.glb;
  await page.locator('#open-import').click();
  await page.locator('#import-model').setInputFiles(importPath);
  await expect(page.locator('#message')).toContainText('Import ready', { timeout: 15_000 });
  await page.locator('[data-scene="imported"]').click();
  await expect(page.locator('#stage-state')).toHaveText('READY');
  await page.screenshot({ path: path.join(output, 'roundtrip.png'), fullPage: true });
  await page.locator('#open-import').click();
  await page.locator('#remove-model').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-scene="imported"]')).toBeDisabled();
  const resourceState = () => page.evaluate(() => ({ ...JSON.parse(document.querySelector('#stage').dataset.diagnostics), heapBytes: performance.memory?.usedJSHeapSize ?? null }));
  await page.waitForTimeout(250);
  report.resourceCycles = [await resourceState()];
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator('#open-import').click();
    await page.locator('#import-model').setInputFiles(importPath);
    await expect(page.locator('#message')).toContainText('Import ready');
    await page.locator('[data-scene="imported"]').click();
    await page.locator('#open-import').click();
    await page.locator('#remove-model').click();
    await page.keyboard.press('Escape');
    await page.locator('#rehearse').click();
    await expect(page.locator('#stop-input')).toBeVisible();
    await page.locator('#stop-input').click();
    await expect(page.locator('#stop-input')).not.toBeVisible();
    await page.waitForTimeout(250);
    const resources = await resourceState();
    assert.equal(resources.geometries, report.resourceCycles[0].geometries, 'Imported geometry is released');
    assert.equal(resources.textures, report.resourceCycles[0].textures, 'Imported textures are released');
    report.resourceCycles.push(resources);
  }
  report.checks.push('repeated import/remove and rehearsal start/stop retain stable GPU resource counts');
  report.checks.push('exports, cancellation and baked-animation import');
  await page.locator('#reduced-motion').check();
  await page.locator('#play').click();
  await page.waitForTimeout(200);
  const beforeReduced = await page.locator('#stage').screenshot();
  await page.waitForTimeout(300);
  const afterReduced = await page.locator('#stage').screenshot();
  assert.equal(beforeReduced.equals(afterReduced), true, 'Reduced motion must render a stationary scene');
  await page.locator('#play').click();
  for (const viewport of [{ width: 1024, height: 768 }, { width: 780, height: 700 }, { width: 760, height: 620 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true, `Main studio fits ${viewport.width}×${viewport.height}`);
  }
  await page.screenshot({ path: path.join(output, 'small-window.png'), fullPage: true });
  await page.locator('#open-edit').click();
  await page.locator('#delete').click();
  await expect(page.locator('#take-count')).toHaveText('0 / 6');
  await page.locator('#open-import').click();
  await page.locator('#import-data').setInputFiles(jsonPath);
  await expect(page.locator('#take-count')).toHaveText('1 / 6');
  report.checks.push('reduced motion, keyboard guide, small window, delete and data import');
  assert.deepEqual(errors, []);
  report.errors = errors;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: 'passed', loadMs: report.loadMs, checks: report.checks, report: path.join(output, 'report.json') }));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  report.errors = errors;
  report.failure = String(error);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  throw error;
} finally { await app.close(); }
