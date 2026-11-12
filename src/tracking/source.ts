import { TRACKING_STALE_MS } from '../contracts.ts';
import type { CaptureSource, CaptureStatus, ControlFrame } from '../contracts.ts';
import { validateFrame } from '../validation.ts';

export const TRACKING_INTERVAL_MS = 1000 / 15;
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
  videoGeneration: number;
  tick: Timer | null;
  deadline: Timer | null;
  videoDeadline: Timer | null;
  shutdown: Promise<void> | null;
  finishShutdown: (() => void) | null;
  resolveStartup: () => void;
  rejectStartup: (error: Error) => void;
  onFrame: (frame: ControlFrame) => void;
  onStatus: (status: CaptureStatus) => void;
}

export function createLocalTrackingSource(video: HTMLVideoElement, dependencies: Dependencies = {}): CaptureSource {
  const createWorker = dependencies.createWorker ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as TrackingWorker);
  const createBitmap = dependencies.createBitmap ?? ((video, options) => createImageBitmap(video, options));
  const now = dependencies.now ?? (() => performance.now());
  const setTimer = dependencies.setTimer ?? setTimeout;
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  let current: Session | null = null;
  let disposed = false;

  function clear(session: Session, name: 'tick' | 'deadline' | 'videoDeadline') {
    if (session[name] !== null) clearTimer(session[name]);
    session[name] = null;
  }

  function notify(session: Session, phase: CaptureStatus['phase'], message: string, sessionId: string | null = session.sessionId) {
    session.onStatus({ phase, message, sessionId });
  }

  function stopSession(session: Session, error?: Error): Promise<void> {
    if (session.shutdown) return session.shutdown;
    let resolve!: () => void;
    session.shutdown = new Promise<void>(done => { resolve = done; });
    session.active = false;
    clear(session, 'tick');
    clear(session, 'deadline');
    clear(session, 'videoDeadline');
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
    const scale = Math.min(1, 640 / width, 480 / height);
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createBitmap(video, { resizeWidth: Math.max(1, Math.floor(width * scale)), resizeHeight: Math.max(1, Math.floor(height * scale)), resizeQuality: 'low' });
      if (!session.active) return;
      session.worker.postMessage({ type: 'frame', id, timeMs, bitmap }, [bitmap]);
      bitmap = null;
    } catch {
      fail(session, 'Local tracking could not read a camera frame');
    } finally { bitmap?.close(); }
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
        const observed = frame.tracking.face !== null || frame.tracking.body !== null;
        notify(session, !lagging && observed ? 'ready' : 'poor-signal', lagging ? 'Local tracking is falling behind the camera' : observed ? 'Local face and body estimates · no cloud processing' : 'No clear face or body landmarks');
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
        tick: null, deadline: null, videoDeadline: null, shutdown: null, finishShutdown: null,
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
