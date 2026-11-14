import type { SceneEntry } from './scenes/registry';
import { BRAIN_EXAMPLE_IDS, type BrainExampleId } from './contracts';
import { BRAIN_CAPTION, BRAIN_EXAMPLES, type BrainRegion } from './scenes/brain';

const FRAMING_DELAY_MS = 1000;
const NOTICE_MAX_CHARS = 512 * 1024;

const ICON_PATHS: Record<string, string> = {
  rex: '<circle cx="12" cy="6.5" r="3"/><path d="M6.5 21v-5.5a5.5 5.5 0 0 1 11 0V21M9 13.5l3 3 3-3"/>',
  bubbles: '<circle cx="9" cy="14.5" r="5"/><circle cx="16.5" cy="7.5" r="3"/><circle cx="18" cy="15.5" r="1.5"/>',
  star: '<path d="M12 3.5l2.5 5.4 5.9.7-4.4 4 1.2 5.9L12 16.6l-5.2 2.9L8 13.6l-4.4-4 5.9-.7z"/>',
  sprite: '<path d="M4 11c0-4 3.6-7 8-7s8 3 8 7z"/><path d="M8.5 11v3.5a3.5 3.5 0 0 0 7 0V11M10.5 20h3"/>',
  runner: '<circle cx="14.5" cy="4.5" r="2"/><path d="M8 21l3-6 3 2.2V21M5.5 12.5l4-4h4.2l2 4 3 1"/>',
  brain: '<path d="M11 5.5a3 3 0 0 0-5 2 3 3 0 0 0-1.5 5 3 3 0 0 0 2 4.5 3 3 0 0 0 4.5 1.5zM13 5.5a3 3 0 0 1 5 2 3 3 0 0 1 1.5 5 3 3 0 0 1-2 4.5 3 3 0 0 1-4.5 1.5z"/>',
  imported: '<path d="M12 15V4.5M7.5 9L12 4.5 16.5 9M5 19.5h14"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
};

function icon(id: string) {
  return `<svg class="scene-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[id] ?? ICON_PATHS.imported}</svg>`;
}

function byId<T extends HTMLElement = HTMLElement>(id: string) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing studio element #${id}`);
  return found as T;
}

