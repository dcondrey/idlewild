import { TRACKING_STALE_MS } from '../contracts.ts';
import type { CaptureSource, CaptureStatus, ControlFrame } from '../contracts.ts';
import { validateFrame } from '../validation.ts';

export const TRACKING_INTERVAL_MS = 1000 / 20;
export const TRACKING_START_TIMEOUT_MS = 20000;
export const TRACKING_FRAME_TIMEOUT_MS = 3000;
export const TRACKING_STOP_TIMEOUT_MS = 1500;

interface TrackingWorker {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { preventDefault(): void }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}
type Timer = ReturnType<typeof setTimeout> | number;
interface Dependencies {
  faceVideo?: HTMLVideoElement;
  createWorker?: () => TrackingWorker;
  createBitmap?: (video: HTMLVideoElement, options: ImageBitmapOptions) => Promise<ImageBitmap>;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  assetsBase?: string;
  sessionId?: () => string;
}
interface Session {
  worker: TrackingWorker;
  sessionId: string;
  epoch: number;
  active: boolean;
  ready: boolean;
  sequence: number;
  pending: number;
  lastCapture: number;
  lastVideoTime: number;
  lastFaceVideoTime: number;
  lastFaceSampleTime: number | null;
  faceCopyPending: boolean;
  videoGeneration: number;
  tick: Timer | null;
  deadline: Timer | null;
  videoDeadline: Timer | null;
  faceDeadline: Timer | null;
  cancelFace: (() => void) | null;
  bitmaps: Set<ImageBitmap>;
  shutdown: Promise<void> | null;
  finishShutdown: (() => void) | null;
  resolveStartup: () => void;
  rejectStartup: (error: Error) => void;
  onFrame: (frame: ControlFrame) => void;
  onStatus: (status: CaptureStatus) => void;
}

