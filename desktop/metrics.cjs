'use strict';

const MAX_PACKET_BYTES = 256 * 1024;
const MAX_CHANNEL_SAMPLES = 4096;
const STALE_MS = 1500;
const CHANNELS = Object.freeze({
  breath: ['breathing', 'upperTrace', 'relative', 0],
  breathingRate: ['breathing', 'rate', 'breaths/min', 45],
  pulseRate: ['cardio', 'pulseRate', 'beats/min', 40],
  arterialTrace: ['cardio', 'arterialPressureTrace', 'relative', 40],
  blink: ['face', 'blinking', 'boolean', 0],
  talking: ['face', 'talking', 'boolean', 0],
});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function microseconds(value) {
  if (typeof value === 'bigint') {
    if (value < 0n || value > 9223372036854775807n) throw new Error('Invalid measurement timestamp');
    return value;
  }
  if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (value && Number.isInteger(value.low) && Number.isInteger(value.high) &&
      value.low >= -2147483648 && value.low <= 2147483647 &&
      value.high >= 0 && value.high <= 2147483647 && typeof value.unsigned === 'boolean') {
    return (BigInt(value.high) << 32n) | BigInt(value.low >>> 0);
  }
  throw new Error('Invalid measurement timestamp');
}

function createMetricsMapper({ sessionId, epochUs }) {
  const origin = microseconds(epochUs);
  const latest = new Map();
  let previousTime = -Infinity;

  return {
    ingest(packet, timeMs) {
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error('Invalid metrics packet');
      if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs < previousTime) throw new Error('Invalid metrics clock');
      const updates = new Map();
      let count = 0;
      for (const [channel, [group, field, unit, threshold]] of Object.entries(CHANNELS)) {
        const values = packet[group]?.[field];
        if (values === undefined || values === null) continue;
        if (!Array.isArray(values) || values.length > MAX_CHANNEL_SAMPLES) throw new Error('Metrics sample limit exceeded');
        count += values.length;
        if (count > 8192) throw new Error('Metrics sample limit exceeded');
        let newest = latest.get(channel);
        for (const sample of values) {
          if (!sample || typeof sample !== 'object' || Array.isArray(sample)) throw new Error('Invalid metric sample');
          const key = unit === 'boolean' ? 'detected' : 'value';
          if (!own(sample, key) || sample[key] === null || !own(sample, 'timestamp') || sample.timestamp === null) continue;
          const rawValue = sample[key];
          if (unit === 'boolean' ? typeof rawValue !== 'boolean' :
            typeof rawValue !== 'number' || !Number.isFinite(rawValue) || Math.abs(rawValue) > (unit === 'relative' ? 1e6 : 1000) ||
            (unit !== 'relative' && rawValue < 0)) throw new Error('Invalid metric value');
          if (own(sample, 'stable') && sample.stable !== null && typeof sample.stable !== 'boolean') throw new Error('Invalid metric quality');
          const timestamp = microseconds(sample.timestamp);
          const delta = timestamp - origin;
          if (delta > BigInt(Number.MAX_SAFE_INTEGER) || delta < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Invalid measurement timestamp');
          const sampledAtMs = Number(delta) / 1000;
          if (sampledAtMs > timeMs || sampledAtMs < -STALE_MS) continue;
          const confidence = own(sample, 'confidence') && sample.confidence !== null ? sample.confidence : null;
          if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 100)) throw new Error('Invalid metric confidence');
          if (newest && timestamp <= newest.timestamp) continue;
          newest = {
            timestamp,
            signal: {
              value: unit === 'boolean' ? Number(rawValue) : rawValue,
              quality: sample.stable === true && (confidence === null || confidence >= threshold) ? 'valid' : 'unstable',
              confidence: confidence === null ? null : confidence / 100,
              sampledAtMs,
              unit,
              provenance: 'measured',
            },
          };
        }
        if (newest) updates.set(channel, newest);
      }
      for (const [channel, value] of updates) latest.set(channel, value);
      previousTime = timeMs;
      return this.snapshot(timeMs);
    },

    snapshot(timeMs) {
      if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs < previousTime) throw new Error('Invalid metrics clock');
      previousTime = timeMs;
      const signals = {};
      for (const [channel, [, , unit]] of Object.entries(CHANNELS)) {
        const value = latest.get(channel)?.signal;
        signals[channel] = value ? { ...value, quality: timeMs - value.sampledAtMs >= STALE_MS ? 'stale' : value.quality } :
          { value: null, quality: 'missing', confidence: null, sampledAtMs: timeMs, unit, provenance: 'measured' };
      }
      return { sessionId, source: 'live', timeMs, signals };
    },
  };
}

module.exports = { createMetricsMapper, microseconds, MAX_PACKET_BYTES, MAX_CHANNEL_SAMPLES };
