# Idlewild development plan and execution prompts

Build a useful performance studio: one camera-driven performance controls animation and procedural sound, can be replayed across scenes, and produces reusable exports. The visual demonstration should be delightful; the recording and export workflow must establish the real-world value.

Run the prompts in order from `/Volumes/A/idlewild`. Each prompt loads the shared operating contract below, so it can start a fresh session without copying the entire conversation. Drafting this plan does not start the implementation phases.

## Model and effort assignments

These are prescribed settings for the available agent models, not benchmark claims. Use `gpt-6.1-terra` at **high** effort for orchestration, integration, stateful logic, native boundaries, and rendering. Use `gpt-6.1-sol` at **high** for UX and evidence-sensitive research, and **medium** for bounded documentation work. Each prompt states its exact assignments. Reserve escalation for a concrete unresolved problem; do not add reviewer trees.

| Phase | Outcome | Parent verification batch |
| --- | --- | --- |
| 1 | Qualified asset shortlist, SDK viability findings, shared contracts | Source/license/metadata review; no build or test suite |
| 2 | One complete live-capable interaction plus explicit rehearsal | Core regressions, build, native-load and browser smoke checks |
| 3 | Record, retarget, trim, loop, export | Recording/export regressions and integrated workflow |
| 4 | Requested scene collection with consistent quality | One scene-rendering and performance batch |
| 5 | Reliable lifecycle, accessible UX, bounded resource use | Changed-risk regressions and recovery/profile scenarios |
| 6 | Reproducible release candidate and submission materials | One final gate, package check, and authorized live evidence |

## Shared operating contract

Every prompt below incorporates these instructions:

1. Read `AGENTS.md`, `README.md`, `docs/CONTEXT.md`, this plan's current execution record, and only the implementation/callers needed for the phase. Preserve completed decisions and unrelated changes. Diagnose before editing; inspect for an existing equivalent before adding code or a dependency.
2. You are the parent orchestrator. Spawn up to **three workers concurrently** for independent work. Respect prerequisites: establish shared interfaces first, then delegate. Supply each worker its exact model/effort, owned paths, read-only dependencies, acceptance criteria, and prohibited operations. For a different model/effort, use a fresh agent context (`fork_turns="none"`) with a concise handoff. If an assigned model is unavailable, report it and use an available equally capable model without reducing required reasoning.
3. Workers own disjoint files. They may search, read, implement, and author assigned regression cases; they may not run installs, builds, Cargo, tests, dev servers, browsers, render/conversion jobs, benchmarks, packaging, or Git mutations. No recursive delegation. A worker proposes shared-file changes to the parent rather than making them. Workers return only changed paths, interface changes, unresolved risks, and queued checks.
4. The parent owns shared types/contracts, application entry points, manifests, lockfiles, integration, test-file allocation, and Git. Shared-workspace editing is acceptable with explicit ownership; do not create gratuitous worktrees. Use isolated worktrees if independent build environments become necessary, with every build still launched by the parent.
5. **Batch expensive operations.** Collect checks while workers implement; wait for the relevant integrations, then run one deduplicated, dependency-ordered batch at the phase gate. Install dependencies once only when changed; build once and reuse that artifact for subsequent checks. Never run `npm start` after a build if it rebuilds unnecessarily. Do not run unrelated Rust/Cargo checks. Parallelize checks only when they cannot contend for files, ports, native SDK state, or GPU resources.
6. A failed gate permits a targeted diagnostic or rerun of the affected checks after repair, not an automatic full rerun. After two failures with the same cause, inspect the cause and change approach. Run the required final gate once on the release candidate; repeat affected checks only after changes, failures, or a demonstrated verification gap. Record command, scope, result, revision, and log location without pasting large logs.
7. Implement the smallest clear solution. Keep modules cohesive, types explicit, state transitions recoverable, allocations bounded, cleanup reliable, and hot paths predictable. Prefer measured optimization over speculative caching, workers, or abstractions. Concise does not mean compressed identifiers, clever one-liners, ignored errors, or weakened validation. Add no framework or service without an unmet requirement.
8. Test meaningful failure modes and invariants: lifecycle races, stale or malformed input, record limits, synchronization, export correctness, and privileged boundaries. Extend an existing relevant suite first. Create a new file only for a distinct test responsibility. Skip getter tests, cosmetic snapshots, and assertions that merely mirror implementation. Use limit−1/limit/limit+1 where a meaningful boundary exists. Workers queue execution for the parent.
9. Default to no inline comments; add only non-obvious contracts or workarounds. Keep updates to a single sentence when something changes. Do not narrate tools, repeat the plan, or report checks that were not run. Maintain a compact execution record here rather than creating separate status documents.
10. Commit small coherent completed chunks frequently after diff review, even when runtime verification is explicitly queued for the batch. The parent stages exact paths and commits with one line: `<type>: <Imperative description>`. Use author and committer `David Condrey <david@writerslogic.com>`. Never commit secrets, recordings, prohibited assets, or generated dependencies. Local commits are authorized; remote creation, push, and publication require explicit authorization.
11. Development uses local/free resources. Do not start a metered SDK session, paid cloud task, generation service, or paid API for development, tuning, or diagnostics. An explicitly authorized live benchmark or a specific user exception is required for paid work; calling a demonstration a benchmark does not authorize it. Complete independent work if credentials, consent, or authorization are missing; record the exact remaining dependency.
12. Camera capture requires an explicit user action and informed in-app consent. Keep rehearsal visibly synthetic. Stop camera/native/audio resources on stop, cancellation, teardown, and errors. Disable SDK telemetry through its supported option; independently establish and disclose other vendor processing. Do not equate telemetry-off with offline operation. Never infer brain activity, medical conclusions, airflow pressure, or actual beat timing from an averaged rate.

