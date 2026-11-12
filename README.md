# Idlewild

A desktop creative studio built with Electron, TypeScript and Three.js: record a control performance, replay it across characters and procedural scenes, then export animation and sound.

Use consented, on-device face and body tracking without an API key, account or credits, or try visibly synthetic rehearsal without a camera. Scenes include three detailed Blender Studio characters (Rex, Sprite and the Rain runner), bubbles, star and an anatomical brain whose highlighted regions are an educational simulation based on published studies, not measured brain activity. Optional SmartSpectra signals require separate credentials and consent; that desktop integration still requires live validation. See [verification evidence and remaining limits](docs/CONTEXT.md).

## Run locally

Use Node.js **22.12 or newer**, npm and a desktop session with WebGL support. From the repository directory:

```sh
npm ci --ignore-scripts
npm run check
npm start
```

`npm run check` runs unit tests, TypeScript/Vite compilation and the Electron UI checks; UI artifacts go to ignored `artifacts/ui/`. These checks use synthetic input and fake SDK adapters, not paid measurement. `npm start` rebuilds before opening Electron.

The first Electron launch downloads its version-pinned desktop binary if it is not cached. The documented install skips dependency lifecycle scripts; the macOS arm64 SDK prebuild was verified with this installation path.

After a successful build, launch the existing output without rebuilding:

```sh
./node_modules/.bin/electron .
```

For browser rehearsal or local camera tracking, run `npm run dev` and open `http://127.0.0.1:5173`; camera access requires browser permission. SmartSpectra measurement is available only through Electron. `npm test` runs the unit tests alone; `npm run test:ui` requires an existing build and a graphical desktop.

Packaging for macOS arm64: `npm run dist` writes an unsigned DMG and zip to ignored `release/`; `npm run notices` regenerates `public/THIRD_PARTY_NOTICES.txt`. Signing, notarization and publication are user-gated; see [release steps](docs/RELEASE.md), and the drafts [PRIVACY.md](docs/PRIVACY.md) and [TERMS.md](docs/TERMS.md), which need owner approval.

Local tracking loads bundled MediaPipe models and WebAssembly from `public/tracking/`; it needs no CDN or cloud inference after setup. Keep those files with the app. The tracking worker allows only bundled-asset fetches, including during shutdown, and blocks the SDK's telemetry uploads. [Tracking asset licenses and receipts](public/tracking/ATTRIBUTION.md) document the pinned files.

After building, `node scripts/check-local-tracking.mjs --prepare-fixtures` downloads two hash-pinned public sample images into ignored `.local/` and verifies real face/body inference, recording, exports, restart and consent revocation in Electron with external requests blocked. It uses a canvas camera fixture, never a physical camera or paid service. Omit the flag to reuse the downloaded fixtures offline.

A require-only native SDK probe succeeded on macOS arm64 with Node 26.8.1 and SDK 3.5.0; it created no SDK instance or measurement session. The installed SDK declares macOS arm64, Linux x64/arm64 with glibc ≥2.35, and Windows x64 support. Other platforms and packaged distribution remain unverified. There are no installers, signing or notarization artifacts.

## Make a take

1. Choose **Use camera**, consent, open preview and select **Start face & body tracking**, or choose **Start rehearsal**. Pick a character or scene from the **Character** menu and adjust Motion and Sensitivity. **Enable sound** starts procedural audio; local body movement shapes its level, and Sound sets its volume.
2. Choose **Record take**, perform, then **Finish take**. Input stops and your take is ready to play. Recording stops automatically at its limit: three minutes, at most 3,600 stored samples, six takes in the workspace.
3. Play, scrub or loop the selected take on another scene. **Takes** opens the take library; **Edit** opens trim and delete. Trim uses seconds and replaces that in-memory take; export the original first if you need both versions.
4. **Export** opens choices for **Control data**, **WAV sound**, **Video preview** and **Baked GLB** using the current scene and controls. Keep the window visible during video export; Cancel stops an unfinished export.

Takes and imported characters are held in memory. Export before closing. **Guide** reopens the skippable walkthrough. Controls appear when they are useful; camera setup, imports, signals and editing use focused dialogs. The main studio fits desktop viewports down to 760×620; dialogs can scroll at high zoom. Keyboard navigation and Reduce motion are supported.

Choose **Use your own character** (beside the Character menu, or at the top of it) for a self-contained GLB or embedded-resource glTF; its **Rig requirements** summarize bone and morph names. **Import** also reopens saved takes. Static models support creative root movement; compatible named bones and morphs receive additional controls. Import an animation-only file after its matching character and choose its animation clip in the import dialog. See [formats, rig mapping and reuse](docs/FORMATS.md) for limits and supported features.

