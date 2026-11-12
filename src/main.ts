import './style.css';
import type { BrainExampleId, CaptureSource, ControlFrame, SceneControls, SceneFrame, SceneId, Source, Take } from './contracts';
import { BRAIN_EXAMPLE_IDS, TAKE_LIMITS, SIGNAL_STALE_MS } from './contracts';
import { BRAIN_CAPTION, BRAIN_EXAMPLES } from './scenes/brain';
import { createStage, DETAIL_SCENES } from './stage';
import { createRehearsalSource } from './rehearsal';
import { createLocalTrackingSource } from './tracking/source';
import { trackingAt } from './tracking-frame';
import { addTake, frameAt, TakeRecorder, trimTake } from './recording';
import { validateFrame, validateTake, MAX_TAKE_JSON_BYTES } from './validation';
import { createBreathContinuity } from './continuity';
import { createPulseTrend } from './pulse-trend';
import { createCamera } from './camera';
import { createSound, renderWav } from './audio';
import { cameraErrorMessage, createBrainLegend, createCameraFeed, createFramingPrompt, mountStudio, setupCharacterMenu, setupGuide, setupPanels, updateStudioFlow } from './ui';
import { bakeAnimation, exportControlData, exportPreview } from './exports';
import { importCharacter, validateClipCompatibility, disposeImported } from './imports';
import { assetCopyright, getAssetCopyright, setAssetCopyright } from './asset-credits';
import { SCENE_REGISTRY, type SceneEntry } from './scenes/registry';
import type { AnimationClip, Group } from 'three';

mountStudio(document.querySelector<HTMLElement>('#app')!);
setupGuide();
setupPanels();
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const button = (id: string) => element<HTMLButtonElement>(id);
const canvas = element<HTMLCanvasElement>('stage');
const FULL_BODY_SCENES: ReadonlySet<SceneId> = new Set(['rex', 'runner', 'imported']);
const userEntry = SCENE_REGISTRY.find(item => item.group === 'yours')!;
let stage: Awaited<ReturnType<typeof createStage>> | null = null;
let entry: SceneEntry = SCENE_REGISTRY[0];
let importedEntry: SceneEntry | null = null;
let loadingCharacter = false;
let source: CaptureSource | null = null;
let sourceKind: Source | null = null;
let latest: ControlFrame | null = null;
let latestArrival = 0;
let takes: Take[] = [];
let selected: Take | null = null;
let recorder: TakeRecorder | null = null;
let recordingOrigin = 0;
let playing = false;
let position = 0;
let playOrigin = 0;
let busy = false;
let exporting: AbortController | null = null;
let importedRoot: Group | null = null;
let importedClips: AnimationClip[] = [];
let keySet = false;
let disposed = false;
let raf = 0;
let inputIntent = 0;
let cleanupFailed = false;
const seed = 20261111;
const sound = createSound();
const continuity = createBreathContinuity();
const pulseTrend = createPulseTrend();
const reducedPreference = matchMedia('(prefers-reduced-motion: reduce)');
input('reduced-motion').checked = reducedPreference.matches;
const applyMotionPreference = () => document.documentElement.classList.toggle('motion-reduced', input('reduced-motion').checked);
applyMotionPreference();
input('reduced-motion').addEventListener('change', applyMotionPreference);
const camera = createCamera(element<HTMLVideoElement>('camera-preview'), () => {
  inputIntent++;
  void stopInput().then(() => message('The selected camera disconnected or frame submission failed. Reconnect it, refresh, then open a new preview.', true))
    .catch(() => message('Camera capture failed and cleanup could not finish. Stop again before retrying.', true));
});
const syncCameraFeed = createCameraFeed(element<HTMLVideoElement>('camera-preview'));
const framing = createFramingPrompt();
const renderBrainLegend = createBrainLegend();
const menu = setupCharacterMenu(SCENE_REGISTRY, next => { void run(() => pickEntry(next)); });

function message(text: string, error = false) {
  element('message').textContent = text;
  element('message').classList.toggle('error', error);
  for (const status of document.querySelectorAll('dialog[open] .dialog-message')) { status.textContent = text; status.classList.toggle('error', error); }
}

const isBrainExample = (value: string): value is BrainExampleId => (BRAIN_EXAMPLE_IDS as readonly string[]).includes(value);