## Prompt 1 Establish contracts and qualify model replacements

```text
Parent model: gpt-6.1-terra. Reasoning effort: high.
Workspace: /Volumes/A/idlewild.
Read and follow docs/DEVELOPMENT_PLAN.md's shared operating contract.
Execute phase 1 only; complete its artifacts and commit them.

Goal: resolve the assumptions that could invalidate the product before adding
features. Preserve the requested subjects while choosing better usable assets.

Delegate concurrently:
A. gpt-6.1-terra / high: inspect installed SmartSpectra declarations/examples and
   primary documentation. Report supported Electron integration, native lifecycle,
   selected metrics, warm-up/quality behavior, timestamp semantics, online calls,
   automatic insights, and account/cost constraints. Propose the smallest safe
   adapter contract. Read-only; do not instantiate the SDK or run diagnostics.
B. gpt-6.1-sol / high: qualify acquired dragon/robot metadata and research better
   baby-dragon and runner replacements plus a usable brain mesh. Own model
   provenance/catalog files only. Verify archive license terms, public raw-asset
   redistribution, rig/clips, materials, scale, and acquisition route. Produce a
   ranked shortlist with specific reasons; queue downloads and rendering for the
   parent. Do not bypass authentication or submit assets to cloud generators.
C. gpt-6.1-sol / high: design the shortest creator workflow from first launch to
   usable export. Return concrete UI states, keyboard interactions, acquisition
   feedback, one visual direction, and a 60-second product demonstration. Choose
   two hero scenes from evidence; preserve the other requested scene options.

Parent: reconcile findings into a compact architecture and initial shared types.
Define source provenance/quality, monotonic performance time, normalized controls,
session ownership, scene lifecycle, seeded playback, audio timing, and export data.
Freeze file ownership and error/stop semantics before phase 2. Choose and document
bounded recording limits; default to 180 seconds, 20 samples/second, six takes
unless evidence requires another limit. Do not invent unsupported SDK metrics.
Acquire only license-qualified free assets; record hashes and source terms.

Gate: one source/license/metadata review, no build/test suite. Distinguish acquired,
render-qualified, and still-blocked assets. Record how live functionality can be
verified without paid development calls and which assumptions need real capture.
Done: contracts and ownership are sufficient for independent implementation;
asset choices have evidence; privacy/cost uncertainty is explicit and actionable.
```