**Runner** uses Rain (CC BY 4.0) with its authored run cycle; **Runner pace** chooses Easy, Steady or Brisk, and breathing never speeds it up. Choose **Sprite** in the **Character** menu for the bundled creature character. Local tracking drives supported face morphs, head orientation and body bones; **Close view** brings its face forward. Choose Idle, Soft smile or Brow motion as the underlying authored clip. Missing joints or facial input preserve that animation. Other rigs need compatible bone and morph names; static models receive creative root movement. Tracking estimates visible movement, not microexpressions or emotions. Rex, Sprite and Rain permit commercial reuse under CC BY 4.0; retain their [credits and modification notices](public/models/ATTRIBUTION.md) with shared exports.

## Camera, keys and data

Startup does not request camera or microphone access. Open **Use camera**, check consent for preview and on-device tracking, choose a system camera and select **Open preview**, then **Start face & body tracking**. Desk View and Continuity Camera appear as ordinary cameras; Idlewild requests each camera's widest view. After the preview opens, **Second camera** can add a different face close-up camera with its own consent. While a camera runs, a small live feed sits in the stage corner (**Hide camera** tucks it away); it is a page overlay and never part of an export. If you are too close for a full-body character, a dismissible tip asks you to move back. Keep your face and upper body visible; step back for leg tracking. Closing camera settings leaves input running; **Stop input** releases every camera. An iPhone is selectable only when the operating system exposes it as a webcam; device compatibility has not been verified locally.

Local mode processes one face and body on this device, without SmartSpectra, a key or paid processing. Its facial coefficients, head rotation, body positions and movement amount are estimates. Poor light, occlusion, distance and fast motion reduce quality; missing or stale input does not invent replacement tracking. Local mode does not supply breathing, pulse, arterial traces or speech detection. Face-only tracking produces no movement sound until body movement is available.

For an explicitly authorized SmartSpectra session, expand **SmartSpectra · optional API key**, enter your own Presage API key, select **Use key**, read the vendor-processing disclosure, check the separate metered-measurement consent and select **Start live measurement**. Keys stay in main-process memory for the session; the input field is cleared after submission. Setting a key does not start capture. **Clear key** clears it and stops input.

SmartSpectra measurement uses vendor networking and may consume account credits. Its telemetry setting is disabled and the app does not request insights, but automatic vitals insights may upload data; vendor retention is unverified. Telemetry-off does not mean offline processing. Do not use paid measurement for development, smoke checks or tuning without the required explicit exception.

Creative exports exclude camera images and API keys. No microphone is requested or recorded: WAV and preview audio are synthesized. Local-camera exports preserve estimated movement and their source; camera-derived control data is still personal data. Keep it outside the repository or under ignored `.local/`. Takes remain in memory until exported; deleting them is not a guarantee of physical memory erasure.

Source and input availability remain visible. For SmartSpectra/rehearsal signals, optional breathing-animation continuity replays a bounded quiet-period cache during detected speech and labels it **CACHED BREATH**; it is not a new measurement. Relative traces do not measure airflow or calibrated blood pressure. Averaged pulse rate does not establish beat timing. The brain scene is an illustration, not measured neural activity, a diagnosis or a personalized activation map. Local mouth controls approximate shape, without speech audio, phonemes or gaze matching. SmartSpectra measurement is for adults 18 or older under [Presage's SDK terms](https://presagetech.com/legal/terms-of-service).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Desktop cannot start or an asset is missing | Run `npm ci --ignore-scripts`, then `npm run build`, and launch from the repository root. Confirm `public/models/rex.glb`, `sprite.glb`, `runner.glb` and `brain.glb` are present; model receipts and provenance are below. |
| Blank stage or graphics lost | Use a WebGL-capable desktop session, close other GPU-heavy applications, then reopen Idlewild. Export takes before restarting when possible. |
| Camera denied or disconnected | Stop input, allow camera access in system privacy settings, reconnect the intended device, select Refresh, and explicitly reopen preview. Close another application if it owns the camera. |
| Local models fail to load or tracking falls behind | Confirm both `.task` models and the `wasm/` files in `public/tracking/` are present, rebuild, then reopen preview and start tracking. Improve lighting, keep the intended joints visible and close other CPU-heavy applications. Signals shows face/body availability; inference speed depends on the device. |
| Authentication or unavailable signals | Clear and re-enter the key; verify account entitlements and network access. Missing/stale channels are not replaced with synthetic live signals. |
| Capture cleanup failed | Stop again before retrying. If cleanup still fails, close and reopen the app; do not start overlapping sessions. |
| Silent playback or export | Enable sound for monitoring; raise Sound and Sensitivity. Local mode needs visible body movement; other sources need valid breath input. WAV/preview generation uses the selected Sound setting independently of monitor mute. Missing input and gaps become silence. |
| Video encoding stalls or is unsupported | Use Electron, keep the window visible and try a shorter take. WAV, control JSON and baked GLB are separate export choices. |
| Character or clip rejected | Follow the reported limit; export one self-contained scene with supported textures and dense geometry. Clip node names and morph widths must match the loaded character. See [format limits](docs/FORMATS.md). |

[Product and verification context](docs/CONTEXT.md) · [SDK evidence](docs/SDK-EVIDENCE.md) · [Asset provenance](public/models/ATTRIBUTION.md) · [Contributor rules](AGENTS.md)
