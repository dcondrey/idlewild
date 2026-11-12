# Idlewild formats and reuse

Exports use the selected take and current scene, Motion, Sensitivity, Sound and reduced-motion setting. The same take, seed and settings supply the same scene controls; timestamps are not proof of measured end-to-end latency. Exported files contain no camera imagery or API keys. Local-camera tracking and SmartSpectra control data are still personal data.

## Control JSON, version 1

**Control data** writes UTF-8 JSON with MIME type `application/json`. Import and export are limited to 8 MiB. The document is a single take:

| Field | Meaning |
| --- | --- |
| `version` | Integer `1`; other versions are rejected. |
| `id`, `sessionId` | Nonempty identifiers, at most 128 characters, beginning with an ASCII letter/digit; remaining characters may also include `.`, `_`, `:` or `-`. |
| `source` | `rehearsal`, `live` (SmartSpectra) or `local-camera`; never inferred from the values. |
| `seed` | Unsigned 32-bit integer for deterministic scene variation. |
| `durationMs` | Take duration in milliseconds, up to 180,000. |
| `samples` | At most 3,600 control frames, ordered by strictly increasing `timeMs`. |

Each frame contains `sessionId`, `source`, `timeMs` and `signals`. A `local-camera` frame also requires `tracking`; other sources must omit it. Frame identity must match the take. Frame time is nonnegative and less than `durationMs`; signals and tracking have their own sample times. A take may contain gaps. Empty takes are representable internally but cannot be exported through the app.

`signals` contains all six channels:

| Channel | `unit` | Interpretation |
| --- | --- | --- |
| `breath` | `relative` | Relative upper-body breathing trace; live amplitude/polarity calibration remains unverified. |
| `breathingRate` | `breaths/min` | Vendor breathing-rate estimate, not an instantaneous breath phase. |
| `pulseRate` | `beats/min` | Vendor pulse-rate estimate, not individual beat events. |
| `arterialTrace` | `relative` | Uncalibrated relative trace, not a blood-pressure reading. |
| `blink` | `boolean` | Sampled detection state, numeric `0` or `1`; not an event count. |
| `talking` | `boolean` | Sampled talking detection, numeric `0` or `1`; not speech audio or phonemes. |

Each signal contains:

| Field | Values |
| --- | --- |
| `value` | Finite number or `null`; valid/unstable signals require a value, and missing signals require `null`. Stale signals may retain an old value. |
| `quality` | `valid`, `unstable`, `missing` or `stale`. Absence is distinct from zero. |
| `confidence` | Number from 0 to 1, or `null` when unavailable. Vendor percentages are rescaled; trace confidence is not fabricated. |
| `sampledAtMs` | Milliseconds on the same clock as the containing frame; no later than its `timeMs`. |
| `unit` | Exact channel unit listed above. |
| `provenance` | `measured`, `synthetic` or `replayed`. Older version-1 input may omit it; validation supplies `synthetic` for rehearsal and `measured` otherwise. Local-camera signals remain null placeholders; their provenance does not assert a physiological measurement. |

Local-camera frames retain all six signal entries with `value: null`; capture supplies `quality: "missing"` and `confidence: null`. Facial blink and mouth coefficients live in `tracking.face`, not the legacy blink/talking detection channels. No physiological or speech-detection values are accepted for this source.

Recording subtracts its origin from frame, signal and tracking sample times. Trimming subtracts the trim start from all three. A negative `sampledAtMs` is valid: the sample predates the retained take. For example, a frame at `timeMs: 0` with tracking `sampledAtMs: -100` contains a 100 ms-old estimate. Do not clamp negative sample times to zero.

Playback chooses the latest frame at or before the requested time. Legacy rehearsal/SmartSpectra frames are held for less than 50 ms; local-camera frames for less than 300 ms. Tracking also expires when its own `sampledAtMs` is 300 ms old, so processing delay counts toward freshness. At either tracking boundary the estimate is unavailable; gaps do not interpolate invented movement. Loop time is modulo `durationMs`. Legacy signals retain their independent quality and 1,500 ms stale threshold. The recorder stores at most one frame per 50 ms bucket; local capture schedules at most 15 frames/second with one frame in flight, not a guaranteed inference rate.

Optional speech continuity applies to rehearsal/SmartSpectra breath signals. It keeps at most eight seconds of quiet input, requires two seconds of contiguous valid samples, and replays breath for at most ten seconds. The final 500 ms fades toward neutral; valid recovery blends for 500 ms. These intervals carry `replayed` provenance and `confidence: null`, including blended recovery. They must not feed physiological analysis. Source/session changes, disabling continuity or resetting capture discard the cache. No breathing rate is synthesized.

### Local tracking payload

The `tracking` object contains the following bounded fields; unavailable face/body/movement values are `null`:

| Field | Meaning and limits |
| --- | --- |
| `sampledAtMs` | Camera snapshot request time in milliseconds on the frame clock, no later than `timeMs`. Local `timeMs` records result delivery, preserving processing age; neither is a hardware sensor timestamp. |
| `face.weights` | All 13 named coefficients below, finite numbers in `[0, 1]`. |
| `face.rotation` | Head orientation as quaternion `[x, y, z, w]`, or `null`; each component in `[-1, 1]`, length within 0.01 of one. |
| `body` | Up to 12 named joints below. Each value is `[x, y, z, confidence]`: finite coordinates in `[-5, 5]` and confidence in `[0, 1]`. Omit unavailable joints; use `null`, not an empty object, when none are available. |
| `movement` | Derived body movement amount in `[0, 1]`, or `null`; a number requires a body. Capture derives it from at least three matching joints across consecutive samples at most 300 ms apart. |

Face names: `eyeBlinkLeft`, `eyeBlinkRight`, `jawOpen`, `mouthSmileLeft`, `mouthSmileRight`, `browDownLeft`, `browDownRight`, `browInnerUp`, `mouthFunnel`, `mouthPucker`, `mouthClose`, `mouthPressLeft`, `mouthPressRight`.

Body names: `leftShoulder`, `rightShoulder`, `leftElbow`, `rightElbow`, `leftWrist`, `rightWrist`, `leftHip`, `rightHip`, `leftKnee`, `rightKnee`, `leftAnkle`, `rightAnkle`.

Body coordinates are estimated meters around the hip midpoint, converted from MediaPipe world coordinates as `(x, -y, -z)` for the studio's Y-up space. Capture retains only in-frame joints meeting its 0.65 confidence threshold. These estimates do not establish calibrated depth, emotions, microexpression accuracy, breathing or pulse. Raw face landmarks and camera pixels are not stored. Both models and their runtime are bundled under `public/tracking/`; see [licenses and receipts](../public/tracking/ATTRIBUTION.md).

For reuse in this codebase, enforce the file-size limit before parsing, then call `validateTake` from `src/validation.ts`; it returns detached schema fields and drops unknown properties. Use `frameAt` from `src/recording.ts` for gap-aware playback and `trackingAt` from `src/tracking-frame.ts` for tracking freshness. Existing version-1 rehearsal/SmartSpectra takes need no tracking fields. JSON records the take and seed, **not scene selection or creative slider settings**: retain those settings separately when reproducing a scene. Export baked GLB to preserve the resulting animation.

## Character and clip imports

**Import character / clips** accepts `.glb` version 2 or `.gltf` version 2.0 with embedded base64 buffers and textures. Export exactly one scene containing every node. External URLs, relative files, compressed resources, sparse accessors and GPU-instancing extensions are rejected before loading. Use assets you have rights to use and export.

| Resource | Import limit |
| --- | --- |
| File / decoded buffers | 32 MiB each total |
| Scene graph | 256 nodes, depth 64; one parent per node, no cycles |
| Geometry | 500,000 vertices and 1,000,000 indices, including repeated mesh instances; triangles, line segments or points |
| Accessor storage | 64 MiB declared allocation; dense supported numeric accessors only |
| Morphs | 32 targets per primitive, one million total morph vertices; matching primitive target counts |
| Skins | 32 skins, 128 unique joints per skin; valid joint indices and inverse-bind matrices |
| Textures | PNG or baseline/progressive JPEG; 32 images/textures, 8 MiB per encoded image, 4,096 pixels per dimension, 16,777,216 total decoded pixels; material uses also share a conservative pixel budget |
| Clips | 64 clips, 600 seconds per clip, 12,000 keys per sampler, 256 channels per clip, 4,096 channels overall |

Supported material extensions are `KHR_materials_unlit`, `KHR_texture_transform`, `KHR_materials_clearcoat`, `KHR_materials_iridescence` and `KHR_materials_emissive_strength`. Their numbers, texture references and allocations are validated. Other extensions require re-export to the supported subset. Live cameras, compressed/video textures and imported cameras are not supported model resources.

Standard glTF `asset.copyright` notices are retained as plain text, limited to 4,096 characters, and shown under Model credits. Arbitrary imported metadata is removed. Supply the author, source, license link and existing modification notices in that field when preparing licensed assets; importing a model does not grant reuse rights.

Skinned characters retain their supplied rig. Static models receive creative root motion and are identified as static. The currently chosen source clip is named `Idle` (case-insensitive), or the first clip when no Idle clip exists; there is no automatic retargeting between unrelated skeletons.

Animation-only files require a previously imported character. Their target node names must match uniquely, and morph-track widths must match the target mesh. Translation, quaternion rotation, scale and morph-weight tracks support LINEAR, STEP and CUBICSPLINE interpolation. Missing targets, ambiguous names and incompatible morph widths are rejected.