## Prompt 2 Build one complete interaction

```text
Parent model: gpt-6.1-terra. Reasoning effort: high.
Workspace: /Volumes/A/idlewild.
Read and follow docs/DEVELOPMENT_PLAN.md's shared operating contract.
Execute phase 2 against phase 1's contracts; do not redesign settled interfaces.

Delegate concurrently after publishing exact interfaces:
A. gpt-6.1-terra / high: own the capture adapter, preload boundary, and signal
   processing modules. Implement supported SDK integration, consent-gated startup,
   serialized start/stop/destroy, validated bounded inputs, timestamp normalization,
   and explicit warm-up/invalid/stale/error states. No paid calls or camera use.
   Implement a separately identified deterministic rehearsal source using the same
   control contract. Never substitute synthetic values into a live session.
B. gpt-6.1-terra / high: own the stage and initial scene modules. Implement a
   high-quality character scene and bubbles using qualified assets, consistent
   lighting/materials, resize handling, and complete resource disposal. Controls
   must produce observable changes; animation must be reproducible at a given
   playback time. Gate unverified phase/blowing behavior behind honest wording.
C. gpt-6.1-sol / high: own UI modules and styles. Implement the agreed studio
   layout, scene selection, consent details, camera action, warm-up feedback,
   source/quality status, and clear stop/retry controls. Make keyboard use and
   reduced motion work. Keep setup details out of ordinary creative controls.

Parent: wire entry points and secure Electron navigation, permissions, IPC, and
window lifecycle. Review pending native install scripts before enabling necessary
ones. Author or consolidate risk-based regression cases; preserve package scripts
as honest runnable commands. No shell/native power should leak into the renderer.

Run one integration batch: targeted signal/lifecycle regressions, one build,
consent-free native-load check where supported, browser rehearsal flow, and one
rendered asset review. Verify startup makes no camera request and rehearsal makes
no SDK/service calls. Verify stop releases owned resources and repeated activation
does not accumulate listeners/render loops. Record actual visual defects.

For live evidence, use only available free access with explicit capture consent,
or separately authorized metered execution. If blocked, preserve a functioning
adapter and record that live viability remains unverified; continue independent
work without representing rehearsal as challenge-qualified live integration.
Done: the complete interaction works locally, and live status is accurately stated.
```

## Prompt 3 Implement the reusable performance workflow

```text
Parent model: gpt-6.1-terra. Reasoning effort: high.
Workspace: /Volumes/A/idlewild.
Read and follow docs/DEVELOPMENT_PLAN.md's shared operating contract.
Execute phase 3 using the established control/clock/scene contracts.

Delegate concurrently with disjoint files:
A. gpt-6.1-terra / high: own recording and transport modules. Implement bounded
   takes, source metadata, stable replay, scrub, trim, loop, deletion, and retargeting
   the same controls across scenes. Make the performance clock the authority.
   Define behavior for gaps, invalid values, end points, and reset during playback.
B. gpt-6.1-terra / high: own audio and export modules. Implement user-activated
   procedural sound, shared timing, mute, and supported exports: audiovisual
   preview, WAV, and versioned control data. Use actual supported browser codecs;
   label formats accurately. Handle cancellation, allocation limits, failed
   encoding, and track/context/object-URL cleanup. Do not capture the webcam into
   exported scene video. Do not claim baked 3D animation unless implemented.
C. gpt-6.1-sol / high: own timeline, take controls, and export UI. Make record,
   preview, trim, loop, scene change, and export discoverable without a tutorial.
   Communicate recording limits and export progress/cancellation; preserve focus
   and keyboard operation through state changes. No simulated success messages.

Parent: integrate state transitions and allocate additions to existing tests.
Prioritize synchronization, recording limits, invalid input, repeated export,
cancellation, and delete/reset; avoid a separate test file for every control.

Run one batch after integration: affected regressions, one build, and a scripted
rehearsal recording retargeted to both scenes. Inspect exported media independently
for duration, audible sound, visible motion, and timing; reopening a valid blob
alone is insufficient. Verify trim/loop boundaries and memory caps. Collect media
fixtures/screenshots only in ignored artifact paths.
Done: a creator can produce and reuse an actual exported performance without a
paid service; provenance survives replay/export and live gaps are not fabricated.
```

