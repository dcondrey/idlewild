import { _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TakeRecorder } from '../src/recording.ts';
import { validateFrame } from '../src/validation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
if (!checkOnly && !process.argv.includes('--authorized')) throw new Error('This live benchmark requires explicit user authorization and --authorized.');
const directory = path.join(root, '.local/live-benchmarks', new Date().toISOString().replaceAll(':', '-'));
await mkdir(directory, { recursive: true, mode: 0o700 });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DEBUG;
const app = await electron.launch({ args: [root, '--live-benchmark'], cwd: root, env, timeout: 30_000 });
const report = { mode: checkOnly ? 'non-metered preparation check' : 'authorized live benchmark', statuses: [], started: false, stopped: false, watchdog: false, recording: false };
let recorder;
let firstFrameAt = null;
let startedAt = null;
let deadline;
let uiRecording = Promise.resolve();
let resolveStopped;
const stopped = new Promise(resolve => { resolveStopped = resolve; });
let page;
try {
  page = await app.firstWindow();
  await expect(page.locator('#stage-state')).toHaveText('READY', { timeout: 30_000 });
  const loaded = await app.evaluate(() => Object.keys(process.getBuiltinModule('node:module').createRequire(process.cwd() + '/package.json').cache).some(file => file.includes('@smartspectra/node-sdk/')));
  if (loaded) throw new Error('SDK unexpectedly loaded before consent.');
  await expect(page.locator('#source-badge')).toHaveText('NO INPUT');
  await expect(page.locator('#live')).toBeDisabled();
  if (checkOnly) {
    report.preparationPassed = true;
  } else {
    await page.exposeFunction('__benchmarkStatus', status => {
      if (!['idle', 'starting', 'warming', 'ready', 'poor-signal', 'stopping', 'error'].includes(status.phase)) return;
      if (report.statuses.length < 1000) report.statuses.push({ phase: status.phase, message: String(status.message).slice(0, 512), elapsedMs: startedAt === null ? 0 : Math.round(performance.now() - startedAt) });
      if (status.phase === 'starting' && !report.started) {
        report.started = true;
        startedAt = performance.now();
        console.log('LIVE_STARTED: stay still and breathe normally; a short speaking cue follows at 35 seconds.');
        deadline = setTimeout(() => {
          report.watchdog = true;
          app.process().kill('SIGKILL');
          resolveStopped();
        }, 58_000);
      }
      if (status.phase === 'idle' && report.started) {
        report.stopped = true;
        report.elapsedMs = Math.round(performance.now() - startedAt);
        clearTimeout(deadline);
        resolveStopped();
      }
    });
    await page.exposeFunction('__benchmarkFrame', raw => {
      if (!report.started || report.stopped) return;
      const frame = validateFrame(raw);
      if (frame.source !== 'live') throw new Error('A live benchmark received non-live input.');
      if (!recorder) {
        recorder = new TakeRecorder(randomUUID(), 'live', frame.sessionId, 20261111);
        firstFrameAt = performance.now();
        uiRecording = page.locator('#record').click({ timeout: 5000 }).then(() => { report.recording = true; }, () => { report.recording = false; });
      }
      recorder.append(frame);
    });
    await page.evaluate(() => {
      window.idlewild.onStatus(status => { void window.__benchmarkStatus(status); });
      window.idlewild.onFrame(frame => { void window.__benchmarkFrame(frame); });
      const cue = document.createElement('p');
      cue.className = 'fine'; cue.id = 'benchmark-cue'; cue.setAttribute('aria-live', 'polite');
      cue.textContent = 'Authorized benchmark: one run, automatic stop after 55 seconds.';
      document.getElementById('status').after(cue);
      let started = null;
      let timer;
      window.idlewild.onStatus(status => {
        if (status.phase === 'starting' && started === null) {
          started = performance.now();
          timer = setInterval(() => {
            const elapsed = (performance.now() - started) / 1000;
            cue.textContent = `Benchmark · ${Math.max(0, Math.ceil(55 - elapsed))}s left. ${elapsed < 35 ? 'Stay still and breathe normally.' : elapsed < 43 ? 'Say a short sentence naturally.' : 'Return to quiet, normal breathing.'}`;
          }, 1000);
        }
        if (status.phase === 'idle' && started !== null) { clearInterval(timer); cue.textContent = 'Benchmark stopped. No automatic restart.'; }
      });
    });
    await page.locator('#character-button').click();
    await page.locator('[data-scene="snow"]').click();
    await expect(page.locator('#message')).toContainText('Import ready', { timeout: 20_000 });
    await page.locator('#detail-view').click();
    await page.evaluate(() => { document.getElementById('continuity').checked = true; });
    await page.locator('#open-camera').click();
    await page.locator('#measurement-settings').evaluate(element => { element.open = true; });
    await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
    console.log(`READY_FOR_USER: camera setup is open; no SDK or camera started. Evidence directory: ${directory}`);
    const closed = new Promise(resolve => app.once('close', resolve));
    await Promise.race([stopped, closed]);
    await uiRecording;
    if (report.stopped && !report.watchdog) {
      await expect.poll(() => page.locator('#camera-preview').evaluate(video => video.srcObject === null), { timeout: 5000 }).toBe(true);
      report.cameraReleased = true;
      report.firstFrameDelayMs = firstFrameAt === null ? null : Math.round(firstFrameAt - startedAt);
      if (recorder) {
        const take = recorder.finish();
        await writeFile(path.join(directory, 'control.json'), JSON.stringify(take), { mode: 0o600 });
        report.samples = take.samples.length;
        report.durationMs = take.durationMs;
        report.channels = Object.fromEntries(Object.keys(take.samples[0]?.signals ?? {}).map(channel => {
          const values = take.samples.map(frame => ({ ...frame.signals[channel], ageMs: frame.timeMs - frame.signals[channel].sampledAtMs }));
          const valid = values.filter(signal => signal.quality === 'valid' && signal.value !== null);
          return [channel, { validSamples: valid.length, missingSamples: values.filter(signal => signal.value === null).length, maximumAgeMs: Math.max(0, ...valid.map(signal => signal.ageMs)) }];
        }));
        await page.locator('#stage').screenshot({ path: path.join(directory, 'stage-after-stop.png') });
      }
    }
  }
} catch {
  report.harnessError = 'Benchmark preparation or verification failed; no automatic retry was attempted.';
  process.exitCode = 1;
} finally {
  if (report.started && !report.stopped && !report.watchdog) {
    app.process().kill('SIGKILL');
    report.watchdog = true;
  }
  clearTimeout(deadline);
  await app.close().catch(() => {});
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ directory, ...report }));
}
