'use strict';

const BENCHMARK_LIMIT_MS = 55_000;

function createBenchmarkLimit(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Benchmark callbacks are required');
  const { expire, setTimer = setTimeout, clearTimer = clearTimeout } = options;
  if (typeof expire !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw new TypeError('Benchmark callbacks must be functions');
  let used = false;
  let active = false;
  let timer;

  return {
    begin() {
      if (used) throw new Error('The live benchmark allowance has already been used');
      used = true;
      active = true;
      try {
        timer = setTimer(() => {
          if (!active) return;
          active = false;
          timer = undefined;
          expire();
        }, BENCHMARK_LIMIT_MS);
      } catch (error) {
        active = false;
        timer = undefined;
        throw error;
      }
    },
    end() {
      active = false;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
    },
  };
}

module.exports = { BENCHMARK_LIMIT_MS, createBenchmarkLimit };
