# Idlewild product and research context

## Purpose

Idlewild replaces the abandoned vivid-id hackathon concept. The intended real-world use is helping game and animation creators make synchronized motion and procedural sound from a short performance, then reuse that performance across scenes. Product usefulness and the quality of live control still need validation.

The requested subjects are a baby dragon, a European dragon, a robot, a pulsating star, bubbles, runners with different character choices, and an educational body-brain visualization. The owner authorized replacing unsuitable models with better free assets. Prioritize two polished demonstration scenes while retaining the remaining requested options in the development plan.

The workflow is consent, acquisition/warm-up, performance, recording, scene retargeting, trim/loop, and export. Rehearsal is explicitly synthetic. No rewards for unrestricted rapid breathing; any racing mapping uses comfortable calibrated bounds. Bubbles use a validated movement-based approximation, not a claim to measure airflow.

The [Presage challenge](https://dev.to/challenges/presage-2026-11-04) requires a functional SmartSpectra app using at least one live signal, a public repository, setup instructions, a DEV post, a demo video, and consent/data-handling disclosures. The relevant categories reward creative/delightful use and thoughtful real-world use. No medical decision-making, diagnosis/treatment claims, or non-consensual monitoring.

## Current workspace

The independent repository is `/Volumes/A/idlewild`; the original Rust project remains at `/Volumes/A/vivid-id`. Its prior research is in `docs/READINESS.md` and `docs/ACQUISITION.md` there. Do not build or modify the original Rust workspace for this app.

The scaffold selects Electron, Vite, TypeScript, Three.js, and `@smartspectra/node-sdk` 3.5.0. Resolve exact versions from `package.json` and `package-lock.json`. The initial npm install reported pending install-script review for `koffi` and `protobufjs`; dependency presence does not establish native usability. Review scripts before the orchestrator runs the first native-load check.

Two downloaded GLBs have SHA-256 receipts and documented source licenses. They have not passed a rendered appearance, deformation, or runtime performance review. No runner, baby-dragon replacement, or brain asset is acquired here. No application source exists yet.

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
