# SmartSpectra Node SDK 3.5.0: static evidence

Scope: installed `node_modules/@smartspectra/node-sdk` and its four native package manifests, read without importing or executing the SDK. Declarations describe a wire/API contract, not proof that an account is authorized, a signal is produced, or a model meets a performance claim. Native binaries and network traffic were not inspected.

## Signals

`js/index.d.ts` (`SmartSpectraOptions`, `MetricType`) and `js/constants.js` define requested metric codes and bundles. The default is chest and abdomen breathing plus breathing rate; other bundles must be explicitly requested. The generated protobuf schema is `js/messages/generated.d.ts`; decode event buffers using `js/messages/index.d.ts` `decodeMetrics`. Fields can be absent or empty. Authorization and actual runtime availability are unverified.

| Requested signal | Declared output and limits |
| --- | --- |
| Chest and abdomen breathing, rate | `IBreathing.upperTrace` and `lowerTrace` are movement traces, `rate` is respiratory rate with confidence. Trace units, sampling rate and waveform calibration are not specified. Trace stability inherits the rate verdict; it is not trace confidence. Rate stable means confidence >= 45. |
| Movement | `IMicroMotion.glutes` and `knees` contain region-specific measurements; generic whole-body motion is not declared. `ValidationCode.kExcessiveMotion` is a validation condition, not a quantitative movement measurement (`js/constants.js`). |
| Heart / pulse | `ICardio.pulseRate` is heart rate with confidence, stable at confidence >= 40; `arterialPressureTrace` is uncalibrated and unitless, with the same stability threshold. This is not a systolic/diastolic blood pressure reading. `IPulse.trace` exists in the schema but `IMetrics` has no `pulse` field, so its delivery via metrics is unverified. |
| HRV | `ICardio.hrv` contains `IHrv` rmssd, meanNn, sdnn, baevsky, confidence and stable; stability threshold is confidence >= 50. `IHrv` describes a period of pulse data, but its window and the units of the first three fields are not specified there. |
| Face | `IFace` exposes blinking and talking detection statuses, landmark coordinates and expression scores. `ILandmarks.reset` breaks association with prior sets. No explicit facial action units, lip-specific metric or gaze field is declared; deriving these from landmarks is unverified. `IExpression` scores are not an action-unit API. |
| Strict rates | `IStrict` has value, stable and window-end timestamp; `ICardio.pulseRateStrict` and `IBreathing.breathingRateStrict` are populated only when requested and a value is available. Window duration and averaging behavior are not specified. |

Breathing amplitude, apnea, respiratory line length, baseline and inhale/exhale ratio are explicitly unavailable: fields remain empty and requesting their codes causes startup configuration failure (`IBreathing`, `SmartSpectraOptions`). Do not infer airflow from movement. A rate alone does not give actual beat times. No general averaging window or freshness guarantee is documented in these installed declarations; accumulated output is an end-of-session packet, not a specified averaging operation.

## Time and quality

`IMeasurement`, `IMeasurementWithConfidence`, `IDetectionStatus`, `IHrv`, `ILandmarks` and `IExpression` label their timestamps absolute microseconds since the Linux epoch and permit `number | Long`; `IStrict.timestamp` instead says microseconds on the session input timeline. Event callback timestamps are named `timestampUs`, but their epoch is not specified in `js/index.d.ts`. Custom `sendFrame` requires strictly increasing capture timestamps in microseconds; `README.md` troubleshooting recommends a monotonic clock. Do not assume event, strict and measurement clocks are interchangeable or convert a Long through an unsafe JS number. The declarations and native implementation may differ; runtime behavior remains unverified.

`IMeasurementWithConfidence.confidence` and expression scores declare 0–100 percentages; stable is a separate verdict. `ValidationCode` reports conditions including face positioning, lighting, chest visibility, low frame rate and excessive motion. Neither a missing sample nor unstable data means zero; preserve quality and absence explicitly.

## Lifecycle and privacy