export function mountStudio(root: HTMLElement) {
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#main"><span class="brand-mark" aria-hidden="true">i</span> idlewild<span class="brand-detail">PERFORMANCE STUDIO</span></a>
      <nav class="top-actions" aria-label="Studio tools"><button id="open-import" class="quiet">Import</button><button id="open-takes" class="quiet" hidden>Takes <span id="take-count">0 / 6</span></button><button id="help" class="quiet">Guide</button></nav>
    </header>
    <main id="main" class="workspace">
      <aside class="panel input-panel" aria-label="Performance input">
        <span class="eyebrow">YOUR NEXT STEP</span><h1 id="flow-title">Start here.</h1>
        <p id="next-step" class="next-step">Perform with your breath and pulse through SmartSpectra, or try a rehearsal.</p>
        <div id="input-actions" class="input-actions"><button id="rehearse" class="primary wide">Start rehearsal</button><button id="open-camera" class="wide quiet">Use camera</button></div>
        <p id="rehearsal-note" class="fine">Rehearsal is synthetic. No camera, account or credits.</p>
        <div class="acquisition"><span id="source-badge" class="tag">NO INPUT</span><p id="status" role="status" aria-live="polite">Ready for a rehearsal.</p><button id="stop-input" class="wide danger" title="Stop input and release the camera" hidden>Stop input</button><button id="open-signals" class="text-button" hidden>View signal details</button></div>
      </aside>
      <section class="stage-panel" aria-label="Creative stage">
        <div class="stage-heading">
          <div id="character-picker" class="character-picker">
            <button id="character-button" class="character-button" aria-expanded="false" aria-controls="character-menu"><span id="character-icon" class="character-icon">${icon('rex')}</span><span class="character-kicker">Character</span><strong id="character-current">Rex</strong><span class="chevron" aria-hidden="true"></span></button>
            <div id="character-menu" class="character-menu" hidden>
              <button id="menu-own-character" class="own-tile">${icon('add')}<span><strong>Use your own character</strong><span>GLB or glTF · see rig requirements</span></span></button>
              <p id="defaults-label" class="menu-label">Included</p>
              <div id="scene-picker" class="scene-grid" role="group" aria-labelledby="defaults-label"></div>
              <p id="yours-label" class="menu-label" hidden>Yours</p>
              <div id="yours-picker" class="scene-grid" role="group" aria-labelledby="yours-label" hidden></div>
            </div>
          </div>
          <button id="use-own-character" class="accent-outline" aria-label="Use your own character">${icon('add')}<span class="label-long">Use your own character</span><span class="label-short" aria-hidden="true">Use your own</span></button>
          <span id="stage-state" class="tag">LOADING</span>
        </div>
        <div class="viewport">
          <canvas id="stage" aria-label="Animated creative scene"></canvas><canvas id="signal-overlay" aria-hidden="true" hidden></canvas>
          <div class="stage-overlay">
            <div class="overlay-start">
              <button id="detail-view" class="overlay-button" aria-pressed="false" hidden>Close view</button>
              <div id="framing-region" role="status" aria-live="polite"><div id="framing-prompt" class="framing-prompt" hidden><p>Move back so your whole body is visible.</p><button id="dismiss-framing" class="dismiss" aria-label="Dismiss framing tip">×</button></div></div>
              <div id="brain-legend" class="brain-legend" hidden><p id="brain-caption">${BRAIN_CAPTION}</p><ul id="brain-regions" class="brain-regions" aria-live="off" aria-label="Simulated region highlights" aria-describedby="brain-caption"></ul></div>
            </div>
            <div id="pip" class="pip" hidden><video id="pip-video" muted playsinline autoplay aria-label="Live camera feed. Not recorded or exported."></video><button id="pip-toggle" class="overlay-button" aria-controls="pip-video" aria-expanded="true">Hide camera</button></div>
          </div>
          <div class="stage-caption"><div class="caption-copy"><h2 id="scene-title">Rex</h2><span id="scene-caption">A sporty showman with a long chin and big expressions.</span></div><span id="input-watermark">NO INPUT</span></div>
        </div>
        <div id="transport" class="transport" hidden>
          <div class="transport-top"><button id="record" class="record" hidden>● Record take</button><button id="play" hidden>Play</button><label id="loop-control" class="check" hidden><input id="loop" type="checkbox" checked> Loop</label><output id="time">0:00.00 / 0:00.00</output><div id="take-actions" class="take-actions" hidden><button id="open-edit" class="quiet">Edit</button><button id="open-export">Export</button></div></div>
          <div id="timeline-control" hidden><label class="sr-only" for="timeline">Playback position</label><input id="timeline" type="range" min="0" max="0" value="0" step="1"></div>
          <p id="recording-hint" class="fine" hidden>Up to three minutes per take. Six takes per workspace.</p>
        </div>
        <div class="stage-feedback"><p id="message" class="message" role="status" aria-live="polite">Loading the studio…</p><button id="cancel-export" hidden>Cancel export</button></div>
      </section>
      <aside id="interpretation" class="panel output-panel" aria-label="Creative controls" hidden>
        <span class="eyebrow">MAKE IT YOURS</span><h2>Shape it.</h2>
        <div id="creative-controls"><label for="motion">Motion <output id="motion-value">70%</output></label><input id="motion" type="range" min="0" max="100" value="70"><label for="sensitivity">Sensitivity <output id="sensitivity-value">65%</output></label><input id="sensitivity" type="range" min="0" max="100" value="65"><label for="sound">Sound <output id="sound-value">45%</output></label><input id="sound" type="range" min="0" max="100" value="45"><button id="enable-sound" class="wide">Enable sound</button></div>
        <label class="check"><input id="show-signals" type="checkbox" checked> Show SmartSpectra signals on stage</label>
        <label class="check reduce-motion"><input id="reduced-motion" type="checkbox"> Reduce motion</label>
        <div id="runner-choice" class="runner-choice" hidden><label for="runner-variant">Runner pace</label><select id="runner-variant"><option value="0">Easy</option><option value="1">Steady</option><option value="2">Brisk</option></select></div>
        <div id="brain-choice" class="runner-choice" hidden><label for="brain-example">Brain view</label><select id="brain-example" aria-describedby="brain-example-note"><option value="">Live input</option><optgroup label="Study examples">${BRAIN_EXAMPLE_IDS.map(id => `<option value="${id}">${BRAIN_EXAMPLES[id].label}</option>`).join('')}</optgroup></select><p id="brain-example-note" class="fine">Examples show regions one published group study reported. They never use your camera or body signals.</p></div>
      </aside>
    </main>
    <footer><span>Local workspace · export to keep your takes</span><button id="open-credits" class="footer-link">Credits &amp; licenses</button><span>Creative animation, not medical measurement</span></footer>

    <dialog id="camera-dialog" aria-labelledby="camera-title">
      <button class="close" data-close aria-label="Close camera settings">×</button><span class="eyebrow">PERFORMANCE INPUT</span><h2 id="camera-title">Your camera, your choice.</h2>
      <p>SmartSpectra reads your breathing and pulse from the camera; on-device tracking adds your face and body. Together they perform the character.</p>
      <label class="check consent"><input id="camera-consent" type="checkbox"> I consent to camera preview and on-device face and body tracking.</label>
      <label for="camera">Body camera</label><select id="camera"><option value="">System default (first preview)</option></select>
      <p class="fine">Desk View and Continuity Camera appear here as ordinary cameras. Idlewild asks each camera for its widest view; choose a wide camera and step back.</p>
      <div class="row"><button id="refresh-cameras">Refresh cameras</button><button id="preview" class="primary">Open preview</button></div>
      <div id="camera-view" hidden><video id="camera-preview" muted playsinline aria-label="Body camera preview"></video><p class="fine">Preview stays on when you close this panel and appears in the corner of the stage. Stop input releases every camera.</p></div>
      <section id="measurement-settings" class="measurement" aria-labelledby="measurement-title">
        <h3 id="measurement-title">SmartSpectra live signals</h3>
        <p class="fine">Breathing movement, breathing rate and pulse rate from your camera, with blink and talking detection. Uses your own Presage key, account credits and Presage network processing. Telemetry is disabled and insights are never requested; vendor retention is unverified. Creative animation, not a medical measurement.</p>
        <label for="api-key">Presage API key · this session only</label><input id="api-key" type="password" autocomplete="off" spellcheck="false" maxlength="512" placeholder="Enter your own key">
        <div class="row"><button id="save-key">Use key</button><button id="clear-key">Clear key</button></div><p id="key-status" class="fine">No key set.</p>
        <label class="check consent"><input id="live-consent" type="checkbox"> I am 18 or older and authorize metered measurement and the disclosed vendor processing.</label>
        <label class="check"><input id="live-tracking" type="checkbox" checked> Also track my face and body on this device</label>
        <button id="live" class="wide primary">Start SmartSpectra performance</button>
        <p class="fine">Keep this window visible while measuring; hiding or minimizing it stops input.</p>
      </section>
      <details id="local-only" open><summary>No key? Face &amp; body only</summary>
        <button id="local-tracking" class="wide" disabled>Start face & body tracking</button><p class="fine">Runs on this device without a key or credits. No breathing or pulse. Keep your face and upper body visible; step back to track your legs. No microphone is used.</p>
      </details>
      <details id="face-camera-settings" hidden><summary>Second camera · face close-up (optional)</summary>
        <p class="fine">A second camera near your face can add facial detail. It must be a different device; your body camera keeps tracking your body.</p>
        <label class="check consent"><input id="face-consent" type="checkbox"> I consent to a second camera preview for on-device face tracking.</label>
        <label for="face-camera">Face camera</label><select id="face-camera"><option value="">Choose a different camera</option></select>
        <button id="open-face-camera" class="wide" disabled>Open face camera</button>
        <video id="face-preview" muted playsinline aria-label="Face camera preview" hidden></video>
      </details>
      <p class="dialog-message message" role="status" aria-live="polite"></p><div class="dialog-actions"><button data-close>Done</button></div>
    </dialog>
    <dialog id="signals-dialog" aria-labelledby="signals-title">
      <button class="close" data-close aria-label="Close signal details">×</button><span class="eyebrow">INPUT DETAILS</span><h2 id="signals-title">What drives the scene.</h2>
      <p>Each input keeps its source and quality. Missing input stays missing.</p><div id="tracking-details" hidden><p id="tracking-summary"></p><p class="fine">Face and body positions are on-device estimates. Hidden joints return to the character’s authored animation. These controls do not measure breathing, pulse or emotions.</p></div><div id="physiology-details"><div id="signals" class="signals" aria-label="Signal quality"></div>
      <label class="check consent"><input id="continuity" type="checkbox"> Keep breathing animation continuous during speech</label><p class="fine">Optional cached breath is labeled when replayed. It is animation continuity, never a new measurement.</p></div>
      <p class="dialog-message message" role="status" aria-live="polite"></p><div class="dialog-actions"><button data-close>Done</button></div>
    </dialog>
    <dialog id="import-dialog" aria-labelledby="import-title">
      <button class="close" data-close aria-label="Close imports">×</button><span class="eyebrow">BRING YOUR OWN</span><h2 id="import-title">Use your own character.</h2>
      <p>Give your performance a new home, or reopen a saved take.</p>
      <label class="file-button primary-file"><strong>Choose a character or clips</strong><span>Self-contained GLB or embedded glTF, up to 32 MiB</span><input id="import-model" type="file" accept=".glb,.gltf"></label>
      <details id="rig-requirements"><summary>Rig requirements</summary>
        <ul class="requirements">
          <li>One scene, embedded resources, no compression; up to 256 nodes and 500,000 vertices.</li>
          <li>Body tracking rotates named bones such as Spine, Head, LeftArm, LeftForeArm, LeftUpLeg and LeftLeg. Mixamo and Blender Studio rig names (Rex, Sprite, Rain) work; there is no automatic retargeting.</li>
          <li>Face tracking drives ARKit-style morphs such as eyeBlinkLeft, jawOpen and mouthSmileLeft.</li>
          <li>Static models get creative root movement. Animation-only files need their matching character first.</li>
        </ul>
        <p class="fine">Every limit and bone alias is listed in docs/FORMATS.md, “Character and clip imports”.</p>
      </details>
      <label class="file-button"><strong>Import control data</strong><span>A previously exported JSON take</span><input id="import-data" type="file" accept=".json,application/json"></label>
      <p id="import-status" class="fine">Use assets you have rights to use. Importing a model does not grant reuse rights.</p>
      <details id="import-credits" hidden><summary>Model credits</summary><p id="import-credit-text" class="fine"></p></details>
      <div id="clip-choice" hidden><label for="imported-clip">Animation clip</label><select id="imported-clip" disabled></select></div><button id="remove-model" class="wide danger" hidden>Remove imported character</button>
      <p class="dialog-message message" role="status" aria-live="polite"></p><div class="dialog-actions"><button data-close>Done</button></div>
    </dialog>
    <dialog id="takes-dialog" aria-labelledby="takes-title">
      <button class="close" data-close aria-label="Close takes">×</button><span class="eyebrow">YOUR WORKSPACE</span><h2 id="takes-title">Choose a performance.</h2><p>Select a take to play it on any scene. Takes stay in memory until you export them.</p><div id="takes" class="takes">No takes yet. Record a performance to begin.</div>
      <p class="dialog-message message" role="status" aria-live="polite"></p><div class="dialog-actions"><button data-close>Done</button></div>
    </dialog>
    <dialog id="edit-dialog" aria-labelledby="edit-title">
      <button class="close" data-close aria-label="Close take editor">×</button><span class="eyebrow">EDIT YOUR TAKE</span><h2 id="edit-title">Keep the best part.</h2><p>Trim replaces the selected take. Export a copy first if you want to keep the original.</p>
      <div class="trim-fields"><label>In (seconds)<input id="trim-start" type="number" min="0" step="0.05" value="0"></label><label>Out (seconds)<input id="trim-end" type="number" min="0" step="0.05" value="0"></label></div><div class="row"><button id="delete" class="danger">Delete take</button><button id="trim" class="primary">Apply trim</button></div>
      <p class="dialog-message message" role="status" aria-live="polite"></p><div class="dialog-actions"><button data-close>Done</button></div>
    </dialog>
    <dialog id="export-dialog" aria-labelledby="export-title">
      <button class="close" data-close aria-label="Close export choices">×</button><span class="eyebrow">SAVE YOUR PERFORMANCE</span><h2 id="export-title">Take it with you.</h2><p>Export the selected take with your current scene and creative settings.</p>
      <div class="export-grid"><button id="export-video"><strong>Video preview</strong><span>WebM · picture and sound</span></button><button id="export-glb"><strong>Baked GLB</strong><span>Reusable character animation</span></button><button id="export-wav"><strong>WAV sound</strong><span>Audio for your project</span></button><button id="export-data"><strong>Control data</strong><span>JSON · replay and reuse</span></button><button id="export-csv"><strong>Signal curves</strong><span>CSV · breathing, pulse, face for animation tools</span></button></div><label class="check"><input id="export-signals" type="checkbox" checked> Show the SmartSpectra signal panel in the video</label><p class="fine">Video renders the stage in real time; the camera feed is never included. Keep this window visible until it finishes. Supplied model credits download alongside the video.</p>
      <p class="dialog-message message" role="status" aria-live="polite"></p>
    </dialog>
    <dialog id="credits-dialog" aria-labelledby="credits-title">
      <button class="close" data-close aria-label="Close credits">×</button><span class="eyebrow">CREDITS &amp; LICENSES</span><h2 id="credits-title">Made with open work.</h2>
      <ul class="credits">
        <li><strong>Rex</strong> Rex Rig (CC) Blender Foundation | studio.blender.org · CC BY 4.0 · modified</li>
        <li><strong>Sprite</strong> Sprite Rig (CC) Blender Foundation | studio.blender.org · adapted under CC BY 4.0</li>
        <li><strong>Runner</strong> Rain Rig (CC) Blender Foundation | studio.blender.org · adapted under CC BY 4.0</li>
        <li><strong>Brain</strong> Brain for Blender by Anderson Winkler, brainder.org · adapted under CC BY-SA 3.0</li>
        <li><strong>Local tracking</strong> MediaPipe Tasks Vision with Face and Pose Landmarker models by Google · Apache 2.0</li>
      </ul>
      <p class="fine">Bubbles, Star and the fallback runner figure are original procedural geometry. Imported characters keep their own rights.</p>
      <details id="credits-full"><summary>Full attributions and third-party notices</summary><div id="credits-files" class="credit-files"></div></details>
      <p class="dialog-message message" role="status" aria-live="polite"></p><div class="dialog-actions"><button data-close>Done</button></div>
    </dialog>
    <dialog id="guide" aria-labelledby="guide-title"><form method="dialog"><button class="close" aria-label="Close studio guide">×</button></form><span id="guide-step" class="eyebrow"></span><h2 id="guide-title"></h2><p id="guide-copy"></p><div class="row"><button id="guide-back">Back</button><button id="guide-next" class="primary">Next</button><button id="guide-skip">Skip guide</button></div></dialog>`;
}

export function setupPanels() {
  const openers = [['open-camera', 'camera'], ['open-signals', 'signals'], ['open-import', 'import'], ['use-own-character', 'import'], ['menu-own-character', 'import'], ['open-takes', 'takes'], ['open-edit', 'edit'], ['open-export', 'export'], ['open-credits', 'credits']] as const;
  for (const [trigger, name] of openers) {
    const dialog = byId<HTMLDialogElement>(`${name}-dialog`);
    byId(trigger).addEventListener('click', () => {
      const feedback = dialog.querySelector('.dialog-message');
      if (feedback) feedback.textContent = '';
      if (!dialog.open) dialog.showModal();
    });
  }
  for (const close of document.querySelectorAll<HTMLButtonElement>('[data-close]')) close.addEventListener('click', () => close.closest('dialog')?.close());
  const exports = byId<HTMLDialogElement>('export-dialog');
  for (const button of exports.querySelectorAll<HTMLButtonElement>('.export-grid button')) button.addEventListener('click', () => { if (!button.disabled) exports.close(); });
  byId('takes').addEventListener('click', event => {
    if ((event.target as HTMLElement).closest('button.take')) byId<HTMLDialogElement>('takes-dialog').close();
  });
  setupCredits();
}

function setupCredits() {
  const files = [['Model provenance', './models/ATTRIBUTION.md'], ['Local tracking assets', './tracking/ATTRIBUTION.md'], ['Third-party notices', './THIRD_PARTY_NOTICES.txt']] as const;
  const details = byId<HTMLDetailsElement>('credits-full');
  const container = byId('credits-files');
  let loading: Promise<void> | null = null;
  details.addEventListener('toggle', () => {
    if (!details.open || loading) return;
    loading = Promise.all(files.map(async ([title, path]) => {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      const text = document.createElement('pre');
      heading.textContent = title;
      text.textContent = 'Loading…';
      section.append(heading, text);
      container.append(section);
      try {
        const response = await fetch(path, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.text();
        text.textContent = body.length > NOTICE_MAX_CHARS ? `${body.slice(0, NOTICE_MAX_CHARS)}\n…` : body;
      } catch {
        text.textContent = `Unavailable in this build. The file ships as ${path.slice(2)} with Idlewild.`;
        text.classList.add('error');
      }
    })).then(() => undefined);
  });
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow Idlewild in System Settings › Privacy & Security › Camera, then open the preview again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'That camera is unavailable. Refresh cameras, choose another one, then open the preview again.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Another app may be using that camera. Close it, then open the preview again.';
  return error instanceof Error && error.message ? error.message : 'The camera could not open. Refresh cameras and try again.';
}

export interface CharacterMenu {
  setCurrent(entry: SceneEntry): void;
  setAvailable(id: string, available: boolean): void;
  setDisabled(disabled: boolean): void;
}

export function setupCharacterMenu(entries: readonly SceneEntry[], onPick: (entry: SceneEntry) => void): CharacterMenu {
  const picker = byId('character-picker');
  const trigger = byId<HTMLButtonElement>('character-button');
  const panel = byId('character-menu');
  const groups = { default: byId('scene-picker'), yours: byId('yours-picker') };
  const items = new Map<string, HTMLButtonElement>();
  let refocus = false;
  for (const entry of entries) {
    const item = document.createElement('button');
    item.className = 'scene-item';
    item.dataset.scene = entry.id;
    item.setAttribute('aria-pressed', 'false');
    item.innerHTML = icon(entry.id);
    const label = document.createElement('span');
    label.textContent = entry.label;
    item.append(label);
    item.hidden = entry.group === 'yours';
    item.addEventListener('click', () => onPick(entry));
    groups[entry.group].append(item);
    items.set(entry.id, item);
  }
  const visible = () => [...panel.querySelectorAll<HTMLButtonElement>('button')].filter(item => !item.hidden && !item.disabled && !item.closest('[hidden]'));
  const close = (restoreFocus: boolean) => {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };
  const open = () => {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    (visible().find(item => item.getAttribute('aria-pressed') === 'true') ?? visible()[0])?.focus();
  };
  trigger.addEventListener('click', () => { if (panel.hidden) open(); else close(true); });
  panel.addEventListener('click', event => { if ((event.target as HTMLElement).closest('button')) close(true); }, true);
  picker.addEventListener('keydown', event => {
    if (panel.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = visible();
    if (!options.length) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  });
  picker.addEventListener('focusout', event => { const target = event.relatedTarget as Node | null; if (target && !picker.contains(target)) close(false); });
  document.addEventListener('pointerdown', event => { if (!picker.contains(event.target as Node)) close(false); });
  const refreshGroups = () => {
    const hasYours = [...groups.yours.querySelectorAll('button')].some(item => !item.hidden);
    groups.yours.hidden = !hasYours;
    byId('yours-label').hidden = !hasYours;
  };
  return {
    setCurrent(entry) {
      for (const [id, item] of items) item.setAttribute('aria-pressed', String(id === entry.id));
      byId('character-current').textContent = entry.label;
      byId('character-icon').innerHTML = icon(entry.id);
    },
    setAvailable(id, available) {
      const item = items.get(id);
      if (item) item.hidden = !available;
      refreshGroups();
    },
    setDisabled(disabled) {
      if (disabled === trigger.disabled) return;
      if (disabled) refocus = document.activeElement === trigger;
      trigger.disabled = disabled;
      for (const item of panel.querySelectorAll('button')) item.disabled = disabled;
      if (disabled) close(false);
      else if (refocus) { refocus = false; trigger.focus(); }
    },
  };
}

export function createCameraFeed(preview: HTMLVideoElement) {
  const container = byId('pip');
  const video = byId<HTMLVideoElement>('pip-video');
  const toggle = byId<HTMLButtonElement>('pip-toggle');
  let collapsed = false;
  const sync = (active: boolean) => {
    container.hidden = !active;
    const stream = active && !collapsed ? preview.srcObject : null;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.hidden = collapsed;
    container.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? 'Show camera' : 'Hide camera';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  toggle.addEventListener('click', () => { collapsed = !collapsed; sync(!container.hidden); });
  return sync;
}

export function createFramingPrompt() {
  const card = byId('framing-prompt');
  let cutOffSince: number | null = null;
  let clearSince: number | null = null;
  let dismissed = false;
  const reset = () => { cutOffSince = null; clearSince = null; dismissed = false; card.hidden = true; };
  byId('dismiss-framing').addEventListener('click', () => { dismissed = true; card.hidden = true; });
  return {
    reset,
    update(now: number, cutOff: boolean) {
      if (cutOff) {
        clearSince = null;
        cutOffSince ??= now;
        if (!dismissed && now - cutOffSince >= FRAMING_DELAY_MS) card.hidden = false;
        return;
      }
      cutOffSince = null;
      clearSince ??= now;
      if (now - clearSince >= FRAMING_DELAY_MS) { card.hidden = true; dismissed = false; }
    },
  };
}

export function createBrainLegend() {
  const list = byId('brain-regions');
  const caption = byId('brain-caption');
  const rows = Array.from({ length: 3 }, () => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    row.hidden = true;
    row.append(label);
    list.append(row);
    return { row, label };
  });
  return (regions: readonly BrainRegion[], example?: BrainExampleId) => {
    const text = example ? `Educational example: ${BRAIN_EXAMPLES[example].citation}. A published group result, not your brain activity.` : BRAIN_CAPTION;
    if (caption.textContent !== text) caption.textContent = text;
    list.classList.toggle('example', Boolean(example));
    rows.forEach(({ row, label }, index) => {
      const region = regions[index];
      const baseline = !regions.length && index === 0;
      row.hidden = !region && !baseline;
      row.classList.toggle('baseline', baseline);
      label.textContent = region ? region.label : baseline ? 'Neutral baseline — no mapped input right now' : '';
      row.style.setProperty('--level', String(region ? Math.min(1, Math.max(0, region.intensity)) : 0));
    });
  };
}

export function updateStudioFlow(state: { hasInput: boolean; cameraActive: boolean; recording: boolean; hasTake: boolean; playing: boolean; busy: boolean; exporting: boolean }): void {
  const show = (id: string, visible: boolean) => { byId(id).hidden = !visible; };
  const active = state.hasInput || state.hasTake;
  byId('main').classList.toggle('has-performance', active);
  show('interpretation', active);
  show('rehearse', !state.hasInput && !state.cameraActive && !state.recording && !state.exporting);
  show('rehearsal-note', !active && !state.cameraActive && !state.exporting);
  show('stop-input', state.hasInput || state.cameraActive || state.recording);
  show('open-signals', active);
  show('open-takes', state.hasTake);
  show('camera-view', state.cameraActive);
  show('face-camera-settings', state.cameraActive);
  show('record', state.hasInput && !state.exporting);
  show('play', state.hasTake && !state.recording && !state.exporting);
  show('transport', active && !state.exporting);
  show('loop-control', state.hasTake && !state.recording);
  show('timeline-control', state.hasTake && !state.recording);
  show('take-actions', state.hasTake && !state.recording && !state.exporting);
  show('recording-hint', state.hasInput && !state.hasTake);
  byId('rehearse').classList.toggle('primary', !state.hasTake);
  byId('record').classList.toggle('primary', state.hasInput);
  byId('play').classList.toggle('primary', state.hasTake && !state.hasInput);
  byId('open-camera').textContent = state.cameraActive ? 'Camera settings' : 'Use camera';
  byId('open-camera').classList.toggle('primary', state.cameraActive && !state.hasInput && !state.hasTake);
  byId('stop-input').textContent = state.cameraActive && !state.hasInput ? 'Stop camera' : 'Stop input';
  const title = state.exporting ? 'Saving…' : state.recording ? 'On record.' : state.playing ? 'Your replay.' : state.hasInput ? 'You’re ready.' : state.hasTake ? 'Your take.' : state.cameraActive ? 'Preview on.' : 'Start here.';
  const hint = state.exporting ? 'Keep the studio visible while your export finishes.' : state.recording ? 'Finish your take when you have the performance you want.' : state.playing ? 'One performance can bring every character to life.' : state.hasInput ? 'Pick a character, then record a take.' : state.hasTake ? 'Play your take, try another character, or export it.' : state.cameraActive ? 'Open camera settings to start SmartSpectra or face & body tracking.' : 'Perform with your breath and pulse through SmartSpectra, or try a rehearsal.';
  byId('flow-title').textContent = title;
  byId('next-step').textContent = state.busy && !state.exporting ? 'Preparing your studio…' : hint;
}

export function setupGuide() {
  const dialog = byId<HTMLDialogElement>('guide');
  const steps = [
    ['Perform with your breath', 'Use camera asks for consent and opens a preview. With your own Presage key, Start SmartSpectra performance measures breathing movement, breathing rate and pulse rate while on-device tracking adds your face and body. The character breathes with you.'],
    ['Your camera, your decision', 'Each step has its own consent. SmartSpectra uses account credits and Presage processing; without a key, face & body tracking runs on this device alone. Desk View and Continuity Camera appear as ordinary cameras. Stop input releases every camera.'],
    ['Try a rehearsal first', 'Start rehearsal plays clearly labeled synthetic breathing and pulse. It needs no camera, account or credits. Controls appear once your input is running.'],
    ['Add a face camera', 'Once the preview is open, Second camera adds an optional face close-up with its own consent. It must be a different device. Face values are geometric estimates, not emotions.'],
    ['See yourself while you perform', 'A small live feed sits in the corner of the stage while a camera runs; Hide camera tucks it away. It is never part of an export. If you are too close, a tip asks you to step back.'],
    ['Choose a character', 'The Character menu holds Rex, Sprite, the Rain runner, two abstract scenes and the brain. The brain scene is an educational simulation, not your measured brain activity.'],
    ['Use your own character', 'Use your own character opens import for a GLB or embedded glTF. Named bones and ARKit-style face morphs receive tracking; static models get creative movement. Rig requirements are listed there.'],
    ['Record once, play anywhere', 'Start an input, then Record take. Finish to keep up to three minutes of controls. Play, scrub and loop it on another character. Edit trims or deletes; Takes opens your library.'],
    ['Keep your performance', 'Export offers WebM video with the signal panel, WAV sound, a baked GLB with breathing and pulse curves, signal CSV and control JSON. Camera images and keys are excluded. Takes live in memory, so export before closing. Credits & licenses sit in the footer.'],
  ] as const;
  let step = 0;
  const render = () => {
    byId('guide-step').textContent = `STUDIO GUIDE / ${step + 1} OF ${steps.length}`;
    byId('guide-title').textContent = steps[step][0];
    byId('guide-copy').textContent = steps[step][1];
    byId<HTMLButtonElement>('guide-back').disabled = step === 0;
    byId('guide-next').textContent = step === steps.length - 1 ? 'Start creating' : 'Next';
  };
  byId('help').addEventListener('click', () => { step = 0; render(); dialog.showModal(); });
  byId('guide-next').addEventListener('click', () => { if (step === steps.length - 1) dialog.close(); else { step++; render(); } });
  byId('guide-back').addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
  byId('guide-skip').addEventListener('click', () => dialog.close());
}
