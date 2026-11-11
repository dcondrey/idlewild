import type { CaptureSource, CaptureStatus, ControlFrame, Signal, Unit } from './contracts.ts';

const INTERVAL_MS = 50;
let nextSession = 0;

function signal(value: number, timeMs: number, unit: Unit): Signal {
  return { value, quality: 'valid', confidence: 1, sampledAtMs: timeMs, unit };
}

export function rehearsalFrame(seed: number, sessionId: string, timeMs: number): ControlFrame {
  if (!Number.isFinite(seed) || !Number.isFinite(timeMs) || timeMs < 0 || !sessionId) {
    throw new Error('Invalid rehearsal frame input');
  }
  const phase = (Math.trunc(seed) >>> 0) / 0x100000000 * Math.PI * 2;
  const breath = Math.sin(timeMs / 4000 * Math.PI * 2 + phase);
  const pulse = Math.sin(timeMs / 920 * Math.PI * 2 + phase);
  return {
    sessionId, source: 'rehearsal', timeMs,
    signals: {
      breath: signal((breath + 1) / 2, timeMs, 'relative'),
      breathingRate: signal(15, timeMs, 'breaths/min'),
      pulseRate: signal(65, timeMs, 'beats/min'),
      arterialTrace: signal((pulse + 1) / 2, timeMs, 'relative'),
      blink: signal(Math.sin(timeMs / 3100 * Math.PI * 2 + phase) > 0.995 ? 1 : 0, timeMs, 'boolean'),
      talking: signal(0, timeMs, 'boolean'),
    },
  };
}

export function createRehearsalSource(seed = 1): CaptureSource {
  if (!Number.isFinite(seed)) throw new Error('Invalid rehearsal seed');
  let timer: ReturnType<typeof setInterval> | null = null;
  let status: ((status: CaptureStatus) => void) | null = null;
  let sessionId: string | null = null;
  let disposed = false;
  return {
    async start(onFrame, onStatus) {
      if (disposed) throw new Error('Rehearsal source is disposed');
      if (sessionId !== null) throw new Error('Rehearsal source is already running');
      sessionId = `rehearsal-${++nextSession}`;
      status = onStatus;
      const currentSession = sessionId;
      const epoch = performance.now();
      try {
        onStatus({ phase: 'starting', message: 'Starting synthetic rehearsal', sessionId });
        if (sessionId !== currentSession) return;
        onFrame(rehearsalFrame(seed, currentSession, 0));
        if (sessionId !== currentSession) return;
        onStatus({ phase: 'ready', message: 'Synthetic rehearsal', sessionId });
        if (sessionId !== currentSession) return;
        timer = setInterval(() => {
          try {
            onFrame(rehearsalFrame(seed, currentSession, Math.max(0, performance.now() - epoch)));
          } catch {
            if (timer !== null) clearInterval(timer);
            timer = null;
            sessionId = null;
            status = null;
            onStatus({ phase: 'error', message: 'Synthetic rehearsal stopped', sessionId: currentSession });
          }
        }, INTERVAL_MS);
      } catch (error) {
        sessionId = null;
        status = null;
        throw error;
      }
    },
    async stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      const previous = sessionId;
      const notify = status;
      sessionId = null;
      status = null;
      if (previous !== null && notify !== null) {
        notify({ phase: 'stopping', message: 'Stopping synthetic rehearsal', sessionId: previous });
        notify({ phase: 'idle', message: 'Synthetic rehearsal stopped', sessionId: null });
      }
    },
    async dispose() {
      disposed = true;
      await this.stop();
    },
  };
}
