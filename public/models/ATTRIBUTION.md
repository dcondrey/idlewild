# Model provenance

Receipts record source URLs, byte counts, SHA-256 hashes and runtime metadata. RobotExpressive and Dragon retain their downloaded bytes; Snow and the brain are adaptations described below. Local visual and export checks are recorded in `docs/CONTEXT.md`.

## RobotExpressive

`robot.glb` is by Tomás Laulhé (Quaternius), with modifications by Don McCurdy: three expression morph targets, FBX2glTF conversion, duplicate-material removal, and reduced metalness. The [pinned upstream README](https://github.com/mrdoob/three.js/blob/eba30de865cfbf31ac736f792defd9a60ff28d57/examples/models/gltf/RobotExpressive/README.md) identifies the license as [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The downloaded GLB contains 14 clips and expression targets named Angry, Surprised, and Sad. See [receipt](robot.receipt.json).

## Dragon

`dragon.glb` is the downloadable sample from [afk.ai's dragon page](https://afk.ai/auto-rig/dragon), which explicitly offers the sample and its animations under CC0. The file contains a 100-joint skin and 20 animation entries, including Rest Pose; the source advertises 19 animations. See [receipt](dragon.receipt.json).

Only the existing free sample was downloaded. No paid/cloud rigging or generation job was submitted. Source license declarations were checked on 2026-11-10; they do not establish runtime or artistic suitability.

## Snow

**Snow Rig (CC) Blender Foundation | studio.blender.org**

`snow.glb` adapts [Snow v4.2](https://studio.blender.org/characters/snow/v4/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The downloaded archive's ReadMe grants this license. Commercial adaptation and redistribution require attribution, the license link and an indication of changes; preserve the embedded credit when sharing model or animation files. See [receipt](snow.receipt.json).

Idlewild evaluates the original facial poses into seven morph targets, reduces the skeleton to 74 joints and skinning to four weights per vertex, applies subdivision level 1, simplifies materials, omits the outer corneas and reduces textures to six 1024×1024 images. It adds a relaxed stance and three authored two-second clips: Idle, Soft smile and Brow motion. These are creative animations, not measurements of emotion or microexpressions.

The source archive and Blender installation stay in ignored `.local/`; neither is needed to run the app. To reproduce the adaptation with Blender 4.5.9 and the original archive extracted under `.local/assets/snow/`, run:

```sh
.local/tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/prepare-character.py -- --profile snow --receipt .local/assets/snow/snow.receipt.json
```

The converter writes `.local/assets/snow/snow.glb`; qualification (`python3 -I .local/tools/compare_glb.py public/models/snow.glb .local/assets/snow/snow.glb --receipts public/models/snow.receipt.json .local/assets/snow/snow.receipt.json`) precedes copying it into `public/models/` and updating its receipt. Source-embedded scripts are disabled. No cloud processing or paid generation was used.

## Brain

**Brain for Blender (CC) Anderson Winkler | brainder.org**

`brain.glb` adapts the Desikan-Killiany pial cortical parcels and subcortical surfaces of [Brain for Blender](https://brainder.org/research/brain-for-blender/), a surface reconstruction of a human brain from 12 MRI volumes, under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Attribution, the license link and an indication of changes are required, and **adaptations must be shared under CC BY-SA 3.0 or a compatible license**: redistributing `brain.glb`, or a model or export that embeds its geometry, carries that obligation. The credit is embedded in the GLB `asset.copyright`. See [receipt](brain.receipt.json).

Idlewild welds each hemisphere, decimates it to at most 150,000 triangles for the whole model, assigns triangles back to their original parcels, maps FreeSurfer surface RAS (mm) to glTF metres (X = -R, Y = S, Z = A, so the front of the brain faces +Z and patient-left is +X) and uses shared hemisphere materials with hemisphere-smooth normals. Mesh names keep the FreeSurfer labels (`ctx-lh-<label>`, `ctx-rh-<label>`, `Left-Thalamus-Proper`, ...). The geometry is an educational illustration of anatomy, not a measurement of any user. To reproduce with the downloaded archives in `.local/assets/brain/`:

```sh
.local/tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/prepare-brain.py -- --retrieved 2026-11-11
```

## Rain (runner)

**Rain Rig (CC) Blender Foundation | studio.blender.org**

`runner.glb` adapts [Rain v3](https://studio.blender.org/characters/rain/v3/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see [runner.receipt.json](runner.receipt.json) for source and runtime SHA-256, sizes and conversion measurements. The downloaded archive (`rain_v3.zip`, SHA-256 `80217f163f6392dc829233d63c2cfb5e1376775bc34101ad14f39631fea70d24`) contains no license file. The license evidence is the Blender Studio character page and the ReadMe.txt text block embedded in `rain_v3.2.blend`, which states the rig is provided under CC BY by Blender Studio.

Modifications: 27 evaluated ARKit-named facial morphs, a reduced deformation skeleton with four weights per vertex, a relaxed arm pose, authored Idle, Run and two subtle expression clips, simplified materials and four reduced textures. Attribution, the license link and an indication of changes are required; preserve the embedded credit (`asset.copyright`) when sharing the model or exports derived from it. Regenerate with:

```sh
.local/tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/prepare-character.py -- --profile rain --receipt .local/assets/rain/rain.receipt.json
cp .local/assets/rain/rain.glb public/models/runner.glb && cp .local/assets/rain/rain.receipt.json public/models/runner.receipt.json
```

## Sprite

**Sprite Rig (CC) Blender Foundation | studio.blender.org**

`sprite.glb` adapts [Sprite](https://studio.blender.org/characters/sprite/v1/) from the open movie Sprite Fright under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see [sprite.receipt.json](sprite.receipt.json) for source and runtime SHA-256, sizes and conversion measurements. The public download (`sprite.blend`, SHA-256 `f0dfeae2b529a712f0c7fdf0d5870627067e996f5e5a0af66bc8b5c8e22c7d5e`) embeds a ReadMe.txt text block stating the rig is provided under CC BY by Blender Studio, matching the character page.

Modifications: 21 evaluated ARKit-named facial morphs from the rig's own pose assets and lip/eyelid actions, a reduced deformation skeleton with four weights per vertex, a relaxed arm pose, authored Idle and two subtle expression clips, and flat materials with colors matched to the source shading. Attribution, the license link and an indication of changes are required; preserve the embedded credit (`asset.copyright`) when sharing the model or exports derived from it. Regenerate with:

```sh
.local/tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/prepare-character.py -- --profile sprite --receipt .local/assets/blender-studio/sprite.receipt.json
cp .local/assets/blender-studio/sprite.glb public/models/sprite.glb && cp .local/assets/blender-studio/sprite.receipt.json public/models/sprite.receipt.json
```

## Original procedural subjects

`src/scenes/procedural.ts` constructs Idlewild's bubbles, star and the fallback runner (used only if `runner.glb` cannot load) from mathematical geometry. These contain no downloaded third-party artwork. Generated geometry and baked animation may be reused in the creator's projects. User-imported assets retain their own rights and licenses.
