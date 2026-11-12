# Release checklist (macOS arm64)

Draft. No release is approved. Unsigned builds are for local smoke tests only.

1. Bump `version` in `package.json`; run `npm ci --ignore-scripts`.
2. `npm run notices` and review the diff of `public/THIRD_PARTY_NOTICES.txt`; `npm run notices:check` must pass (fails on any production package without a license field or license file).
3. `npm run check` (tests, build, UI).
4. Unsigned build: `npm run dist`. Artifacts land in `release/` and are named `...-unsigned`. Then `npm run check:packaged` launches `release/mac-arm64/Idlewild.app` and verifies the bundle contents, model loading, credits/notices, rehearsal and that startup does not load the SDK.
5. Signed build (user-gated): export `CSC_LINK` and `CSC_KEY_PASSWORD` (Developer ID Application certificate) or `CSC_NAME` (keychain identity), plus one notarization set: `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`; or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; or `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`. Run `npm run dist:signed` (fails if notarization credentials are absent). Never commit credentials.
6. Verify: `codesign --verify --deep --strict release/mac-arm64/Idlewild.app`, `spctl --assess --type execute -v release/mac-arm64/Idlewild.app`, `xcrun stapler validate` on the DMG.
7. Clean-machine smoke test (no Node, no repo, no network for the local path): open the app from the DMG; the stage and a model load; Credits & licenses shows all three files; no camera prompt until consent is given in the app, then exactly one video-only prompt; no microphone prompt; local tracking starts; quit releases the camera. Optional SDK probe: `scripts/check-native.mjs` equivalent against the packaged app, require-only, no session, no key.
8. Confirm `Info.plist` has `NSCameraUsageDescription` and the entitlements contain no microphone entry: `codesign -d --entitlements - release/mac-arm64/Idlewild.app`.

User-gated before publication: Apple Developer signing credentials; owner and legal approval of `docs/PRIVACY.md` and `docs/TERMS.md`; confirmation of Presage redistribution terms and retention behavior; publication itself.

Linux and Windows are not configured: the SDK ships prebuilds for them but nothing here has been built or tested on those platforms.
