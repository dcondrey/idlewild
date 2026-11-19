import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { CaptureStatus, ControlFrame } from '../src/contracts.ts';

const require = createRequire(import.meta.url);
const { createCaptureController, validateFrame, MAX_WIDTH, MAX_HEIGHT } = require('../desktop/capture.cjs');
const { createMetricsMapper, microseconds, MAX_PACKET_BYTES, MAX_CHANNEL_SAMPLES } = require('../desktop/metrics.cjs');
const { Metrics, decodeMetrics } = require('@smartspectra/node-sdk/messages');
const EPOCH = 1_790_000_000_000;
const request = () => ({ apiKey: 'fixture-key', consent: true, sessionId: 'live-test' });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options: { load?: Promise<void>; start?: Promise<void>; stop?: Promise<void>; throwStart?: boolean; throwDestroy?: boolean; metrics?: string; onPacket?: (event: Record<string, unknown>) => void } = {}) {
  const frames: ControlFrame[] = [];
  const statuses: CaptureStatus[] = [];
  const calls: string[] = [];
  const instances: FakeSDK[] = [];
  let now = EPOCH;
  class FakeSDK {
    handlers = new Map<string, (...args: any[]) => void>();
    options: Record<string, unknown>;
    constructor(configuration: Record<string, unknown>) {
      this.options = configuration;
      instances.push(this);
      calls.push('construct');
    }
    on(event: string, callback: (...args: any[]) => void) { this.handlers.set(event, callback); return this; }
    useCustomInput() { calls.push('custom'); return this; }
    async start() { calls.push('start'); if (options.throwStart) throw new Error('secret fixture key'); await options.start; }
    async stopAsync() { calls.push('stop'); await options.stop; }
    async destroy() { calls.push('destroy'); if (options.throwDestroy) throw new Error('secret fixture key'); }
    sendFrame(...args: unknown[]) { calls.push(`frame:${args[4]}`); return true; }
    emit(event: string, ...args: unknown[]) { this.handlers.get(event)?.(...args); }
  }
  const module = {
    SmartSpectraSDK: FakeSDK,
    MetricType: { CHEST_BREATHING: 0, BREATHING_RATE: 2, PULSE_RATE: 15, ARTERIAL_PRESSURE_TRACE: 16, BLINKING: 12, TALKING: 13 },
    PixelFormat: { kRGBA: 2 }, SmartSpectraLogLevel: { kNone: 4 }, decodeMetrics,
  };
  const controller = createCaptureController({
    loadSDK: async () => { calls.push('load'); await options.load; return module; },
    onFrame: (frame: ControlFrame) => frames.push(frame), onStatus: (status: CaptureStatus) => statuses.push(status), now: () => now,
    ...(options.metrics ? { metrics: options.metrics } : {}), ...(options.onPacket ? { onPacket: options.onPacket } : {}),
  });
  return { controller, calls, instances, frames, statuses, advance: (milliseconds: number) => { now += milliseconds; } };
}

function packet(timestamp = EPOCH * 1000, value = 0) {
  return Metrics.encode({ breathing: { upperTrace: [{ value, stable: true, timestamp }] } }).finish();
}

test('capture is inert without consent and validates identity and bounded key before loading', async () => {
  const fake = fixture();
  assert.deepEqual(fake.calls, []);
  for (const change of [{ consent: false }, { sessionId: '../unsafe' }, { apiKey: 'a'.repeat(513) }, { apiKey: 'with space' }]) {
    await assert.rejects(fake.controller.start({ ...request(), ...change }));
  }
  assert.deepEqual(fake.calls, []);
  await fake.controller.dispose();
});

test('explicit start uses custom RGBA input, no telemetry, no accumulated output or insight request', async () => {
  const fake = fixture();
  await fake.controller.start(request());
  assert.deepEqual(fake.calls, ['load', 'construct', 'custom', 'start']);
  assert.deepEqual(fake.instances[0].options, {
    apiKey: 'fixture-key', requestedMetrics: [0, 2, 15, 16, 12, 13], enableTelemetry: false, enableAccumulatedOutput: false, logLevel: 4,
  });
  assert.equal(fake.instances[0].handlers.has('insight'), false);
  await assert.rejects(fake.controller.start(request()));
  await fake.controller.stop();
  assert.deepEqual(fake.calls.slice(-2), ['stop', 'destroy']);
  await fake.controller.dispose();
});

