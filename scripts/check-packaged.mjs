import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.resolve(process.argv[2] ?? path.join(root, 'release/mac-arm64/Idlewild.app'));
const executable = path.join(app, 'Contents/MacOS/Idlewild');
if (!existsSync(executable)) throw new Error(`Packaged app not found at ${app}; run npm run dist first.`);
const resources = path.join(app, 'Contents/Resources/app');
for (const file of ['dist/index.html', 'dist/models/runner.glb', 'dist/models/brain.glb', 'dist/tracking/face_landmarker.task', 'dist/THIRD_PARTY_NOTICES.txt', 'node_modules/@smartspectra/node-sdk/package.json']) {
  assert.ok(existsSync(path.join(resources, file)), `Bundle contains ${file}`);
}
assert.ok(!existsSync(path.join(resources, 'node_modules/@smartspectra/node-sdk-linux-x64')), 'Bundle excludes other-platform SDK binaries');
const output = path.join(root, 'artifacts/packaged');
await mkdir(output, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electronApp = await electron.launch({ executablePath: executable, args: [], env, timeout: 60_000 });
const errors = [];
try {
  const page = await electronApp.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', item => { if (item.type() === 'error') errors.push(item.text()); });
  await expect(page.locator('#stage-state')).toHaveText('READY', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const assets = Object.values(JSON.parse(document.querySelector('#stage')?.dataset.diagnostics || '{}').assets ?? {});
    return assets.length > 0 && assets.every(asset => asset.phase === 'ready');
  }, null, { timeout: 60_000 });
  const packaged = await electronApp.evaluate(({ app: electronMain }) => ({ packaged: electronMain.isPackaged, name: electronMain.getName(), version: electronMain.getVersion() }));
  assert.equal(packaged.packaged, true);
  const sdkLoaded = await electronApp.evaluate(() => Object.keys(process.getBuiltinModule('node:module').createRequire(process.execPath).cache).some(file => file.includes('@smartspectra/node-sdk/')));
  assert.equal(sdkLoaded, false, 'Startup does not load the SDK');
  await page.locator('#open-credits').click();
  await page.locator('#credits-full summary').click();
  await expect(page.locator('#credits-files pre')).toHaveCount(3);
  await expect(page.locator('#credits-files pre.error')).toHaveCount(0);
  await expect(page.locator('#credits-files pre').last()).toContainText('Idlewild third-party notices');
  await page.keyboard.press('Escape');
  await page.locator('#rehearse').click();
  await expect(page.locator('#source-badge')).toHaveText('SYNTHETIC REHEARSAL');
  await page.locator('#character-button').click();
  await page.locator('[data-scene="runner"]').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(output, 'runner.png') });
  await page.locator('#stop-input').click();
  assert.deepEqual(errors, []);
  const report = { app, ...packaged, sdkLoadedAtStartup: sdkLoaded, errors };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await electronApp.close(); }