export function createLocalTrackingSource(video: HTMLVideoElement, dependencies: Dependencies = {}): CaptureSource {
  const faceVideo = dependencies.faceVideo;
  const createWorker = dependencies.createWorker ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as TrackingWorker);
  const createBitmap = dependencies.createBitmap ?? ((video, options) => createImageBitmap(video, options));
  const now = dependencies.now ?? (() => performance.now());
  const setTimer = dependencies.setTimer ?? setTimeout;
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  let current: Session | null = null;
  let disposed = false;

  function clear(session: Session, name: 'tick' | 'deadline' | 'videoDeadline' | 'faceDeadline') {
    if (session[name] !== null) clearTimer(session[name]);
    session[name] = null;
  }

  function notify(session: Session, phase: CaptureStatus['phase'], message: string, sessionId: string | null = session.sessionId) {
    session.onStatus({ phase, message, sessionId });
  }

  function releaseBitmap(session: Session, bitmap: ImageBitmap | null) {
    if (bitmap && session.bitmaps.delete(bitmap)) bitmap.close();
  }

  function retainBitmap(session: Session, bitmap: ImageBitmap): ImageBitmap | null {
    if (!session.active) { bitmap.close(); return null; }
    session.bitmaps.add(bitmap);
    return bitmap;
  }

  async function snapshot(session: Session, video: HTMLVideoElement, options: ImageBitmapOptions): Promise<ImageBitmap | null> {
    return retainBitmap(session, await createBitmap(video, options));
  }

  function imageOptions(width: number, height: number): ImageBitmapOptions {
    const scale = Math.min(1, 960 / width, 720 / height);
    return { resizeWidth: Math.max(1, Math.floor(width * scale)), resizeHeight: Math.max(1, Math.floor(height * scale)), resizeQuality: 'low' };
  }

  function faceSnapshot(session: Session, timeMs: number): Promise<{ bitmap: ImageBitmap | null; timeMs: number | null }> {
    const absent = { bitmap: null, timeMs: null };
    if (!faceVideo || !session.active || faceVideo.readyState < 2 || !Number.isFinite(faceVideo.currentTime)
      || !Number.isInteger(faceVideo.videoWidth) || !Number.isInteger(faceVideo.videoHeight)
      || faceVideo.videoWidth < 1 || faceVideo.videoHeight < 1 || faceVideo.videoWidth > 16384 || faceVideo.videoHeight > 16384) return Promise.resolve(absent);
    if (faceVideo.currentTime === session.lastFaceVideoTime) return Promise.resolve({ bitmap: null, timeMs: session.lastFaceSampleTime !== null && timeMs - session.lastFaceSampleTime < TRACKING_STALE_MS ? session.lastFaceSampleTime : null });
    if (session.faceCopyPending) return Promise.resolve(absent);
    const videoTime = faceVideo.currentTime;
    session.faceCopyPending = true;
    return new Promise(resolve => {
      let finished = false;
      const finish = (result: { bitmap: ImageBitmap | null; timeMs: number | null }) => {
        if (finished) { releaseBitmap(session, result.bitmap); return; }
        finished = true;
        clear(session, 'faceDeadline');
        session.cancelFace = null;
        resolve(result);
      };
      session.cancelFace = () => finish(absent);
      session.faceDeadline = setTimer(() => finish(absent), TRACKING_INTERVAL_MS);
      void snapshot(session, faceVideo, imageOptions(faceVideo.videoWidth, faceVideo.videoHeight)).then(bitmap => {
        if (!finished && bitmap) {
          session.lastFaceVideoTime = videoTime;
          session.lastFaceSampleTime = timeMs;
        }
        finish({ bitmap, timeMs: bitmap ? timeMs : null });
      }, () => finish(absent)).finally(() => { session.faceCopyPending = false; });
    });
  }

  function stopSession(session: Session, error?: Error): Promise<void> {
    if (session.shutdown) return session.shutdown;
    let resolve!: () => void;
    session.shutdown = new Promise<void>(done => { resolve = done; });
    session.active = false;
    clear(session, 'tick');
    clear(session, 'deadline');
    clear(session, 'videoDeadline');
    session.cancelFace?.();
    clear(session, 'faceDeadline');
    for (const bitmap of session.bitmaps) releaseBitmap(session, bitmap);
    session.rejectStartup(error ?? new Error('Local tracking startup was cancelled'));
    let finished = false;
    session.finishShutdown = () => {
      if (finished) return;
      finished = true;
      clear(session, 'deadline');
      session.worker.onmessage = null;
      session.worker.onerror = null;
      session.worker.terminate();
      if (current === session) current = null;
      try { if (!error) notify(session, 'idle', 'Local camera tracking stopped', null); } catch { /* Resources are already released. */ }
      resolve();
    };
    try { notify(session, error ? 'error' : 'stopping', error?.message ?? 'Stopping local camera tracking'); } catch { /* Cleanup must survive a consumer callback failure. */ }
    session.deadline = setTimer(session.finishShutdown, TRACKING_STOP_TIMEOUT_MS);
    try { session.worker.postMessage({ type: 'stop' }); }
    catch { session.finishShutdown(); }
    return session.shutdown;
  }

  function fail(session: Session, message: string) {
    if (session.active) void stopSession(session, new Error(message));
  }

  function watchVideoProgress(session: Session) {
    if (!session.active) return;
    clear(session, 'videoDeadline');
    const generation = ++session.videoGeneration;
    const origin = now();
    const active = () => session.active && session.videoGeneration === generation;
    session.videoDeadline = setTimer(() => {
      if (!active()) return;
      session.videoDeadline = null;
      try { notify(session, 'poor-signal', session.pending ? 'Local tracking is falling behind the camera' : 'Camera frames are not advancing'); }
      catch { fail(session, 'Local camera tracking stopped after a status callback failed'); return; }
      if (!active()) return;
      session.videoDeadline = setTimer(() => {
        if (!active()) return;
        session.videoDeadline = null;
        fail(session, session.pending ? 'Local camera tracking timed out' : 'Camera frames are unavailable. Reopen the camera preview.');
      }, Math.max(0, origin + TRACKING_FRAME_TIMEOUT_MS - now()));
    }, TRACKING_STALE_MS);
  }

  function schedule(session: Session) {
    if (!session.active) return;
    session.tick = setTimer(() => { session.tick = null; void capture(session); }, Math.max(0, session.lastCapture + TRACKING_INTERVAL_MS - now()));
  }

  async function capture(session: Session) {
    if (!session.active || session.pending) return;
    const captured = now();
    const videoTime = video.currentTime;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (video.readyState < 2 || !Number.isFinite(videoTime) || videoTime === session.lastVideoTime || width < 1 || height < 1) {
      session.lastCapture = captured;
      schedule(session);
      return;
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width > 16384 || height > 16384) {
      fail(session, 'Camera dimensions exceed the local tracking limit');
      return;
    }
    session.lastCapture = captured;
    session.lastVideoTime = videoTime;
    watchVideoProgress(session);
    const timeMs = Math.max(0, captured - session.epoch);
    const id = ++session.sequence;
    session.pending = id;
    session.deadline = setTimer(() => fail(session, 'Local camera tracking timed out'), TRACKING_FRAME_TIMEOUT_MS);
    let bitmap: ImageBitmap | null = null;
    let secondary: { bitmap: ImageBitmap | null; timeMs: number | null } | null = null;
    try {
      if (faceVideo) [bitmap, secondary] = await Promise.all([snapshot(session, video, imageOptions(width, height)), faceSnapshot(session, timeMs)]);
      else bitmap = retainBitmap(session, await createBitmap(video, imageOptions(width, height)));
      if (!session.active || !bitmap) return;
      const transfer = secondary?.bitmap ? [bitmap, secondary.bitmap] : [bitmap];
      session.worker.postMessage({ type: 'frame', id, timeMs, bitmap, ...(secondary ? { faceBitmap: secondary.bitmap, faceTimeMs: secondary.timeMs } : {}) }, transfer);
      for (const image of transfer) session.bitmaps.delete(image);
    } catch {
      fail(session, 'Local tracking could not read a camera frame');
    } finally { releaseBitmap(session, bitmap); releaseBitmap(session, secondary?.bitmap ?? null); }
  }

  function receive(session: Session, message: unknown) {
    if (!message || typeof message !== 'object') return;
    const data = message as Record<string, unknown>;
    if (data.type === 'stopped') { session.finishShutdown?.(); return; }
    if (!session.active) return;
    try {
      if (data.type === 'ready' && !session.ready) {
        clear(session, 'deadline');
        session.ready = true;
        notify(session, 'warming', 'Local face and body tracking is ready for camera frames');
        session.resolveStartup();
        watchVideoProgress(session);
        schedule(session);
      } else if (data.type === 'frame' && session.ready && session.pending !== 0 && data.id === session.pending) {
        clear(session, 'deadline');
        session.pending = 0;
        const frame = validateFrame(data.frame);
        const receivedAt = now() - session.epoch;
        if (frame.source !== 'local-camera' || frame.sessionId !== session.sessionId || !frame.tracking
          || frame.timeMs !== frame.tracking.sampledAtMs || frame.timeMs !== session.lastCapture - session.epoch
          || frame.timeMs > receivedAt) throw new Error('Invalid tracking worker result');
        frame.timeMs = receivedAt;
        session.onFrame(frame);
        if (!session.active) return;
        const lagging = receivedAt - frame.tracking.sampledAtMs >= TRACKING_STALE_MS;
        const observed = frame.tracking.body !== null || (frame.tracking.face !== null && receivedAt - (frame.tracking.face.sampledAtMs ?? frame.tracking.sampledAtMs) < TRACKING_STALE_MS);
        notify(session, !lagging && observed ? 'ready' : 'poor-signal', lagging ? 'Local tracking is falling behind the camera' : observed ? 'Face & body estimates stay local' : 'No clear face or body landmarks');
        schedule(session);
      } else if (data.type === 'error') fail(session, session.ready ? 'Local tracking could not process a camera frame' : 'Local tracking could not load its models');
    } catch { fail(session, 'Local camera tracking stopped after an invalid result'); }
  }

  return {
    async start(onFrame, onStatus) {
      if (disposed) throw new Error('Local tracking source is disposed');
      if (current) throw new Error('Local tracking source is already active');
      if (typeof onFrame !== 'function' || typeof onStatus !== 'function') throw new Error('Local tracking callbacks are required');
      const sessionId = dependencies.sessionId?.() ?? `local-${crypto.randomUUID()}`;
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sessionId)) throw new Error('Invalid tracking session');
      const assetsBase = dependencies.assetsBase ?? new URL('./tracking/', document.baseURI).href;
      let resolveStartup!: () => void;
      let rejectStartup!: (error: Error) => void;
      const startup = new Promise<void>((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });
      const session: Session = {
        worker: createWorker(), sessionId, epoch: now(), active: true, ready: false,
        sequence: 0, pending: 0, lastCapture: -Infinity, lastVideoTime: -Infinity, videoGeneration: 0,
        lastFaceVideoTime: -Infinity, lastFaceSampleTime: null, faceCopyPending: false,
        tick: null, deadline: null, videoDeadline: null, faceDeadline: null, cancelFace: null, bitmaps: new Set(), shutdown: null, finishShutdown: null,
        resolveStartup, rejectStartup, onFrame, onStatus,
      };
      current = session;
      session.worker.onmessage = event => receive(session, event.data);
      session.worker.onerror = event => { event.preventDefault(); fail(session, 'Local camera tracking worker failed'); };
      try {
        session.deadline = setTimer(() => fail(session, 'Local tracking model startup timed out'), TRACKING_START_TIMEOUT_MS);
        notify(session, 'starting', 'Loading local face and body models');
        if (session.active) session.worker.postMessage({ type: 'initialize', sessionId, assetsBase });
      } catch { fail(session, 'Local camera tracking could not start'); }
      try { await startup; }
      catch (error) { await session.shutdown; throw error; }
    },
    async stop() { if (current) await stopSession(current); },
    async dispose() { disposed = true; if (current) await stopSession(current); },
  };
}
