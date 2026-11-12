import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { createTrackingMapper } from './mapping.ts';
import { localTrackingFetch } from './network.ts';

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

function release() {
  const previousFace = face;
  const previousPose = pose;
  face = null;
  pose = null;
  map = null;
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
    runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: 0.6,
    minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
    outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
  });
  if (stopped) { release(); return; }
  pose = await PoseLandmarker.createFromOptions({ ...files, wasmLoaderPath: `${files.wasmLoaderPath}?task=pose` }, {
    baseOptions: { modelAssetPath: new URL('pose_landmarker_lite.task', base).href, delegate: 'CPU' },
    runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.6,
    minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6, outputSegmentationMasks: false,
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
    if (!(bitmap instanceof ImageBitmap)) return;
    let result: ReturnType<PoseLandmarker['detectForVideo']> | null = null;
    try {
      if (stopped || !face || !pose || !map) return;
      if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 640 || bitmap.height > 480
        || !Number.isSafeInteger(data.id) || data.id < 1 || !Number.isFinite(data.timeMs)
        || data.timeMs <= previousTimestamp || data.timeMs < 0 || data.timeMs > Number.MAX_SAFE_INTEGER) throw new Error('Invalid tracking frame');
      previousTimestamp = data.timeMs;
      const faceResult = face.detectForVideo(bitmap, data.timeMs);
      result = pose.detectForVideo(bitmap, data.timeMs);
      scope.postMessage({ type: 'frame', id: data.id, frame: map(faceResult, result, data.timeMs) });
    } catch {
      stopped = true;
      try { release(); } finally { scope.postMessage({ type: 'error', message: 'Local tracking could not process a camera frame' }); }
    } finally {
      try { result?.close(); } finally { bitmap.close(); }
    }
  }
};
