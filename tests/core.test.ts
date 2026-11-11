import test from 'node:test';
import assert from 'node:assert/strict';
import { TAKE_LIMITS } from '../src/contracts.ts';
import { createRehearsalSource, rehearsalFrame } from '../src/rehearsal.ts';
import { addTake, frameAt, TakeRecorder, trimTake } from '../src/recording.ts';
import { validateFrame, validateTake } from '../src/validation.ts';

test('synthetic frames are seeded, deterministic and explicitly identified', () => {
  const frame = rehearsalFrame(10, 'session', 500);
  assert.deepEqual(frame, rehearsalFrame(10, 'session', 500));
  assert.notDeepEqual(frame.signals, rehearsalFrame(11_000_000, 'session', 500).signals);
  assert.equal(frame.source, 'rehearsal');
  assert.equal(frame.sessionId, 'session');
  assert.throws(() => rehearsalFrame(1, 'session', -1));
});

test('source stops and disposes without emitting further frames', async () => {
  const source = createRehearsalSource(3);
  const frames: number[] = [];
  const phases: string[] = [];
  await source.start(frame => frames.push(frame.timeMs), status => phases.push(status.phase));
  await new Promise(resolve => setTimeout(resolve, 120));
  await source.stop();
  const count = frames.length;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.ok(count >= 2);
  assert.equal(frames.length, count);
  assert.ok(frames.every((time, index) => index === 0 || time > frames[index - 1]));
  assert.deepEqual(phases, ['starting', 'ready', 'stopping', 'idle']);
  await source.dispose();
  await assert.rejects(source.start(() => {}, () => {}));
});

test('reentrant stop during startup leaves no timer', async () => {
  const source = createRehearsalSource();
  let count = 0;
  await source.start(() => { count++; void source.stop(); }, () => {});
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(count, 1);
  await source.dispose();
});

test('recorder bounds duration and rate and rejects mixed or non-monotonic frames', () => {
  const recorder = new TakeRecorder('one', 'rehearsal', 's', 1);
  assert.equal(recorder.append(rehearsalFrame(1, 's', 0)), true);
  assert.equal(recorder.append(rehearsalFrame(1, 's', 49)), false);
  assert.equal(recorder.full, false);
  assert.equal(recorder.append(rehearsalFrame(1, 's', 50)), true);
  assert.throws(() => recorder.append(rehearsalFrame(1, 'other', 51)));
  assert.throws(() => recorder.append(rehearsalFrame(1, 's', 50)));
  assert.equal(recorder.append(rehearsalFrame(1, 's', 179999)), true);
  assert.equal(recorder.append(rehearsalFrame(1, 's', 180000)), false);
  const take = recorder.finish();
  assert.equal(take.durationMs, 180000);
  assert.throws(() => recorder.finish());
  assert.throws(() => recorder.append(rehearsalFrame(1, 's', 180001)));
});

test('sample and take limits apply at their boundaries', () => {
  const recorder = new TakeRecorder('one', 'rehearsal', 's', 1);
  const max = TAKE_LIMITS.seconds * TAKE_LIMITS.samplesPerSecond;
  for (let i = 0; i < max; i++) assert.equal(recorder.append(rehearsalFrame(1, 's', i * 50)), true);
  assert.equal(recorder.full, true);
  assert.equal(recorder.append(rehearsalFrame(1, 's', max * 50)), false);
  const take = recorder.finish();
  assert.equal(take.samples.length, max);
  let takes = [] as typeof take[];
  for (let i = 0; i < TAKE_LIMITS.takes; i++) takes = addTake(takes, { ...take, id: String(i) });
  assert.throws(() => addTake(takes, { ...take, id: 'extra' }));
  assert.throws(() => addTake([take], take));
});

test('recording, trimming and looping keep sample age on the playback clock', () => {
  const recorder = new TakeRecorder('one', 'rehearsal', 's', 1);
  for (const time of [10000, 10050, 10100]) {
    const frame = rehearsalFrame(1, 's', time);
    frame.signals.breath.sampledAtMs = time - 1000;
    recorder.append(frame);
    frame.signals.breath.value = -1;
  }
  const take = recorder.finish();
  assert.deepEqual(take.samples.map(frame => frame.timeMs), [0, 50, 100]);
  assert.deepEqual(take.samples.map(frame => frame.signals.breath.sampledAtMs), [-1000, -950, -900]);
  assert.notEqual(take.samples[0].signals.breath.value, -1);
  const trimmed = trimTake(take, 50, 125);
  assert.deepEqual(trimmed.samples.map(frame => frame.signals.breath.sampledAtMs), [-1000, -950]);
  for (const frame of trimmed.samples) assert.equal(frame.timeMs - frame.signals.breath.sampledAtMs, 1000);
  const looped = frameAt(trimmed, trimmed.durationMs, { loop: true })!;
  assert.equal(looped.timeMs - looped.signals.breath.sampledAtMs, 1000);
  looped.signals.breath.value = -1;
  assert.notEqual(trimmed.samples[0].signals.breath.value, -1);
  assert.deepEqual(validateTake(trimmed), trimmed);
});

test('invalid frames do not advance recorder state and an empty take is explicit', () => {
  const recorder = new TakeRecorder('one', 'rehearsal', 's', 1);
  const invalid = rehearsalFrame(1, 's', 100);
  invalid.signals.blink.value = 0.5;
  assert.throws(() => recorder.append(invalid));
  assert.equal(recorder.append(rehearsalFrame(1, 's', 50)), true);
  assert.equal(recorder.finish().samples[0].timeMs, 0);
  const empty = new TakeRecorder('empty', 'rehearsal', 's', 1).finish();
  assert.equal(empty.durationMs, 0);
  assert.equal(frameAt(empty, 0, { loop: true }), null);
});

