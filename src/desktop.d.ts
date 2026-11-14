import type { CaptureStatus, ControlFrame } from './contracts';

export type MenuScene = 'rex' | 'bubbles' | 'star' | 'sprite' | 'runner' | 'brain' | 'imported';

export interface MenuState {
  scene: MenuScene;
  inputActive: boolean;
  recording: boolean;
  playing: boolean;
  hasTake: boolean;
  canRecord: boolean;
  exporting: boolean;
  loop: boolean;
  showSignals: boolean;
  reducedMotion: boolean;
  sound: boolean;
}

export interface Preferences {
  scene: Exclude<MenuScene, 'imported'>;
  motion: number;
  sensitivity: number;
  sound: number;
  showSignals: boolean;
  reducedMotion: 'system' | 'on' | 'off';
  liveTracking: boolean;
  liveExtended: boolean;
  exportSignals: boolean;
  loop: boolean;
}

export interface DesktopBridge {
  setKey(key: string): Promise<void>;
  clearKey(): Promise<void>;
  allowCamera(allowed: boolean): Promise<void>;
  startLive(consent: boolean, extended?: boolean): Promise<void>;
  stopLive(): Promise<void>;
  sendFrame(frame: { bytes: Uint8Array; width: number; height: number; stride: number; timestampUs: number }): Promise<unknown>;
  onFrame(callback: (frame: ControlFrame) => void): () => void;
  onStatus(callback: (status: CaptureStatus) => void): () => void;
  onMenu(callback: (command: string) => void): () => void;
  setMenuState(state: MenuState): void;
  getPreferences(): Promise<Preferences>;
  setPreferences(partial: Partial<Preferences>): Promise<Preferences>;
}

declare global { interface Window { idlewild?: DesktopBridge; } }