For rehearsal/SmartSpectra mapping, bone names are compared without punctuation or case. Imported chest mapping recognizes `Chest`, `Spine1`, `Spine2`, `mixamorigSpine1` and `mixamorigSpine2`; jaw mapping recognizes `Jaw` and `mixamorigJaw`. Blink morphs recognize `Blink`, `BlinkLeft`, `BlinkRight`, `EyeBlinkLeft` and `EyeBlinkRight`; talking morphs recognize `JawOpen` and `MouthOpen`. A talking detection opens the jaw; it does not reconstruct speech or gaze.

Local tracking maps supported torso, shoulder, upper-arm, forearm, thigh and shin bones, plus head rotation. Naming support includes the supplied Snow rig, Mixamo-style names and common names such as `LeftArm`, `LeftForeArm`, `LeftUpLeg`, `LeftLeg`, `Spine` and `Head`; segment endpoints must be descendants of their bones. This rotates existing segments without changing limb lengths or inventing a rig. It does not provide finger tracking, foot locking, global root translation or universal skeleton retargeting. See `src/scenes/tracking.ts` for the exact aliases.

Local face mapping recognizes the 13 coefficient names above, plus aliases including `Blink`, `BlinkLeft`, `BlinkRight`, `MouthOpen`, `Smile`, `SmileOpen`, `BrowDown` and `MouthFunnel`. Only morphs present in the model respond; Snow has a smaller adapted subset. Mouth controls represent estimated shapes, not phonemes or speech audio, and gaze is unavailable. Motion blends tracking into the authored animation; Reduce motion disables tracking animation.

Missing, low-confidence or stale tracking preserves authored motion for the affected joints or face. A valid zero remains an active face value. Local body movement also drives the creative controls of procedural scenes and static models without being relabeled as breath.

## Baked animation GLB

**Baked GLB** writes a self-contained `model/gltf-binary` file with an `Idlewild_Performance` clip. It samples the selected scene at 20 Hz, adds the exact duration endpoint, and writes changed node translation, quaternion rotation, scale and morph-weight tracks. Skinning and model geometry are included. Materials are static: animated glow, shader appearance and procedural audio are not baked into glTF material tracks. Use the preview for the rendered appearance and WAV for sound.

The exported root includes `extras.idlewild` metadata: format version, take ID/source/seed/duration, controls, reduced-motion state, sample interval and per-channel provenance/quality intervals. Local-camera exports retain `source: "local-camera"`; separate `face` and `body` intervals use `source: "local-camera-estimate"`, `quality: "tracked"` when fresh and available, otherwise `missing`. This describes available input, not measured retargeting accuracy. Animation keyframe times are in **seconds**; `durationMs`, `sampleIntervalMs` and provenance interval bounds remain milliseconds. Third-party tools may discard extras when resaving; retain control JSON if provenance matters.

Baked GLBs preserve supplied model/clip notices in `asset.copyright` and record Idlewild's adaptation in `extras.idlewild.adaptation`. Video exports download a separate `-credits.txt` file when the character supplies notices; keep those credits with shared videos. Other tools may remove metadata, so retain the original asset license and credits as well.

Open the GLB in a glTF-capable animation tool, select `Idlewild_Performance`, and place the separately exported WAV at time zero. No-motion takes are rejected with an explanation instead of producing a falsely animated file. Reduce motion suppresses animation and can therefore make a take ineligible for baked export.

Export limits differ from import limits: at most 64 MiB output, 512 nodes, 64 morph weights per mesh, 32 MiB geometry, 8,388,608 captured numeric values and 8,388,608 texture pixels. Export textures are capped at 2,048 pixels per dimension. A larger valid export may require trimming or simplifying before Idlewild can import it again; other glTF consumers have their own limits.

## Sound and preview

**WAV sound** writes mono, 48,000 Hz, signed 16-bit little-endian PCM in a RIFF/WAVE file. Duration is rounded up to a whole audio sample. Procedural tone depends on scene and take time; amplitude uses fresh `tracking.movement` for local-camera takes or valid breath for rehearsal/SmartSpectra, with the current Sound/Sensitivity settings. Face-only tracking, missing movement and stale tracking become silence with short gain fades; Sound at zero exports silence. Monitoring mute does not change export settings. No microphone audio is included.

**Video preview** records the rendered scene with the same generated sound in real time. The runtime chooses supported WebM encoding, preferring VP8/Opus, then VP9/Opus, then its generic WebM support. Output fits within 1,280 × 720, preserves stage aspect ratio and requests approximately 30 frames per second. It contains a source label, including **LOCAL CAMERA TRACKING** for local takes; the brain scene additionally identifies its educational nature. Camera preview pixels are excluded.

Keep the studio visible for the take's duration. Rendering stalls, codec failures, cancellation, unavailable media support and output above 64 MiB fail explicitly. WebM is an audiovisual preview, not reusable skeletal animation; it may have encoder timing overhead. Actual-camera accuracy, latency and end-to-end synchronization need consented validation; SmartSpectra additionally needs separately authorized metered processing. See [verification limits](CONTEXT.md).
