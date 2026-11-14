import { TAKE_LIMITS, TRACKING_STALE_MS } from './contracts.ts';
import type { ControlFrame, Source, Take } from './contracts.ts';
import { validateFrame, validateTake } from './validation.ts';

const MAX_MS = TAKE_LIMITS.seconds * 1000;
const SAMPLE_MS = 1000 / TAKE_LIMITS.samplesPerSecond;
const MAX_SAMPLES = TAKE_LIMITS.seconds * TAKE_LIMITS.samplesPerSecond;

function copyFrame(frame: ControlFrame, offset = 0): ControlFrame {
  const copy = validateFrame(frame);
  copy.timeMs -= offset;
  for (const signal of Object.values(copy.signals)) signal.sampledAtMs -= offset;
  if (copy.tracking) copy.tracking.sampledAtMs -= offset;
  if (copy.tracking?.face?.sampledAtMs !== undefined) copy.tracking.face.sampledAtMs -= offset;
  return copy;
}

export class TakeRecorder {
  private samples: ControlFrame[] = [];
  private origin: number | null = null;
  private lastInput = -Infinity;
  private finished = false;
  private capacityReached = false;
  private readonly id: string;
  private readonly source: Source;
  private readonly sessionId: string;
  private readonly seed: number;

  constructor(id: string, source: Source, sessionId: string, seed: number) {
    validateTake({ version: 1, id, source, sessionId, seed, durationMs: 0, samples: [] });
    this.id = id;
    this.source = source;
    this.sessionId = sessionId;
    this.seed = seed;
  }

  get full(): boolean { return this.capacityReached; }
  get count(): number { return this.samples.length; }
  get durationMs(): number { return this.samples.length ? Math.min(MAX_MS, this.samples[this.samples.length - 1].timeMs + SAMPLE_MS) : 0; }

  append(frame: ControlFrame): boolean {
    if (this.finished) throw new Error('Take is finished');
    frame = validateFrame(frame);
    if (frame.source !== this.source || frame.sessionId !== this.sessionId) throw new Error('Frame does not belong to this take');
    if (!Number.isFinite(frame.timeMs) || frame.timeMs < 0 || frame.timeMs <= this.lastInput) throw new Error('Frame time must increase');
    this.lastInput = frame.timeMs;
    if (this.origin === null) this.origin = frame.timeMs;
    const elapsed = frame.timeMs - this.origin;
    if (elapsed >= MAX_MS || this.samples.length >= MAX_SAMPLES) {
      this.capacityReached = true;
      return false;
    }
    const previous = this.samples.at(-1);
    if (previous && Math.floor(elapsed / SAMPLE_MS) <= Math.floor(previous.timeMs / SAMPLE_MS)) return false;
    const sample = copyFrame(frame, this.origin);
    this.samples.push(sample);
    this.capacityReached = this.samples.length >= MAX_SAMPLES || elapsed + SAMPLE_MS >= MAX_MS;
    return true;
  }

  finish(): Take {
    if (this.finished) throw new Error('Take is finished');
    this.finished = true;
    const samples = this.samples.map(frame => copyFrame(frame));
    return { version: 1, id: this.id, source: this.source, sessionId: this.sessionId, seed: this.seed, durationMs: this.durationMs, samples };
  }
}

export function trimTake(take: Take, startMs: number, endMs: number): Take {
  take = validateTake(take);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < startMs || endMs > take.durationMs) throw new Error('Invalid trim range');
  return { ...take, durationMs: endMs - startMs, samples: take.samples.filter(frame => frame.timeMs >= startMs && frame.timeMs < endMs).map(frame => copyFrame(frame, startMs)) };
}

export function frameAt(take: Take, timeMs: number, options: { loop?: boolean } = {}): ControlFrame | null {
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error('Invalid playback time');
  if (take.durationMs <= 0 || (!options.loop && timeMs >= take.durationMs)) return null;
  const target = options.loop ? timeMs % take.durationMs : timeMs;
  let low = 0;
  let high = take.samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (take.samples[middle].timeMs <= target) low = middle + 1;
    else high = middle;
  }
  const frame = take.samples[low - 1];
  return frame && target - frame.timeMs < (frame.tracking ? TRACKING_STALE_MS : SAMPLE_MS) ? copyFrame(frame) : null;
}

export function addTake(takes: readonly Take[], take: Take): Take[] {
  if (takes.length >= TAKE_LIMITS.takes) throw new Error('Take limit reached');
  if (takes.some(existing => existing.id === take.id)) throw new Error('Duplicate take ID');
  return [...takes, validateTake(take)];
}
