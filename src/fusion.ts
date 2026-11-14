import { TRACKING_STALE_MS } from './contracts.ts';
import type { ControlFrame } from './contracts.ts';

export interface TrackedArrival {
  frame: ControlFrame;
  arrivedAtMs: number;
}

// SmartSpectra frames use the main-process session clock; local tracking uses its own worker clock.
// Re-base the tracking sample by its age at the live frame's arrival so both share the live timeline.
export function attachTracking(live: ControlFrame, liveArrivedAtMs: number, tracked: TrackedArrival | null): ControlFrame {
  const tracking = tracked?.frame.tracking;
  if (live.source !== 'live' || !tracked || !tracking || tracked.frame.source !== 'local-camera' ||
      !Number.isFinite(liveArrivedAtMs) || !Number.isFinite(tracked.arrivedAtMs)) return live;
  const transit = liveArrivedAtMs - tracked.arrivedAtMs;
  const age = transit + tracked.frame.timeMs - tracking.sampledAtMs;
  if (!Number.isFinite(age) || transit < 0 || age < 0 || age >= TRACKING_STALE_MS) return live;
  const sampledAtMs = Math.min(live.timeMs, live.timeMs - age);
  const face = tracking.face && {
    ...tracking.face,
    ...(tracking.face.sampledAtMs !== undefined ? { sampledAtMs: Math.min(live.timeMs, live.timeMs - (transit + tracked.frame.timeMs - tracking.face.sampledAtMs)) } : {}),
  };
  return { ...live, tracking: { ...tracking, sampledAtMs, face } };
}
