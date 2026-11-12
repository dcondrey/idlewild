# Privacy notice

Draft - requires owner approval. Not legal advice; makes no guarantee.

## What Idlewild does with the camera

- Startup requests no camera or microphone access. The camera opens only after you consent inside the app and choose a device. An optional second (face close-up) camera needs its own consent and must be a different device.
- Local tracking (face and body) runs on this device using bundled MediaPipe models. No CDN is used and the tracking worker is blocked from making outbound requests. Camera images are not saved or uploaded by this mode.
- No microphone is requested or recorded. Audio previews and WAV exports are synthesized.
- Face coefficients, head rotation, body positions and movement amount are estimates for creative animation. They are not measurements of health, emotion or identity. Control data derived from your camera is still personal data.

## Your data on this device

- Recorded takes stay in memory until you export them. Closing the app discards them. Deleting takes does not guarantee physical erasure of memory.
- Exports contain control data and source labels. They exclude camera images and API keys. Where you save an export is your choice.
- An optional SmartSpectra API key you enter is kept in main-process memory for the session only, is not written to disk, and is cleared with **Clear key**.
- The app does not run analytics of its own.

## Optional SmartSpectra measurement (Presage Technologies)

- This mode is off by default, needs your own Presage API key, and requires a separate consent.
- It sends camera-derived data to the vendor for processing and may consume metered account credits.
- Vendor telemetry is disabled by Idlewild, but that is not an offline mode. The vendor SDK may generate automatic periodic insights; Idlewild exposes no control to disable them.
- Vendor retention is not verified. See Presage's terms and privacy policy: https://presagetech.com/legal/terms-of-service
- Use of this mode is for adults 18 or older.

## Not medical

Idlewild is a creative tool. It does not diagnose, monitor or treat any condition, and its brain scene is an educational simulation based on published studies, not your measured brain activity.

## Contact

[Owner to supply a contact before publication.]