function controls(): SceneControls {
  const example = element<HTMLSelectElement>('brain-example').value;
  return { motion: Number(input('motion').value) / 100, sensitivity: Number(input('sensitivity').value) / 100, sound: Number(input('sound').value) / 100, ...(entry.scene === 'brain' && isBrainExample(example) ? { brainExample: example } : {}) };
}

function clockLabel(ms: number) {
  return `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(2).padStart(5, '0')}`;
}

function refreshActions() {
  updateStudioFlow({ hasInput: sourceKind !== null, cameraActive: camera.active, recording: recorder !== null, hasTake: selected !== null, playing, busy, exporting: exporting !== null });
  button('rehearse').disabled = busy || exporting !== null || sourceKind !== null || cleanupFailed;
  button('record').disabled = !stage || busy || exporting !== null || (!recorder && (!latest || sourceKind === null || takes.length >= TAKE_LIMITS.takes));
  button('record').textContent = recorder ? '■ Finish take' : '● Record take';
  button('record').setAttribute('aria-pressed', String(recorder !== null));
  button('play').disabled = !selected || busy || exporting !== null || recorder !== null;
  button('play').textContent = playing ? 'Pause' : 'Play';
  for (const id of ['trim', 'delete', 'export-data', 'export-wav', 'export-video', 'export-glb']) button(id).disabled = !selected || busy || recorder !== null || exporting !== null;
  input('timeline').disabled = !selected || recorder !== null || sourceKind !== null || exporting !== null;
  button('preview').disabled = busy || exporting !== null || cleanupFailed || !input('camera-consent').checked;
  button('live').disabled = !window.idlewild || busy || exporting !== null || sourceKind !== null || !camera.active || !keySet || !input('live-consent').checked;
  button('local-tracking').disabled = busy || exporting !== null || sourceKind !== null || !camera.active || !input('camera-consent').checked;
  button('save-key').disabled = !window.idlewild || busy || sourceKind === 'live';
  button('clear-key').disabled = !window.idlewild || !keySet;
  button('enable-sound').disabled = busy || exporting !== null;
  for (const id of ['camera', 'face-camera']) input(id).disabled = busy || exporting !== null;
  const faceDevice = camera.faceDeviceId;
  const faceChoice = input('face-camera').value;
  button('open-face-camera').disabled = busy || exporting !== null || (!faceDevice && (!camera.active || !input('face-consent').checked || !faceChoice || faceChoice === camera.deviceId));
  button('open-face-camera').textContent = faceDevice ? 'Close face camera' : 'Open face camera';
  element('face-preview').hidden = !faceDevice;
  syncCameraFeed(camera.active);
  for (const id of ['motion', 'sensitivity', 'sound', 'runner-variant', 'brain-example', 'import-data', 'import-model', 'reduced-motion']) input(id).disabled = exporting !== null || busy;
  for (const id of ['detail-view', 'use-own-character', 'menu-own-character']) button(id).disabled = exporting !== null || busy;
  input('imported-clip').disabled = exporting !== null || busy || !importedClips.length;
  button('remove-model').disabled = exporting !== null || busy || !importedRoot;
  menu.setDisabled(busy || exporting !== null);
  button('cancel-export').hidden = !exporting;
  for (const id of ['open-export', 'open-edit']) button(id).disabled = !selected || busy || recorder !== null || exporting !== null;
  button('open-takes').disabled = !takes.length || busy || recorder !== null || exporting !== null;
  if (cleanupFailed) { button('stop-input').hidden = false; element('next-step').textContent = 'Stop again to finish releasing capture before starting another input.'; }
}

async function run(action: () => Promise<void> | void) {
  if (busy || exporting) return;
  busy = true;
  refreshActions();
  try { await action(); }
  catch (error) { message(error instanceof Error ? error.message : 'The operation failed. Try again.', true); }
  finally { busy = false; refreshActions(); }
}

function on(id: string, action: () => Promise<void> | void) {
  element(id).addEventListener('click', () => { void run(action); });
}

function renderTakes() {
  element('takes').replaceChildren();
  takes.forEach((take, index) => {
    const item = document.createElement('button');
    item.className = 'take';
    item.textContent = `Take ${index + 1}`;
    item.setAttribute('aria-pressed', String(selected?.id === take.id));
    const detail = document.createElement('span');
    detail.textContent = `${take.source === 'rehearsal' ? 'SYNTHETIC' : take.source === 'local-camera' ? 'LOCAL CAMERA' : 'SMARTSPECTRA'} · ${clockLabel(take.durationMs)}`;
    item.append(detail);
    item.addEventListener('click', () => { void run(async () => { await stopInput(); selectTake(take); element<HTMLDialogElement>('takes-dialog').close(); }); });
    element('takes').append(item);
  });
  if (!takes.length) element('takes').textContent = 'No takes yet. Record a performance to begin.';
  element('take-count').textContent = `${takes.length} / ${TAKE_LIMITS.takes}`;
}

