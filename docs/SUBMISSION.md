# Presage SmartSpectra SDK Challenge submission

Deadline: November 22, 2026, 11:59 PM PST. Required: a published DEV post using the challenge template with `#presagechallenge` (and `#devchallenge`), a public repository with setup instructions, a demo video, and the consent and data-handling section. Judges check SDK use in the repository and the video. Qualifying live signals: pulse, breathing rate, HRV or expressions.

## Before publishing

- [x] One authorized live run (2026-11-18, standard metrics, 55 s; SDK accepted the frames): `node scripts/live-benchmark.mjs --authorized` (55 s, writes `.local/live-benchmarks/<time>/`). If it fails with an entitlement error, rerun with `--sdk-metrics=core`.
- [x] Inspect `report.json` and replay `packets.jsonl` with `node scripts/replay-packets.mjs`; tune mapping offline, never with extra metered runs.
- [x] Demo video: `node scripts/make-demo.mjs <replayed-take.json> <dir>` records a captioned screen demo of the app with Synthetic Rehearsal and a replay of the 2026-11-18 SmartSpectra run (labeled RECORDED TAKE; pulse was not reported). Output stays outside the repo.
- [ ] (Superseded unless you want a live camera take) Record the demo take in a normal session (keep the window visible; hiding it stops input), export its control JSON, then re-render video, WAV, GLB and CSV from that JSON as often as needed.
- [ ] Owner approves `docs/PRIVACY.md` and `docs/TERMS.md`.
- [ ] Confirm no `.local/`, takes, packet logs, keys or recordings are tracked (`git ls-files`).
- [x] Create the public repository and push: https://github.com/dcondrey/idlewild
- [ ] Optional: upload this agent session at dev.to/agent_sessions/new, check it for keys, then **Make Public**.

## Demo video (about 2 minutes)

1. 0:00 Title card: "Idlewild: your breath performs the character."
2. 0:05 Consent: Use camera, consent, open preview, enter key, metered-measurement consent. Point out telemetry off and the disclosure.
3. 0:20 Start SmartSpectra performance on Rex. The signal panel shows SmartSpectra · LIVE, the breath trace and rates warming up.
4. 0:35 Breathe slowly and deeply: Rex's chest and shoulders rise with the trace. Turn and gesture: face and body tracking layer on top.
5. 0:55 Record a 20-second take, finish, play it back on Bubbles (rise on inhale, release on exhale) and Star (glow, pulse-waveform shimmer). Enable sound.
6. 1:20 Export: video with the signal panel, WAV, GLB opened in Blender showing the `IdlewildSignals` breath curve driving a rig, and the CSV.
7. 1:45 Close on data handling: keys in memory only, camera images never saved, creative use, not medical.

## DEV post draft

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04)*

### What I Built

Idlewild is a desktop performance studio for animators and game makers. You breathe, move and perform in front of a webcam; SmartSpectra measures your chest breathing and, when your chest and face are well framed, breathing rate and pulse rate; on-device tracking follows your face and body, and a character performs with you. Record once, replay the same performance on any character, then export video, procedural sound, a baked GLB with real breathing curves and CSV curves for your animation tools. Idle loops and cutscenes get breathing captured from a real person instead of a sine wave.

### Demo

{% embed VIDEO_URL %}

### Code

{% embed https://github.com/dcondrey/idlewild %}

### How It Responds to Human Signals

- **Chest breathing trace** drives chest, shoulder and head motion on Rex, Sprite and the Rain runner; bubbles rise on inhale and release on exhale; the star glows; the sound's breath layer swells. The trace has no declared units, so Idlewild centers and scales it against its own recent range.
- **Breathing rate** sets slow, bounded scene pacing. Faster breathing is never rewarded, and the runner's pace is chosen, not breath-driven.
- **Pulse rate**, when SmartSpectra reports it, warms colors and glow and is shown with its trend. It is never turned into fake heartbeats.
- **Pulse waveform** (uncalibrated arterial trace), when reported, adds a fine shimmer and a subtle tremolo.
- **Blink and talking** move eyelids and jaw when no face is tracked locally. **HRV and expression estimates** are opt-in.
- Every signal carries its quality and confidence onto an on-stage panel that is also composited into exported video. Missing or stale input fades out and is never invented. SmartSpectra frames and local MediaPipe tracking from the same camera are merged onto one timeline.

### Prize Categories

Most Creative or Delightful Use; Best Thoughtful Real-World Use.

### Consent and Data Handling

- Nothing starts at launch. The camera opens only after in-app consent; SmartSpectra needs your own key and a separate metered-measurement consent (18+).
- Keys stay in main-process memory for the session and are never written to disk. Camera images are never saved, uploaded by Idlewild or exported. No microphone is used; all audio is synthesized.
- SmartSpectra sends camera-derived data to Presage for processing. Idlewild disables SDK telemetry and never requests insights, but the SDK may generate automatic vitals insights that upload data and Idlewild cannot disable them; vendor retention is governed by Presage's terms and is not verified by Idlewild.
- Takes live in memory until you export them. Exports that include measured breathing and pulse are personal data, and you choose where they go. Face and body tracking runs entirely on the device.
- Creative animation, not medical measurement: no diagnosis, no health claims, no covert monitoring.

### Agent Session

AGENT_SESSION_URL (optional)
