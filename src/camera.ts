const MAX_CAPTURE_WIDTH = 1920;
const MAX_CAPTURE_HEIGHT = 1440;
const CAPTURE_FRAME_RATE = 30;
const SDK_FRAME_PIXELS = 640 * 480;

interface CameraCapabilities extends MediaTrackCapabilities { resizeMode?: string[]; zoom?: { min?: number; max?: number } }
interface CameraConstraints extends MediaTrackConstraints { resizeMode?: string; zoom?: number }

export function sdkFrameSize(width: number, height: number): [number, number] {
  const ratio = Math.min(1, Math.sqrt(SDK_FRAME_PIXELS / (width * height)), 1280 / width, 720 / height);
  return [Math.max(2, Math.floor(width * ratio / 2) * 2), Math.max(2, Math.floor(height * ratio / 2) * 2)];
}

export interface FaceCameraRequest {
  video: HTMLVideoElement;
  deviceId: string;
  consent: boolean;
  onDisconnect: () => void;
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
}

function openCamera(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: false, video: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: MAX_CAPTURE_WIDTH }, height: { ideal: MAX_CAPTURE_HEIGHT }, frameRate: { ideal: CAPTURE_FRAME_RATE },
  } });
}

async function widenView(track: MediaStreamTrack, deviceId: string | null) {
  const capabilities = track.getCapabilities?.() as CameraCapabilities | undefined;
  const constraints: CameraConstraints = {};
  const width = capabilities?.width?.max;
  const height = capabilities?.height?.max;
  if (width !== undefined && height !== undefined && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    const scale = Math.min(1, MAX_CAPTURE_WIDTH / width, MAX_CAPTURE_HEIGHT / height);
    constraints.width = { ideal: Math.round(width * scale) };
    constraints.height = { ideal: Math.round(height * scale) };
    constraints.frameRate = { ideal: CAPTURE_FRAME_RATE };
  }
  if (capabilities?.resizeMode?.includes('none')) constraints.resizeMode = 'none';
  if (Number.isFinite(capabilities?.zoom?.min)) constraints.zoom = capabilities!.zoom!.min;
  if (Object.keys(constraints).length) await track.applyConstraints(constraints);
  if (deviceId && track.getSettings().deviceId !== deviceId) throw new Error('The camera opened a different device than the one selected.');
}

export function createCamera(video: HTMLVideoElement, onDisconnect: () => void, bridge = window.idlewild) {
  let stream: MediaStream | null = null;
  let pending: Promise<void> | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending: Promise<unknown> | null = null;
  let live = false;
  let faceStream: MediaStream | null = null;
  let faceVideo: HTMLVideoElement | null = null;
  let facePending: Promise<void> | null = null;
  let faceGeneration = 0;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  function deviceOf(source: MediaStream | null): string | null {
    return source?.getVideoTracks()[0]?.getSettings().deviceId || null;
  }

  function releaseFace() {
    faceGeneration++;
    if (faceStream) stopTracks(faceStream);
    faceStream = null;
    if (faceVideo) faceVideo.srcObject = null;
    faceVideo = null;
  }

  function release() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    live = false;
    releaseFace();
    if (stream) stopTracks(stream);
    stream = null;
    video.srcObject = null;
  }

  async function shutdown() {
    release();
    await Promise.allSettled([pending, sending, facePending]);
    if (bridge) await bridge.allowCamera(false);
  }

  async function stop() {
    generation++;
    await shutdown();
  }

  return {
    get active() { return stream !== null; },
    get deviceId() { return deviceOf(stream); },
    get faceDeviceId() { return deviceOf(faceStream); },
    async devices() {
      if (!navigator.mediaDevices) throw new Error('Camera access requires the desktop app or localhost.');
      return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    },
    async start(deviceId: string | null) {
      const token = ++generation;
      await shutdown();
      if (token !== generation) return;
      pending = (async () => {
        try {
          if (bridge) await bridge.allowCamera(true);
          if (token !== generation) return;
          const opened = await openCamera(deviceId);
          if (token !== generation) { stopTracks(opened); return; }
          stream = opened;
          const track = opened.getVideoTracks()[0];
          if (!track) throw new Error('The selected camera did not provide video.');
          track.onended = () => { release(); onDisconnect(); };
          await widenView(track, deviceId);
          if (token !== generation) return;
          video.srcObject = opened;
          await video.play();
          if (token !== generation) release();
        } catch (error) {
          if (token === generation) release();
          if (bridge) await bridge.allowCamera(false);
          throw error;
        }
      })();
      try { await pending; } finally { pending = null; }
    },
    async openFace(request: FaceCameraRequest) {
      if (request.consent !== true) throw new Error('The face camera requires its own consent.');
      if (typeof request.deviceId !== 'string' || !request.deviceId) throw new Error('Choose a specific face camera.');
      if (request.video === video) throw new Error('The face camera needs its own preview.');
      const body = deviceOf(stream);
      if (!stream || pending || !body) throw new Error('Open the body camera preview before the face camera.');
      if (body === request.deviceId) throw new Error('Choose a face camera different from the body camera.');
      releaseFace();
      const token = faceGeneration;
      const owner = generation;
      await Promise.allSettled([facePending]);
      if (token !== faceGeneration || owner !== generation) return;
      const current = (async () => {
        let opened: MediaStream | null = null;
        try {
          opened = await openCamera(request.deviceId);
          if (token !== faceGeneration || owner !== generation) { stopTracks(opened); return; }
          faceStream = opened;
          faceVideo = request.video;
          const track = opened.getVideoTracks()[0];
          if (!track) throw new Error('The face camera did not provide video.');
          track.onended = () => { if (faceStream === opened) { releaseFace(); request.onDisconnect(); } };
          await widenView(track, request.deviceId);
          if (token !== faceGeneration) return;
          if (deviceOf(opened) === deviceOf(stream)) throw new Error('Choose a face camera different from the body camera.');
          request.video.srcObject = opened;
          await request.video.play();
        } catch (error) {
          if (opened && faceStream === opened) releaseFace();
          throw error;
        }
      })();
      facePending = current;
      try { await current; } finally { if (facePending === current) facePending = null; }
    },
    async closeFace() {
      releaseFace();
      await Promise.allSettled([facePending]);
    },
    async startLive(extended = false) {
      if (!bridge) throw new Error('Live measurement requires the Electron desktop app.');
      if (!stream || !context) throw new Error('Start a camera preview first.');
      const token = generation;
      await bridge.startLive(true, extended);
      if (token !== generation || !stream) { await bridge.stopLive(); return; }
      live = true;
      let lastStamp = 0;
      const tick = async () => {
        if (!live || token !== generation || !stream) return;
        try {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
            [canvas.width, canvas.height] = sdkFrameSize(video.videoWidth, video.videoHeight);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            lastStamp = Math.max(lastStamp + 1, Math.floor((performance.timeOrigin + performance.now()) * 1000));
            sending = bridge.sendFrame({ bytes: new Uint8Array(pixels.data.buffer), width: canvas.width, height: canvas.height, stride: canvas.width * 4, timestampUs: lastStamp });
            await sending;
          }
        } catch {
          release();
          onDisconnect();
          return;
        } finally { sending = null; }
        if (live && token === generation) timer = setTimeout(() => { void tick(); }, 50);
      };
      void tick();
    },
    stop,
  };
}
