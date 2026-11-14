import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { MENU_COMMANDS as RENDERER_COMMANDS } from '../src/commands.ts';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';

const require = createRequire(import.meta.url);
const { MENU_COMMANDS, INITIAL_MENU_STATE, validateMenuState, buildMenuTemplate } = require('../desktop/menu.cjs');
const { PREFERENCE_DEFAULTS, sanitizePreferences, createPreferenceStore } = require('../desktop/preferences.cjs');

type Item = { id?: string; role?: string; enabled?: boolean; checked?: boolean; click?: () => void; submenu?: Item[] };
const walk = (items: Item[]): Item[] => items.flatMap(item => [item, ...walk(item.submenu ?? [])]);
const build = (platform: string, state = {}, packaged = true, send: (c: string) => void = () => {}) =>
  buildMenuTemplate({ platform, packaged, state: { ...INITIAL_MENU_STATE, ...state }, send, openExternal: () => {}, showAbout: () => {} }) as Item[];
const find = (template: Item[], id: string) => walk(template).filter(item => item.id === id);
const only = (template: Item[], id: string) => {
  const found = find(template, id);
  assert.equal(found.length, 1, id);
  return found[0];
};

test('main and renderer command lists match', () => {
  assert.deepEqual([...MENU_COMMANDS], [...RENDERER_COMMANDS]);
});

for (const platform of ['darwin', 'linux']) {
  test(`every command appears once and sends itself on ${platform}`, () => {
    const sent: string[] = [];
    const template = build(platform, {}, true, c => sent.push(c));
    for (const command of MENU_COMMANDS) {
      const item = only(template, command);
      item.click?.();
      assert.equal(sent.pop(), command);
    }
  });
}

test('input and export gating', () => {
  assert.equal(only(build('linux', { inputActive: true }), 'stop-input').enabled, true);
  assert.equal(only(build('linux', { inputActive: false }), 'stop-input').enabled, false);
  const active = build('linux', { inputActive: true });
  assert.equal(only(active, 'use-camera').enabled, false);
  assert.equal(only(active, 'start-rehearsal').enabled, false);
  const exports = ['export', 'export-video', 'export-wav', 'export-glb', 'export-csv', 'export-json'];
  for (const state of [{}, { hasTake: true, exporting: true }]) {
    const template = build('linux', state);
    for (const id of exports) assert.equal(only(template, id).enabled, false, id);
  }
  const ready = build('linux', { hasTake: true });
  for (const id of exports) assert.equal(only(ready, id).enabled, true, id);
});

test('character radios follow state', () => {
  const template = build('linux', { scene: 'star', recording: true });
  for (const id of MENU_COMMANDS.filter((c: string) => c.startsWith('scene:'))) {
    const item = only(template, id);
    assert.equal(item.enabled, false);
    assert.equal(item.checked, id === 'scene:star');
  }
  assert.equal(only(build('linux'), 'scene:rex').enabled, true);
});

test('devtools only when unpackaged', () => {
  assert.equal(walk(build('linux', {}, true)).some(i => i.role === 'toggleDevTools'), false);
  assert.equal(walk(build('linux', {}, false)).some(i => i.role === 'toggleDevTools'), true);
});

test('validateMenuState is strict', () => {
  assert.deepEqual(validateMenuState({ ...INITIAL_MENU_STATE }), INITIAL_MENU_STATE);
  assert.equal(validateMenuState({ ...INITIAL_MENU_STATE, extra: true }), null);
  const { sound: _sound, ...missing } = INITIAL_MENU_STATE;
  assert.equal(validateMenuState(missing), null);
  assert.equal(validateMenuState({ ...INITIAL_MENU_STATE, loop: 'yes' }), null);
  assert.equal(validateMenuState({ ...INITIAL_MENU_STATE, scene: 'dragon' }), null);
  assert.equal(validateMenuState(null), null);
  assert.equal(validateMenuState([]), null);
});

test('sanitizePreferences boundaries', () => {
  const motion = (value: unknown) => sanitizePreferences({ motion: value }).motion;
  assert.equal(motion(-1), 0);
  assert.equal(motion(0), 0);
  assert.equal(motion(100), 100);
  assert.equal(motion(101), 100);
  assert.equal(motion(50.4), 50);
  assert.equal(motion(NaN), PREFERENCE_DEFAULTS.motion);
  assert.equal(motion('50'), PREFERENCE_DEFAULTS.motion);
  assert.equal(sanitizePreferences({ scene: 'imported' }).scene, 'rex');
  assert.equal(sanitizePreferences({ scene: 'star' }).scene, 'star');
  assert.equal('apiKey' in sanitizePreferences({ apiKey: 'secret' }), false);
  assert.equal(sanitizePreferences({ loop: 'false' }).loop, true);
  assert.equal(sanitizePreferences({ reducedMotion: 'maybe' }).reducedMotion, 'system');
  assert.deepEqual(sanitizePreferences(null), PREFERENCE_DEFAULTS);
});

test('preference store persistence and hostile files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlewild-prefs-'));
  try {
    const file = path.join(dir, 'preferences.json');
    const saved = createPreferenceStore(file).save({ scene: 'brain', motion: 12, bogus: 1 });
    assert.equal(saved.scene, 'brain');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const reloaded = createPreferenceStore(file);
    assert.deepEqual(reloaded.load(), saved);
    fs.writeFileSync(file, JSON.stringify({ scene: 'star', pad: 'x'.repeat(16 * 1024) }));
    assert.deepEqual(createPreferenceStore(file).load(), PREFERENCE_DEFAULTS);
    fs.writeFileSync(file, '{not json');
    assert.deepEqual(createPreferenceStore(file).load(), PREFERENCE_DEFAULTS);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('renderer preference defaults match the main-process store', () => {
  assert.deepEqual({ ...DEFAULT_PREFERENCES }, { ...PREFERENCE_DEFAULTS });
});
