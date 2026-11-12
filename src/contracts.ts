export const TAKE_LIMITS = Object.freeze({ seconds: 180, samplesPerSecond: 20, takes: 6 });
export const SIGNAL_STALE_MS = 1500;

export type Source = 'live' | 'rehearsal' | 'local-camera';
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

export const CORE_FACE_SHAPES = ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'mouthFunnel', 'mouthPucker', 'mouthClose', 'mouthPressLeft', 'mouthPressRight'] as const;
export const FACE_SHAPES = [...CORE_FACE_SHAPES, '_neutral', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawRight', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight'] as const;
export type FaceShape = typeof FACE_SHAPES[number];
export type FaceWeights = Record<typeof CORE_FACE_SHAPES[number], number> & Partial<Record<FaceShape, number>>;
export const BODY_JOINTS = ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] as const;
export type BodyJoint = typeof BODY_JOINTS[number];
export type TrackingPoint = [number, number, number, number];
export const TRACKING_STALE_MS = 300;

export interface TrackingFraming {
  face: boolean;
  upperBody: boolean;
  fullBody: boolean;
  tooClose: boolean;
}

export interface TrackingFrame {
  sampledAtMs: number;
  face: { weights: FaceWeights; rotation: [number, number, number, number] | null; sampledAtMs?: number } | null;
  body: Partial<Record<BodyJoint, TrackingPoint>> | null;
  movement: number | null;
  framing?: TrackingFraming;
}

export interface ControlFrame {
  sessionId: string;
  source: Source;
  timeMs: number;
  signals: Record<Channel, Signal>;
  tracking?: TrackingFrame;
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
