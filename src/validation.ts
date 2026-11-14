import { BODY_JOINTS, CORE_FACE_SHAPES, EXPRESSION_TYPES, FACE_SHAPES, TAKE_LIMITS } from './contracts.ts';
import type { Channel, ControlFrame, ExtendedSignals, Quality, Signal, SignalTrend, Source, Take, TrackingFrame, TrackingPoint, Unit } from './contracts.ts';

export const MAX_TAKE_JSON_BYTES = 16 * 1024 * 1024;

const CHANNEL_UNITS: Record<Channel, Unit> = {
  breath: 'relative', breathingRate: 'breaths/min', pulseRate: 'beats/min',
  arterialTrace: 'relative', blink: 'boolean', talking: 'boolean',
};

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${name}`);
  return value as Record<string, unknown>;
}

function number(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

function identity(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function source(value: unknown): Source {
  if (value !== 'live' && value !== 'rehearsal' && value !== 'local-camera') throw new Error('Invalid source');
  return value;
}

function signal(value: unknown, channel: Channel, frameTime: number, frameSource: Source): Signal {
  const input = record(value, `${channel} signal`);
  const unit = CHANNEL_UNITS[channel];
  if (input.unit !== unit) throw new Error(`Invalid ${channel} unit`);
  const quality = input.quality;
  if (quality !== 'valid' && quality !== 'unstable' && quality !== 'missing' && quality !== 'stale') throw new Error(`Invalid ${channel} quality`);
  let measured: number | null = null;
  if (input.value !== null) {
    measured = number(input.value, unit === 'relative' ? -1e6 : 0, unit === 'relative' ? 1e6 : unit === 'boolean' ? 1 : 1000, `${channel} value`);
    if (unit === 'boolean' && measured !== 0 && measured !== 1) throw new Error(`Invalid ${channel} detection`);
  }
  if ((quality === 'valid' || quality === 'unstable') && measured === null) throw new Error(`Missing ${channel} value`);
  if (quality === 'missing' && measured !== null) throw new Error(`Unexpected ${channel} value`);
  const confidence = input.confidence === null ? null : number(input.confidence, 0, 1, `${channel} confidence`);
  const sampledAtMs = number(input.sampledAtMs, frameTime - Number.MAX_SAFE_INTEGER, frameTime, `${channel} sample time`);
  const provenance = input.provenance === undefined ? (frameSource === 'rehearsal' ? 'synthetic' : 'measured') : input.provenance;
  if (provenance !== 'measured' && provenance !== 'synthetic' && provenance !== 'replayed') throw new Error(`Invalid ${channel} provenance`);
  if ((frameSource !== 'rehearsal' && provenance === 'synthetic') || (frameSource === 'rehearsal' && provenance === 'measured')) throw new Error(`Conflicting ${channel} provenance`);
  if (frameSource === 'local-camera' && measured !== null) throw new Error('Local tracking does not supply physiological or speech-detection signals');
  return { value: measured, quality, confidence, sampledAtMs, unit, provenance };
}

function tracking(value: unknown, frameTime: number): TrackingFrame {
  const input = record(value, 'tracking');
  const sampledAtMs = number(input.sampledAtMs, frameTime - Number.MAX_SAFE_INTEGER, frameTime, 'tracking sample time');
  let face: TrackingFrame['face'] = null;
  let body: TrackingFrame['body'] = null;
  if (input.face !== null) {
    const value = record(input.face, 'tracked face');
    const sourceWeights = record(value.weights, 'face weights');
    const weights = Object.fromEntries(FACE_SHAPES.filter(name => (CORE_FACE_SHAPES as readonly string[]).includes(name) || sourceWeights[name] !== undefined).map(name => [name, number(sourceWeights[name], 0, 1, name)])) as NonNullable<TrackingFrame['face']>['weights'];
    let rotation: NonNullable<TrackingFrame['face']>['rotation'] = null;
    if (value.rotation !== null) {
      if (!Array.isArray(value.rotation) || value.rotation.length !== 4) throw new Error('Invalid head rotation');
      rotation = value.rotation.map(value => number(value, -1, 1, 'head rotation')) as [number, number, number, number];
      if (Math.abs(Math.hypot(...rotation) - 1) > 0.01) throw new Error('Head rotation must be normalized');
    }
    face = { weights, rotation, ...(value.sampledAtMs !== undefined ? { sampledAtMs: number(value.sampledAtMs, frameTime - Number.MAX_SAFE_INTEGER, frameTime, 'face sample time') } : {}) };
  }
  if (input.body !== null) {
    const points = record(input.body, 'tracked body');
    body = {};
    for (const name of BODY_JOINTS) {
      if (points[name] === undefined) continue;
      const point = points[name];
      if (!Array.isArray(point) || point.length !== 4) throw new Error('Invalid body landmark');
      body[name] = point.map((value, index) => number(value, index === 3 ? 0 : -5, index === 3 ? 1 : 5, 'body landmark')) as TrackingPoint;
    }
    if (!Object.keys(body).length) throw new Error('An unavailable body must be null');
  }
  const movement = input.movement === null ? null : number(input.movement, 0, 1, 'body movement');
  if (!body && movement !== null) throw new Error('Body movement requires tracked landmarks');
  if (input.framing === undefined) return { sampledAtMs, face, body, movement };
  const framing = record(input.framing, 'framing');
  const flags = ['face', 'upperBody', 'fullBody', 'tooClose'] as const;
  if (Object.keys(framing).length !== flags.length || flags.some(name => typeof framing[name] !== 'boolean')) throw new Error('Invalid framing');
  const [hasFace, upperBody, fullBody, tooClose] = flags.map(name => framing[name] as boolean);
  if ((hasFace && !face) || ((upperBody || fullBody) && !body) || (fullBody && !upperBody)) throw new Error('Framing contradicts tracked landmarks');
  return { sampledAtMs, face, body, movement, framing: { face: hasFace, upperBody, fullBody, tooClose } };
}

function trend(value: unknown): SignalTrend {
  const input = record(value, 'pulse trend');
  const direction = input.direction;
  if (direction !== 'rising' && direction !== 'falling' && direction !== 'steady') throw new Error('Invalid pulse trend direction');
  const samples = number(input.samples, 2, 100_000, 'pulse trend samples');
  if (!Number.isInteger(samples)) throw new Error('Invalid pulse trend samples');
  return { direction, changePerMinute: number(input.changePerMinute, -1000, 1000, 'pulse trend change'), windowMs: number(input.windowMs, 0, 600_000, 'pulse trend window'), samples };
}

function quality(value: unknown, name: string): Quality {
  if (value !== 'valid' && value !== 'unstable' && value !== 'stale') throw new Error(`Invalid ${name} quality`);
  return value;
}

function extended(value: unknown, frameTime: number): ExtendedSignals {
  const input = record(value, 'extended signals');
  if (Object.keys(input).some(key => key !== 'expression' && key !== 'variability')) throw new Error('Unsupported extended signal');
  const result: ExtendedSignals = {};
  if (input.expression !== undefined) {
    const expression = record(input.expression, 'expression');
    const scores = record(expression.scores, 'expression scores');
    if (Object.keys(scores).some(key => !(EXPRESSION_TYPES as readonly string[]).includes(key))) throw new Error('Unsupported expression type');
    result.expression = {
      scores: Object.fromEntries(Object.entries(scores).map(([key, score]) => [key, number(score, 0, 1, `${key} score`)])),
      quality: quality(expression.quality, 'expression'),
      sampledAtMs: number(expression.sampledAtMs, frameTime - Number.MAX_SAFE_INTEGER, frameTime, 'expression sample time'),
    };
  }
  if (input.variability !== undefined) {
    const variability = record(input.variability, 'variability');
    result.variability = {
      rmssd: number(variability.rmssd, 0, 1e6, 'variability'),
      quality: quality(variability.quality, 'variability'),
      confidence: variability.confidence === null ? null : number(variability.confidence, 0, 1, 'variability confidence'),
      sampledAtMs: number(variability.sampledAtMs, frameTime - Number.MAX_SAFE_INTEGER, frameTime, 'variability sample time'),
    };
  }
  return result;
}

export function validateFrame(value: unknown): ControlFrame {
  const input = record(value, 'control frame');
  const sessionId = identity(input.sessionId, 'session ID');
  const frameSource = source(input.source);
  const timeMs = number(input.timeMs, 0, Number.MAX_SAFE_INTEGER, 'frame time');
  const inputs = record(input.signals, 'signals');
  const signals = {} as Record<Channel, Signal>;
  for (const channel of Object.keys(CHANNEL_UNITS) as Channel[]) signals[channel] = signal(inputs[channel], channel, timeMs, frameSource);
  if (frameSource === 'local-camera' && input.tracking === undefined) throw new Error('Local-camera frames require tracking');
  if (frameSource === 'rehearsal' && input.tracking !== undefined) throw new Error('Synthetic rehearsal does not carry camera tracking');
  let trends: ControlFrame['trends'];
  if (input.trends !== undefined) {
    const value = record(input.trends, 'trends');
    if (Object.keys(value).some(key => key !== 'pulseRate')) throw new Error('Unsupported signal trend');
    if (value.pulseRate !== undefined && signals.pulseRate.value === null) throw new Error('A pulse trend requires a pulse value');
    trends = value.pulseRate === undefined ? {} : { pulseRate: trend(value.pulseRate) };
  }
  if (input.extended !== undefined && frameSource !== 'live') throw new Error('Extended signals come only from SmartSpectra');
  return { sessionId, source: frameSource, timeMs, signals, ...(input.tracking !== undefined ? { tracking: tracking(input.tracking, timeMs) } : {}), ...(trends ? { trends } : {}),
    ...(input.extended !== undefined ? { extended: extended(input.extended, timeMs) } : {}) };
}

export function validateTake(value: unknown): Take {
  const input = record(value, 'take');
  if (input.version !== 1) throw new Error('Unsupported take version');
  const id = identity(input.id, 'take ID');
  const sessionId = identity(input.sessionId, 'session ID');
  const takeSource = source(input.source);
  const seed = number(input.seed, 0, 0xffffffff, 'seed');
  if (!Number.isInteger(seed)) throw new Error('Invalid seed');
  const durationMs = number(input.durationMs, 0, TAKE_LIMITS.seconds * 1000, 'take duration');
  if (!Array.isArray(input.samples) || input.samples.length > TAKE_LIMITS.seconds * TAKE_LIMITS.samplesPerSecond) throw new Error('Invalid take sample count');
  let previous = -1;
  const samples = Array.from(input.samples, value => {
    const frame = validateFrame(value);
    if (frame.source !== takeSource || frame.sessionId !== sessionId) throw new Error('Frame does not belong to this take');
    if (frame.timeMs <= previous || frame.timeMs >= durationMs) throw new Error('Invalid take sample time');
    previous = frame.timeMs;
    return frame;
  });
  return { version: 1, id, source: takeSource, sessionId, seed, durationMs, samples };
}
