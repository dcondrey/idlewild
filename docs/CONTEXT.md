# Idlewild product and research context

## Purpose

Idlewild replaces the abandoned vivid-id hackathon concept. The intended real-world use is helping game and animation creators make synchronized motion and procedural sound from a short performance, then reuse that performance across scenes. Product usefulness and the quality of live control still need validation.

The requested subjects are a baby dragon, a European dragon, a robot, a pulsating star, bubbles, runners with different character choices, and an educational body-brain visualization. The owner authorized replacing unsuitable models with better free assets. Prioritize two polished demonstration scenes while retaining the remaining requested options for subsequent development.

The workflow is consent, acquisition/warm-up, performance, recording, scene retargeting, trim/loop, and export. Rehearsal is explicitly synthetic. No rewards for unrestricted rapid breathing; any racing mapping uses comfortable calibrated bounds. Bubbles use a validated movement-based approximation, not a claim to measure airflow.

The [Presage challenge](https://dev.to/challenges/presage-2026-11-04) requires a functional SmartSpectra app using at least one live signal, a public repository, setup instructions, a DEV post, a demo video, and consent/data-handling disclosures. The relevant categories reward creative/delightful use and thoughtful real-world use. No medical decision-making, diagnosis/treatment claims, or non-consensual monitoring.

## Current workspace

The independent repository is `/Volumes/A/idlewild`; the original Rust project remains at `/Volumes/A/vivid-id`. Its prior research is in `docs/READINESS.md` and `docs/ACQUISITION.md` there. Do not build or modify the original Rust workspace for this app.

The application uses Electron, Vite, TypeScript, Three.js, `@smartspectra/node-sdk` 3.5.0 and MediaPipe Tasks Vision 1.2.3. Resolve versions from the manifests. Dependency lifecycle scripts were reviewed; the documented `npm ci --ignore-scripts` path and require-only native loading passed on macOS arm64. No physical camera, SmartSpectra instance or metered session has run; local face/body inference uses public image fixtures during verification.

Robot and dragon downloads and the adapted Snow character have SHA-256 receipts and documented redistribution licenses. All seven requested scenes and the imported-character workflow run locally. Detailed verification is recorded below; older dated assessments describe the state before implementation.

| Completion gate | Current evidence and limit |
| --- | --- |
| Live capture | Key-free face/body tracking passes actual model inference with image fixtures. Physical-camera validation remains pending. David's one authorized SmartSpectra benchmark remains unused. |
| Creative controls | Motion, sensitivity, sound and facial/body mapping verified with synthetic and local image input; actual-camera accuracy remains unmeasured. |
| Reusable takes | Record/replay/scrub/trim/loop/delete, deterministic mapping and limits passed unit and Electron checks. |
| Exports | Control JSON, decoded WAV/WebM and meaningful baked GLB export/reimport passed; measured timing and format limits are below. |
| Scenes | Seven distinct scenes plus Snow passed local rendering/export checks with documented rights and cleanup. |
| Robustness | Local lifecycle, input boundaries, cancellation, keyboard, reduced motion, viewport and resource checks passed; actual camera failure/recovery and other platforms remain unverified. |
| Reproducible setup | Separate clean-checkout install/build/start passed before the MediaPipe dependency; updated clean-checkout verification is pending. |

David explicitly authorized the proposed single live benchmark, up to 60 seconds and two credits. This supersedes the earlier unanswered request; no further paid run is authorized. It still requires his session-only key entry and separate in-app camera/measurement consent. Public release awaits end-user/privacy terms, distribution/signing qualification and explicit publication authorization; no production-ready claim is made.

## Signal and privacy constraints

Use the [Node SDK documentation](https://smartspectra.presagetech.com/docs/nodejs/), its installed declarations, and official examples to establish the Electron boundary. The native SDK requires desktop integration; a browser rehearsal is not a live SDK integration.

The [data types](https://smartspectra.presagetech.com/docs/data-types) distinguish relative breathing traces, averaged rates, stability, and confidence. Validate supported metrics, units, timestamps, warm-up, polarity, phase inference, and latency before promising responsive breath control. Averaged pulse rate does not establish individual beat timing. Invalid or stale input must produce an explicit acquisition state rather than plausible generated physiology.

[Telemetry](https://smartspectra.presagetech.com/docs/telemetry-and-privacy) defaults on; configure it off and verify the active setting. That setting is not a universal network opt-out. [Node LLM Insights](https://smartspectra.presagetech.com/docs/nodejs/llm-insights/) describes automatic periodic insights as well as explicit requests. Omitting a callback does not establish that buffered vitals are never uploaded. Verify the selected metric configuration, account behavior, retention, and any supported disable control; disclose unresolved behavior before consent. Do not promise local-only processing based on telemetry settings alone.

Keep API keys in memory, never in source, logs, command arguments, or exported takes. The planned app retains bounded control recordings in memory until explicit export, provides delete/reset, and captures no raw camera video for creative exports. Browser-managed memory clearing is not a guarantee of physical erasure. Disclose actual implementation behavior and vendor processing separately.

## Brain visualization boundaries

Heart and respiration interact with neural timing, but SmartSpectra does not measure regional neural activity. This scene can show sourced educational relationships animated by body signals; it cannot read the user's brain or infer an individual activation map.

- [Herrero et al.](https://journals.physiology.org/doi/full/10.1152/jn.00551.2017) studied respiration-neural coupling using intracranial recordings.
- [van Koningsbruggen et al.](https://pubmed.ncbi.nlm.nih.gov/22530264/) studied instructed blinking; task findings do not establish live activation for every blink.
- [Garfinkel et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4012313/) studied cardiac-phase effects on fear processing, not a universal perceptual delay.
- [Sloots et al.](https://doi.org/10.1016/j.neuroimage.2020.116581) measured tissue movement with specialized MRI; movement is distinct from neural activity.

Do not label precise brain regions without verified anatomy and supporting evidence. An illustrative whole-brain network is an acceptable rendering approach when accurately described.

## Asset replacement leads

| Subject | Starting point | Qualification needed |
| --- | --- | --- |
| Robot | Acquired RobotExpressive; see provenance | Appearance, morph semantics, clip transitions |
| European dragon | Acquired afk.ai CC0 sample | Appearance, deforming rig, useful breath mapping |
| Baby dragon | [Kanna-Nakajima reference](https://sketchfab.com/3d-models/baby-dragon-8ebffa958b6247d09b0c40f33f03bbae) | CC BY listing, unrigged, authenticated download; seek a ready-rigged alternative of comparable quality; respect NoAI tag |
| Runners | [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) and [KayKit Adventurers](https://kaylousberg.itch.io/kaykit-adventurers) | Actual archive terms, public redistribution, clothing, walk/run clips, rig compatibility |
| Brain | [Innerscene brain](https://www.innerscene.com/tools/library/3d-parts/brain-10d8f88f) | Download, license evidence, geometry and anatomical scope |
| Star and bubbles | Original procedural geometry/materials | Visual quality and bounded GPU cost |

The previously suggested Atom Ant is fan art with unresolved underlying-character rights; Atom Array and the male runner do not offer downloadable licensed sources; the female runner's Standard license is unsuitable for raw redistribution in a public repository. These are visual references, not approved production assets. Use legitimate download routes, preserve provenance, and never bypass an authentication requirement.

## Expanded creator requirements (2026-11-10)

The resumed mission is `/tmp/idlewild/DEVELOPMENT_PLAN.md`, as corrected by David; its contents superseded the earlier phased prompt plan. At this historical assessment, all seven DONE requirements were unmet and neither a live session nor native load had run; the current gate status is above.

David additionally requested facial actions, lip/speech movement, blink and gaze matching wherever supported, multimodal control of subtle character motion, import of users' own rigged characters and animation clips, reusable baked animation exports, and a replayable in-app walkthrough with clear documentation. These are required product scope, not substitutes for the original scenes and exports. Initial import/export target is GLB/glTF; actual rig and morph compatibility must be reported. Speech audio requires separate microphone consent. Video export alone does not satisfy reusable character animation.

Separate measured channels from derived animation controls in recordings. Fusion must account for missing data, quality, shared camera artifacts, sampling cadence and latency; timestamps alone do not establish temporal accuracy. Creative controls such as energy or stillness are interpretations, not diagnoses or validated measurements of emotion, cognitive load, fatigue, flow, deception or exact autonomic balance. Any psychological interpretation needs independent validation and participant feedback before a corresponding accuracy claim. Preserve direct observable movement mapping even when higher-order inference is unavailable.

The walkthrough must cover consent, synthetic rehearsal versus live input, scene selection, import compatibility, signal mapping, recording, editing and export, and remain skippable and replayable. Documentation must cover setup, supported signals and limitations, privacy, rig requirements, export schemas and reuse in animation tools, plus actionable troubleshooting.

## Authentication and live credit budget

David requested per-user Presage API key entry and optional Presage login. Keys must remain session-only, masked in UI, clearable, and absent from recordings, exports and logs; entering a key must not start measurement. A key shared in conversation was not copied into project files or used.

On 2026-11-10, the [official authentication overview](https://presagetech.com/docs/smartspectra-sdk) documents API keys for Node.js and OAuth for iOS/Android. Installed 3.5.0 `js/index.d.ts` exposes `SmartSpectraOptions.apiKey` but no OAuth option. Desktop OAuth therefore remains an unverified integration path; app registration alone does not establish support. The [MCP server](https://presagetech.com/docs/smartspectra-sdk/mcp-server) uses OAuth for developer account management, which is a separate capability from authenticating desktop measurement. Do not implement a speculative token exchange or expose a nonfunctional login button.

David reported 100 available credits at 30 seconds per credit. Reserve 60 credits (30 minutes) for demo rehearsal/recording; at most 40 credits (20 minutes) remain for separately authorized live validation. This is a planning allocation, not a measured balance or permission to spend. No metered session has run. All development remains local/free.

## Camera choice and speech continuity

David requested configurable camera input including an attached iPhone. Use a system camera picker with a consented preview, refresh/device-change handling, and explicit disconnected-device recovery. Stop and await old capture before opening the selected camera; reset calibration and cached breathing on camera change. Never silently select a different device. Microphone selection and consent remain independent. Camera preview alone must not initialize metered measurement.

[Apple Continuity Camera](https://support.apple.com/en-au/102546) supports using an iPhone as a Mac webcam wirelessly or over USB, subject to Apple's device/account requirements; USB requires trusting the Mac. Idlewild should accept this as a system camera, not promise its own phone-pairing protocol. On Windows, Microsoft's [connected camera feature](https://support.microsoft.com/en-us/windows/apps/phonelink/use-your-mobile-device-s-camera) documents Android support; iPhone input requires a separately compatible webcam bridge and remains unverified. End-to-end iPhone capture has not been tested.

David also requested breathing continuity during speech. Optional animation fallback may cache a valid quiet-period breathing waveform, replay it for a bounded interval during speech, and blend back on valid recovery. UI and exported per-channel provenance must mark replayed intervals; these values cannot feed physiological analysis or higher-order inference. No cached waveform means no fabricated measured breath. Expiry eases animation toward neutral. Exact cache bounds and blend duration require implementation and validation.

The [Presage breathing model card](https://vandv.presagetech.com/breathing_model_card.html), inspected 2026-11-10, reports Logitech C920 breathing-rate MAE 0.38 BrPM (82.0% return) versus Samsung S24 rear 0.37 BrPM (78.5%), under ring lighting with stationary devices. This is vendor evidence, not a local measurement or a guarantee for other cameras/channels. The card explicitly says talking invalidates breathing rate, motivating per-channel validity and honestly labeled animation continuity. Live tests must distinguish quiet measurement from speaking performance.

## Initial shared contract

`src/contracts.ts` fixes the first interaction boundary: independent channel quality/absence, explicit source and session, session-relative monotonic milliseconds, native-free types, awaited source lifecycle and deterministic scene time/seed. `Signal.sampledAtMs` uses the same session clock as `ControlFrame.timeMs`; the adapter must validate conversion from vendor timestamps before claiming live synchronization. Confidence is optional per channel, never invented for traces. Values remain in declared units; breath/arterial traces are relative, not pressure or airflow. Blink and talking are sampled detection states, not counted one-shot events. Additional facial/HRV channels await verified semantics and are not silently replaced by these initial channels.

Initial recording bounds are 180 seconds, 20 samples/second and six takes. Recording must stop at duration/sample capacity and reject a seventh take until deletion; gaps remain explicit. Staleness starts at a conservative 1500 ms per channel, subject to measured update cadence. This is a design threshold, not measured latency. Scene time is supplied by the transport; scenes must not read wall time or unseeded randomness. No runtime checks have yet been run for these type declarations.

## Implementation and verification — 2026-11-11

The current plan was reconciled with the working tree on `main` at `4df5ce0`; pre-existing untracked source/tests and SDK evidence, and the expanded scope in this document, were retained and integrated. No work was performed in vivid-id. Development uses no paid service, SDK session, camera, or microphone.

- Desktop uses an in-memory Electron partition, sandboxed isolated renderer, custom local resource scheme, confined paths, restricted navigation/windows, explicit camera permission and validated narrow IPC. The native SDK loads only after the separate live action. Keys remain in main-process memory; setting a key does not initialize measurement.
- Static installed-source evidence in `js/renderer/timestamp.js` specifies epoch-anchored custom-input microseconds. Camera input follows that contract; metrics subtract the session epoch using BigInt before conversion to milliseconds. This fixes a supported clock mapping, but does not establish measured latency or live synchronization. Telemetry is disabled, logs suppressed, and no insights are requested. The vendor's automatic insights behavior has no exposed disable option; the consent text discloses potential vitals processing and unverified retention.
- Recording and trimming rebase both frame and signal times, preserving sample age. Imported takes are bounded and sanitized; missing input stays missing. Speech continuity uses an 8-second quiet cache, needs 2 seconds of continuous valid input, replays for at most 10 seconds, and fades/rejoins over 500 ms. Cached breath carries `replayed` provenance and no fabricated confidence or breathing rate. These are animation design bounds, not validated physiological processing.
- Original procedural subjects supply the baby dragon, runners, star, bubbles and abstract educational brain. The baby is separately constructed juvenile anatomy. Robot and European dragon load independently. Reduced motion suppresses all animated transforms. Supported named chest/jaw bones and blink/jaw morphs drive imported characters; gaze and detailed lip matching remain unavailable.
- Foundation batch: 36/36 tests passed with `node --experimental-strip-types --test tests/core.test.ts tests/continuity.test.ts tests/capture.test.ts tests/scenes.test.ts tests/security.test.ts`; log `artifacts/foundation-tests.log`. These cover fake native lifecycle/packets, clocks, limits, provenance, deterministic scenes and resource confinement. Subsequent integration checks are pending.
- The installed `koffi` install path was reviewed: it checks/extracts local prebuilds or falls back to CMake and Node headers; protobufjs postinstall only checks version-scheme metadata. A require-only native probe succeeded on macOS arm64, Node 26.8.1, SDK 3.5.0 (`artifacts/native-load.log`). It created no SDK instance/session, queried no camera and supplied no key. This establishes native library loading only.

Remaining external evidence: a specifically authorized live session with David and his session-only key; account entitlements, actual trace calibration/timing, quiet-versus-speaking behavior, system-camera hardware behavior and vendor data retention. SDK redistribution rights, signing/notarization, installers and non-macOS platforms are unverified. No public repository, publication or deployment is authorized by this task. The original live/production completion gates remain unmet until supported by recorded evidence.

### Studio integration and qualification

The studio now supports the complete synthetic record/replay/trim/loop/retarget workflow, bounded character/clip import, control JSON, PCM WAV, reusable baked GLB and rendered WebM. Camera selection, consented preview and separate session-only key/measurement actions are wired through the desktop bridge. Camera disconnects stop input; pending permission and capture shutdown are awaited. The native control poll uses 50 ms to match the recording grid, without claiming that the vendor updates every channel at that rate.

Following David's UI feedback, the main workspace fits the viewport at the tested 760 × 620, 780 × 700 and 1024 × 768 sizes. One next action and the stage lead the flow; camera setup, imports, take management, editing, export and signal details open progressively in dialogs. Dialogs can scroll at small sizes or high zoom rather than clipping controls. Typography uses balanced headings/buttons and pretty paragraph wrapping.

Verification before the final credit-preservation change: `npm run check` passed 62 tests, TypeScript/Vite and the actual Electron synthetic workflow (`artifacts/final-check.log` was subsequently replaced by later checks). All seven scene GLBs exported and reimported in `scripts/check-scene-exports.mjs`; a real dragon texture exposed Three.js image-buffer alignment, now covered by strict 0–3 zero-padding regression tests. Independent ffmpeg/ffprobe and Three.js decoding of a 1.5-second take found exact PCM duration, 0.99966 waveform correlation, 14.5 ms audio alignment lag, visible changing video frames and meaningful GLB tracks (`scripts/verify-media.mjs`). These are local synthetic media observations, not live sensor latency.

On this Mac16,3 / Apple M4 / 32 GiB / macOS 27.0, the short synthetic scene workload had approximately 16.7 ms median animation-frame spacing and 17.6–17.7 ms p95, 4–78 draw calls and stable 39 geometries/10 textures after repeated import/remove and start/stop cycles. Startup timing varied substantially between runs; these observations are not a general performance guarantee. The require-only native probe also passed inside Electron 45.3.0 / embedded Node 24.22.2 / SDK 3.5.0 with no instance or metered session (`scripts/check-native.mjs`, `artifacts/native-electron.log`). Production dependency audit reported zero known vulnerabilities at inspection time.

Standard glTF `asset.copyright` is now validated and preserved independently of scrubbed arbitrary metadata, including supplied animation-clip notices. GLB exports retain it and add an adaptation notice; video exports download a credits sidecar. Final `npm run check` passed 66/66 tests, TypeScript/Vite and Electron UI checks, including credited and uncredited video downloads. Media decoding and all seven scene export/reimport checks also passed afterward; latest waveform correlation was 0.99974 with 10.5 ms lag. Logs: `artifacts/final-check.log`, `artifacts/media-check.log`, `artifacts/scene-exports.log`. Clean-checkout validation remains pending.

A separate detached worktree at `384e3eb` passed `npm ci --ignore-scripts` (61 packages, zero audit findings), TypeScript/Vite build, Electron native-load probe and an actual studio startup with both downloaded assets ready and no page errors. Logs: `artifacts/clean-install.log`, `clean-build.log`, `clean-native.log`, `clean-startup.log`. README now documents that verified install path. The ignored verification worktree remains at `.local/verification-checkout` for reproducibility; it contains no live recordings or credentials.

### Higher-quality asset request

David requested commercially reusable, detailed characters with additional animation and subtle expressions. Prefer CC0 or CC BY 4.0, which support both commercial adaptation and redistribution of reusable model files; commercial-project permission alone is insufficient. Keep attribution, license links and modification notices with the source and exports. A facial rig does not establish camera-derived microexpression or gaze measurement: the implemented direct facial inputs remain blink and talking detections.

Verified Sketchfab public metadata on 2026-11-11 identifies [Baby Dragon RIKU](https://sketchfab.com/3d-models/baby-dragon-riku-608f023dc57f46c89af93cb5a051b3f0) by BlueMesh (CC BY 4.0, 20,935 triangles, one animation), [BBangzip's baby dragon](https://sketchfab.com/3d-models/stylized-redblack-dragon-baby-1d3cc450c8914665bf950c4fe06fc127) (CC BY 4.0, 24,136 triangles, four animations), and [Jungle Jim's TH-ICC02 robot](https://sketchfab.com/3d-models/sci-fi-ob-robot-unit-th-icc02-animated-6c0764c2bc4c4aaa8e03ba1653f455a6) (CC BY 4.0, 124,648 triangles, one animation). Their downloadable flags do not prove facial controls or runtime suitability; files remain unavailable without the legitimate authenticated download. Anonymous official download requests returned 401. David created an account and was given the original Kanna-Nakajima baby-dragon link; no user-supplied file is present yet. That original is CC BY, explicitly unrigged and tagged NoAI; do not send it to an AI generation/rigging service.

[Snow v4.2](https://studio.blender.org/characters/snow/v4/) was acquired through Blender Studio's public download link into ignored `.local/assets/snow/`; its included ReadMe explicitly grants CC BY 4.0. Required credit: `Snow Rig (CC) Blender Foundation | studio.blender.org`. The original archive and SHA-256 receipt remain there. Verified Blender 4.5.9 is installed only in ignored `.local/tools/` for local conversion. Inspection with auto-execution disabled found 1,494 rig bones, 290 deform bones, facial corrective shapes and 56 pose/action assets, requiring the adaptation described below. Embedded `cloudrig.py` was not executed. [Rain](https://studio.blender.org/characters/rain/) is a second CC BY facial/body candidate, not acquired.

[Meshy's current community terms](https://www.meshy.ai/terms-of-use) place published 3D outputs under CC0, while uploaded reference images are CC BY-NC; independently generated free-plan outputs have separate CC BY terms and download restrictions. [Its rigging documentation](https://docs.meshy.ai/en/webapp/guides/3d-model/rigging) requires external authoring for custom facial rigs. No Meshy generation, paid download or cloud rigging was run. New Quaternius acquisitions require archive-specific license evidence: its older asset pages say CC0 while its newer QAL restricts standalone redistribution; existing pinned RobotExpressive CC0 evidence remains separate.

David also suggested [Renderpeople's free collection](https://renderpeople.com/free-3d-people/). Its [standard terms](https://renderpeople.com/general-terms-and-conditions/) apply equally to free assets (§2.5), allow commercial rendered media (§4.1), but restrict original/modified model redistribution, creator applications and downloadable/extractable individual models (§4.2–4.3). Exclude these assets from the bundled/exportable library without separate written permission covering Idlewild's use. Its free listings do not establish detailed facial-control support.

### SDK release terms

The installed SDK is proprietary and points to Presage's terms. The [current official terms](https://presagetech.com/legal/terms-of-service), effective November 2, 2026, expressly permit distributing the SDK as part of an application (§29.1), subject to those terms and any separate agreement; this replaces the earlier absence of redistribution evidence. Developer duties include accurate processing disclosures/consent, adult-only SDK use and application terms covering the vendor's technology (§30). Live consent now includes the 18-or-older acknowledgement. Before public distribution, finalize Idlewild's own end-user terms/privacy notice, retain required third-party notices, and qualify packaging/signing; no release is approved or claimed here.

### Facial asset integration

Character overlays distinguish absent/stale facial input from a valid zero, preserving authored facial clips when input is unavailable. Import selects the character immediately. **Import → Try Snow** loads the bundled model through the same strict importer; **Close view** exposes facial detail. Imported-model mutation and camera framing controls are disabled during export.

`scripts/prepare-snow.py` evaluates source deformations into seven named facial morphs and a 74-joint skeleton with four weights per vertex (maximum discarded weight 4.859%). It applies subdivision level 1, converts the skin UDIMs to an atlas and reduces textures to six 1024×1024 images. Outer corneas and unsupported source material effects are omitted. The runtime asset has 32,960 vertices, 91 nodes and three authored two-second clips: Idle, Soft smile and Brow motion. Subtle expression clips retain the body animation and neutral endpoints; these are authored animation, not measured microexpressions, emotion, gaze or phonemes. This conversion does not establish arbitrary extreme-pose deformation quality.

Source-pose compatibility was audited across 5,125 channels. Only absent `STR-TIP-Nostril.L/R` bones and `Jaw.preserve_volume` / `Jaw.teeth_follow_mouth` properties were found, without driver dependencies; conversion explicitly preflights these known differences and rejects unknown ones. Export uses the active scene, dense morph accessors and supported materials. Blender emitted numeric warnings during export, but the resulting float accessors are finite and the strict runtime importer accepts them. Visual inspection caught an asymmetric arm pose: Snow's upper-arm bone axes point upward rather than along its limbs. Lowering now uses shoulder-to-wrist directions, checks the evaluated pose and renders both arms naturally at the sides.

The integration gate passed 67/67 tests, TypeScript/Vite and the actual Electron workflow (`artifacts/final-check.log`). All seven original scene GLBs exported/reimported; independent media decoding passed with exact 1.5-second PCM duration, 0.99780 waveform correlation and 99 ms best-match lag in the latest short synthetic run (`artifacts/media-check.log`, `artifacts/scene-exports.log`). Timing varies between runs; these are media-export observations, not live sensor accuracy.

After the arm correction, TypeScript/Vite and `node scripts/check-character.mjs` passed. Actual Snow checks cover six rendered facial states, all three clips' matching loop endpoints, credited baked GLB export/reimport, export cancellation and mutation guards, 760×620 viewport fit, and resource return to baseline after removal (21 geometries / 8 textures). Full-body, close-face and small-window screenshots were inspected. During these facial checks the renderer reported 40 draw calls and 113,748 triangles; this is a scene workload observation, not a frame-rate guarantee. The 8,060,880-byte runtime model, source/derived hashes and modification notice are tracked under `public/models/`; source archives and tools stay ignored. Logs: `artifacts/snow-conversion.log`, `artifacts/character-build.log`, `artifacts/character-check.log`; detailed results and screenshots: `artifacts/character/`.

### Authorized live benchmark preparation

`scripts/live-benchmark.mjs --authorized` opens the real application with `--live-benchmark`, leaving key entry and both consent controls to David. The main process permits one start attempt, initiates shutdown at 55 seconds and prevents restarting that process's allowance. A separate harness watchdog terminates its own Electron child at 58 seconds if shutdown has not been confirmed. These bounds include SDK startup; they leave time inside the authorized 60-second maximum. Credit cost remains based on David's stated 30-seconds-per-credit rate, not a locally measured account debit. An interrupted or failed paid attempt must not be restarted automatically.

Preparation used no SDK instance or camera. Twenty focused guard/capture tests, TypeScript/Vite and the non-metered `node --experimental-strip-types scripts/live-benchmark.mjs --check` passed (`artifacts/benchmark-tests.log`, `benchmark-build.log`, `benchmark-prepare.log`). The live harness retains bounded control data and a stage-only image under ignored `.local/live-benchmarks/`, with no key or camera image logging. Preparation is not live-validation evidence.

The waiting harness was closed when David requested key-free tracking. Its terminal result and `.local/live-benchmarks/2026-11-12T00-28-32.539Z/report.json` confirm `started: false`, no recording and only idle statuses. No paid attempt occurred; the single-run authorization remains available, subject to in-app key entry and consent.

### Key-free face and body tracking — 2026-11-11

David explicitly requested on-device camera animation and body tracking. MediaPipe Face Landmarker and Pose Landmarker Lite run in one CPU worker, with one bitmap in flight at up to 15 Hz and 640×480. Models and module WebAssembly are bundled with Apache-2.0 license evidence, hashes and origins in `public/tracking/`; no CDN is needed at runtime. Camera preview requires explicit consent and requests video only. SmartSpectra remains a separate optional, metered input.

The installed MediaPipe 1.2.3 runtime unconditionally creates a telemetry logger with no public disable option. An integration check caught its shutdown upload attempt. The worker now confines fetches to exact local assets before transport, with a separate worker-response CSP restricting network access to the app origin. Actual initialization, both inference paths, restart and shutdown pass with all external requests blocked and zero attempted outbound requests. No native SmartSpectra module loads in this mode.

Recordings retain 13 facial coefficients, head rotation and up to 12 visible body joints as estimates, never fabricated physiological channels. Capture time and result-delivery time remain distinct and survive trim/replay. Tracking expires at 300 ms; lower-cadence frame hold uses that same bound. Compatible Snow/Mixamo/common bones and morphs receive bounded rotations/weights; missing input restores authored motion. Movement drives procedural sound and scenes. No finger tracking, foot locking, root translation, gaze, emotion or microexpression accuracy is claimed. Single-camera depth and occluded joints remain approximate.

Final `npm run check` passed 101/101 tests, TypeScript/Vite and the Electron studio workflow. The stalled-video watchdog now marks input stale after 300 ms and stops after 3 seconds; tests cover initial absence, freezing after inference, exact boundaries, cancellation and restart. The separate local-tracking check passed actual model inference using hash-pinned public images, visible Snow poses, control/WAV/baked-GLB export and reimport, worker/stream release, consent revocation and 760×620 viewport fit. On this host its 67 retained frames had 19.6 ms median / 26 ms p95 snapshot-to-result age; render-frame spacing was 16.7 ms median / 17.6 ms p95. These short fixture observations do not establish physical-camera accuracy or hardware sensor latency.

Independent media decoding, Snow expressions/clip loops/resource cleanup and seven-scene GLB round trips also passed after integration. The synthetic 1.5-second export had exact PCM duration, waveform correlation 0.99970 and 6.5 ms best-match audio lag; this is export timing, not camera latency. Logs: `artifacts/local-tracking-{final-check,ui,media,character,scenes}.log`; local inference images/report: `artifacts/local-tracking/`. Vite retains its pre-existing large main-chunk advisory; no performance improvement is inferred from bundle size.
