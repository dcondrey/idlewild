import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { createTrackingMapper } from './mapping.ts';
import { localTrackingFetch } from './network.ts';
import { TRACKING_STALE_MS } from '../contracts.ts';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  location: Location;
  close(): void;
}
const scope = self as unknown as WorkerScope;
globalThis.fetch = localTrackingFetch(scope.location.href, globalThis.fetch.bind(globalThis));
let face: FaceLandmarker | null = null;
let pose: PoseLandmarker | null = null;
let map: ReturnType<typeof createTrackingMapper> | null = null;
let initialization: Promise<void> | null = null;
let stopped = false;
let previousTimestamp = -1;
let cachedFace: FaceLandmarkerResult | null = null;
let cachedFaceTime = -1;

function release() {
  const previousFace = face;
  const previousPose = pose;
  face = null;
  pose = null;
  map = null;
  cachedFace = null;
  cachedFaceTime = -1;
  try { previousFace?.close(); } finally { previousPose?.close(); }
}

async function initialize(sessionId: string, assetsBase: string) {
  const base = new URL(assetsBase);
  const origin = new URL(scope.location.href);
  if (base.protocol !== origin.protocol || base.host !== origin.host || !base.pathname.endsWith('/tracking/') || base.search || base.hash) throw new Error('Invalid local tracking assets');
  const files = await FilesetResolver.forVisionTasks(new URL('wasm', base).href, true);
  if (stopped) return;
  // Separate module URLs restore the SDK's cleared ModuleFactory for the second task.
  face = await FaceLandmarker.createFromOptions({ ...files, wasmLoaderPath: `${files.wasmLoaderPath}?task=face` }, {
    baseOptions: { modelAssetPath: new URL('face_landmarker.task', base).href, delegate: 'CPU' },
    runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
  });
  if (stopped) { release(); return; }
  pose = await PoseLandmarker.createFromOptions({ ...files, wasmLoaderPath: `${files.wasmLoaderPath}?task=pose` }, {
    baseOptions: { modelAssetPath: new URL('pose_landmarker_lite.task', base).href, delegate: 'CPU' },
    runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5, outputSegmentationMasks: false,
  });
  if (stopped) { release(); return; }
  map = createTrackingMapper(sessionId);
  scope.postMessage({ type: 'ready' });
}

scope.onmessage = ({ data }) => {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'initialize') {
    if (initialization || stopped || typeof data.sessionId !== 'string' || typeof data.assetsBase !== 'string') return;
    initialization = initialize(data.sessionId, data.assetsBase).catch(() => {
      stopped = true;
      try { release(); } finally { scope.postMessage({ type: 'error', message: 'Local tracking could not load its models' }); }
    });
  } else if (data.type === 'stop') {
    stopped = true;
    void (async () => {
      try { await initialization; release(); }
      finally { scope.postMessage({ type: 'stopped' }); scope.close(); }
    })();
  } else if (data.type === 'frame') {
    const bitmap = data.bitmap;
    const separateFace = Object.hasOwn(data, 'faceBitmap');
    const faceBitmap = separateFace ? data.faceBitmap : bitmap;
    let result: ReturnType<PoseLandmarker['detectForVideo']> | null = null;
    try {
      if (stopped || !face || !pose || !map) return;
      if (!(bitmap instanceof ImageBitmap) || bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 960 || bitmap.height > 720
        || !Number.isSafeInteger(data.id) || data.id < 1 || !Number.isFinite(data.timeMs)
        || data.timeMs <= previousTimestamp || data.timeMs < 0 || data.timeMs > Number.MAX_SAFE_INTEGER) throw new Error('Invalid tracking frame');
      if (faceBitmap !== null && (!(faceBitmap instanceof ImageBitmap) || faceBitmap.width < 1 || faceBitmap.height < 1 || faceBitmap.width > 960 || faceBitmap.height > 720)) throw new Error('Invalid face frame');
      const faceTime = separateFace ? data.faceTimeMs : data.timeMs;
      if (faceTime !== null && (!Number.isFinite(faceTime) || faceTime < 0 || faceTime > data.timeMs)) throw new Error('Invalid face time');
      if (faceBitmap && faceTime === null) throw new Error('Missing face time');
      previousTimestamp = data.timeMs;
      if (faceBitmap) {
        if (faceTime <= cachedFaceTime) throw new Error('Face frame time must advance');
        cachedFace = face.detectForVideo(faceBitmap, faceTime);
        cachedFaceTime = faceTime;
      }
      const faceResult = faceTime === cachedFaceTime && data.timeMs - cachedFaceTime < TRACKING_STALE_MS ? cachedFace : null;
      result = pose.detectForVideo(bitmap, data.timeMs);
      scope.postMessage({ type: 'frame', id: data.id, frame: map(faceResult, result, data.timeMs, faceResult ? cachedFaceTime : data.timeMs) });
    } catch {
      stopped = true;
      try { release(); } finally { scope.postMessage({ type: 'error', message: 'Local tracking could not process a camera frame' }); }
    } finally {
      try { result?.close(); } finally {
        try { if (bitmap instanceof ImageBitmap) bitmap.close(); }
        finally { if (faceBitmap instanceof ImageBitmap && faceBitmap !== bitmap) faceBitmap.close(); }
      }
    }
  }
};
