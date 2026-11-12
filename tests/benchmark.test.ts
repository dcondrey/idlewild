import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BENCHMARK_LIMIT_MS, createBenchmarkLimit } = require('../desktop/benchmark-limit.cjs');

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const callbacks: (() => void)[] = [];
  return {
    pending,
    callbacks,
    setTimer(callback: () => void, delay: number) {
      const id = ++nextId;
      pending.set(id, { at: now + delay, callback });
      callbacks.push(callback);
      return id;
    },
    clearTimer(id: number) { pending.delete(id); },
    advance(milliseconds: number) {
      const target = now + milliseconds;
      for (;;) {
        const due = [...pending.entries()].filter(([, entry]) => entry.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = target;
    },
  };
}

test('benchmark stays inert until explicitly begun and expires once at its deadline', () => {
  const clock = fakeClock();
  let expirations = 0;
  const limit = createBenchmarkLimit({ ...clock, expire: () => { expirations++; } });
  clock.advance(55_001);
  assert.equal(expirations, 0);
  assert.equal(clock.pending.size, 0);
  limit.end();
  limit.begin();
  clock.advance(54_999);
  assert.equal(expirations, 0);
  clock.advance(1);
  assert.equal(expirations, 1);
  clock.advance(1);
  assert.equal(expirations, 1);
  assert.equal(clock.pending.size, 0);
  assert.throws(() => limit.begin(), /already been used/);
  limit.end();
  assert.throws(() => limit.begin(), /already been used/);
});

test('manual ending cancels the timer and invalidates a callback already queued for delivery', () => {
  const clock = fakeClock();
  let expirations = 0;
  const limit = createBenchmarkLimit({ ...clock, expire: () => { expirations++; } });
  limit.begin();
  clock.advance(BENCHMARK_LIMIT_MS - 1);
  const queued = clock.callbacks[0];
  limit.end();
  limit.end();
  assert.equal(clock.pending.size, 0);
  queued();
  clock.advance(2);
  assert.equal(expirations, 0);
  assert.throws(() => limit.begin(), /already been used/);
});

test('repeated begin neither extends the deadline nor grants another timer', () => {
  const clock = fakeClock();
  let expirations = 0;
  const limit = createBenchmarkLimit({ ...clock, expire: () => { expirations++; } });
  limit.begin();
  clock.advance(BENCHMARK_LIMIT_MS - 1);
  assert.throws(() => limit.begin(), /already been used/);
  assert.equal(clock.callbacks.length, 1);
  clock.advance(1);
  clock.callbacks[0]();
  assert.equal(expirations, 1);
});

test('timer setup failure consumes the allowance and disables a callback retained by the failed timer', () => {
  let callback: (() => void) | undefined;
  let expirations = 0;
  const limit = createBenchmarkLimit({
    expire: () => { expirations++; },
    setTimer(next: () => void) { callback = next; throw new Error('Timer unavailable'); },
    clearTimer() {},
  });
  assert.throws(() => limit.begin(), /Timer unavailable/);
  callback!();
  limit.end();
  assert.equal(expirations, 0);
  assert.throws(() => limit.begin(), /already been used/);
});

test('expiry failure cannot replay the expiration callback or restore the allowance', () => {
  const clock = fakeClock();
  let expirations = 0;
  const limit = createBenchmarkLimit({ ...clock, expire() { expirations++; throw new Error('Cleanup failed'); } });
  limit.begin();
  assert.throws(() => clock.advance(BENCHMARK_LIMIT_MS), /Cleanup failed/);
  clock.callbacks[0]();
  limit.end();
  assert.equal(expirations, 1);
  assert.throws(() => limit.begin(), /already been used/);
});

test('failed timer cancellation can be retried while queued expiration remains disabled', () => {
  const clock = fakeClock();
  let fail = true;
  let expirations = 0;
  const limit = createBenchmarkLimit({ ...clock, expire: () => { expirations++; }, clearTimer(id: number) {
    if (fail) throw new Error('Cancellation failed');
    clock.clearTimer(id);
  } });
  limit.begin();
  assert.throws(() => limit.end(), /Cancellation failed/);
  clock.callbacks[0]();
  assert.equal(expirations, 0);
  fail = false;
  limit.end();
  assert.equal(clock.pending.size, 0);
  assert.throws(() => limit.begin(), /already been used/);
});

test('invalid benchmark callbacks fail before any deadline can be scheduled', () => {
  for (const options of [undefined, null, [], {}, { expire: true }, { expire() {}, setTimer: null }, { expire() {}, clearTimer: 1 }]) {
    assert.throws(() => createBenchmarkLimit(options), TypeError);
  }
});
