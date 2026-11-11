# Idlewild

A desktop creative studio built with Electron, TypeScript and Three.js: record a control performance, replay it across characters and procedural scenes, then export animation and sound.

Scenes include a robot, bubbles, star, European dragon, original baby dragon, three runner variants and an educational body–brain illustration. Rehearsal is visibly synthetic and needs no account or camera. The SmartSpectra desktop integration still requires consented live validation; see [verification evidence and remaining limits](docs/CONTEXT.md).

## Run locally

Use Node.js **22.12 or newer**, npm and a desktop session with WebGL support. From the repository directory:

```sh
npm ci
npm run check
npm start
```

`npm run check` runs unit tests, TypeScript/Vite compilation and the Electron UI checks; UI artifacts go to ignored `artifacts/ui/`. These checks use synthetic input and fake SDK adapters, not paid measurement. `npm start` rebuilds before opening Electron. After a successful build, launch the existing output without rebuilding:

```sh
./node_modules/.bin/electron .
```

For browser rehearsal, run `npm run dev` and open `http://127.0.0.1:5173`. Live SmartSpectra measurement is available only through Electron. `npm test` runs the unit tests alone; `npm run test:ui` requires an existing build and a graphical desktop.

A require-only native SDK probe succeeded on macOS arm64 with Node 26.8.1 and SDK 3.5.0; it created no SDK instance or measurement session. The installed SDK declares macOS arm64, Linux x64/arm64 with glibc ≥2.35, and Windows x64 support. Other platforms and packaged distribution remain unverified. There are no installers, signing or notarization artifacts.

## Make a take

1. Choose **Start rehearsal**, select a scene and adjust Motion and Sensitivity. **Enable sound** starts procedural audio; Sound controls its level.
2. Choose **Record take**, perform, then **Finish take**. Input stops and your take is ready to play. Recording stops automatically at its limit: three minutes, at most 3,600 stored samples, six takes in the workspace.
3. Play, scrub or loop the selected take on another scene. **Takes** opens the take library; **Edit** opens trim and delete. Trim uses seconds and replaces that in-memory take; export the original first if you need both versions.
4. **Export** opens choices for **Control data**, **WAV sound**, **Video preview** and **Baked GLB** using the current scene and controls. Keep the window visible during video export; Cancel stops an unfinished export.

Takes and imported characters are held in memory. Export before closing. **Guide** reopens the skippable walkthrough. Controls appear when they are useful; camera setup, imports, signals and editing use focused dialogs. The main studio fits desktop viewports down to 760×620; dialogs can scroll at high zoom. Keyboard navigation and Reduce motion are supported.

Open **Import** for a self-contained GLB or embedded-resource glTF. Static models support creative root movement; compatible named bones and morphs receive additional controls. Import an animation-only file after its matching character and choose its animation clip in the import dialog. See [formats, rig mapping and reuse](docs/FORMATS.md) for limits and supported features.

## Camera, keys and data

Startup does not request camera or microphone access. Open **Use camera**, check camera-preview consent, choose a system camera and select **Open preview**. Preview alone does not initialize SmartSpectra or consume measurement credits. An iPhone is selectable only when the operating system exposes it as a webcam; device compatibility has not been verified locally.

For an explicitly authorized live session, expand **Live measurement**, enter your own Presage API key, select **Use key**, read the vendor-processing disclosure, check the separate metered-measurement consent and select **Start live measurement**. Keys stay in main-process memory for the session; the input field is cleared after submission. Setting a key does not start capture. **Clear key** clears it and stops input; **Stop input** releases capture resources.

Live measurement uses vendor networking and may consume account credits. Telemetry is disabled and the app does not request insights, but automatic vitals insights may upload data; vendor retention is unverified. Telemetry-off does not mean offline processing. Do not use paid measurement for development, smoke checks or tuning without the required explicit exception.

Creative exports exclude camera images and API keys. No microphone is requested or recorded: WAV and preview audio are synthesized. Control exports from live sessions still contain personal signal data; keep them outside the repository or under ignored `.local/`. Deleting in-memory data is not a guarantee of physical memory erasure.

Signal quality and provenance remain visible. Optional breathing-animation continuity replays a bounded quiet-period cache during detected speech and labels it **CACHED BREATH**; it is not a new measurement. Relative traces do not measure airflow or calibrated blood pressure. Averaged pulse rate does not establish beat timing. The brain scene is an illustration, not measured neural activity, a diagnosis or a personalized activation map. Gaze matching and detailed lip movement are not implemented.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Desktop cannot start or an asset is missing | Run `npm ci`, then `npm run build`, and launch from the repository root. Confirm `public/models/robot.glb` and `dragon.glb` are present; model receipts and provenance are below. |
| Blank stage or graphics lost | Use a WebGL-capable desktop session, close other GPU-heavy applications, then reopen Idlewild. Export takes before restarting when possible. |
| Camera denied or disconnected | Stop input, allow camera access in system privacy settings, reconnect the intended device, select Refresh, and explicitly reopen preview. Close another application if it owns the camera. |
| Authentication or unavailable signals | Clear and re-enter the key; verify account entitlements and network access. Missing/stale channels are not replaced with synthetic live signals. |
| Capture cleanup failed | Stop again before retrying. If cleanup still fails, close and reopen the app; do not start overlapping sessions. |
| Silent playback or export | Enable sound for monitoring; raise Sound and check for valid breath input. WAV/preview generation uses the selected Sound setting independently of monitor mute. Missing input and gaps become silence. |
| Video encoding stalls or is unsupported | Use Electron, keep the window visible and try a shorter take. WAV, control JSON and baked GLB are separate export choices. |
| Character or clip rejected | Follow the reported limit; export one self-contained scene with supported textures and dense geometry. Clip node names and morph widths must match the loaded character. See [format limits](docs/FORMATS.md). |

[Product and verification context](docs/CONTEXT.md) · [SDK evidence](docs/SDK-EVIDENCE.md) · [Asset provenance](public/models/ATTRIBUTION.md) · [Contributor rules](AGENTS.md)
