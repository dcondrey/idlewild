export const TAKE_LIMITS = Object.freeze({ seconds: 180, samplesPerSecond: 20, takes: 6 });
export const SIGNAL_STALE_MS = 1500;

export type Source = 'live' | 'rehearsal';
export type Quality = 'valid' | 'unstable' | 'missing' | 'stale';
export type Channel = 'breath' | 'breathingRate' | 'pulseRate' | 'arterialTrace' | 'blink' | 'talking';
export type Unit = 'relative' | 'breaths/min' | 'beats/min' | 'boolean';
export type SceneId = 'robot' | 'bubbles' | 'star' | 'dragon' | 'baby-dragon' | 'runner' | 'brain' | 'imported';
export type Provenance = 'measured' | 'synthetic' | 'replayed';

export interface Signal {
  value: number | null;
  quality: Quality;
  confidence: number | null;
  sampledAtMs: number;
  unit: Unit;
  provenance?: Provenance;
}

export interface ControlFrame {
  sessionId: string;
  source: Source;
  timeMs: number;
  signals: Record<Channel, Signal>;
}

export type CapturePhase = 'idle' | 'starting' | 'warming' | 'ready' | 'poor-signal' | 'stopping' | 'error';
export interface CaptureStatus {
  phase: CapturePhase;
  message: string;
  sessionId: string | null;
}

export interface CaptureSource {
  start(onFrame: (frame: ControlFrame) => void, onStatus: (status: CaptureStatus) => void): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export interface SceneControls {
  motion: number;
  sensitivity: number;
  sound: number;
}

export interface SceneFrame {
  timeMs: number;
  seed: number;
  controls: SceneControls;
  frame: ControlFrame | null;
  reducedMotion: boolean;
}

export interface PerformanceScene {
  update(input: SceneFrame): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface Take {
  version: 1;
  id: string;
  source: Source;
  sessionId: string;
  seed: number;
  durationMs: number;
  samples: ControlFrame[];
}
