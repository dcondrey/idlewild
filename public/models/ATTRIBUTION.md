# Model provenance

These are acquired candidates, pending visual and animation review. Receipts record exact source URLs, byte counts, SHA-256 hashes, and parsed GLB metadata. Files are unmodified.

## RobotExpressive

`robot.glb` is by Tomás Laulhé (Quaternius), with modifications by Don McCurdy: three expression morph targets, FBX2glTF conversion, duplicate-material removal, and reduced metalness. The [pinned upstream README](https://github.com/mrdoob/three.js/blob/eba30de865cfbf31ac736f792defd9a60ff28d57/examples/models/gltf/RobotExpressive/README.md) identifies the license as [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The downloaded GLB contains 14 clips and expression targets named Angry, Surprised, and Sad. See [receipt](robot.receipt.json).

## Dragon

`dragon.glb` is the downloadable sample from [afk.ai's dragon page](https://afk.ai/auto-rig/dragon), which explicitly offers the sample and its animations under CC0. The file contains a 100-joint skin and 20 animation entries, including Rest Pose; the source advertises 19 animations. See [receipt](dragon.receipt.json).

Only the existing free sample was downloaded. No paid/cloud rigging or generation job was submitted. Source license declarations were checked on 2026-11-10; they do not establish runtime or artistic suitability.

## Original procedural subjects

`src/scenes/procedural.ts` constructs Idlewild's bubbles, star, baby dragon, three runner variants and abstract educational brain from mathematical geometry. These contain no downloaded third-party artwork. The baby dragon has its own juvenile proportions, articulated wings/limbs, eyes and jaw; it is not a scaled European-dragon asset. The brain is a whole-brain illustration without anatomical region labels. Generated geometry and baked animation may be reused in the creator's projects. User-imported assets retain their own rights and licenses.
