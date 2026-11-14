export const MENU_COMMANDS = Object.freeze([
  'preferences', 'import-character', 'open-takes', 'export', 'export-video', 'export-wav', 'export-glb', 'export-csv', 'export-json',
  'use-camera', 'start-rehearsal', 'stop-input', 'record', 'play', 'loop', 'edit-take',
  'scene:rex', 'scene:bubbles', 'scene:star', 'scene:sprite', 'scene:runner', 'scene:brain', 'scene:imported',
  'show-signals', 'reduce-motion', 'sound', 'guide', 'shortcuts', 'privacy', 'credits',
] as const);

export type MenuCommand = typeof MENU_COMMANDS[number];

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value);
}
