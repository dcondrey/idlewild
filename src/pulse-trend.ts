import { SIGNAL_STALE_MS } from './contracts.ts';
import type { ControlFrame, SignalTrend } from './contracts.ts';

export const PULSE_TREND = Object.freeze({ windowMs: 20_000, minimumSpanMs: 10_000, minimumSamples: 5, maximumSamples: 1200, thresholdPerMinute: 6 });
type Point = { time: number; value: number };

export function pulseTrend(points: readonly Point[]): SignalTrend | null {
  if (points.length < PULSE_TREND.minimumSamples) return null;
  const span = points[points.length - 1].time - points[0].time;
  if (span < PULSE_TREND.minimumSpanMs) return null;
  let meanTime = 0, meanValue = 0;
  for (const point of points) { meanTime += point.time; meanValue += point.value; }
  meanTime /= points.length; meanValue /= points.length;
  let covariance = 0, variance = 0;
  for (const point of points) {
    covariance += (point.time - meanTime) * (point.value - meanValue);
    variance += (point.time - meanTime) ** 2;
  }
  const changePerMinute = covariance / variance * 60_000;
  const direction = changePerMinute >= PULSE_TREND.thresholdPerMinute ? 'rising' : changePerMinute <= -PULSE_TREND.thresholdPerMinute ? 'falling' : 'steady';
  return { direction, changePerMinute, windowMs: span, samples: points.length };
}

export function createPulseTrend(): { update(frame: ControlFrame): ControlFrame; reset(): void } {
  let session = '';
  let points: Point[] = [];
  const reset = () => { session = ''; points = []; };
  return {
    reset,
    update(frame) {
      if (frame.sessionId !== session) { reset(); session = frame.sessionId; }
      const signal = frame.signals.pulseRate;
      const usable = signal.quality === 'valid' && signal.value !== null && signal.provenance !== 'replayed' && frame.timeMs - signal.sampledAtMs < SIGNAL_STALE_MS;
      if (!usable) { points = []; return frame; }
      const last = points[points.length - 1];
      if (last && signal.sampledAtMs - last.time > SIGNAL_STALE_MS) points = [];
      if (!last || signal.sampledAtMs > last.time || points.length === 0) points.push({ time: signal.sampledAtMs, value: signal.value! });
      while (points.length > PULSE_TREND.maximumSamples || (points.length && points[0].time < signal.sampledAtMs - PULSE_TREND.windowMs)) points.shift();
      const trend = pulseTrend(points);
      return trend ? { ...frame, trends: { pulseRate: trend } } : frame;
    },
  };
}