function selectTake(take: Take | null) {
  selected = take;
  playing = false;
  position = 0;
  input('timeline').max = String(take?.durationMs ?? 0);
  input('timeline').value = '0';
  input('trim-start').value = '0';
  input('trim-end').value = String((take?.durationMs ?? 0) / 1000);
  renderTakes();
  refreshActions();
}

function finishRecording() {
  if (!recorder) return;
  const take = recorder.finish();
  recorder = null;
  if (take.samples.length) {
    takes = addTake(takes, take);
    selectTake(take);
    message('Take captured. Play it, try another scene, or export.');
  }
  refreshActions();
}

function receiveFrame(raw: ControlFrame) {
  if (raw.source !== sourceKind) return;
  const frame = pulseTrend.update(continuity.update(validateFrame(raw), input('continuity').checked));
  latest = frame;
  latestArrival = performance.now();
  if (recorder) { recorder.append(frame); if (recorder.full) { finishRecording(); void stopInput().catch(() => message('Take saved; input cleanup failed. Stop again.', true)); } }
  refreshActions();
}

let stopping: Promise<void> | null = null;
async function stopInput() {
  if (stopping) return stopping;
  finishRecording();
  const old = source;
  source = null;
  sourceKind = null;
  latest = null;
  continuity.reset(); pulseTrend.reset();
  framing.reset();
  stopping = (async () => {
    const results = await Promise.allSettled([old?.dispose(), camera.stop(), sound.disable()]);
    button('enable-sound').textContent = 'Enable sound';
    refreshActions();
    const failure = results.find(result => result.status === 'rejected');
    cleanupFailed = failure?.status === 'rejected';
    refreshActions();
    if (failure?.status === 'rejected') { element('status').textContent = 'Capture cleanup failed. Stop again before restarting.'; throw failure.reason; }
    element('status').textContent = 'Input and camera stopped. Your takes remain available.';
  })();
  try { await stopping; } finally { stopping = null; }
}

function currentInput(now: number): SceneFrame {
  if (latest && sourceKind) return { timeMs: latest.timeMs + Math.max(0, now - latestArrival), seed, controls: controls(), frame: latest, reducedMotion: input('reduced-motion').checked };
  if (selected) {
    if (playing) {
      position = now - playOrigin;
      if (position >= selected.durationMs) {
        if (input('loop').checked) { position %= selected.durationMs; playOrigin = now - position; }
        else { position = selected.durationMs; playing = false; void sound.disable(); refreshActions(); }
      }
    }
    return { timeMs: position, seed: selected.seed, controls: controls(), frame: frameAt(selected, position), reducedMotion: input('reduced-motion').checked };
  }
  return { timeMs: 0, seed, controls: controls(), frame: null, reducedMotion: input('reduced-motion').checked };
}

