import { _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
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
const metricSet = process.argv.find(value => value.startsWith('--sdk-metrics='))?.slice('--sdk-metrics='.length) ?? 'standard';
if (!['standard', 'core', 'extended'].includes(metricSet)) throw new Error('--sdk-metrics must be standard, core or extended.');
const userData = await mkdtemp(path.join(os.tmpdir(), 'idlewild-check-'));
const app = await electron.launch({ args: [root, `--idlewild-user-data=${userData}`, '--live-benchmark', `--sdk-metrics=${metricSet}`, `--sdk-packet-log=${path.relative(root, path.join(directory, 'packets.jsonl'))}`], cwd: root, env, timeout: 30_000 });
const report = { mode: checkOnly ? 'non-metered preparation check' : 'authorized live benchmark', metricSet, companionTracking: false,
  cues: [{ fromS: 0, toS: 10, cue: 'normal' }, { fromS: 10, toS: 25, cue: 'paced 4 s in / 4 s out, inhale first' }, { fromS: 25, toS: 35, cue: 'normal' }, { fromS: 35, toS: 43, cue: 'speak' }, { fromS: 43, toS: 55, cue: 'quiet' }], statuses: [], started: false, stopped: false, watchdog: false, recording: false };
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
        report.cueStartedAtEpochMs = Date.now();
        console.log('LIVE_STARTED: stay still and breathe normally; a short speaking cue follows at 35 seconds.');
        deadline = setTimeout(() => {
          report.watchdog = true;
          app.process().kill('SIGKILL');
          resolveStopped();
        }, 58_000);
      }
      if (status.phase === 'error' && report.started && !report.stopped && report.failed === undefined) {
        report.failed = String(status.message).slice(0, 512);
        report.elapsedMs = Math.round(performance.now() - startedAt);
        clearTimeout(deadline);
        console.log(`LIVE_ENDED_WITH_ERROR: ${report.failed}`);
        resolveStopped();
      }
      if (status.phase === 'idle' && report.started && !report.stopped) {
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
            const phase = elapsed < 10 ? 'Sit still and breathe normally.' : elapsed < 25 ? `Slow deep breaths: ${Math.floor((elapsed - 10) / 4) % 2 === 0 ? 'IN' : 'OUT'} (4 s in, 4 s out).` : elapsed < 35 ? 'Breathe normally.' : elapsed < 43 ? 'Say a short sentence naturally.' : 'Return to quiet, normal breathing.';
            cue.textContent = `Benchmark · ${Math.max(0, Math.ceil(55 - elapsed))}s left. ${phase}`;
          }, 1000);
        }
        if (status.phase === 'error' && started !== null) { clearInterval(timer); cue.textContent = `Benchmark ended: ${status.message} No automatic restart.`; }
        else if (status.phase === 'idle' && started !== null) { clearInterval(timer); cue.textContent = 'Benchmark stopped. No automatic restart.'; }
      });
    });
    await page.locator('#character-button').click();
    await page.locator('[data-scene="sprite"]').click();
    await expect(page.locator('#message')).toContainText('Import ready', { timeout: 20_000 });
    await page.locator('#detail-view').click();
    await page.evaluate(() => { document.getElementById('continuity').checked = true; });
    await page.locator('#open-camera').click();
    await page.locator('#live-tracking').uncheck();
    await page.locator('#live-extended').setChecked(metricSet === 'extended');
    await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
    console.log(`READY_FOR_USER: camera setup is open; no SDK or camera started. Evidence directory: ${directory}`);
    const closed = new Promise(resolve => app.once('close', resolve));
    await Promise.race([stopped, closed]);
    await uiRecording;
    if (report.failed !== undefined || report.watchdog) process.exitCode = 1;
    if ((report.stopped || report.failed !== undefined) && !report.watchdog) {
      if (report.stopped) {
        await expect.poll(() => page.locator('#camera-preview').evaluate(video => video.srcObject === null), { timeout: 5000 }).toBe(true);
        report.cameraReleased = true;
      }
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
} catch (error) {
  report.harnessError = `Benchmark preparation or verification failed; no automatic retry was attempted. ${String(error?.message ?? error).split('\n')[0].slice(0, 300)}`;
  process.exitCode = 1;
} finally {
  if (report.started && !report.stopped && report.failed === undefined && !report.watchdog) {
    app.process().kill('SIGKILL');
    report.watchdog = true;
  }
  clearTimeout(deadline);
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ directory, ...report }));
}