## Prompt 4 Complete the scene collection

```text
Parent model: gpt-6.1-terra. Reasoning effort: high.
Workspace: /Volumes/A/idlewild.
Read and follow docs/DEVELOPMENT_PLAN.md's shared operating contract.
Execute phase 4; preserve one shared capture/edit/export workflow.

Delegate concurrently:
A. gpt-6.1-terra / high: own character scene modules for the baby dragon,
   European dragon, robot, and runner choices. Use qualified rigs and clips,
   sensible animation blending, bounded secondary motion, and appropriate sound
   controls. Avoid broken deformation and foot sliding; do not relabel a scaled
   adult dragon as a distinct baby asset. Race speed must be comfortably bounded
   and must not reward unrestrained fast breathing. Report missing assets precisely.
B. gpt-6.1-terra / high: own procedural star and bubble modules. Make them visually
   distinctive through controlled lighting, iridescence, particles, and sound while
   keeping GPU work bounded. Use the common clock and seeded randomness. Breath
   phase remains an inferred mapping requiring validation, never measured airflow.
C. gpt-6.1-sol / high: own the educational brain scene and its explanatory copy.
   Use a licensed mesh and existing primary research. Distinguish measured body
   signals from illustrative pathways in the actual interface. No personalized
   activation map, diagnosis, fabricated anatomy, or neural-relaxation score.

Parent: handle shared registry/material changes, queued asset downloads/conversion,
license notices, thumbnails, and UI integration. Reject unsuitable assets on
visual or rig evidence; choose an available qualified replacement rather than
silently shipping a broken model. Retain unresolved requested options explicitly.

Run one scene batch using the same recorded controls: render all scenes at common
viewports and quality settings; inspect idle, active, loop boundary, and scene
switch states. Check export compatibility and resource disposal. Measure frame
time, draw calls, memory trend, and load cost on the named machine; record values
as measurements, not universal guarantees. Fix the demonstrated bottleneck first.
Done: every completed scene is visibly distinct, controls motion/sound correctly,
works with existing takes, and has documented redistribution rights.
```

## Prompt 5 Harden the integrated experience

```text
Parent model: gpt-6.1-terra. Reasoning effort: high.
Workspace: /Volumes/A/idlewild.
Read and follow docs/DEVELOPMENT_PLAN.md's shared operating contract.
Execute phase 5 against demonstrated risks; do not start a general refactor.

Delegate concurrently after assigning exact non-overlapping modules:
A. gpt-6.1-terra / high: inspect/fix desktop and capture boundaries: permissions,
   validated IPC, navigation, credential handling, start/stop races, partial startup,
   device failure, reconnect, and late callbacks. Verify any vendor privacy claims
   against the actual configured integration. Queue specific regression cases.
B. gpt-6.1-terra / high: inspect/fix performance core and renderer resource ownership:
   stale input, buffer/record limits, shared timing, cancellation, repeated scene
   changes/exports, event-listener growth, and object disposal. Use existing profile
   evidence; propose measurements for unresolved hypotheses. No speculative rewrite.
C. gpt-6.1-sol / high: inspect/fix UI accessibility and first-use friction: keyboard,
   focus, contrast, reduced motion, readable consent, acquisition guidance, missing
   permissions, missing assets, slow exports, empty takes, and recovery actions.

Parent: resolve cross-module findings, remove only demonstrably obsolete code, and
extend existing risk-based tests. Keep every new failure case tied to a real
invariant or reproduced defect. Preserve visual quality while fixing performance.

Run one recovery/profile batch after integration: affected regressions, the needed
build, repeated activation/teardown, cancellation/failure paths, and representative
small-window/keyboard flows. Inspect resource trends over repeated cycles and
capture evidence for any performance claim. Do not start metered native diagnostics.
Done: known material failures are fixed or explicitly blocked with reproduction
steps; no placeholder actions, hidden synthetic fallback, or unverified guarantees.
```