test('stop cancels an in-flight SDK load before construction', async () => {
  const loading = deferred();
  const fake = fixture({ load: loading.promise });
  const starting = fake.controller.start(request());
  const rejected = assert.rejects(starting, /cancelled/);
  await Promise.resolve();
  const stopping = fake.controller.stop();
  loading.resolve();
  await Promise.all([rejected, stopping]);
  assert.equal(fake.instances.length, 0);
  assert.equal(fake.statuses.at(-1)?.phase, 'idle');
  await fake.controller.dispose();
});

test('stop drains partial startup and concurrent stops do not double-destroy', async () => {
  const startingGate = deferred();
  const entered = deferred();
  const fake = fixture({ start: startingGate.promise });
  const starting = fake.controller.start(request());
  const rejected = assert.rejects(starting, /cancelled/);
  setImmediate(entered.resolve);
  await entered.promise;
  assert.equal(fake.instances.length, 1);
  const stop1 = fake.controller.stop();
  const stop2 = fake.controller.stop();
  startingGate.resolve();
  await Promise.all([rejected, stop1, stop2]);
  assert.equal(fake.calls.filter(call => call === 'destroy').length, 1);
  await fake.controller.dispose();
});

test('awaited shutdown prevents replacement and late callbacks cannot mutate a new session', async () => {
  const draining = deferred();
  const fake = fixture({ stop: draining.promise });
  await fake.controller.start(request());
  const previous = fake.instances[0];
  const stopping = fake.controller.stop();
  previous.emit('metrics', packet());
  await assert.rejects(fake.controller.start(request()));
  assert.equal(fake.frames.length, 0);
  draining.resolve();
  await stopping;
  await fake.controller.start({ ...request(), sessionId: 'replacement' });
  previous.emit('error', 4, 'secret fixture key');
  previous.emit('metrics', packet());
  assert.equal(fake.statuses.at(-1)?.sessionId, 'replacement');
  assert.equal(fake.frames.length, 0);
  await fake.controller.dispose();
});

test('failed startup cleans up and never exposes vendor exception contents', async () => {
  const fake = fixture({ throwStart: true });
  await assert.rejects(fake.controller.start(request()), error => !String(error).includes('secret'));
  assert.deepEqual(fake.calls.slice(-2), ['stop', 'destroy']);
  assert.ok(fake.statuses.every(status => !status.message.includes('secret')));
  await fake.controller.dispose();
});

test('destroy failure blocks replacement and permits an explicit cleanup retry', async () => {
  const options = { throwDestroy: true };
  const fake = fixture(options);
  await fake.controller.start(request());
  await assert.rejects(fake.controller.stop(), /shutdown failed/);
  await assert.rejects(fake.controller.start(request()));
  options.throwDestroy = false;
  await fake.controller.stop();
  await fake.controller.start(request());
  await fake.controller.dispose();
});

test('frame bounds, RGBA allocation, epochs and submission rate are enforced', async () => {
  const make = (width: number, height: number) => ({ bytes: new Uint8Array(width * height * 4), width, height, stride: width * 4, timestampUs: EPOCH * 1000 });
  for (const width of [MAX_WIDTH - 1, MAX_WIDTH]) assert.doesNotThrow(() => validateFrame(make(width, MAX_HEIGHT)));
  assert.throws(() => validateFrame(make(MAX_WIDTH + 1, MAX_HEIGHT)));
  for (const height of [MAX_HEIGHT - 1, MAX_HEIGHT]) assert.doesNotThrow(() => validateFrame(make(1, height)));
  assert.throws(() => validateFrame(make(1, MAX_HEIGHT + 1)));
  for (const bytes of [new Uint8Array(3), new Uint8Array(5)]) assert.throws(() => validateFrame({ ...make(1, 1), bytes }));
  assert.throws(() => validateFrame({ ...make(1, 1), stride: 5 }));
  assert.throws(() => validateFrame({ ...make(1, 1), timestampUs: Number.MAX_SAFE_INTEGER + 1 }));
  const fake = fixture();
  assert.equal(fake.controller.sendFrame(make(1, 1)), false);
  await fake.controller.start(request());
  assert.throws(() => fake.controller.sendFrame({ ...make(1, 1), timestampUs: 1000 }), /epoch/);
  assert.equal(fake.controller.sendFrame(make(1, 1)), true);
  assert.throws(() => fake.controller.sendFrame(make(1, 1)), /increasing/);
  assert.equal(fake.controller.sendFrame({ ...make(1, 1), timestampUs: EPOCH * 1000 + 1 }), false);
  fake.advance(40);
  const at = (offsetUs: number) => ({ ...make(1, 1), timestampUs: EPOCH * 1000 + offsetUs });
  assert.equal(fake.controller.sendFrame(at(40000)), true);
  fake.advance(20);
  assert.equal(fake.controller.sendFrame(at(40000 + 28570)), false, 'capture spacing below 35 fps is dropped');
  assert.equal(fake.controller.sendFrame(at(40000 + 28571)), true, 'arrival jitter does not drop a frame whose capture spacing is valid');
  fake.advance(5);
  assert.equal(fake.controller.sendFrame(at(200000)), false, 'a burst of late frames is bounded by arrival spacing');
  fake.advance(10);
  assert.equal(fake.controller.sendFrame(at(200001)), true);
  assert.equal(fake.calls.filter(call => call === 'frame:2').length, 4);
  await fake.controller.dispose();
});

