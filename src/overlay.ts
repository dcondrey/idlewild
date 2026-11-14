import { SIGNAL_STALE_MS } from './contracts.ts';
import type { Channel, ControlFrame, Quality } from './contracts.ts';

export interface OverlayView { timeMs: number; frames: readonly ControlFrame[]; live: boolean; status?: string }

export const OVERLAY_WINDOW_MS = 10_000;
const MAX_JOIN_MS = 1000;
const MAX_POINTS = 400;
const MAX_STATUS_CHARS = 80;

export interface TracePoint { t: number; v: number }

/** Frames with timeMs in (timeMs - spanMs, timeMs]. Binary search over chronological frames. */
export function windowRange(frames: readonly ControlFrame[], timeMs: number, spanMs = OVERLAY_WINDOW_MS): [number, number] {
  const bound = (limit: number, inclusive: boolean) => {
    let low = 0;
    let high = frames.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const time = frames[middle].timeMs;
      if (inclusive ? time <= limit : time < limit) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const end = bound(timeMs, true);
  const start = Math.min(end, bound(timeMs - spanMs, true));
  return [start, end];
}

/** A drawable value is measured, valid, finite and fresh at its own frame. Cached, unstable, missing and stale readings are gaps. */
export function drawableValue(frame: ControlFrame, channel: Channel, nowMs = frame.timeMs): number | null {
  const signal = frame.signals[channel];
  if (signal.quality !== 'valid' || signal.provenance === 'replayed' || signal.value === null || !Number.isFinite(signal.value)) return null;
  if (frame.timeMs - signal.sampledAtMs >= SIGNAL_STALE_MS || nowMs - signal.sampledAtMs >= SIGNAL_STALE_MS) return null;
  return signal.value;
}

/** Continuous runs of drawable samples; a missing sample or a time jump above one second breaks the line. */
export function traceSegments(frames: readonly ControlFrame[], channel: Channel, start: number, end: number): TracePoint[][] {
  const stride = Math.max(1, Math.ceil((end - start) / MAX_POINTS));
  const segments: TracePoint[][] = [];
  let current: TracePoint[] | null = null;
  let previous = -Infinity;
  for (let index = start; index < end; index += stride) {
    const frame = frames[index];
    const value = drawableValue(frame, channel);
    if (value === null) { current = null; continue; }
    if (!current || frame.timeMs - previous > MAX_JOIN_MS * stride) { current = []; segments.push(current); }
    current.push({ t: frame.timeMs, v: value });
    previous = frame.timeMs;
  }
  return segments;
}

export function overlayHeader(view: OverlayView): string | null {
  const frame = view.frames.at(-1);
  if (!frame || frame.source === 'local-camera') return null;
  if (frame.source === 'rehearsal') return 'SYNTHETIC REHEARSAL';
  return view.live ? 'SmartSpectra · LIVE' : 'SmartSpectra · RECORDED TAKE';
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
type Shown = Quality | 'cached';
const QUALITY_COLOR: Record<Shown, string> = { valid: '#7fe3b0', unstable: '#f2c66d', stale: '#9aa7ad', missing: '#9aa7ad', cached: '#b7a6f0' };

function percent(confidence: number | null): string {
  return confidence === null || !Number.isFinite(confidence) ? 'conf –' : `conf ${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
}

function latestState(frame: ControlFrame | undefined, channel: Channel, timeMs: number) {
  if (!frame) return { value: null as number | null, quality: 'missing' as Shown, confidence: null as number | null };
  const signal = frame.signals[channel];
  const value = timeMs - frame.timeMs > SIGNAL_STALE_MS ? null : drawableValue(frame, channel, timeMs);
  if (value === null && signal.provenance === 'replayed' && timeMs - frame.timeMs <= SIGNAL_STALE_MS) return { value: null, quality: 'cached' as Shown, confidence: null };
  const quality: Shown = value !== null ? 'valid' : signal.quality === 'unstable' && timeMs - signal.sampledAtMs < SIGNAL_STALE_MS ? 'unstable' : signal.quality === 'valid' || signal.quality === 'stale' ? 'stale' : signal.quality;
  return { value, quality, confidence: signal.confidence };
}

function sparkline(ctx: CanvasRenderingContext2D, frames: readonly ControlFrame[], range: [number, number], channel: Channel, timeMs: number, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  for (const segment of traceSegments(frames, channel, range[0], range[1])) {
    const point = (p: TracePoint): [number, number] => [x + (1 - (timeMs - p.t) / OVERLAY_WINDOW_MS) * w, y + h / 2 - Math.max(-1, Math.min(1, p.v)) * (h / 2 - 2)];
    ctx.beginPath();
    if (segment.length === 1) {
      const [px, py] = point(segment[0]);
      ctx.arc(px, py, 1, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    segment.forEach((p, index) => { const [px, py] = point(p); if (index) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
  }
}

export function extendedLine(frame: ControlFrame | undefined, timeMs: number): string | null {
  const parts: string[] = [];
  const variability = frame?.extended?.variability;
  if (variability?.quality === 'valid' && timeMs - variability.sampledAtMs < SIGNAL_STALE_MS * 4) parts.push(`HRV rmssd ${variability.rmssd.toFixed(1)}`);
  const expression = frame?.extended?.expression;
  if (expression?.quality === 'valid' && timeMs - expression.sampledAtMs < SIGNAL_STALE_MS) {
    const top = Object.entries(expression.scores).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
    if (top) parts.push(`Expression estimate · ${top[0]} ${Math.round((top[1] ?? 0) * 100)}%`);
  }
  return parts.length ? parts.join('  ·  ') : null;
}

export function drawSignalOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, view: OverlayView): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 160 || height < 120 || !Number.isFinite(view.timeMs)) return;
  const header = overlayHeader(view);
  if (!header) return;
  const range = windowRange(view.frames, view.timeMs);
  const latest = range[1] > range[0] ? view.frames[range[1] - 1] : undefined;
  const status = view.status?.replace(/\s+/g, ' ').trim().slice(0, MAX_STATUS_CHARS);
  const panelW = Math.round(Math.min(width - 16, Math.max(220, Math.min(320, width * 0.34))));
  const pad = 10;
  const innerW = panelW - pad * 2;
  const sparkH = 30;
  const extra = extendedLine(latest, view.timeMs);
  const panelH = 22 + (status ? 12 : 0) + 2 * (14 + 3 + sparkH + 3) + 12 + 46 + (extra ? 14 : 0) + 6;
  const left = 8;
  const top = Math.max(8, height - panelH - 8);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(8, 15, 28, 0.78)';
  ctx.strokeStyle = 'rgba(160, 200, 215, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left, top, panelW, panelH, 8);
  ctx.fill();
  ctx.stroke();
  ctx.translate(left + pad, top);
  let y = 16;
  ctx.font = `700 11px ${FONT}`;
  ctx.fillStyle = header.endsWith('LIVE') ? '#7fe3b0' : '#c9dcf0';
  ctx.fillText(header, 0, y, innerW);
  y += 6;
  if (status) {
    y += 12;
    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = '#f2c66d';
    ctx.fillText(status, 0, y, innerW);
  }
  const traces: [Channel, string][] = [['breath', 'Breath'], ['arterialTrace', 'Pulse waveform · uncalibrated']];
  for (const [channel, label] of traces) {
    y += 14;
    const state = latestState(latest, channel, view.timeMs);
    const detail = state.quality === 'cached' ? 'cached animation · not measured' : `${state.quality} · ${percent(state.confidence)}`;
    ctx.font = `600 10px ${FONT}`;
    const detailWidth = ctx.measureText(detail).width;
    ctx.fillStyle = '#c9dcf0';
    ctx.fillText(label, 0, y, Math.max(40, innerW - detailWidth - 8));
    ctx.textAlign = 'right';
    ctx.fillStyle = QUALITY_COLOR[state.quality];
    ctx.fillText(detail, innerW, y);
    ctx.textAlign = 'left';
    y += 3;
    sparkline(ctx, view.frames, range, channel, view.timeMs, 0, y, innerW, sparkH, channel === 'breath' ? '#6fc8ff' : '#ff9ab0');
    y += sparkH + 3;
  }
  y += 12;
  const half = innerW / 2;
  const rates: [Channel, string, string][] = [['breathingRate', 'Breathing', '/min'], ['pulseRate', 'Pulse', 'bpm']];
  rates.forEach(([channel, label, unit], column) => {
    const state = latestState(latest, channel, view.timeMs);
    const x = column * half;
    ctx.font = `600 10px ${FONT}`;
    ctx.fillStyle = '#9fb4c0';
    ctx.fillText(label, x, y);
    ctx.font = `700 18px ${FONT}`;
    ctx.fillStyle = state.value === null ? '#9aa7ad' : '#f4faff';
    const text = state.value === null ? '–' : state.value.toFixed(state.value >= 100 ? 0 : 1);
    ctx.fillText(text, x, y + 19, half - 6);
    const measured = ctx.measureText(text).width;
    ctx.font = `500 10px ${FONT}`;
    ctx.fillStyle = '#9fb4c0';
    ctx.fillText(unit, x + measured + 3, y + 19);
    ctx.fillStyle = QUALITY_COLOR[state.quality];
    let detail = `${state.quality} · ${percent(state.confidence)}`;
    const trend = channel === 'pulseRate' && state.value !== null ? latest?.trends?.pulseRate : undefined;
    if (trend) detail = `${trend.direction} · ${detail}`;
    ctx.fillText(detail, x, y + 31, half - 6);
  });
  y += 46;
  if (extra) {
    ctx.font = `500 10px ${FONT}`;
    ctx.fillStyle = '#c9dcf0';
    ctx.fillText(extra, 0, y, innerW);
    y += 14;
  }
  ctx.font = `500 9px ${FONT}`;
  ctx.fillStyle = '#8197a3';
  ctx.fillText('Creative use · not a medical measurement', 0, y, innerW);
  ctx.restore();
}
