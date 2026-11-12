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
    const assets = Object.values(diagnostics.assets ?? {});
    return assets.length > 0 && assets.every(asset => asset.phase === 'ready');
  });
  report.loadMs = Math.round(performance.now() - started);
  const sizes = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 760, height: 620 }];
  const fits = () => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth);
  const widows = () => page.evaluate(() => {
    const found = [];
    for (const element of document.querySelectorAll('h1, h2, p, li, label, button, .tag, #scene-caption')) {
      if (!element.checkVisibility()) continue;
      const nodes = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) if (walker.currentNode.textContent.trim()) nodes.push(walker.currentNode);
      const node = nodes.at(-1);
      const words = node ? [...node.textContent.matchAll(/\S+/g)] : [];
      if (words.length < 2) continue;
      const rect = match => { const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length); return range.getClientRects()[0]; };
      const last = rect(words.at(-1)); const previous = rect(words.at(-2)); const before = words.length > 2 ? rect(words.at(-3)) : null;
      if (last && previous && before && last.top > previous.top + 2 && Math.abs(previous.top - before.top) <= 2) found.push(element.textContent.trim().slice(-60));
    }
    return found;
  });
  async function checkLayout(name) {
    for (const viewport of sizes) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (!await fits()) {
        await page.screenshot({ path: path.join(output, `${name}-${viewport.width}x${viewport.height}-overflow.png`), fullPage: true });
        const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => element.checkVisibility()).map(element => ({ element, box: element.getBoundingClientRect() })).filter(({ box }) => box.bottom > innerHeight + 0.5 || box.right > innerWidth + 0.5).map(({ element, box }) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.classList.length ? `.${[...element.classList].join('.')}` : ''} ${Math.round(box.right)}×${Math.round(box.bottom)}`).slice(0, 12));
        assert.fail(`${name} fits ${viewport.width}×${viewport.height} without scrolling; overflowing: ${overflow.join(', ')}`);
      }
      assert.deepEqual(await widows(), [], `${name} has no widowed words at ${viewport.width}×${viewport.height}`);
      await page.screenshot({ path: path.join(output, `${name}-${viewport.width}x${viewport.height}.png`) });
    }
  }
  async function pickScene(id) {
    await page.locator('#character-button').click();
    await page.locator(`[data-scene="${id}"]`).click();
    await expect(page.locator('#character-menu')).toBeHidden();
  }
  async function tabTo(id) {
    for (let step = 0; step < 160; step++) {
      if (await page.evaluate(target => document.activeElement?.id === target, id)) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`#${id} is not reachable by keyboard`);
  }
  await checkLayout('welcome');
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
  const guide = [];
  for (let step = 0; step < 12 && !guide.some(text => text.startsWith('Keep your performance')); step++) {
    guide.push(`${await page.locator('#guide-title').textContent()} ${await page.locator('#guide-copy').textContent()}`);
    if (!guide.at(-1).startsWith('Keep your performance')) await page.locator('#guide-next').press('Enter');
  }
  const walkthrough = guide.join(' ');
  for (const topic of ['Character menu', 'Use your own character', 'corner of the stage', 'Second camera', 'Rig requirements']) assert.ok(walkthrough.includes(topic), `Walkthrough covers ${topic}`);
  await page.keyboard.press('Escape');
  await expect(page.locator('#guide')).not.toBeVisible();
  await page.locator('#help').click(); await page.locator('#guide-skip').click();
  await expect(page.locator('#guide')).not.toBeVisible();
  report.checks.push('walkthrough covers menu, picture-in-picture and second camera; skippable and replayable');

  await expect(page.locator('#use-own-character')).toBeVisible();
  await expect(page.locator('#character-menu')).toBeHidden();
  await page.locator('#character-button').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#character-button')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-scene="robot"]')).toBeFocused();
  const menu = await page.evaluate(() => [...document.querySelectorAll('#character-menu button')].filter(item => item.checkVisibility()).map(item => item.id || item.dataset.scene));
  assert.deepEqual(menu, ['menu-own-character', 'robot', 'snow', 'bubbles', 'star', 'dragon', 'baby-dragon', 'runner', 'brain'], 'Menu lists the own-character entry first, then registry defaults; no import before one is loaded');
  const [own, item] = await Promise.all([page.locator('#menu-own-character').boundingBox(), page.locator('[data-scene="robot"]').boundingBox()]);
  assert.ok(own.width > item.width && own.height >= item.height, 'Use your own character is the most prominent menu entry');
  for (const viewport of sizes) { await page.setViewportSize(viewport); assert.equal(await fits(), true, `Open menu fits ${viewport.width}×${viewport.height}`); }
  await page.screenshot({ path: path.join(output, 'menu-760x620.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#character-menu')).toBeHidden();
  await expect(page.locator('#character-button')).toBeFocused();
  await page.locator('#character-button').click(); await page.locator('#menu-own-character').click();
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator('#rig-requirements summary').click();
  await expect(page.locator('#rig-requirements')).toContainText('docs/FORMATS.md');
  await page.screenshot({ path: path.join(output, 'import-760x620.png') });
  await page.keyboard.press('Escape');
  await page.locator('#open-credits').click();
  await expect(page.locator('#credits-dialog')).toContainText('CC BY 4.0');
  await page.locator('#credits-full summary').click();
  await expect(page.locator('#credits-files pre')).toHaveCount(3);
  await expect(page.locator('#credits-files pre').first()).not.toHaveText('Loading…');
  await expect(page.locator('#credits-files pre.error'), 'ATTRIBUTION.md files and THIRD_PARTY_NOTICES.txt must be served (desktop/security.cjs assetPath allowlist; public/THIRD_PARTY_NOTICES.txt)').toHaveCount(0);
  await page.keyboard.press('Escape');
  report.checks.push('character menu, own-character prominence, rig requirements and credits');

  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const drawing = canvas.getContext('2d');
    window.__fixtureTracks = []; window.__fixtureTooClose = false; window.__fixtureDeny = false; window.__trackingWorkers = 0;
    const draw = now => {
      drawing.fillStyle = '#4b5d61'; drawing.fillRect(0, 0, 640, 480);
      drawing.fillStyle = '#d3ee9f'; drawing.fillRect(270 + Math.sin(now / 400) * 120, 160, 100, 160);
      drawing.fillStyle = '#10171d'; drawing.font = '28px sans-serif'; drawing.fillText('SYNTHETIC CAMERA FIXTURE', 120, 60);
      if (window.__fixtureTracks.some(track => track.readyState === 'live')) requestAnimationFrame(draw);
    };
    const devices = [{ kind: 'videoinput', deviceId: 'fixture-body', label: 'Fixture body camera' }, { kind: 'videoinput', deviceId: 'fixture-face', label: 'Fixture face camera' }];
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => devices });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
      if (constraints.audio !== false) throw new Error('Fixture must never request microphone audio');
      if (window.__fixtureDeny) throw new DOMException('Fixture denial', 'NotAllowedError');
      const deviceId = constraints.video?.deviceId?.exact ?? 'fixture-body';
      const stream = canvas.captureStream(15);
      for (const track of stream.getTracks()) {
        const settings = track.getSettings.bind(track);
        Object.defineProperty(track, 'getSettings', { value: () => ({ ...settings(), deviceId }) });
      }
      const idle = !window.__fixtureTracks.some(track => track.readyState === 'live');
      window.__fixtureTracks.push(...stream.getTracks());
      if (idle) requestAnimationFrame(draw);
      return stream;
    } });
    const channels = { breath: 'relative', breathingRate: 'breaths/min', pulseRate: 'beats/min', arterialTrace: 'relative', blink: 'boolean', talking: 'boolean' };
    const shapes = ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'mouthFunnel', 'mouthPucker', 'mouthClose', 'mouthPressLeft', 'mouthPressRight'];
    const OriginalWorker = window.Worker;
    window.Worker = function (url, options) {
      if (!String(url).includes('worker')) return new OriginalWorker(url, options);
      window.__trackingWorkers++;
      let sessionId = '';
      let live = true;
      const worker = { onmessage: null, onerror: null, terminate() { if (live) { live = false; window.__trackingWorkers--; } } };
      const reply = data => setTimeout(() => { if (live) worker.onmessage?.({ data }); }, 5);
      worker.postMessage = message => {
        if (message.type === 'initialize') { sessionId = message.sessionId; reply({ type: 'ready' }); }
        else if (message.type === 'stop') reply({ type: 'stopped' });
        else if (message.type === 'frame') {
          message.bitmap?.close(); message.faceBitmap?.close();
          const t = message.timeMs;
          reply({ type: 'frame', id: message.id, frame: {
            sessionId, source: 'local-camera', timeMs: t,
            signals: Object.fromEntries(Object.entries(channels).map(([channel, unit]) => [channel, { value: null, quality: 'missing', confidence: null, sampledAtMs: t, unit }])),
            tracking: { sampledAtMs: t, face: { weights: Object.fromEntries(shapes.map(name => [name, 0.1])), rotation: null },
              body: { leftShoulder: [0.4, 0.3, 0, 0.9], rightShoulder: [0.6, 0.3, 0, 0.9], leftHip: [0.42, 0.62, 0, 0.9], rightHip: [0.58, 0.62, 0, 0.9] },
              movement: 0.1, framing: { face: true, upperBody: true, fullBody: !window.__fixtureTooClose, tooClose: window.__fixtureTooClose } },
          } });
        }
      };
      return worker;
    };
  });
  await expect(page.locator('#pip')).toBeHidden();
  await page.locator('#open-camera').click();
  await expect(page.locator('#face-camera-settings')).toBeHidden();
  await page.locator('#camera-consent').check();
  await page.evaluate(() => { window.__fixtureDeny = true; });
  await page.locator('#preview').click();
  await expect(page.locator('#camera-dialog .dialog-message')).toContainText('Camera access was blocked');
  await expect(page.locator('#pip')).toBeHidden();
  await page.evaluate(() => { window.__fixtureDeny = false; });
  await page.locator('#preview').click();
  await expect(page.locator('#pip')).toBeVisible();
  await expect.poll(() => page.evaluate(() => { const pip = document.getElementById('pip-video'); return pip.srcObject === document.getElementById('camera-preview').srcObject && pip.readyState >= 2 && !pip.paused; })).toBe(true);
  assert.equal(await page.evaluate(() => window.__fixtureTracks.length), 1, 'Picture-in-picture reuses the consented preview stream');
  await expect(page.locator('#face-camera-settings')).toBeVisible();
  await page.locator('#face-camera-settings summary').click();
  await expect(page.locator('#open-face-camera')).toBeDisabled();
  assert.equal(await page.locator('#face-camera option[value="fixture-body"]').evaluate(option => option.disabled), true, 'The body camera cannot be the face camera');
  await page.locator('#face-camera').selectOption('fixture-face');
  await expect(page.locator('#open-face-camera')).toBeDisabled();
  await page.locator('#face-consent').check();
  await expect(page.locator('#open-face-camera')).toBeEnabled();
  await page.locator('#open-face-camera').click();
  await expect(page.locator('#face-preview')).toBeVisible();
  assert.equal(await page.evaluate(() => window.__fixtureTracks.length), 2);
  await page.screenshot({ path: path.join(output, 'camera-dialog.png') });
  await page.locator('#local-tracking').click();
  await expect(page.locator('#source-badge')).toHaveText('LOCAL CAMERA', { timeout: 15_000 });
  await expect(page.locator('#camera-dialog')).toBeHidden();
  await expect(page.locator('#pip')).toBeVisible();
  assert.equal(await page.locator('#stage #pip').count(), 0, 'Picture-in-picture is a DOM overlay outside the exported canvas');
  await page.evaluate(() => { window.__fixtureTooClose = true; });
  await page.waitForTimeout(400);
  await expect(page.locator('#framing-prompt')).toBeHidden();
  await expect(page.locator('#framing-prompt')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#framing-region')).toHaveAttribute('aria-live', 'polite');
  await page.screenshot({ path: path.join(output, 'framing-prompt.png') });
  await page.locator('#dismiss-framing').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('#framing-prompt')).toBeHidden();
  await pickScene('bubbles');
  await page.waitForTimeout(1500);
  await expect(page.locator('#framing-prompt')).toBeHidden();
  await pickScene('robot');
  await expect(page.locator('#framing-prompt')).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => { window.__fixtureTooClose = false; });
  await expect(page.locator('#framing-prompt')).toBeHidden({ timeout: 5000 });
  report.checks.push('framing prompt: debounced, polite, dismissible, full-body scenes only');
  await page.locator('#pip-toggle').click();
  await expect(page.locator('#pip-video')).toBeHidden();
  await expect(page.locator('#pip-toggle')).toHaveText('Show camera');
  assert.equal(await page.evaluate(() => document.getElementById('pip-video').srcObject), null);
  await page.locator('#pip-toggle').click();
  await expect(page.locator('#pip-video')).toBeVisible();
  await page.locator('#reduced-motion').check();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('motion-reduced') && getComputedStyle(document.getElementById('pip')).transitionDuration === '0s' && getComputedStyle(document.getElementById('pip-toggle')).transitionDuration === '0s'), true);
  await page.locator('#reduced-motion').uncheck();
  await checkLayout('camera');
  await page.evaluate(() => window.__fixtureTracks[0].dispatchEvent(new Event('ended')));
  await expect(page.locator('#message')).toContainText('disconnected');
  await expect(page.locator('#pip')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__trackingWorkers)).toBe(0);
  assert.equal(await page.evaluate(() => window.__fixtureTracks.every(track => track.readyState === 'ended') && document.getElementById('face-preview').srcObject === null), true, 'Disconnect releases body and face cameras');
  report.checks.push('picture-in-picture visibility, second-camera consent gating, camera denial and disconnect recovery');

  await page.setViewportSize({ width: 1024, height: 768 });
  await tabTo('rehearse'); await page.keyboard.press('Enter');
  await expect(page.locator('#source-badge')).toHaveText('SYNTHETIC REHEARSAL');
  await tabTo('record'); await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
  await tabTo('record'); await page.keyboard.press('Enter');
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
  const keyboardBefore = (await downloads()).length;
  await tabTo('open-export'); await page.keyboard.press('Enter');
  await expect(page.locator('#export-dialog')).toBeVisible();
  await tabTo('export-data'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await downloads()).length, { timeout: 30_000 }).toBe(keyboardBefore + 1);
  const jsonPath = (await downloads()).at(-1).path;
  report.checks.push('keyboard-only rehearsal, record and export');
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
    await pickScene(scene);
    await expect(page.locator('#brain-legend')).toBeVisible({ visible: scene === 'brain' });
    await expect(page.locator('#runner-choice')).toBeVisible({ visible: scene === 'runner' });
    if (scene === 'brain') { await expect(page.locator('#brain-regions li:not([hidden])')).not.toHaveCount(0); assert.ok(!/inactive/i.test(await page.locator('#brain-legend').textContent())); }
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
  await pickScene('baby-dragon');
  report.exports.wav = await download('#export-wav');
  report.exports.glb = await download('#export-glb');
  report.exports.video = await download('#export-video');
  await pickScene('robot');
  await download('#export-video', true);
  await pickScene('baby-dragon');
  await page.locator('#open-export').click();
  await page.locator('#export-video').click();
  await expect(page.locator('#cancel-export')).toBeVisible();
  await page.locator('#cancel-export').click();
  await expect(page.locator('#message')).toContainText('canceled');
  await page.screenshot({ path: path.join(output, 'export-canceled.png') });
  const importPath = report.exports.glb;
  await page.locator('#open-import').click();
  await page.locator('#import-model').setInputFiles(importPath);
  await expect(page.locator('#message')).toContainText('Import ready', { timeout: 15_000 });
  await expect(page.locator('[data-scene="imported"]')).toHaveJSProperty('hidden', false);
  await pickScene('imported');
  await expect(page.locator('#stage-state')).toHaveText('READY');
  await page.screenshot({ path: path.join(output, 'roundtrip.png'), fullPage: true });
  await page.locator('#open-import').click();
  await page.locator('#remove-model').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-scene="imported"]')).toHaveJSProperty('hidden', true);
  await page.locator('#open-import').click();
  await page.locator('#import-model').setInputFiles({ name: 'broken.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('not a model') });
  await expect(page.locator('#message')).toHaveClass(/error/);
  report.checks.push('import rejection is reported');
  const resourceState = () => page.evaluate(() => ({ ...JSON.parse(document.querySelector('#stage').dataset.diagnostics), heapBytes: performance.memory?.usedJSHeapSize ?? null }));
  await page.waitForTimeout(250);
  report.resourceCycles = [await resourceState()];
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator('#open-import').click();
    await page.locator('#import-model').setInputFiles(importPath);
    await expect(page.locator('#message')).toContainText('Import ready');
    await pickScene('imported');
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
  await checkLayout('studio');
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