test('protobuf samples distinguish absent from zero and preserve confidence, instability and epoch precision', () => {
  const mapper = createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n });
  const decoded = decodeMetrics(Metrics.encode({
    breathing: { upperTrace: [{ value: 0, timestamp: EPOCH * 1000, stable: true }], rate: [{ value: 15, confidence: 44, stable: true, timestamp: EPOCH * 1000 }] },
    face: { blinking: [{ detected: false, timestamp: EPOCH * 1000, stable: true }] },
  }).finish());
  const frame = mapper.ingest(decoded, 10);
  assert.equal(frame.signals.breath.value, 0);
  assert.equal(frame.signals.breath.confidence, null);
  assert.equal(frame.signals.breath.quality, 'unstable');
  assert.equal(frame.signals.breath.sampledAtMs, 0);
  assert.equal(frame.signals.breathingRate.quality, 'unstable');
  assert.equal(frame.signals.breathingRate.confidence, 0.44);
  assert.equal(frame.signals.blink.value, 0);
  assert.equal(frame.signals.pulseRate.value, null);
  assert.equal(frame.signals.pulseRate.quality, 'missing');
  assert.equal(frame.signals.breath.provenance, 'measured');
});

test('measurement arrays deduplicate and preserve acquisition age across packets and staleness boundary', () => {
  const mapper = createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n });
  const sample = (offset: number, value: number) => ({ value, stable: true, timestamp: EPOCH * 1000 + offset });
  assert.equal(mapper.ingest({ breathing: { upperTrace: [sample(1000, 1), sample(0, 2)] } }, 1).signals.breath.value, -1);
  assert.equal(mapper.ingest({ breathing: { upperTrace: [sample(0, 3), sample(1000, 4)] } }, 2).signals.breath.value, -1);
  assert.equal(mapper.snapshot(1500).signals.breath.quality, 'unstable');
  assert.equal(mapper.snapshot(1501).signals.breath.quality, 'stale');
  assert.equal(mapper.snapshot(1502).signals.breath.sampledAtMs, 1);
  assert.throws(() => mapper.snapshot(1501));
});

test('unscaled SDK traces normalize to the same bounded shape regardless of offset and gain', () => {
  const run = (offset: number, gain: number) => {
    const mapper = createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n });
    const values: number[] = [];
    for (let step = 0; step < 300; step++) {
      const timeMs = step * 100;
      const frame = mapper.ingest({ breathing: { upperTrace: [{ value: offset + gain * Math.sin(2 * Math.PI * timeMs / 4000), stable: true, timestamp: EPOCH * 1000 + timeMs * 1000 }] } }, timeMs);
      values.push(frame.signals.breath.value);
    }
    return values;
  };
  const reference = run(0, 1);
  const shifted = run(-4200, 0.003);
  assert.ok(reference.every(value => value >= -1 && value <= 1));
  assert.ok(Math.max(...reference.slice(100)) > 0.95 && Math.min(...reference.slice(100)) < -0.95);
  for (let index = 100; index < reference.length; index++) assert.ok(Math.abs(reference[index] - shifted[index]) < 1e-6);
  const flat = createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n });
  for (let step = 0; step < 5; step++) assert.equal(flat.ingest({ breathing: { upperTrace: [{ value: 7, stable: true, timestamp: EPOCH * 1000 + step * 1000 }] } }, step).signals.breath.value, 0);
});

test('SDK breath traces and rates carry no stable flag and are valid once warmed up; an explicit false stays unstable', () => {
  const mapper = createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n });
  const quality = (timeMs: number, stable?: boolean) => mapper.ingest({ breathing: { upperTrace: [{ value: Math.sin(timeMs / 700), timestamp: EPOCH * 1000 + timeMs * 1000, ...(stable === undefined ? {} : { stable }) }] } }, timeMs).signals.breath.quality;
  for (let timeMs = 0; timeMs < 6000; timeMs += 250) quality(timeMs);
  assert.equal(quality(6000), 'valid');
  assert.equal(quality(6250, false), 'unstable');
});