## Prompt 6 Verify and prepare the hackathon submission

```text
Parent model: gpt-6.1-terra. Reasoning effort: high.
Workspace: /Volumes/A/idlewild.
Read and follow docs/DEVELOPMENT_PLAN.md's shared operating contract.
Execute phase 6; distinguish a prepared submission from a published submission.

Delegate concurrently:
A. gpt-6.1-terra / high: own setup/packaging instructions and packaging scripts
   only. Document supported platform, exact dependency setup, native prerequisites,
   account/key entry, start commands, rehearsal, and troubleshooting. Propose any
   manifest changes to the parent. Queue clean-checkout/package validation; run none.
B. gpt-6.1-sol / medium: own the DEV draft and demo shot list. Explain the creator
   need and show live performance -> reusable take -> different scene -> real
   export. Use the current official submission template and both relevant category
   descriptions. Include the actual consent, storage, sharing, retention, deletion,
   telemetry, and AI-service behavior. Mark missing links/evidence explicitly.
C. gpt-6.1-sol / high: independently inspect source disclosures, asset licenses,
   repository contents, and the proposed demonstration for unsupported claims or
   exposed data. Read-only: return concrete corrections and a publication manifest.
   If an agent transcript is included, select useful excerpts and redact secrets;
   public transcript upload requires authorization and the challenge's visibility
   setting. Do not publish or send anything.

Parent: finish changes, freeze the candidate, then run the required final gate once:
project checks, a reproducible dependency/setup check in an isolated checkout,
packaged launch where implemented, core creator flow, and actual export inspection.
Reuse built artifacts; deduplicate overlapping checks. Keep native suites separate
from ordinary browser rehearsal checks and report exactly which ran.

Obtain actual live SDK evidence using consented capture and confirmed free access
or a specifically authorized paid run. Demonstrate at least one real Presage signal
causing the claimed effect, including warm-up/quality, stop behavior, and observed
latency. Record the demo only with the participant's consent. A mocked callback,
recorded fixture, or rehearsal source cannot satisfy this acceptance condition.

Inspect the staged candidate for credentials, private media, prohibited binaries,
and licensing problems. Commit completed chunks with the specified attribution.
Prepare the public-repository contents, DEV post, setup, video, and any curated
session locally. Publish/push only when explicitly authorized. If live access or
publication is pending, finish everything independent and state the exact remaining
action; do not claim the hackathon entry is complete.
```

## Execution record

Update this section in place with concise decisions, gate evidence, and remaining dependencies. Keep large logs and private demo captures under ignored `artifacts/` or `.local/` paths; retain the result and reproduction command here.

- **Verified baseline, 2026-11-10:** independent Git repository at `/Volumes/A/idlewild`, branch `main`; dependency scaffold installed; robot and dragon GLBs match their SHA-256 receipts. Native loading, appearance, application behavior, and live capture are not yet verified.
- **Git policy:** small coherent local commits, one-line messages, author/committer `David Condrey <david@writerslogic.com>`; no remote configured or publication performed.
- **Phase state:** 1–6 pending. This document is the development plan, not an implementation completion claim.
- **Open dependencies:** baby-dragon/runner/brain asset qualification; native install-script review; supported SDK privacy configuration; consented live access with verified cost status. These do not block independent local implementation.
