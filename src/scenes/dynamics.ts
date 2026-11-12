import { SIGNAL_STALE_MS, TRACKING_STALE_MS, type Channel, type FaceShape, type SceneFrame, type TrackingPoint } from '../contracts.ts';
import { trackingAt } from '../tracking-frame.ts';

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
export const confidenceWeight = (confidence: number) => smooth((confidence - 0.45) / 0.15);

export function trackedPoint(value: TrackingPoint | undefined): value is TrackingPoint {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    Math.abs(value[0]) <= 5 && Math.abs(value[1]) <= 5 && Math.abs(value[2]) <= 5 && value[3] >= 0.45 && value[3] <= 1;
}

export function trackingStrength(input: SceneFrame, sampledAtMs?: number): number {
  const tracking = input.reducedMotion ? null : trackingAt(input);
  if (!tracking) return 0;
  const age = Math.max(input.timeMs, input.frame!.timeMs) - (sampledAtMs ?? tracking.sampledAtMs);
  if (!Number.isFinite(age) || age < 0) return 0;
  return clamp(clamp(input.controls.motion) * clamp(input.controls.sensitivity) * 2) *
    (1 - smooth((age - TRACKING_STALE_MS / 2) / (TRACKING_STALE_MS / 2)));
}

export function randomFor(seed: number, index: number): number {
  let value = (Math.trunc(Number.isFinite(seed) ? seed : 0) ^ Math.imul(index + 1, 0x9e3779b1)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
}

function signalWeight(input: SceneFrame, channel: Channel): number {
  const frame = input.frame;
  const signal = frame?.signals[channel];
  if (!frame || !signal || signal.quality !== 'valid' || signal.value === null || !Number.isFinite(signal.value) ||
      !Number.isFinite(signal.sampledAtMs) || signal.sampledAtMs > frame.timeMs) return 0;
  const unit = channel === 'pulseRate' ? 'beats/min' : channel === 'breathingRate' ? 'breaths/min' : channel === 'blink' || channel === 'talking' ? 'boolean' : 'relative';
  if (signal.unit !== unit) return 0;
  const age = Math.max(input.timeMs, frame.timeMs) - signal.sampledAtMs;
  if (!(age < SIGNAL_STALE_MS)) return 0;
  return clamp((SIGNAL_STALE_MS - age) / 500);
}

export function signalValue(input: SceneFrame, channel: Channel): number | null {
  const weight = signalWeight(input, channel);
  return weight > 0 ? input.frame!.signals[channel].value! * weight : null;
}

function ratePace(input: SceneFrame, channel: 'breathingRate' | 'pulseRate', low: number, high: number): number {
  const weight = signalWeight(input, channel);
  return weight > 0 ? clamp((input.frame!.signals[channel].value! - low) / (high - low)) * weight : 0;
}

export function sceneDynamics(input: SceneFrame) {
  const motion = input.reducedMotion ? 0 : clamp(input.controls.motion);
  const sensitivity = clamp(input.controls.sensitivity);
  const local = input.frame?.source === 'local-camera';
  const tracking = motion > 0 ? trackingAt(input) : null;
  const strength = trackingStrength(input);
  const faceStrength = trackingStrength(input, tracking?.face?.sampledAtMs);
  const face = (shape: FaceShape) => clamp(tracking?.face?.weights[shape] ?? 0) * faceStrength;
  const jaw = local ? face('jawOpen') : clamp(signalValue(input, 'talking') ?? 0) * motion;
  const blink = local ? (face('eyeBlinkLeft') + face('eyeBlinkRight')) / 2 : clamp(signalValue(input, 'blink') ?? 0) * motion;
  const smile = (face('mouthSmileLeft') + face('mouthSmileRight')) / 2;
  const brow = Math.max(face('browInnerUp'), (face('browDownLeft') + face('browDownRight')) / 2);
  const movement = clamp(tracking?.movement ?? 0) * strength;
  let armSpread = 0, armLift = 0, lean = 0, turn = 0;
  const body = tracking?.body;
  if (body) {
    const left = body.leftShoulder, right = body.rightShoulder;
    const leftHip = body.leftHip, rightHip = body.rightHip;
    if (trackedPoint(left) && trackedPoint(right)) {
      const width = Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
      const certainty = confidenceWeight(Math.min(left[3], right[3]));
      if (width >= 0.1) {
        turn = clamp((left[2] - right[2]) / width, -1, 1) * strength * certainty;
        const a = body.leftWrist, b = body.rightWrist;
        if (trackedPoint(a) && trackedPoint(b)) armSpread = clamp((Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / width - 1) / 2) * strength * confidenceWeight(Math.min(left[3], right[3], a[3], b[3]));
        let raised = 0, count = 0;
        for (const [wrist, shoulder] of [[a, left], [b, right]] as const) if (trackedPoint(wrist)) {
          raised += clamp(0.5 + (wrist[1] - shoulder[1]) / width * 0.5) * confidenceWeight(wrist[3]);
          count++;
        }
        if (count) armLift = raised / count * strength * certainty;
      }
      if (trackedPoint(leftHip) && trackedPoint(rightHip)) {
        const hipX = (leftHip[0] + rightHip[0]) / 2, hipY = (leftHip[1] + rightHip[1]) / 2;
        const height = (left[1] + right[1]) / 2 - hipY;
        if (height >= 0.15) {
          const torsoWeight = strength * confidenceWeight(Math.min(left[3], right[3], leftHip[3], rightHip[3]));
          lean = clamp(((left[0] + right[0]) / 2 - hipX) / height, -1, 1) * torsoWeight;
        }
      }
    }
  }
  return {
    time: motion === 0 ? 0 : Math.max(0, Number.isFinite(input.timeMs) ? input.timeMs : 0) / 1000,
    motion,
    breath: local ? 0 : clamp(signalValue(input, 'breath') ?? 0, -1, 1) * sensitivity * motion,
    breathingPace: local ? 0 : ratePace(input, 'breathingRate', 6, 30) * sensitivity * motion,
    pulsePace: local ? 0 : ratePace(input, 'pulseRate', 45, 135) * sensitivity * motion,
    blink,
    talking: clamp(signalValue(input, 'talking') ?? 0) * motion,
    jaw, smile, brow, movement, armSpread, armLift, lean, turn,
  };
}
