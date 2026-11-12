import { TRACKING_STALE_MS, type SceneFrame, type TrackingFrame } from './contracts.ts';

export function trackingAt(input: SceneFrame): TrackingFrame | null {
  const frame = input.frame;
  const tracking = frame?.tracking;
  if (!frame || frame.source !== 'local-camera' || !tracking || !Number.isFinite(input.timeMs) || !Number.isFinite(tracking.sampledAtMs)) return null;
  const age = Math.max(input.timeMs, frame.timeMs) - tracking.sampledAtMs;
  if (age < 0 || age >= TRACKING_STALE_MS) return null;
  const faceAge = Math.max(input.timeMs, frame.timeMs) - (tracking.face?.sampledAtMs ?? tracking.sampledAtMs);
  return tracking.face && (faceAge < 0 || faceAge >= TRACKING_STALE_MS) ? { ...tracking, face: null } : tracking;
}
