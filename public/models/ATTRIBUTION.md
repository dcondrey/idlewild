# Model provenance

Receipts record source URLs, byte counts, SHA-256 hashes and runtime metadata. RobotExpressive and Dragon retain their downloaded bytes; Snow is an adaptation described below. Local visual and export checks are recorded in `docs/CONTEXT.md`.

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
.local/tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/prepare-snow.py
```

The converter writes `.local/assets/snow/snow.glb`; qualification precedes copying it into `public/models/` and updating its receipt. Source-embedded scripts are disabled. No cloud processing or paid generation was used.

## Original procedural subjects

`src/scenes/procedural.ts` constructs Idlewild's bubbles, star, baby dragon, three runner variants and abstract educational brain from mathematical geometry. These contain no downloaded third-party artwork. The baby dragon has its own juvenile proportions, articulated wings/limbs, eyes and jaw; it is not a scaled European-dragon asset. The brain is a whole-brain illustration without anatomical region labels. Generated geometry and baked animation may be reused in the creator's projects. User-imported assets retain their own rights and licenses.