const signalNames = { breath: 'Breath movement', breathingRate: 'Breathing rate', pulseRate: 'Pulse rate', arterialTrace: 'Arterial trace', blink: 'Blink', talking: 'Talking' };
for (const [channel, name] of Object.entries(signalNames)) {
  const card = document.createElement('div'); card.className = 'signal';
  const label = document.createElement('span'); label.textContent = name;
  const value = document.createElement('strong'); value.id = `signal-${channel}`; value.textContent = '—';
  const quality = document.createElement('small'); quality.id = `quality-${channel}`; quality.textContent = 'missing';
  card.append(label, value, quality); element('signals').append(card);
}
let lastSignalPaint = 0;
let lastLegendPaint = 0;
function animate(now: number) {
  if (disposed) return;
  if (!exporting && stage) {
    const data = currentInput(now);
    stage.update(data);
    if (playing || sourceKind) sound.update(data, entry.scene);
    const duration = recorder?.durationMs ?? selected?.durationMs ?? 0;
    const displayTime = recorder ? Math.max(0, (latest?.timeMs ?? recordingOrigin) - recordingOrigin) : position;
    element('time').textContent = `${clockLabel(displayTime)} / ${clockLabel(duration)}`;
    if (!recorder) input('timeline').value = String(position);
    const origin = data.frame?.source;
    const provenance = data.frame?.signals.breath.provenance;
    const badge = origin === 'rehearsal' ? 'SYNTHETIC REHEARSAL' : origin === 'local-camera' ? 'LOCAL CAMERA' : origin === 'live' ? sourceKind === 'live' ? 'LIVE · UNVERIFIED TIMING' : 'RECORDED LIVE' : 'NO INPUT';
    element('input-watermark').textContent = provenance === 'replayed' ? `${badge} · CACHED BREATH` : badge;
    element('source-badge').textContent = badge;
    if (now - lastSignalPaint > 200) {
      lastSignalPaint = now;
      const diagnostics = stage.diagnostics();
      canvas.dataset.diagnostics = JSON.stringify(diagnostics);
      const asset = entry.scene in diagnostics.assets ? diagnostics.assets[entry.scene as keyof typeof diagnostics.assets] : null;
      element('stage-state').textContent = diagnostics.contextLost ? 'GRAPHICS LOST' : loadingCharacter || asset?.phase === 'loading' ? 'LOADING' : asset?.phase === 'error' ? 'ASSET UNAVAILABLE' : 'READY';
      if (asset?.phase === 'error') message(asset.message, true);
      element('tracking-details').hidden = origin !== 'local-camera';
      element('physiology-details').hidden = origin === 'local-camera';
      const tracking = trackingAt(data);
      if (sourceKind === 'local-camera' && FULL_BODY_SCENES.has(entry.scene)) framing.update(now, Boolean(tracking?.face && tracking.framing?.face && tracking.framing.tooClose));
      else framing.reset();
      if (entry.scene === 'brain' && now - lastLegendPaint >= 250) { lastLegendPaint = now; renderBrainLegend(stage.brainRegions(3), controls().brainExample); }
      if (origin === 'local-camera') element('tracking-summary').textContent = `${tracking?.face ? 'Face tracked' : 'Face unavailable'} · ${tracking?.body ? `${Object.keys(tracking.body).length} body joints tracked` : 'Body unavailable'}`;
      for (const channel of Object.keys(signalNames) as (keyof typeof signalNames)[]) {
        const signal = data.frame?.signals[channel];
        const quality = signal && data.timeMs - signal.sampledAtMs >= SIGNAL_STALE_MS ? 'stale' : signal?.quality ?? 'missing';
        const trend = channel === 'pulseRate' ? data.frame?.trends?.pulseRate : undefined;
        element(`signal-${channel}`).textContent = !signal || signal.value === null || quality === 'stale' ? '—' : signal.unit === 'boolean' ? signal.value === 1 ? 'Yes' : 'No' : `${signal.value.toFixed(1)}${signal.unit === 'breaths/min' ? ' /min' : signal.unit === 'beats/min' ? ' bpm' : ''}${trend ? ` · ${trend.direction}` : ''}`;
        element(`quality-${channel}`).textContent = `${quality}${signal?.provenance === 'replayed' ? ' · cached animation' : ''}`;
      }
    }
  }
  raf = requestAnimationFrame(animate);
}

