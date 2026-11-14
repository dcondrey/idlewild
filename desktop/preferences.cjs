'use strict';

const fs = require('node:fs');

const MAX_BYTES = 16 * 1024;
const SCENES = ['rex', 'bubbles', 'star', 'sprite', 'runner', 'brain'];
const MOTION_MODES = ['system', 'on', 'off'];
const PREFERENCE_DEFAULTS = Object.freeze({
  scene: 'rex', motion: 70, sensitivity: 65, sound: 45, showSignals: true, reducedMotion: 'system',
  liveTracking: true, liveExtended: false, exportSignals: true, loop: true,
});
const BOOLEANS = ['showSignals', 'liveTracking', 'liveExtended', 'exportSignals', 'loop'];
const LEVELS = ['motion', 'sensitivity', 'sound'];

function sanitizePreferences(value) {
  const input = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = { ...PREFERENCE_DEFAULTS };
  if (typeof input.scene === 'string' && SCENES.includes(input.scene)) out.scene = input.scene;
  for (const key of LEVELS) {
    const n = input[key];
    if (typeof n === 'number' && Number.isFinite(n)) out[key] = Math.min(100, Math.max(0, Math.round(n)));
  }
  for (const key of BOOLEANS) if (typeof input[key] === 'boolean') out[key] = input[key];
  if (typeof input.reducedMotion === 'string' && MOTION_MODES.includes(input.reducedMotion)) out.reducedMotion = input.reducedMotion;
  return out;
}

function createPreferenceStore(file) {
  let current = { ...PREFERENCE_DEFAULTS };
  return {
    load() {
      try {
        if (fs.statSync(file).size > MAX_BYTES) current = { ...PREFERENCE_DEFAULTS };
        else current = sanitizePreferences(JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch { current = { ...PREFERENCE_DEFAULTS }; }
      return { ...current };
    },
    save(partial) {
      const next = sanitizePreferences({ ...current, ...(partial !== null && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}) });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, file);
      current = next;
      return { ...current };
    },
    get() { return { ...current }; },
  };
}

module.exports = { PREFERENCE_DEFAULTS, sanitizePreferences, createPreferenceStore };
