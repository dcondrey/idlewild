// Records a captioned screen demo of the studio, driven by Playwright. No camera, no key, no metered session:
// the take is Synthetic Rehearsal, and the optional replay is a take built from a previous authorized run's packet log.
// Usage: node scripts/make-demo.mjs [replayed-take.json] [output-dir]
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [replayPath, outArg] = process.argv.slice(2);
const output = path.resolve(outArg ?? path.join(root, 'artifacts/demo'));
await mkdir(output, { recursive: true });
const raw = await mkdtemp(path.join(os.tmpdir(), 'idlewild-demo-'));
const userData = await mkdtemp(path.join(os.tmpdir(), 'idlewild-demo-data-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const size = { width: 1440, height: 900 };
const app = await electron.launch({
  args: [root, `--idlewild-user-data=${userData}`], cwd: root, env, timeout: 30_000,
  recordVideo: { dir: raw, size },
});
let page;
try {
  page = await app.firstWindow();
  await page.setViewportSize(size);
  await expect(page.locator('#stage-state')).toHaveText('READY', { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }, directory) => {
    globalThis.__demoDownloads = [];
    BrowserWindow.getAllWindows()[0].webContents.session.on('will-download', (_event, item) => {
      const target = process.getBuiltinModule('node:path').join(directory, item.getFilename());
      item.setSavePath(target);
      item.once('done', (_e, state) => globalThis.__demoDownloads.push({ path: target, state }));
    });
  }, output);
  await page.evaluate(() => {
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    caption.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;max-width:900px;padding:12px 20px;border-radius:10px;background:#000c;color:#fff;font:600 20px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none;opacity:0;transition:opacity .3s';
    document.body.append(caption);
  });
  const say = async (text, ms) => {
    await page.evaluate(text => { const c = document.getElementById('demo-caption'); c.textContent = text; c.style.opacity = text ? '1' : '0'; }, text);
    await page.waitForTimeout(ms);
  };
  const pick = async id => { await page.locator('#character-button').click(); await page.locator(`[data-scene="${id}"]`).click(); await page.waitForTimeout(600); };
  const exportAs = async button => {
    const before = await app.evaluate(() => globalThis.__demoDownloads.length);
    await page.locator('#open-export').click();
    await page.locator(button).click();
    await expect.poll(() => app.evaluate(() => globalThis.__demoDownloads.length), { timeout: 60_000 }).toBeGreaterThan(before);
    await page.keyboard.press('Escape');
  };

  await say('Idlewild: your breath performs the character.', 3500);
  await say('Nothing starts on launch. The camera needs in-app consent, and SmartSpectra needs your own key and a separate metered-measurement consent.', 5500);
  await say('This demo uses Synthetic Rehearsal: stand-in input, labeled on screen, no camera and no measurement.', 3500);
  await page.locator('#rehearse').click();
  await expect(page.locator('#source-badge')).toHaveText('SYNTHETIC REHEARSAL');
  await say('The signal panel shows each channel with its quality and confidence.', 4500);
  await page.locator('#record').click();
  await say('Recording a take.', 9000);
  await page.locator('#record').click();
  await expect(page.locator('#take-count')).toHaveText('1 / 6');
  await say('Take saved. Play it back on any character.', 1500);
  await page.locator('#play').click();
  await say('Rex: chest and shoulders follow the breathing trace.', 6000);
  await pick('bubbles');
  await say('Bubbles rise on inhale and release on exhale.', 6000);
  await pick('star');
  await say('Star glows with breath and shimmers with the pulse waveform.', 6000);

  if (replayPath) {
    await page.locator('#open-import').click();
    await page.locator('#import-data').setInputFiles(path.resolve(replayPath));
    await page.waitForTimeout(1000);
    await say('Playback of a real SmartSpectra session recorded earlier. The panel says RECORDED TAKE: this is not live input.', 6000);
    await pick('rex');
    await page.locator('#play').click();
    await say('The SDK breathing trace and expression estimates drive Rex. Pulse was not reported in that session, so none is shown.', 7000);
  }

  await say('Export: control JSON, procedural sound, baked GLB with breathing curves, CSV, and video with the signal panel.', 3500);
  await exportAs('#export-data');
  await exportAs('#export-wav');
  await exportAs('#export-csv');
  await say('Keys stay in memory. Camera images are never saved. Creative use, not medical measurement.', 5000);
  await say('', 500);
} finally {
  const video = page?.video();
  await app.close();
  const target = path.join(output, 'demo.webm');
  if (video) await rename(await video.path(), target).catch(() => undefined);
  const files = await readdir(raw);
  console.log(JSON.stringify({ output, video: files.length ? target : null }));
  await rm(userData, { recursive: true, force: true });
}
