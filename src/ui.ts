export function mountStudio(root: HTMLElement) {
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#main"><span class="brand-mark" aria-hidden="true">i</span> idlewild<span class="brand-detail">PERFORMANCE STUDIO</span></a>
      <nav class="top-actions" aria-label="Studio tools"><button id="open-import" class="quiet">Import</button><button id="open-takes" class="quiet" hidden>Takes <span id="take-count">0 / 6</span></button><button id="help" class="quiet">Guide</button></nav>
    </header>
    <main id="main" class="workspace">
      <aside class="panel input-panel" aria-label="Performance input">
        <span class="eyebrow">YOUR NEXT STEP</span><h1 id="flow-title">Start here.</h1>
        <p id="next-step" class="next-step">Animate with your camera, or try a rehearsal. No key needed.</p>
        <div id="input-actions" class="input-actions"><button id="rehearse" class="primary wide">Start rehearsal</button><button id="open-camera" class="wide quiet">Use camera</button></div>
        <p id="rehearsal-note" class="fine">Rehearsal is synthetic. No camera, account or credits.</p>
        <div class="acquisition"><span id="source-badge" class="tag">NO INPUT</span><p id="status" role="status" aria-live="polite">Ready for a rehearsal.</p><button id="stop-input" class="wide danger" title="Stop input and release the camera" hidden>Stop input</button><button id="open-signals" class="text-button" hidden>View signal details</button></div>
      </aside>
      <section class="stage-panel" aria-label="Creative stage">
        <div class="stage-heading"><h2 id="scene-title">The robot</h2><button id="detail-view" class="quiet" aria-pressed="false" hidden>Close view</button><span id="stage-state" class="tag">LOADING</span></div>
        <div class="viewport"><canvas id="stage" aria-label="Animated creative scene"></canvas><div class="stage-caption"><span id="scene-caption">Breathing gives a character its own rhythm.</span><span id="input-watermark">NO INPUT</span></div></div>
        <div id="scene-picker" class="scene-picker" role="group" aria-label="Choose a scene"></div>
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
        <label class="check reduce-motion"><input id="reduced-motion" type="checkbox"> Reduce motion</label>
        <div class="runner-choice"><label for="runner-variant">Runner character</label><select id="runner-variant"><option value="0">Coral</option><option value="1">Ocean</option><option value="2">Meadow</option></select></div>
      </aside>
    </main>
    <footer><span>Local workspace · export to keep your takes</span><span>Creative animation, not medical measurement</span></footer>

    <dialog id="camera-dialog" aria-labelledby="camera-title">
      <button class="close" data-close aria-label="Close camera settings">×</button><span class="eyebrow">PERFORMANCE INPUT</span><h2 id="camera-title">Your camera, your choice.</h2>
      <p>Animate your face and body on this device. No API key, account or credits needed.</p>
      <label class="check consent"><input id="camera-consent" type="checkbox"> I consent to camera preview and on-device face and body tracking.</label>
      <label for="camera">System camera</label><select id="camera"><option value="">System default (first preview)</option></select>
      <div class="row"><button id="refresh-cameras">Refresh cameras</button><button id="preview" class="primary">Open preview</button></div>
      <div id="camera-view" hidden><video id="camera-preview" muted playsinline aria-label="Camera preview"></video><p class="fine">Preview remains active when you close this panel. Use Stop input to release the camera.</p></div>
      <p class="fine">An iPhone appears here when your operating system makes it available as a webcam.</p>
      <button id="local-tracking" class="wide primary" disabled>Start face & body tracking</button><p class="fine">Open preview first. Keep your face and upper body visible; step back to track your legs. Camera images stay on this device in local mode. No microphone is used.</p>
      <details id="measurement-settings"><summary>SmartSpectra · optional API key</summary>
        <p class="fine">Open a preview first. Live measurement uses account credits and vendor network processing. Automatic vitals insights may upload data; retention is unverified. Telemetry is disabled. This integration awaits consented live validation.</p>
        <label for="api-key">Presage API key · this session only</label><input id="api-key" type="password" autocomplete="off" spellcheck="false" maxlength="512" placeholder="Enter your own key">
        <div class="row"><button id="save-key">Use key</button><button id="clear-key">Clear key</button></div><p id="key-status" class="fine">No key set.</p>
        <label class="check consent"><input id="live-consent" type="checkbox"> I am 18 or older and authorize metered measurement and the disclosed vendor processing.</label><button id="live" class="wide">Start live measurement</button>
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
      <button class="close" data-close aria-label="Close imports">×</button><span class="eyebrow">BRING YOUR OWN</span><h2 id="import-title">Import a character or take.</h2>
      <p>A saved take works across scenes. A character gives that same performance a new home.</p>
      <button id="try-snow" class="wide">Try Snow · expressive character</button>
      <label class="file-button"><strong>Import control data</strong><span>A previously exported JSON take</span><input id="import-data" type="file" accept=".json,application/json"></label>
      <label class="file-button"><strong>Import character or clips</strong><span>Self-contained GLB or embedded glTF</span><input id="import-model" type="file" accept=".glb,.gltf"></label>
      <p id="import-status" class="fine">For clip reuse, named nodes and morph targets must match your imported character.</p>
      <details id="import-credits" hidden><summary>Model credits</summary><p id="import-credit-text" class="fine"></p></details>
      <label for="imported-clip">Animation clip</label><select id="imported-clip" disabled><option value="">Import a character with animation</option></select><button id="remove-model" class="wide danger" hidden>Remove imported character</button>
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
      <div class="export-grid"><button id="export-video"><strong>Video preview</strong><span>WebM · picture and sound</span></button><button id="export-glb"><strong>Baked GLB</strong><span>Reusable character animation</span></button><button id="export-wav"><strong>WAV sound</strong><span>Audio for your project</span></button><button id="export-data"><strong>Control data</strong><span>JSON · replay and reuse</span></button></div><p class="fine">Video renders in real time. Keep this window visible until it finishes. Supplied model credits download alongside the video.</p>
      <p class="dialog-message message" role="status" aria-live="polite"></p>
    </dialog>
    <dialog id="guide" aria-labelledby="guide-title"><form method="dialog"><button class="close" aria-label="Close studio guide">×</button></form><span id="guide-step" class="eyebrow"></span><h2 id="guide-title"></h2><p id="guide-copy"></p><div class="row"><button id="guide-back">Back</button><button id="guide-next" class="primary">Next</button><button id="guide-skip">Skip guide</button></div></dialog>`;
}

export function setupPanels() {
  for (const name of ['camera', 'signals', 'import', 'takes', 'edit', 'export']) {
    const dialog = document.getElementById(`${name}-dialog`) as HTMLDialogElement;
    document.getElementById(`open-${name}`)!.addEventListener('click', () => {
      const feedback = dialog.querySelector('.dialog-message');
      if (feedback) feedback.textContent = '';
      if (!dialog.open) dialog.showModal();
    });
  }
  for (const close of document.querySelectorAll<HTMLButtonElement>('[data-close]')) close.addEventListener('click', () => close.closest('dialog')?.close());
  const exports = document.getElementById('export-dialog') as HTMLDialogElement;
  for (const button of exports.querySelectorAll<HTMLButtonElement>('.export-grid button')) button.addEventListener('click', () => { if (!button.disabled) exports.close(); });
  document.getElementById('takes')!.addEventListener('click', event => {
    if ((event.target as HTMLElement).closest('button.take')) (document.getElementById('takes-dialog') as HTMLDialogElement).close();
  });
}

export function updateStudioFlow(state: { hasInput: boolean; cameraActive: boolean; recording: boolean; hasTake: boolean; playing: boolean; busy: boolean; exporting: boolean }): void {
  const show = (id: string, visible: boolean) => { document.getElementById(id)!.hidden = !visible; };
  const active = state.hasInput || state.hasTake;
  document.getElementById('main')!.classList.toggle('has-performance', active);
  show('interpretation', active);
  show('rehearse', !state.hasInput && !state.cameraActive && !state.recording && !state.exporting);
  show('rehearsal-note', !active && !state.cameraActive && !state.exporting);
  show('stop-input', state.hasInput || state.cameraActive || state.recording);
  show('open-signals', active);
  show('open-takes', state.hasTake);
  show('camera-view', state.cameraActive);
  show('record', state.hasInput && !state.exporting);
  show('play', state.hasTake && !state.recording && !state.exporting);
  show('transport', active && !state.exporting);
  show('loop-control', state.hasTake && !state.recording);
  show('timeline-control', state.hasTake && !state.recording);
  show('take-actions', state.hasTake && !state.recording && !state.exporting);
  show('recording-hint', state.hasInput && !state.hasTake);
  document.getElementById('rehearse')!.classList.toggle('primary', !state.hasTake);
  document.getElementById('record')!.classList.toggle('primary', state.hasInput);
  document.getElementById('play')!.classList.toggle('primary', state.hasTake && !state.hasInput);
  document.getElementById('open-camera')!.textContent = state.cameraActive ? 'Camera settings' : 'Use camera';
  document.getElementById('open-camera')!.classList.toggle('primary', state.cameraActive && !state.hasInput && !state.hasTake);
  document.getElementById('stop-input')!.textContent = state.cameraActive && !state.hasInput ? 'Stop camera' : 'Stop input';
  const title = state.exporting ? 'Saving…' : state.recording ? 'On record.' : state.playing ? 'Your replay.' : state.hasInput ? 'You’re ready.' : state.hasTake ? 'Your take.' : state.cameraActive ? 'Preview on.' : 'Start here.';
  const hint = state.exporting ? 'Keep the studio visible while your export finishes.' : state.recording ? 'Finish your take when you have the performance you want.' : state.playing ? 'One performance can bring every scene to life.' : state.hasInput ? 'Shape the scene, then record a take.' : state.hasTake ? 'Play your take, explore another scene, or export it.' : state.cameraActive ? 'Open camera settings to start face and body tracking.' : 'Animate with your camera, or try a rehearsal. No key needed.';
  document.getElementById('flow-title')!.textContent = title;
  document.getElementById('next-step')!.textContent = state.busy && !state.exporting ? 'Preparing your studio…' : hint;
}

export function setupGuide() {
  const dialog = document.querySelector<HTMLDialogElement>('#guide')!;
  const steps = [
    ['Start with a rehearsal', 'Choose Start rehearsal for clearly labeled synthetic input. It needs no camera, account or credits. Controls appear when your input is running.'],
    ['Your camera, your decision', 'Use camera opens consented preview. Start face & body tracking runs on this device without a key or credits. Keep your face and upper body visible; step back for your legs. Optional SmartSpectra signals require a separate key and metered-processing consent. Stop input releases the camera.'],
    ['Give it a character', 'Try Snow in Import for face and body animation, or use a compatible rig. Local movement also shapes procedural scenes and sound. Switch scenes and adjust Motion and Sensitivity. Face expressions are geometric estimates, not emotions; gaze is unavailable. The brain scene is educational.'],
    ['Record once, play anywhere', 'Start an input, then Record take. Finish your take to keep up to three minutes of controls. Play, scrub and loop it on another scene. Edit opens trim and delete; Takes opens your saved performances.'],
    ['Bring your own character', 'Import accepts a saved JSON take, a self-contained GLB, or embedded glTF. Animation clips need matching named nodes and morph targets. Oversized assets, external resources and unsupported compression are rejected with an explanation.'],
    ['Keep your performance', 'Export offers rendered WebM, procedural WAV, reusable baked GLB animation and control JSON. Camera images and keys are excluded. Takes live in memory, so export before closing. Replay this guide any time.'],
  ];
  let step = 0;
  const render = () => {
    document.querySelector('#guide-step')!.textContent = `STUDIO GUIDE / ${step + 1} OF ${steps.length}`;
    document.querySelector('#guide-title')!.textContent = steps[step][0];
    document.querySelector('#guide-copy')!.textContent = steps[step][1];
    (document.querySelector('#guide-back') as HTMLButtonElement).disabled = step === 0;
    document.querySelector('#guide-next')!.textContent = step === steps.length - 1 ? 'Start creating' : 'Next';
  };
  document.querySelector('#help')!.addEventListener('click', () => { step = 0; render(); dialog.showModal(); });
  document.querySelector('#guide-next')!.addEventListener('click', () => { if (step === steps.length - 1) dialog.close(); else { step++; render(); } });
  document.querySelector('#guide-back')!.addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
  document.querySelector('#guide-skip')!.addEventListener('click', () => dialog.close());
}
