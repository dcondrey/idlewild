# Idlewild formats and reuse

Exports use the selected take and current scene, Motion, Sensitivity, Sound and reduced-motion setting. The same take, seed and settings supply the same scene controls; a live timestamp mapping is not proof of measured end-to-end latency. Exported files contain no camera imagery or API keys. Live control data is still personal data.

## Control JSON, version 1

**Control data** writes UTF-8 JSON with MIME type `application/json`. Import and export are limited to 8 MiB. The document is a single take:

| Field | Meaning |
| --- | --- |
| `version` | Integer `1`; other versions are rejected. |
| `id`, `sessionId` | Nonempty identifiers, at most 128 characters, beginning with an ASCII letter/digit; remaining characters may also include `.`, `_`, `:` or `-`. |
| `source` | `rehearsal` or `live`; never inferred from the values. |
| `seed` | Unsigned 32-bit integer for deterministic scene variation. |
| `durationMs` | Take duration in milliseconds, up to 180,000. |
| `samples` | At most 3,600 control frames, ordered by strictly increasing `timeMs`. |

Each frame contains `sessionId`, `source`, `timeMs` and `signals`. Frame identity must match the take. Frame time is nonnegative and less than `durationMs`; each signal has its own sample time. A take may contain gaps. Empty takes are representable internally but cannot be exported through the app.

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
| `provenance` | `measured`, `synthetic` or `replayed`. Older version-1 input may omit it; validation supplies `measured` for live input and `synthetic` for rehearsal. |

Recording subtracts its origin from both frame and signal times. Trimming subtracts the trim start from both. A negative `sampledAtMs` is valid: it means that signal was acquired before the retained take began. For example, a frame at `timeMs: 0` with `sampledAtMs: -1000` contains a one-second-old signal. Do not clamp negative sample times to zero.

Playback chooses the latest frame at or before the requested time and uses it only for the following 50 ms; later gaps stay missing. Loop time is modulo `durationMs`. Apply per-channel quality and freshness after frame lookup; the current stale threshold is 1,500 ms. The recorder stores at most one frame per 50 ms bucket, not interpolated physiology.

Optional speech continuity keeps at most eight seconds of quiet input, requires two seconds of contiguous valid samples, and replays breath for at most ten seconds. The final 500 ms fades toward neutral; valid recovery blends for 500 ms. These intervals carry `replayed` provenance and `confidence: null`, including blended recovery. They must not feed physiological analysis. Source/session changes, disabling continuity or resetting capture discard the cache. No breathing rate is synthesized.

For reuse in this codebase, enforce the file-size limit before parsing, then call `validateTake` from `src/validation.ts`; it returns detached schema fields and drops unknown properties. Use `frameAt` from `src/recording.ts` for gap-aware playback. JSON records the take and seed, **not scene selection or creative slider settings**: retain those settings separately when reproducing a scene. Export baked GLB to preserve the resulting animation.

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

For additional performance mapping, bone names are compared without punctuation or case. Imported chest mapping recognizes `Chest`, `Spine1`, `Spine2`, `mixamorigSpine1` and `mixamorigSpine2`; jaw mapping recognizes `Jaw` and `mixamorigJaw`. Blink morphs recognize `Blink`, `BlinkLeft`, `BlinkRight`, `EyeBlinkLeft` and `EyeBlinkRight`; talking morphs recognize `JawOpen` and `MouthOpen`. A talking detection opens the jaw; it does not reconstruct speech or gaze.

Missing, invalid or stale facial input preserves the character's authored facial animation. A valid zero is an active control value and overrides the corresponding blink or mouth morph.

## Baked animation GLB

**Baked GLB** writes a self-contained `model/gltf-binary` file with an `Idlewild_Performance` clip. It samples the selected scene at 20 Hz, adds the exact duration endpoint, and writes changed node translation, quaternion rotation, scale and morph-weight tracks. Skinning and model geometry are included. Materials are static: animated glow, shader appearance and procedural audio are not baked into glTF material tracks. Use the preview for the rendered appearance and WAV for sound.

The exported root includes `extras.idlewild` metadata: format version, take ID/source/seed/duration, controls, reduced-motion state, sample interval and per-channel provenance/quality intervals. Animation keyframe times are in **seconds**; `durationMs`, `sampleIntervalMs` and provenance interval bounds remain milliseconds. Third-party tools may discard extras when resaving; retain control JSON if provenance matters.

Baked GLBs preserve supplied model/clip notices in `asset.copyright` and record Idlewild's adaptation in `extras.idlewild.adaptation`. Video exports download a separate `-credits.txt` file when the character supplies notices; keep those credits with shared videos. Other tools may remove metadata, so retain the original asset license and credits as well.

Open the GLB in a glTF-capable animation tool, select `Idlewild_Performance`, and place the separately exported WAV at time zero. No-motion takes are rejected with an explanation instead of producing a falsely animated file. Reduce motion suppresses animation and can therefore make a take ineligible for baked export.

Export limits differ from import limits: at most 64 MiB output, 512 nodes, 64 morph weights per mesh, 32 MiB geometry, 8,388,608 captured numeric values and 8,388,608 texture pixels. Export textures are capped at 2,048 pixels per dimension. A larger valid export may require trimming or simplifying before Idlewild can import it again; other glTF consumers have their own limits.

## Sound and preview

**WAV sound** writes mono, 48,000 Hz, signed 16-bit little-endian PCM in a RIFF/WAVE file. Duration is rounded up to a whole audio sample. Procedural tone depends on scene, take time, valid breath and the current Sound/Sensitivity settings. Missing input becomes silence with short gain fades; Sound at zero exports silence. Monitoring mute does not change export settings. No microphone audio is included.

**Video preview** records the rendered scene with the same generated sound in real time. The runtime chooses supported WebM encoding, preferring VP8/Opus, then VP9/Opus, then its generic WebM support. Output fits within 1,280 × 720, preserves stage aspect ratio and requests approximately 30 frames per second. It contains a source label; the brain scene additionally identifies its educational nature. Camera preview pixels are excluded.

Keep the studio visible for the take's duration. Rendering stalls, codec failures, cancellation, unavailable media support and output above 64 MiB fail explicitly. WebM is an audiovisual preview, not reusable skeletal animation; it may have encoder timing overhead. Live signal latency and end-to-end synchronization still require the separately authorized session described in [CONTEXT](CONTEXT.md).