test('normalized breath reports unstable until the trace window has warmed up', () => {
  const mapper = createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n });
  const quality = (timeMs: number) => mapper.ingest({ breathing: { upperTrace: [{ value: Math.sin(timeMs / 700), stable: true, timestamp: EPOCH * 1000 + timeMs * 1000 }] } }, timeMs).signals.breath.quality;
  for (let timeMs = 0; timeMs < 5000; timeMs += 250) assert.equal(quality(timeMs), 'unstable');
  assert.equal(mapper.calibrating(), true);
  assert.equal(quality(5000), 'valid');
  assert.equal(mapper.calibrating(), false);
});

test('extended SDK expression scores and variability map to bounded optional readings and expire', () => {
  const mapper = createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n });
  const decoded = decodeMetrics(Metrics.encode({
    face: { expression: [{ stable: true, timestamp: EPOCH * 1000, scores: [{ type: 5, confidence: 72 }, { type: 8, confidence: 10 }, { type: 0, confidence: 99 }] }] },
    cardio: { hrv: [{ rmssd: 41.5, confidence: 49, stable: true, timestamp: EPOCH * 1000 }] },
  }).finish());
  const frame = mapper.ingest(decoded, 10);
  assert.deepEqual(frame.extended.expression.scores, { happy: 0.72, surprise: 0.1 });
  assert.equal(frame.extended.expression.quality, 'valid');
  assert.equal(frame.extended.variability.rmssd, 41.5);
  assert.equal(frame.extended.variability.quality, 'unstable');
  assert.equal(mapper.snapshot(1499).extended.expression.quality, 'valid');
  assert.equal(mapper.snapshot(1500).extended.expression.quality, 'stale');
  assert.equal(createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n }).ingest({}, 1).extended, undefined);
  assert.deepEqual(createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n }).ingest({ face: { expression: [{ stable: true, timestamp: EPOCH * 1000, scores: [{ type: 5, confidence: 101 }] }] }, cardio: { hrv: [{ rmssd: 2e6, stable: true, timestamp: EPOCH * 1000 }] } }, 10).extended, { expression: { scores: {}, quality: 'valid', sampledAtMs: 0 } });
});

