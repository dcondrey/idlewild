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
const EXPRESSION_NAMES = Object.freeze({ 1: 'angry', 2: 'contempt', 3: 'disgust', 4: 'fear', 5: 'happy', 6: 'neutral', 7: 'sad', 8: 'surprise' });
const VARIABILITY_THRESHOLD = 50;
const TRACE_WINDOWS = Object.freeze({ breath: 20_000, arterialTrace: 6_000 });
const MAX_TRACE_POINTS = 2048;
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

function percentile(sorted, fraction) {
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.min(sorted.length - 1, low + 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

// SDK traces have no declared units or scale, so each is centered and scaled by its own recent 5th-95th percentile range.
function createTraceNormalizer(windowMs) {
  let points = [];
  return {
    add(timeMs, value) {
      if (points.length && timeMs <= points[points.length - 1].timeMs) return;
      points.push({ timeMs, value });
      const cutoff = timeMs - windowMs;
      let start = 0;
      while (start < points.length && points[start].timeMs < cutoff) start++;
      if (start || points.length > MAX_TRACE_POINTS) points = points.slice(Math.max(start, points.length - MAX_TRACE_POINTS));
    },
    normalize(value) {
      if (points.length < 2) return 0;
      const sorted = points.map(point => point.value).sort((a, b) => a - b);
      const low = percentile(sorted, 0.05);
      const high = percentile(sorted, 0.95);
      const half = (high - low) / 2;
      if (!(half > 0) || !Number.isFinite(half)) return 0;
      return Math.max(-1, Math.min(1, (value - (low + high) / 2) / half));
    },
  };
}

function createMetricsMapper({ sessionId, epochUs }) {
  const origin = microseconds(epochUs);
  const latest = new Map();
  const traces = new Map(Object.entries(TRACE_WINDOWS).map(([channel, windowMs]) => [channel, createTraceNormalizer(windowMs)]));
  let previousTime = -Infinity;
  let expression = null;
  let variability = null;

  function sampleTime(sample, timeMs) {
    if (!own(sample, 'timestamp') || sample.timestamp === null) return null;
    const timestamp = microseconds(sample.timestamp);
    const delta = timestamp - origin;
    if (delta > BigInt(Number.MAX_SAFE_INTEGER) || delta < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Invalid measurement timestamp');
    const sampledAtMs = Number(delta) / 1000;
    return sampledAtMs > timeMs || sampledAtMs < -STALE_MS ? null : sampledAtMs;
  }

  function ingestExtended(packet, timeMs) {
    const expressions = packet.face?.expression;
    if (expressions !== undefined && expressions !== null) {
      if (!Array.isArray(expressions) || expressions.length > MAX_CHANNEL_SAMPLES) throw new Error('Metrics sample limit exceeded');
      for (const sample of expressions) {
        if (!sample || typeof sample !== 'object' || !Array.isArray(sample.scores) || sample.scores.length > 16) throw new Error('Invalid expression sample');
        const sampledAtMs = sampleTime(sample, timeMs);
        if (sampledAtMs === null || (expression && sampledAtMs <= expression.sampledAtMs)) continue;
        const scores = {};
        for (const score of sample.scores) {
          const name = EXPRESSION_NAMES[score?.type];
          if (!name) continue;
          if (typeof score.confidence !== 'number' || !Number.isFinite(score.confidence) || score.confidence < 0 || score.confidence > 100) throw new Error('Invalid expression score');
          scores[name] = score.confidence / 100;
        }
        expression = { scores, quality: sample.stable === true ? 'valid' : 'unstable', sampledAtMs };
      }
    }
    const readings = packet.cardio?.hrv;
    if (readings !== undefined && readings !== null) {
      if (!Array.isArray(readings) || readings.length > MAX_CHANNEL_SAMPLES) throw new Error('Metrics sample limit exceeded');
      for (const sample of readings) {
        if (!sample || typeof sample !== 'object') throw new Error('Invalid variability sample');
        if (typeof sample.rmssd !== 'number' || !Number.isFinite(sample.rmssd) || sample.rmssd <= 0) continue;
        if (sample.rmssd > 1e6) throw new Error('Invalid variability sample');
        const sampledAtMs = sampleTime(sample, timeMs);
        if (sampledAtMs === null || (variability && sampledAtMs <= variability.sampledAtMs)) continue;
        const confidence = typeof sample.confidence === 'number' && Number.isFinite(sample.confidence) && sample.confidence >= 0 && sample.confidence <= 100 ? sample.confidence : null;
        variability = { rmssd: sample.rmssd, quality: sample.stable === true && (confidence === null || confidence >= VARIABILITY_THRESHOLD) ? 'valid' : 'unstable', confidence: confidence === null ? null : confidence / 100, sampledAtMs };
      }
    }
  }

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
        const trace = traces.get(channel);
        const accepted = [];
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
          if (trace) accepted.push({ sampledAtMs, rawValue });
          if (newest && timestamp <= newest.timestamp) continue;
          newest = {
            timestamp,
            raw: rawValue,
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
        if (trace) {
          accepted.sort((a, b) => a.sampledAtMs - b.sampledAtMs);
          for (const point of accepted) trace.add(point.sampledAtMs, point.rawValue);
          if (newest && newest !== latest.get(channel)) newest.signal.value = trace.normalize(newest.raw);
        }
        if (newest) updates.set(channel, newest);
      }
      ingestExtended(packet, timeMs);
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
      const extended = {};
      if (expression) extended.expression = { ...expression, scores: { ...expression.scores }, quality: timeMs - expression.sampledAtMs >= STALE_MS ? 'stale' : expression.quality };
      if (variability) extended.variability = { ...variability, quality: timeMs - variability.sampledAtMs >= STALE_MS * 4 ? 'stale' : variability.quality };
      return { sessionId, source: 'live', timeMs, signals, ...(expression || variability ? { extended } : {}) };
    },
  };
}

module.exports = { createMetricsMapper, microseconds, MAX_PACKET_BYTES, MAX_CHANNEL_SAMPLES };
