import { TAKE_LIMITS } from './contracts.ts';
import type { Channel, ControlFrame, Signal, Source, Take, Unit } from './contracts.ts';

export const MAX_TAKE_JSON_BYTES = 8 * 1024 * 1024;

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
  if (value !== 'live' && value !== 'rehearsal') throw new Error('Invalid source');
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
  const provenance = input.provenance === undefined ? (frameSource === 'live' ? 'measured' : 'synthetic') : input.provenance;
  if (provenance !== 'measured' && provenance !== 'synthetic' && provenance !== 'replayed') throw new Error(`Invalid ${channel} provenance`);
  if ((frameSource === 'live' && provenance === 'synthetic') || (frameSource === 'rehearsal' && provenance === 'measured')) throw new Error(`Conflicting ${channel} provenance`);
  return { value: measured, quality, confidence, sampledAtMs, unit, provenance };
}

export function validateFrame(value: unknown): ControlFrame {
  const input = record(value, 'control frame');
  const sessionId = identity(input.sessionId, 'session ID');
  const frameSource = source(input.source);
  const timeMs = number(input.timeMs, 0, Number.MAX_SAFE_INTEGER, 'frame time');
  const inputs = record(input.signals, 'signals');
  const signals = {} as Record<Channel, Signal>;
  for (const channel of Object.keys(CHANNEL_UNITS) as Channel[]) signals[channel] = signal(inputs[channel], channel, timeMs, frameSource);
  return { sessionId, source: frameSource, timeMs, signals };
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
