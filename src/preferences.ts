import type { Preferences } from './desktop';

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  scene: 'rex', motion: 70, sensitivity: 65, sound: 45, showSignals: true, reducedMotion: 'system',
  liveTracking: true, liveExtended: false, exportSignals: true, loop: true,
});