function chooseEntry(next: SceneEntry) {
  stage?.setScene(next.scene); entry = next;
  element('scene-title').textContent = next.title; element('scene-caption').textContent = next.caption;
  button('detail-view').hidden = !DETAIL_SCENES.has(next.scene); button('detail-view').textContent = 'Close view'; button('detail-view').setAttribute('aria-pressed', 'false');
  element('brain-legend').hidden = next.scene !== 'brain';
  element('runner-choice').hidden = next.scene !== 'runner';
  element('brain-choice').hidden = next.scene !== 'brain';
  framing.reset();
  menu.setCurrent(next);
}
async function pickEntry(next: SceneEntry) {
  if (next.model && importedEntry?.id !== next.id) { await loadBundled(next); return; }
  if (next.scene === 'imported' && !importedRoot) throw new Error('Use your own character to import one first.');
  chooseEntry(next);
}
on('detail-view', () => {
  const enabled = button('detail-view').getAttribute('aria-pressed') !== 'true';
  stage?.setDetailView(enabled); button('detail-view').setAttribute('aria-pressed', String(enabled)); button('detail-view').textContent = enabled ? 'Full view' : 'Close view';
});
chooseEntry(entry);
on('rehearse', async () => {
  const intent = ++inputIntent;
  await stopInput(); if (intent !== inputIntent) return;
  playing = false; sourceKind = 'rehearsal';
  source = createRehearsalSource(seed);
  try { await source.start(receiveFrame, status => { element('status').textContent = status.message; }); }
  catch (error) { await stopInput(); throw error; }
  message('Synthetic rehearsal is running. Shape the scene, then record a take.');
});
element('stop-input').addEventListener('click', () => {
  const intent = ++inputIntent;
  exporting?.abort();
  playing = false;
  void stopInput().then(() => { if (intent === inputIntent) message(''); }, () => message('Capture cleanup failed. Stop again before restarting.', true));
});
on('record', async () => {
  if (recorder) { finishRecording(); await stopInput(); setTimeout(() => button('play').focus(), 0); return; }
  if (!latest || !sourceKind || takes.length >= TAKE_LIMITS.takes) throw new Error('Start an input and make room for another take.');
  playing = false;
  recorder = new TakeRecorder(crypto.randomUUID(), latest.source, latest.sessionId, seed);
  recordingOrigin = latest.timeMs;
  recorder.append(latest);
  message('Recording control data. Camera images and microphone audio are excluded.');
});
on('play', async () => {
  if (playing) { position = performance.now() - playOrigin; playing = false; await sound.disable(); button('enable-sound').textContent = 'Enable sound'; return; }
  const intent = ++inputIntent;
  const wasAudible = sound.enabled;
  await stopInput(); if (intent !== inputIntent) return;
  if (!selected || selected.durationMs === 0) throw new Error('Choose a nonempty take.');
  if (position >= selected.durationMs) position = 0;
  playOrigin = performance.now() - position; playing = true;
  if (wasAudible) { await sound.enable(); button('enable-sound').textContent = 'Mute sound'; }
});
input('timeline').addEventListener('input', () => { playing = false; position = Number(input('timeline').value); void sound.disable(); button('enable-sound').textContent = 'Enable sound'; refreshActions(); });
on('trim', async () => {
  if (!selected) return;
  await stopInput(); playing = false;
  const start = Number(input('trim-start').value) * 1000; const end = Number(input('trim-end').value) * 1000;
  if (!(end > start)) throw new Error('Trim out must be after trim in.');
  const trimmed = trimTake(selected, start, end);
  if (!trimmed.samples.length) throw new Error('This range contains no recorded controls. Choose another range.');
  takes = takes.map(take => take.id === trimmed.id ? trimmed : take); selectTake(trimmed); element<HTMLDialogElement>('edit-dialog').close(); message('Take trimmed. Export to keep it.');
});
on('delete', async () => {
  await stopInput();
  takes = takes.filter(take => take.id !== selected?.id); selectTake(takes.at(-1) ?? null); element<HTMLDialogElement>('edit-dialog').close(); message('Take deleted from this workspace.');
});
for (const id of ['motion', 'sensitivity', 'sound']) input(id).addEventListener('input', () => { element(`${id}-value`).textContent = `${input(id).value}%`; });
on('enable-sound', async () => { if (sound.enabled) await sound.disable(); else await sound.enable(); button('enable-sound').textContent = sound.enabled ? 'Mute sound' : 'Enable sound'; });
input('runner-variant').addEventListener('change', () => stage?.setRunnerVariant(Number(input('runner-variant').value) as 0 | 1 | 2));
input('camera-consent').addEventListener('change', () => { if (!input('camera-consent').checked) { inputIntent++; void stopInput().catch(() => message('Capture cleanup failed. Stop again.', true)); } refreshActions(); });
input('live-consent').addEventListener('change', () => { if (!input('live-consent').checked && sourceKind === 'live') { inputIntent++; void stopInput().catch(() => message('Capture cleanup failed. Stop again.', true)); } refreshActions(); });
on('save-key', async () => {
  const key = input('api-key').value; input('api-key').value = '';
  if (!window.idlewild) throw new Error('API keys are available only in the desktop app.');
  await window.idlewild.setKey(key); keySet = true; element('key-status').textContent = 'Key set in memory for this session.';
});
element('clear-key').addEventListener('click', () => {
  inputIntent++; keySet = false; input('api-key').value = ''; element('key-status').textContent = 'Key cleared.'; refreshActions();
  void Promise.allSettled([window.idlewild?.clearKey(), sourceKind === 'live' ? stopInput() : Promise.resolve()]).then(results => {
    if (results.some(result => result.status === 'rejected')) message('Key clear requested; capture cleanup failed. Stop again before retrying.', true);
  });
});
async function refreshCameras() {
  const select = element<HTMLSelectElement>('camera');
  const previous = camera.deviceId ?? select.value;
  const devices = await camera.devices();
  select.replaceChildren();
  if (!previous) select.add(new Option('System default (first preview)', ''));
  devices.forEach((device, index) => select.add(new Option(device.label || `Camera ${index + 1}`, device.deviceId)));
  if (previous && !devices.some(device => device.deviceId === previous)) {
    select.add(new Option('Selected camera disconnected — choose explicitly', previous));
    if (camera.active) { inputIntent++; await stopInput(); message('The selected camera is unavailable. Choose a camera and reopen preview.', true); }
  }
  select.value = previous;
  const faceSelect = element<HTMLSelectElement>('face-camera');
  const face = camera.faceDeviceId ?? faceSelect.value;
  faceSelect.replaceChildren(new Option('Choose a different camera', ''));
  devices.forEach((device, index) => { const option = new Option(device.label || `Camera ${index + 1}`, device.deviceId); option.disabled = device.deviceId === camera.deviceId; faceSelect.add(option); });
  faceSelect.value = devices.some(device => device.deviceId === face && device.deviceId !== camera.deviceId) ? face : '';
  if (camera.faceDeviceId && faceSelect.value !== camera.faceDeviceId) { await camera.closeFace(); message('The face camera is unavailable. Choose another and open it again.', true); }
}
on('refresh-cameras', refreshCameras);
on('preview', async () => {
  if (!input('camera-consent').checked) throw new Error('Camera preview requires consent.');
  const intent = ++inputIntent;
  await stopInput(); if (intent !== inputIntent) return;
  playing = false;
  try { await camera.start(input('camera').value || null); } catch (error) { throw new Error(cameraErrorMessage(error)); }
  await refreshCameras();
  if (intent !== inputIntent || !camera.active) return;
  element('status').textContent = 'Camera preview only. No SDK measurement is running.';
  message('Preview ready. Start face and body tracking without a key.');
});
input('camera').addEventListener('change', () => { void run(async () => { await stopInput(); message('Camera changed. Open a new preview explicitly.'); }); });
on('open-face-camera', async () => {
  if (camera.faceDeviceId) { await camera.closeFace(); message('Face camera closed. Body tracking continues.'); return; }
  const deviceId = input('face-camera').value;
  try {
    await camera.openFace({ video: element<HTMLVideoElement>('face-preview'), deviceId, consent: input('face-consent').checked, onDisconnect: () => { message('The face camera disconnected. Body tracking continues; reconnect it and open it again.', true); refreshActions(); } });
  } catch (error) { throw new Error(cameraErrorMessage(error)); }
  message('Face camera ready. It adds facial detail while the body camera tracks your body.');
});
input('face-consent').addEventListener('change', () => { if (input('face-consent').checked) { refreshActions(); return; } void camera.closeFace().then(refreshActions).catch(() => message('Face camera cleanup failed. Stop input before retrying.', true)); });
input('face-camera').addEventListener('change', () => { if (camera.faceDeviceId) void run(async () => { await camera.closeFace(); message('Face camera changed. Open it again explicitly.'); }); else refreshActions(); });
on('local-tracking', async () => {
  if (!input('camera-consent').checked || !camera.active || sourceKind !== null) throw new Error('Open a consented camera preview before starting local tracking.');
  sourceKind = 'local-camera'; latest = null; continuity.reset(); pulseTrend.reset(); playing = false;
  source = createLocalTrackingSource(element<HTMLVideoElement>('camera-preview'), { faceVideo: element<HTMLVideoElement>('face-preview') });
  try {
    await source.start(receiveFrame, status => {
      element('status').textContent = status.message;
      if (status.phase === 'error') void stopInput().then(() => message(status.message, true)).catch(() => message('Local tracking cleanup failed. Stop again before retrying.', true));
    });
    if (camera.active && sourceKind === 'local-camera') {
      element<HTMLDialogElement>('camera-dialog').close();
      message('Local tracking is running. Move naturally, then record a take.');
    }
  } catch (error) { await stopInput(); throw error; }
});
on('live', async () => {
  if (!input('camera-consent').checked || !input('live-consent').checked || !keySet) throw new Error('Preview consent, vendor-processing consent and a key are required.');
  sourceKind = 'live'; latest = null; continuity.reset(); pulseTrend.reset(); playing = false;
  try { await camera.startLive(); if (camera.active && sourceKind === 'live') element<HTMLDialogElement>('camera-dialog').close(); } catch (error) { await stopInput(); throw error; }
});
const offFrame = window.idlewild?.onFrame(frame => {
  try { receiveFrame(frame); } catch { void stopInput().then(() => message('Invalid live control data. Stop and retry.', true)).catch(() => message('Invalid live control data; cleanup failed. Stop again.', true)); }
});
const offStatus = window.idlewild?.onStatus(status => {
  if (sourceKind !== 'live') return;
  element('status').textContent = status.message;
  if (status.phase === 'error') void stopInput().then(() => { element('status').textContent = status.message; message(status.message, true); }).catch(() => message('Capture shutdown failed. Stop again before retrying.', true));
});
const deviceChange = () => { void refreshCameras().catch(() => message('Could not refresh cameras. Use Refresh to retry.', true)); };
navigator.mediaDevices?.addEventListener('devicechange', deviceChange);

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
async function exportTake(kind: 'data' | 'wav' | 'video' | 'glb') {
  if (!selected || !stage) return;
  const take = selected;
  const intent = ++inputIntent;
  await stopInput(); if (intent !== inputIntent) return;
  playing = false;
  exporting = new AbortController(); refreshActions();
  const options = { signal: exporting.signal, reducedMotion: input('reduced-motion').checked };
  message(kind === 'video' ? 'Rendering the video in real time. Keep this window visible; Cancel stops the export.' : 'Preparing your export…');
  try {
    const copyright = kind === 'video' ? getAssetCopyright(stage.getExportRoot()) : undefined;
    const blob = kind === 'data' ? exportControlData(take) : kind === 'wav' ? await renderWav(take, entry.scene, controls(), options.signal) : kind === 'glb' ?
      await bakeAnimation(take, stage, controls(), options) : await exportPreview({ take, scene: entry.scene, controls: controls(), canvas, update: data => stage!.update(data), ...options, onProgress: progress => message(`Rendering video · ${Math.round(progress * 100)}%`) });
    options.signal.throwIfAborted();
    const example = controls().brainExample;
    const note = entry.scene === 'brain' ? `${example ? `Brain view: educational example from ${BRAIN_EXAMPLES[example].citation}. A published group result, not the performer's brain activity.` : BRAIN_CAPTION}\n\n` : '';
    if (copyright) save(new Blob([`${copyright}\n\n${note}Adapted in Idlewild: rendered with performance animation, lighting and procedural sound.\n`], { type: 'text/plain;charset=utf-8' }), `idlewild-${entry.id}-${take.source}-credits.txt`);
    save(blob, `idlewild-${entry.id}-${take.source}.${kind === 'data' ? 'json' : kind === 'video' ? 'webm' : kind}`);
    message(copyright ? 'Video and model credits are ready. Keep the credits with shared copies.' : 'Export prepared. Save the downloaded file to keep it.');
  } catch (error) {
    if (options.signal.aborted) message('Export canceled. The take is unchanged.'); else throw error;
  } finally { exporting = null; refreshActions(); }
}
for (const [id, kind] of [['export-data', 'data'], ['export-wav', 'wav'], ['export-video', 'video'], ['export-glb', 'glb']] as const) on(id, () => exportTake(kind));
element('cancel-export').addEventListener('click', () => exporting?.abort());
input('import-data').addEventListener('change', () => { const file = input('import-data').files?.[0]; input('import-data').value = ''; if (file) void run(async () => {
  element<HTMLDialogElement>('import-dialog').close();
  if (file.size > MAX_TAKE_JSON_BYTES) throw new Error(`Control data exceeds the ${MAX_TAKE_JSON_BYTES / 1024 / 1024} MiB limit.`);
  const take = validateTake(JSON.parse(await file.text()));
  if (!take.samples.length) throw new Error('The imported take contains no samples.');
  await stopInput(); takes = addTake(takes, take); selectTake(take); message('Control take imported. Its original source and signal quality are preserved.');
}); });
async function loadCharacter(file: File, owner: SceneEntry) {
  element<HTMLDialogElement>('import-dialog').close();
  if (!stage) throw new Error('Wait for the stage to finish loading.');
  const imported = await importCharacter(file);
  if (imported.kind === 'animation') {
    try {
      if (!importedRoot) throw new Error('Import the target character before adding animation clips.');
      validateClipCompatibility(importedRoot, imported.clips);
      const copyright = assetCopyright([...new Set([getAssetCopyright(importedRoot), getAssetCopyright(imported.root)].filter(Boolean))].join('\n\n'));
      stage.setImportedClips(imported.clips); importedClips = imported.clips;
      setAssetCopyright(importedRoot, copyright);
    } finally { disposeImported(imported.root); }
  } else {
    try { stage.setImported(imported.root, imported.clips); importedRoot = imported.root; importedClips = imported.clips; importedEntry = owner; }
    catch (error) { disposeImported(imported.root); throw error; }
  }
  menu.setAvailable(userEntry.id, importedEntry === userEntry);
  chooseEntry(importedEntry ?? owner);
  element('import-status').textContent = imported.summary; button('remove-model').hidden = !importedRoot;
  message(selected ? 'Import ready. Play your take or choose an animation in Import.' : 'Import ready. Start rehearsal to bring the character to life.');
  const copyright = importedRoot ? getAssetCopyright(importedRoot) : undefined;
  element('import-credits').hidden = !copyright; element('import-credit-text').textContent = copyright ?? '';
  const clips = element<HTMLSelectElement>('imported-clip'); clips.replaceChildren();
  importedClips.forEach((clip, index) => clips.add(new Option(clip.name || `Clip ${index + 1}`, String(index))));
  clips.disabled = !importedClips.length; element('clip-choice').hidden = !importedClips.length;
  const idle = importedClips.findIndex(clip => clip.name.toLowerCase() === 'idle'); clips.value = String(Math.max(0, idle));
}
input('import-model').addEventListener('change', () => { const file = input('import-model').files?.[0]; input('import-model').value = ''; if (file) void run(() => loadCharacter(file, userEntry)); });
async function loadBundled(next: SceneEntry) {
  const replacing = importedEntry === userEntry;
  loadingCharacter = true; element('stage-state').textContent = 'LOADING'; message(`Loading ${next.label}…`);
  try {
    let bytes: ArrayBuffer;
    try {
      const response = await fetch(next.model!, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(String(response.status));
      bytes = await response.arrayBuffer();
    } catch { throw new Error(`${next.label} could not load. Choose it again to retry, or use your own character.`); }
    await loadCharacter(new File([bytes], `${next.id}.glb`, { type: 'model/gltf-binary' }), next);
  } finally { loadingCharacter = false; }
  if (replacing) message(`${next.label} replaced your imported character. Import it again to switch back.`);
}
input('imported-clip').addEventListener('change', () => { void run(() => { const clip = importedClips[Number(input('imported-clip').value)]; if (clip) stage?.setImportedClips([clip]); }); });
on('remove-model', () => {
  if (entry.scene === 'imported') chooseEntry(SCENE_REGISTRY[0]);
  stage?.setImported(null, []); importedRoot = null; importedClips = []; importedEntry = null; menu.setAvailable(userEntry.id, false);
  input('imported-clip').disabled = true; element('imported-clip').replaceChildren(); element('clip-choice').hidden = true; button('remove-model').hidden = true;
  element('import-status').textContent = 'Imported character removed.';
  element('import-credits').hidden = true; element('import-credit-text').textContent = '';
});

const resize = new ResizeObserver(entries => { const rect = entries[0].contentRect; stage?.resize(rect.width, rect.height); });
resize.observe(canvas.parentElement!);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { inputIntent++; exporting?.abort(); playing = false; void stopInput().catch(() => message('Capture cleanup failed. Stop again before retrying.', true)); }
});
window.addEventListener('beforeunload', () => {
  disposed = true; cancelAnimationFrame(raf); exporting?.abort(); resize.disconnect(); offFrame?.(); offStatus?.();
  navigator.mediaDevices?.removeEventListener('devicechange', deviceChange); void source?.dispose(); void camera.stop(); void sound.dispose(); stage?.dispose();
});
refreshActions();
void createStage(canvas).then(async created => {
  if (disposed) { created.dispose(); return; }
  stage = created;
  const rect = canvas.parentElement!.getBoundingClientRect(); stage.resize(rect.width, rect.height);
  element('stage-state').textContent = 'READY';
  message('Ready. Start a synthetic rehearsal or open the studio guide.');
  refreshActions(); raf = requestAnimationFrame(animate);
  await stage.whenReady();
}).catch(() => { element('stage-state').textContent = 'UNAVAILABLE'; message('The 3D stage could not initialize. Check WebGL support and restart Idlewild.', true); });