`SmartSpectraSDK` in `js/index.d.ts` selects an input before `start`; `stop` is idempotent, `stopAsync` drains without blocking the event loop, and `destroy` is idempotent and must be awaited before replacement where process-global native ordering matters. `js/ffi.js` `stopAsync` deduplicates in-flight calls and `destroy` defers teardown until the stop settles; callbacks can remain in flight until native destroy joins workers. Await shutdown, prevent stale callbacks from updating a later session, and surface failures. `on` replaces the previous callback for that event. Source selection/reset details are documented in `js/index.d.ts`.

`SmartSpectraOptions.apiKey` is for server-validated authentication; no offline-only or no-network guarantee follows. Telemetry defaults on; `enableTelemetry: false` maps to `disable_telemetry` (`js/smartspectra.js`, `js/ffi.js`). `js/index.d.ts` says session summaries and full readiness reports may include free text, paths and platform context, and authenticated requests can correlate them to account/device; it says no raw frames or measured vitals are sent in those reports. `docs/device-readiness.md` says each enabled readiness check sends its full report. This telemetry statement does not establish the contents of other network traffic.

`requestInsight(text)` dispatches a prompt and returns a request ID; an asynchronous `insight` event matches it (`js/index.d.ts`, `js/smartspectra.js`). The README describes natural-language analysis of measured vitals, but its referenced insights guide is absent from this installed package. The destination, uploaded payload, retention and relationship to the telemetry switch are not established by the installed JavaScript/declarations. Do not enable or invoke insights without separately verified disclosure and authorization.

## Platform and packaging

`package.json` requires Node >= 20 and hard-depends on the four 3.5.0 native payload packages. `README.md` lists macOS arm64, Linux x64/arm64 (glibc >= 2.35) and Windows x64; `js/resolve-native.js` chooses by host platform/architecture or `SMARTSPECTRA_CAPI_PATH`. The main manifest has `prepare` and `build:proto` scripts but no install/postinstall script; each installed native package manifest has no scripts. README and resolver state no postinstall native download; npm still fetches all four hard dependencies. Other dependency scripts and actual deployment compatibility were not audited. No support for macOS x64 or Windows arm64 is declared.

## Minimal adapter proposal and queued checks

Keep capture behind explicit in-app consent and own one session at a time. Configure `enableTelemetry: false`, request only needed metrics, avoid insights, decode packets into bounded timestamped samples with source, stability/confidence and explicit missing/unavailable states. Preserve raw clock identity and Long precision until a verified conversion; never treat averaged rates as beat events. Expose lifecycle/error/validation state and await `stopAsync` then `destroy` before reuse; ignore late callbacks by session generation. Synthetic rehearsal must remain visibly synthetic.

Queue local, non-metered tests using a fake SDK and protobuf fixtures: absent/empty versus zero; unstable and confidence thresholds; multiple samples and large timestamps; strict versus measurement clock domains; invalid/malformed packets and bounded arrays; validation/errors; repeated and concurrent stop/destroy, late callbacks and replacement ordering; consent gating and telemetry/insight configuration. Live signal availability, timestamp mapping, data upload behavior, and platform packaging require separately authorized verification; no native session or paid service was run for this evidence.

## Official Electron example inspection

Inspected the upstream [Electron quickstart](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart) via GitHub on 2026-11-10: `main.js` blob `25f75366968803ba5b2744f3eb53df90a33e7cde`, `renderer.js` blob `82a33683eda3a8803c399229b02e2af172c6e96b`. It demonstrates the main/preload/renderer split, custom host MediaStream input, metric decoding, and replacement of an SDK instance when requested metrics change. Its renderer has contradictory comments about cumulative versus windowed packets; actual cadence/duplication remains a validation item. We must bound buffers and deduplicate timestamps independently. Its camera auto-grant, source-embedded key, default telemetry and synchronous renderer destroy are sample choices, not Idlewild's consent, privacy or awaited teardown contract. Refer to APIs without copying proprietary sample code into the project.