test('frame validation distinguishes missing, stale and zero and strips foreign fields', () => {
  const frame = rehearsalFrame(1, 's', 10);
  frame.signals.breath = { ...frame.signals.breath, value: null, quality: 'missing' };
  frame.signals.arterialTrace = { ...frame.signals.arterialTrace, value: null, quality: 'stale' };
  frame.signals.blink.value = 0;
  const input = { ...frame, apiKey: 'must-not-survive', signals: { ...frame.signals, unsupported: {} } };
  const validated = validateFrame(input);
  assert.equal(validated.signals.breath.value, null);
  assert.equal(validated.signals.arterialTrace.quality, 'stale');
  assert.equal(validated.signals.blink.value, 0);
  assert.equal(validated.signals.blink.provenance, 'synthetic');
  assert.equal('apiKey' in validated, false);
  assert.equal('unsupported' in validated.signals, false);
  frame.signals.blink.value = 1;
  assert.equal(validated.signals.blink.value, 0);
});

test('frame validation rejects malformed values and incompatible provenance', () => {
  const mutations = [
    (frame: ReturnType<typeof rehearsalFrame>) => { frame.signals.breath.value = NaN; },
    (frame: ReturnType<typeof rehearsalFrame>) => { frame.signals.breath.value = null; },
    (frame: ReturnType<typeof rehearsalFrame>) => { frame.signals.breath.quality = 'missing'; },
    (frame: ReturnType<typeof rehearsalFrame>) => { frame.signals.breath.unit = 'boolean'; },
    (frame: ReturnType<typeof rehearsalFrame>) => { frame.signals.breath.confidence = 1.01; },
    (frame: ReturnType<typeof rehearsalFrame>) => { frame.signals.breath.confidence = -0.01; },
    (frame: ReturnType<typeof rehearsalFrame>) => { frame.signals.breath.sampledAtMs = 101; },
    (frame: ReturnType<typeof rehearsalFrame>) => { frame.signals.breath.provenance = 'measured'; },
    (frame: ReturnType<typeof rehearsalFrame>) => { frame.signals.talking.value = 0.5; },
  ];
  for (const mutate of mutations) {
    const frame = rehearsalFrame(1, 's', 100);
    mutate(frame);
    assert.throws(() => validateFrame(frame));
  }
  for (const value of [null, [], {}, { signals: {} }]) assert.throws(() => validateFrame(value));
  const frame = rehearsalFrame(1, 's', 100);
  for (const value of [999999, 1000000]) {
    frame.signals.breath.value = value;
    assert.equal(validateFrame(frame).signals.breath.value, value);
  }
  frame.signals.breath.value = 1000001;
  assert.throws(() => validateFrame(frame));
});

test('take validation enforces version, identity, time, duration and sample bounds', () => {
  const recorder = new TakeRecorder('one', 'rehearsal', 's', 1);
  recorder.append(rehearsalFrame(1, 's', 0));
  recorder.append(rehearsalFrame(1, 's', 50));
  const take = recorder.finish();
  for (const id of ['a'.repeat(127), 'a'.repeat(128)]) assert.equal(validateTake({ ...take, id }).id, id);
  for (const id of ['', 'a'.repeat(129), '../path', '\nsecret']) assert.throws(() => validateTake({ ...take, id }));
  for (const seed of [0, 0xfffffffe, 0xffffffff]) assert.equal(validateTake({ ...take, seed }).seed, seed);
  for (const seed of [-1, 0.5, 0x100000000]) assert.throws(() => validateTake({ ...take, seed }));
  for (const durationMs of [179999, 180000]) assert.equal(validateTake({ ...take, durationMs }).durationMs, durationMs);
  for (const durationMs of [180001, -1, 0, 50]) assert.throws(() => validateTake({ ...take, durationMs }));
  assert.throws(() => validateTake({ ...take, version: 2 }));
  assert.throws(() => validateTake({ ...take, source: 'live' }));
  assert.throws(() => validateTake({ ...take, sessionId: 'other' }));
  assert.throws(() => validateTake({ ...take, samples: [...take.samples].reverse() }));
  assert.throws(() => validateTake({ ...take, samples: [take.samples[0], take.samples[0]] }));
  assert.throws(() => validateTake({ ...take, samples: new Array(2) }));
  const maximum = Array.from({ length: 3600 }, (_, index) => rehearsalFrame(1, 's', index * 50));
  for (const count of [3599, 3600]) assert.equal(validateTake({ ...take, durationMs: 180000, samples: maximum.slice(0, count) }).samples.length, count);
  assert.throws(() => validateTake({ ...take, durationMs: 180000, samples: [...maximum, maximum[3599]] }));
});

test('trim, scrub and loop preserve missing intervals', () => {
  const recorder = new TakeRecorder('one', 'rehearsal', 's', 1);
  for (const time of [0, 50, 200]) recorder.append(rehearsalFrame(1, 's', time));
  const take = recorder.finish();
  assert.equal(frameAt(take, 99)?.timeMs, 50);
  assert.equal(frameAt(take, 100), null);
  assert.equal(frameAt(take, 199), null);
  assert.equal(frameAt(take, 200)?.timeMs, 200);
  assert.equal(frameAt(take, 250), null);
  assert.equal(frameAt(take, 250, { loop: true })?.timeMs, 0);
  const trimmed = trimTake(take, 25, 225);
  assert.deepEqual(trimmed.samples.map(frame => frame.timeMs), [25, 175]);
  assert.equal(frameAt(trimmed, 0), null);
  assert.throws(() => trimTake(take, 0, 251));
});
