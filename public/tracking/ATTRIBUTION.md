# Local tracking assets

MediaPipe Tasks Vision 1.2.3 and the Face Landmarker / Pose Landmarker Lite models are from Google, under [Apache License 2.0](LICENSE-2.0.txt). Runtime and model bytes are unmodified. [Receipts](receipts.json) contain pinned origins, sizes and SHA-256 hashes. These assets are bundled for on-device inference; runtime does not use a CDN or upload camera images.

Primary model license evidence:

- [BlazeFace short-range model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf)
- [Face Mesh V2 model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf)
- [Blendshape V2 model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf)
- [BlazePose GHUM 3D model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)

[Face documentation](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) and [pose documentation](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) describe supported inputs and model limitations. Face coefficients and body positions are estimates for creative animation, not physiological measurements, emotion classification or validated microexpression detection. Occlusion, poor lighting, distance and fast motion reduce tracking quality; single-camera depth is approximate.
