'use strict';

const MENU_COMMANDS = Object.freeze([
  'preferences', 'import-character', 'open-takes', 'export', 'export-video', 'export-wav', 'export-glb', 'export-csv', 'export-json',
  'use-camera', 'start-rehearsal', 'stop-input', 'record', 'play', 'loop', 'edit-take',
  'scene:rex', 'scene:bubbles', 'scene:star', 'scene:sprite', 'scene:runner', 'scene:brain', 'scene:imported',
  'show-signals', 'reduce-motion', 'sound', 'guide', 'shortcuts', 'privacy', 'credits',
]);

const SCENES = Object.freeze(['rex', 'bubbles', 'star', 'sprite', 'runner', 'brain', 'imported']);
const SCENE_LABELS = Object.freeze({ rex: 'Rex', bubbles: 'Bubbles', star: 'Star', sprite: 'Sprite', runner: 'Runner', brain: 'Brain', imported: 'Your Character…' });
const BOOLEAN_KEYS = Object.freeze(['inputActive', 'recording', 'playing', 'hasTake', 'canRecord', 'exporting', 'loop', 'showSignals', 'reducedMotion', 'sound']);
const STATE_KEYS = Object.freeze(['scene', ...BOOLEAN_KEYS]);
const INITIAL_MENU_STATE = Object.freeze({
  scene: 'rex', inputActive: false, recording: false, playing: false, hasTake: false, canRecord: false,
  exporting: false, loop: true, showSignals: true, reducedMotion: false, sound: false,
});
const SDK_DOCS_URL = 'https://smartspectra.presagetech.com/docs/nodejs';
const PRESAGE_URL = 'https://smartspectra.presagetech.com/';

function validateMenuState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Object.keys(value);
  if (keys.length !== STATE_KEYS.length || !STATE_KEYS.every(key => Object.hasOwn(value, key))) return null;
  if (typeof value.scene !== 'string' || !SCENES.includes(value.scene)) return null;
  const out = { scene: value.scene };
  for (const key of BOOLEAN_KEYS) {
    if (typeof value[key] !== 'boolean') return null;
    out[key] = value[key];
  }
  return out;
}

function buildMenuTemplate({ platform, packaged, state, send, openExternal, showAbout }) {
  const mac = platform === 'darwin';
  const command = (id, label, extra = {}) => ({ id, label, click: () => send(id), ...extra });
  const exportable = state.hasTake && !state.exporting;
  const preferences = () => command('preferences', 'Preferences…', { accelerator: 'CmdOrCtrl+,' });
  const about = () => ({ id: 'about', label: 'About Idlewild', click: showAbout });
  const sep = { type: 'separator' };

  const appMenu = mac ? [{
    label: 'Idlewild',
    submenu: [about(), sep, preferences(), sep, { role: 'services' }, sep, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' }],
  }] : [];

  const file = {
    label: 'File',
    submenu: [
      command('import-character', 'Import Character…', { accelerator: 'CmdOrCtrl+O' }),
      command('open-takes', 'Takes…', { accelerator: 'CmdOrCtrl+T' }),
      sep,
      command('export', 'Export…', { accelerator: 'CmdOrCtrl+E', enabled: exportable }),
      {
        label: 'Export As', enabled: exportable,
        submenu: [
          command('export-video', 'Video (WebM)', { enabled: exportable }),
          command('export-wav', 'Sound (WAV)', { enabled: exportable }),
          command('export-glb', 'Animation (GLB)', { enabled: exportable }),
          command('export-csv', 'Signal curves (CSV)', { enabled: exportable }),
          command('export-json', 'Control data (JSON)', { enabled: exportable }),
        ],
      },
      sep,
      ...(mac ? [{ role: 'close' }] : [preferences(), sep, { role: 'quit' }]),
    ],
  };

  const performance = {
    label: 'Performance',
    submenu: [
      command('use-camera', 'Use Camera…', { accelerator: 'CmdOrCtrl+Shift+C', enabled: !state.inputActive }),
      command('start-rehearsal', 'Start Rehearsal', { accelerator: 'CmdOrCtrl+Shift+R', enabled: !state.inputActive }),
      command('stop-input', 'Stop Input', { accelerator: 'CmdOrCtrl+.', enabled: state.inputActive }),
      sep,
      command('record', state.recording ? 'Stop Recording' : 'Record Take', { accelerator: 'CmdOrCtrl+R', enabled: state.canRecord || state.recording }),
      command('play', state.playing ? 'Pause' : 'Play', { accelerator: 'Space', registerAccelerator: false, enabled: state.hasTake }),
      command('loop', 'Loop', { type: 'checkbox', checked: state.loop, accelerator: 'CmdOrCtrl+L' }),
      command('edit-take', 'Edit Take…', { enabled: state.hasTake && !state.recording }),
    ],
  };

  const character = {
    label: 'Character',
    submenu: SCENES.map((scene, index) => command(`scene:${scene}`, SCENE_LABELS[scene], {
      type: 'radio', checked: state.scene === scene, accelerator: `CmdOrCtrl+${index + 1}`, enabled: !state.exporting && !state.recording,
    })),
  };

  const view = {
    label: 'View',
    submenu: [
      command('show-signals', 'Show Signal Panel', { type: 'checkbox', checked: state.showSignals, accelerator: 'CmdOrCtrl+Shift+S' }),
      command('reduce-motion', 'Reduce Motion', { type: 'checkbox', checked: state.reducedMotion, accelerator: 'CmdOrCtrl+Shift+M' }),
      command('sound', 'Sound', { type: 'checkbox', checked: state.sound, accelerator: 'CmdOrCtrl+Shift+A' }),
      sep,
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      sep,
      { role: 'togglefullscreen' },
      ...(packaged ? [] : [sep, { role: 'toggleDevTools' }]),
    ],
  };

  const help = {
    role: 'help',
    submenu: [
      command('guide', 'Studio Guide'),
      command('shortcuts', 'Keyboard Shortcuts', { accelerator: 'CmdOrCtrl+/' }),
      command('privacy', 'Data & Privacy'),
      command('credits', 'Credits & Licenses'),
      sep,
      { id: 'link:sdk-docs', label: 'SmartSpectra SDK documentation', click: () => openExternal(SDK_DOCS_URL) },
      { id: 'link:presage', label: 'Presage SmartSpectra', click: () => openExternal(PRESAGE_URL) },
      ...(mac ? [] : [sep, about()]),
    ],
  };

  return [...appMenu, file, { role: 'editMenu' }, performance, character, view, { role: 'windowMenu' }, help];
}

module.exports = { MENU_COMMANDS, INITIAL_MENU_STATE, SCENES, validateMenuState, buildMenuTemplate };
