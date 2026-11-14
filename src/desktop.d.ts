import type { CaptureStatus, ControlFrame } from './contracts';

export interface DesktopBridge {
  setKey(key: string): Promise<void>;
  clearKey(): Promise<void>;
  allowCamera(allowed: boolean): Promise<void>;
  startLive(consent: boolean, extended?: boolean): Promise<void>;
  stopLive(): Promise<void>;
  sendFrame(frame: { bytes: Uint8Array; width: number; height: number; stride: number; timestampUs: number }): Promise<unknown>;
  onFrame(callback: (frame: ControlFrame) => void): () => void;
  onStatus(callback: (status: CaptureStatus) => void): () => void;
}

declare global { interface Window { idlewild?: DesktopBridge; } }
