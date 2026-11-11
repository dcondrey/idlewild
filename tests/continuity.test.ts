import test from 'node:test';
import assert from 'node:assert/strict';
import { createBreathContinuity } from '../src/continuity.ts';
import { rehearsalFrame } from '../src/rehearsal.ts';

function frame(time: number, talking = false, session = 's') {
  const input = rehearsalFrame(1, session, time);
  input.signals.talking.value = talking ? 1 : 0;
  return input;
}

function prepare(end = 2000) {
  const continuity = createBreathContinuity();
  for (let time = 0; time <= end; time += 50) continuity.update(frame(time), true);
  return continuity;
}

test('continuity needs two seconds of fresh quiet samples and never invents a rate', () => {
  const missing = createBreathContinuity();
  assert.equal(missing.update(frame(0, true), true).signals.breath.provenance, 'synthetic');
  const short = prepare(1950);
  assert.equal(short.update(frame(2000, true), true).signals.breath.provenance, 'synthetic');
  const ready = prepare();
  const input = frame(2050, true);
  const output = ready.update(input, true);
  assert.equal(output.signals.breath.provenance, 'replayed');
  assert.equal(output.signals.breath.confidence, null);
  assert.deepEqual(output.signals.breathingRate, { ...input.signals.breathingRate, provenance: 'synthetic' });
  assert.equal(input.signals.breath.provenance, undefined);
});

test('speech replay fades to neutral and expires at ten seconds', () => {
  const continuity = prepare();
  continuity.update(frame(2050, true), true);
  const before = continuity.update(frame(12049, true), true);
  assert.equal(before.signals.breath.provenance, 'replayed');
  assert.ok(Math.abs(before.signals.breath.value!) <= 0.002);
  for (const time of [12050, 12051]) {
    const output = continuity.update(frame(time, true), true);
    assert.equal(output.signals.breath.value, null);
    assert.equal(output.signals.breath.quality, 'missing');
    assert.equal(output.signals.breath.provenance, 'replayed');
  }
  const recovery = continuity.update(frame(12100), true);
  assert.equal(recovery.signals.breath.value, 0);
  assert.equal(recovery.signals.breath.provenance, 'replayed');
});

test('valid recovery blends for 500 ms and then restores original provenance', () => {
  const continuity = prepare();
  const replay = continuity.update(frame(2050, true), true);
  const start = continuity.update(frame(2100), true);
  assert.equal(start.signals.breath.value, replay.signals.breath.value);
  for (const time of [2350, 2599]) assert.equal(continuity.update(frame(time), true).signals.breath.provenance, 'replayed');
  const recovered = frame(2600);
  assert.equal(continuity.update(recovered, true).signals.breath.value, recovered.signals.breath.value);
  assert.equal(continuity.update(frame(2601), true).signals.breath.provenance, 'synthetic');
});

test('disable, session changes, reversed clocks and explicit reset discard the cache', () => {
  for (const reset of [
    (continuity: ReturnType<typeof prepare>) => { continuity.update(frame(2050), false); },
    (continuity: ReturnType<typeof prepare>) => { continuity.update(frame(2050, false, 'other'), true); },
    (continuity: ReturnType<typeof prepare>) => { continuity.update(frame(0), true); },
    (continuity: ReturnType<typeof prepare>) => { continuity.reset(); },
  ]) {
    const continuity = prepare();
    reset(continuity);
    assert.equal(continuity.update(frame(2100, true), true).signals.breath.provenance, 'synthetic');
  }
});

test('missing talking, stale breath, repeated samples and quiet gaps cannot seed fallback', () => {
  for (const mode of ['talking-missing', 'stale', 'repeated', 'gap']) {
    const continuity = createBreathContinuity();
    for (let time = 0; time <= 2500; time += 50) {
      if (mode === 'gap' && time > 1000 && time < 1500) continue;
      const input = frame(time);
      if (mode === 'talking-missing') input.signals.talking = { ...input.signals.talking, value: null, quality: 'missing' };
      if (mode === 'stale') input.signals.breath.sampledAtMs = time - 1500;
      if (mode === 'repeated') input.signals.breath.sampledAtMs = 0;
      continuity.update(input, true);
    }
    assert.equal(continuity.update(frame(2550, true), true).signals.breath.provenance, 'synthetic', mode);
  }
});

test('the quiet cache retains only the most recent eight seconds', () => {
  const continuity = createBreathContinuity();
  for (let time = 0; time <= 12000; time += 50) {
    const input = frame(time);
    input.signals.breath.value = time / 12000;
    continuity.update(input, true);
  }
  assert.equal(continuity.update(frame(12050, true), true).signals.breath.value, 4000 / 12000);
});