test('unsafe, future, strict-clock, absent and oversized measurements never become valid controls', () => {
  const mapper = () => createMetricsMapper({ sessionId: 's', epochUs: BigInt(EPOCH) * 1000n });
  const sample = { value: 1, stable: true, timestamp: EPOCH * 1000 };
  for (const value of [NaN, Infinity, 1e6 + 1]) assert.throws(() => mapper().ingest({ breathing: { upperTrace: [{ ...sample, value }] } }, 10));
  for (const confidence of [-1, 101, NaN]) assert.throws(() => mapper().ingest({ breathing: { rate: [{ ...sample, confidence }] } }, 10));
  for (const timestamp of [1, EPOCH * 1000 + 11000]) assert.equal(mapper().ingest({ breathing: { upperTrace: [{ ...sample, timestamp }] } }, 10).signals.breath.value, null);
  assert.equal(mapper().ingest({ breathing: { upperTrace: [{ timestamp: EPOCH * 1000 }] } }, 10).signals.breath.value, null);
  assert.equal(mapper().ingest({ breathing: { breathingRateStrict: sample } }, 10).signals.breathingRate.value, null);
  for (const count of [MAX_CHANNEL_SAMPLES - 1, MAX_CHANNEL_SAMPLES]) assert.doesNotThrow(() => mapper().ingest({ breathing: { upperTrace: Array(count).fill(sample) } }, 10));
  assert.throws(() => mapper().ingest({ breathing: { upperTrace: Array(MAX_CHANNEL_SAMPLES + 1).fill(sample) } }, 10));
  assert.throws(() => microseconds(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => microseconds(-1));
  const wide = 9007199254740993n;
  assert.equal(microseconds({ low: Number(BigInt.asIntN(32, wide)), high: Number(wide >> 32n), unsigned: false }), wide);
});

test('native metric callback uses measurement epochs, discards event timestamps and sanitizes errors', async () => {
  const fake = fixture();
  await fake.controller.start(request());
  fake.advance(50);
  fake.instances[0].emit('metrics', packet(EPOCH * 1000, 0.25), 9007199254740992);
  assert.equal(fake.frames[0].timeMs, 50);
  assert.equal(fake.frames[0].signals.breath.sampledAtMs, 0);
  assert.equal(fake.statuses.at(-1)?.phase, 'warming');
  assert.match(fake.statuses.at(-1)?.message ?? '', /breathing range/);
  fake.instances[0].emit('validationStatus', 5, 0, 'secret fixture key');
  assert.equal(fake.statuses.at(-1)?.phase, 'poor-signal');
  fake.instances[0].emit('error', 4, 'secret fixture key', false);
  assert.ok(fake.statuses.every(status => !status.message.includes('secret')));
  assert.match(fake.statuses.at(-1)?.message ?? '', /credits/);
  await fake.controller.stop();
  await fake.controller.dispose();
});

test('metric sets are allow-listed and the optional packet log sees the session epoch and raw bytes before decoding', async () => {
  assert.throws(() => fixture({ metrics: 'everything' }), /metric set/);
  const rejected = fixture();
  await assert.rejects(rejected.controller.start({ ...request(), metrics: 'everything' }));
  assert.deepEqual(rejected.calls, []);
  const perSession = fixture();
  await perSession.controller.start({ ...request(), metrics: 'core' });
  assert.deepEqual(perSession.instances[0].options.requestedMetrics, [0, 2, 15]);
  await perSession.controller.dispose();
  const events: Record<string, unknown>[] = [];
  const fake = fixture({ metrics: 'core', onPacket: event => events.push(event) });
  await fake.controller.start(request());
  assert.deepEqual(fake.instances[0].options.requestedMetrics, [0, 2, 15]);
  const bytes = packet(EPOCH * 1000, 0.5);
  fake.instances[0].emit('metrics', bytes);
  assert.deepEqual(events.map(event => event.kind), ['session', 'packet']);
  assert.equal(events[0].epochUs, String(EPOCH * 1000));
  assert.equal(events[1].bytes, bytes);
  await fake.controller.dispose();
});

test('malformed and oversized native packets terminate capture without passing invalid frames', async () => {
  for (const bytes of [new Uint8Array([255]), new Uint8Array(MAX_PACKET_BYTES + 1)]) {
    const fake = fixture();
    await fake.controller.start(request());
    fake.instances[0].emit('metrics', bytes);
    assert.equal(fake.frames.length, 0);
    assert.equal(fake.statuses.at(-1)?.phase, 'error');
    await fake.controller.stop();
    await fake.controller.dispose();
  }
});

test('packet log writes ordered records off the main thread, truncates at its byte limit and flushes on close', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createPacketLog, packetLogPath } = require('../desktop/packet-log.cjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'idlewild-packets-'));
  try {
    assert.throws(() => packetLogPath('../outside.jsonl', root), /under \.local/);
    assert.throws(() => packetLogPath('.local/log.json', root), /under \.local/);
    const session = { kind: 'session', sessionId: 's', epochUs: '1', metrics: ['CHEST_BREATHING'] };
    const packet = (timeMs: number) => ({ kind: 'packet', timeMs, bytes: new Uint8Array([timeMs, 2, 3]) });
    const sizeOf = (record: object) => Buffer.byteLength(`${JSON.stringify(record)}\n`);
    const sessionBytes = sizeOf(session);
    const packetBytes = sizeOf({ kind: 'packet', timeMs: 1, bytes: Buffer.from([1, 2, 3]).toString('base64') });
    const lines = async (maxBytes: number, count: number) => {
      const file = packetLogPath(`.local/${maxBytes}.jsonl`, root);
      const log = createPacketLog(file, { maxBytes });
      log.record(session);
      for (let index = 1; index <= count; index++) log.record(packet(index));
      await log.close();
      log.record(packet(9));
      await log.close();
      return (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    };
    const exact = await lines(sessionBytes + 2 * packetBytes, 2);
    assert.deepEqual(exact.map(record => record.timeMs ?? record.kind), ['session', 1, 2], 'records at exactly the limit are kept in order');
    const over = await lines(sessionBytes + 2 * packetBytes - 1, 2);
    assert.deepEqual(over.map(record => record.timeMs ?? record.kind), ['session', 1, 'truncated']);
    assert.equal(over[2].atBytes, sessionBytes + packetBytes);
    const roomy = await lines(sessionBytes + 2 * packetBytes + 1, 3);
    assert.deepEqual(roomy.map(record => record.timeMs ?? record.kind), ['session', 1, 2, 'truncated'], 'nothing is written after truncation or close');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
