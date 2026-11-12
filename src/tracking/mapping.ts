import { BODY_JOINTS, FACE_SHAPES, TRACKING_STALE_MS } from '../contracts.ts';
import type { BodyJoint, ControlFrame, FaceShape, Signal, TrackingFrame, TrackingPoint, Unit } from '../contracts.ts';
import { Matrix4, Quaternion, Vector3 } from 'three';

interface Landmark { x: number; y: number; z: number; visibility?: number; presence?: number }
interface FaceResult {
  faceLandmarks: Landmark[][];
  faceBlendshapes: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes?: { rows: number; columns: number; data: number[] }[];
}
interface PoseResult { landmarks: Landmark[][]; worldLandmarks: Landmark[][] }
interface FilterParameters { minCutoff: number; beta: number; derivativeCutoff: number }
type Rotation = [number, number, number, number];
export type FaceCamera = 'body' | 'face';

const JOINT_INDICES: Record<BodyJoint, number> = {
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
};
const FRAMING_LANDMARKS = [0, 2, 5, 7, 8, 11, 12, 23, 24, 25, 26, 27, 28];
const FULL_BODY_JOINTS: readonly BodyJoint[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'];
const FAST_FACE_SHAPES: ReadonlySet<FaceShape> = new Set(['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen']);
export const MIN_JOINT_CONFIDENCE = 0.6;
export const RETAIN_JOINT_CONFIDENCE = 0.45;
export const FRAMING_ENTER_MARGIN = 0.01;
export const FRAMING_EXIT_MARGIN = 0.04;
const POSITION_FILTER: FilterParameters = { minCutoff: 0.3, beta: 8, derivativeCutoff: 1 };
const ROTATION_FILTER: FilterParameters = { minCutoff: 0.3, beta: 8, derivativeCutoff: 1 };
const FACE_FILTER: FilterParameters = { minCutoff: 0.4, beta: 3, derivativeCutoff: 0.5 };
const FAST_FACE_FILTER: FilterParameters = { minCutoff: 0.5, beta: 2, derivativeCutoff: 2 };
// Longer gaps would make the next sample nearly unfiltered; capping the smoothing step eases recovery after a held dropout.
const FILTER_STEP_LIMIT_S = 0.05;
const SLOTS = 3;

function finite(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function rounded(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function smoothing(cutoff: number, seconds: number): number {
  return 1 / (1 + 1 / (2 * Math.PI * cutoff * seconds));
}

function filtered(state: Float64Array, slot: number, value: number, seconds: number, parameters: FilterParameters): number {
  const index = slot * SLOTS;
  const rate = state[index + 2] + smoothing(parameters.derivativeCutoff, seconds) * ((value - state[index + 1]) / seconds - state[index + 2]);
  const estimate = state[index] + smoothing(parameters.minCutoff + parameters.beta * Math.abs(rate), Math.min(seconds, FILTER_STEP_LIMIT_S)) * (value - state[index]);
  state[index] = estimate;
  state[index + 1] = value;
  state[index + 2] = rate;
  return estimate;
}

function restarted(state: Float64Array, slot: number, value: number): number {
  const index = slot * SLOTS;
  state[index] = value;
  state[index + 1] = value;
  state[index + 2] = 0;
  return value;
}

function rotationFrom(result: FaceResult): Rotation | null {
  const matrices = result.facialTransformationMatrixes;
  if (matrices?.length !== 1) return null;
  const value = matrices[0];
  if (value.rows !== 4 || value.columns !== 4 || value.data.length !== 16 || value.data.some(entry => !finite(entry, -1e6, 1e6))) return null;
  if ([3, 7, 11].some(index => Math.abs(value.data[index]) > 1e-5) || Math.abs(value.data[15] - 1) > 1e-5) return null;
  const matrix = new Matrix4().fromArray(value.data);
  const x = new Vector3().setFromMatrixColumn(matrix, 0);
  const y = new Vector3().setFromMatrixColumn(matrix, 1);
  const z = new Vector3().setFromMatrixColumn(matrix, 2);
  if ([x, y, z].some(axis => !finite(axis.length(), 0.001, 100)) || matrix.determinant() <= 0) return null;
  x.normalize(); y.normalize(); z.normalize();
  if (Math.max(Math.abs(x.dot(y)), Math.abs(y.dot(z)), Math.abs(z.dot(x))) > 0.01) return null;
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)).normalize();
  return [rotation.x, rotation.y, rotation.z, rotation.w];
}

function faceFrom(result: FaceResult | null): { weights: Record<FaceShape, number>; rotation: Rotation | null } | null {
  if (!result || result.faceLandmarks.length !== 1 || result.faceBlendshapes.length !== 1) return null;
  const landmarks = result.faceLandmarks[0];
  if (landmarks.length !== 478 || landmarks.some(point => !finite(point.x, -5, 5) || !finite(point.y, -5, 5) || !finite(point.z, -5, 5))) return null;
  const categories = result.faceBlendshapes[0].categories;
  if (categories.length > 64) return null;
  const weights: Partial<Record<FaceShape, number>> = {};
  for (const category of categories) {
    if (!(FACE_SHAPES as readonly string[]).includes(category.categoryName)) continue;
    const name = category.categoryName as FaceShape;
    if (weights[name] !== undefined || !finite(category.score, 0, 1)) return null;
    weights[name] = category.score;
  }
  if (FACE_SHAPES.some(name => weights[name] === undefined)) return null;
  return { weights: weights as Record<FaceShape, number>, rotation: rotationFrom(result) };
}

function confidence(point: Landmark): number {
  if (!finite(point.visibility ?? NaN, 0, 1) || (point.presence !== undefined && !finite(point.presence, 0, 1))) return 0;
  return Math.min(point.visibility!, point.presence ?? 1);
}

function poseFrom(result: PoseResult | null): { world: Landmark[]; image: Landmark[] } | null {
  if (!result || result.worldLandmarks.length !== 1 || result.landmarks.length !== 1) return null;
  const world = result.worldLandmarks[0];
  const image = result.landmarks[0];
  return world.length === 33 && image.length === 33 ? { world, image } : null;
}

function certainty(world: Landmark, image: Landmark, threshold: number): number | null {
  const value = Math.min(confidence(world), confidence(image));
  if (value < threshold || !finite(image.x, 0, 1) || !finite(image.y, 0, 1)
    || !finite(world.x, -5, 5) || !finite(world.y, -5, 5) || !finite(world.z, -5, 5)) return null;
  return value;
}

function edgeMargin(image: Landmark[]): number | null {
  let margin = Infinity;
  for (const index of FRAMING_LANDMARKS) {
    const point = image[index];
    if (!finite(point.x, -5, 5) || !finite(point.y, -5, 5)) return null;
    margin = Math.min(margin, point.x, 1 - point.x, point.y, 1 - point.y);
  }
  return margin;
}

function missing(timeMs: number, unit: Unit): Signal {
  return { value: null, quality: 'missing', confidence: null, sampledAtMs: timeMs, unit, provenance: 'measured' };
}

export function createTrackingMapper(sessionId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sessionId)) throw new Error('Invalid tracking session');
  let previousMs: number | null = null;
  const bodyState = new Float64Array(BODY_JOINTS.length * 3 * SLOTS);
  const bodyMeasuredMs = new Float64Array(BODY_JOINTS.length).fill(-Infinity);
  const bodyConfidence = new Float64Array(BODY_JOINTS.length);
  const faceState = new Float64Array(FACE_SHAPES.length * SLOTS);
  const rotationState = new Float64Array(4 * SLOTS);
  let rotationMs = -Infinity;
  let lastFace: NonNullable<TrackingFrame['face']> | null = null;
  let lastFaceMs = -Infinity;
  let lastFaceCamera: FaceCamera = 'body';
  let tooClose = false;
  let framedMs = -Infinity;

  function bodyPoint(joint: number, score: number): TrackingPoint {
    const index = joint * 3 * SLOTS;
    return [rounded(bodyState[index]), rounded(bodyState[index + SLOTS]), rounded(bodyState[index + 2 * SLOTS]), rounded(score)];
  }

  function heldFace(): NonNullable<TrackingFrame['face']> {
    return { weights: { ...lastFace!.weights }, rotation: lastFace!.rotation ? [...lastFace!.rotation] : null, sampledAtMs: lastFaceMs };
  }

  function rotationAt(rotation: Rotation | null, timeMs: number, continuous: boolean): Rotation | null {
    if (!rotation) return null;
    const age = timeMs - rotationMs;
    if (continuous && age <= TRACKING_STALE_MS) {
      let dot = 0;
      for (let axis = 0; axis < 4; axis++) dot += rotationState[axis * SLOTS] * rotation[axis];
      const sign = dot < 0 ? -1 : 1;
      let length = 0;
      for (let axis = 0; axis < 4; axis++) length += filtered(rotationState, axis, sign * rotation[axis], age / 1000, ROTATION_FILTER) ** 2;
      length = Math.sqrt(length);
      for (let axis = 0; axis < 4; axis++) rotationState[axis * SLOTS] /= length;
    } else for (let axis = 0; axis < 4; axis++) restarted(rotationState, axis, rotation[axis]);
    rotationMs = timeMs;
    return [rounded(rotationState[0]), rounded(rotationState[SLOTS]), rounded(rotationState[2 * SLOTS]), rounded(rotationState[3 * SLOTS])];
  }

  return (face: FaceResult | null, pose: PoseResult | null, sampledAtMs: number, faceSampledAtMs = sampledAtMs, faceCamera: FaceCamera = 'body'): ControlFrame => {
    if (!finite(sampledAtMs, 0, Number.MAX_SAFE_INTEGER) || (previousMs !== null && sampledAtMs <= previousMs)) throw new Error('Invalid tracking timestamp');
    if (face && (!finite(faceSampledAtMs, 0, sampledAtMs) || (lastFace && faceSampledAtMs < lastFaceMs))) throw new Error('Invalid face timestamp');
    const continuous = previousMs !== null && sampledAtMs - previousMs <= TRACKING_STALE_MS;
    const landmarks = poseFrom(pose);
    const tracked: Partial<Record<BodyJoint, TrackingPoint>> = {};
    let speed = 0;
    let moving = 0;
    for (let joint = 0; joint < BODY_JOINTS.length; joint++) {
      const name = BODY_JOINTS[joint];
      const index = JOINT_INDICES[name];
      const age = sampledAtMs - bodyMeasuredMs[joint];
      const retained = continuous && bodyMeasuredMs[joint] === previousMs;
      const measured = landmarks ? certainty(landmarks.world[index], landmarks.image[index], retained ? RETAIN_JOINT_CONFIDENCE : MIN_JOINT_CONFIDENCE) : null;
      if (measured !== null) {
        const world = landmarks!.world[index];
        let distance = 0;
        for (let axis = 0; axis < 3; axis++) {
          const slot = joint * 3 + axis;
          const value = axis === 0 ? world.x : axis === 1 ? -world.y : -world.z;
          const before = bodyState[slot * SLOTS];
          const estimate = age <= TRACKING_STALE_MS ? filtered(bodyState, slot, value, age / 1000, POSITION_FILTER) : restarted(bodyState, slot, value);
          distance += (estimate - before) ** 2;
        }
        if (retained) { speed += Math.sqrt(distance) * 1000 / age; moving++; }
        bodyMeasuredMs[joint] = sampledAtMs;
        bodyConfidence[joint] = measured;
        tracked[name] = bodyPoint(joint, measured);
      } else if (age < TRACKING_STALE_MS) {
        const held = bodyConfidence[joint];
        tracked[name] = bodyPoint(joint, held - Math.max(0, held - RETAIN_JOINT_CONFIDENCE) * age / TRACKING_STALE_MS);
      }
    }
    const body = Object.keys(tracked).length ? tracked : null;

    let trackedFace: TrackingFrame['face'] = null;
    const measuredFace = sampledAtMs - faceSampledAtMs < TRACKING_STALE_MS ? faceFrom(face) : null;
    if (measuredFace && lastFace && faceSampledAtMs === lastFaceMs && faceCamera === lastFaceCamera) trackedFace = heldFace();
    else if (measuredFace) {
      const age = faceSampledAtMs - lastFaceMs;
      const sameCamera = lastFace !== null && faceCamera === lastFaceCamera;
      const weights = {} as Record<FaceShape, number>;
      for (let slot = 0; slot < FACE_SHAPES.length; slot++) {
        const name = FACE_SHAPES[slot];
        const value = measuredFace.weights[name];
        weights[name] = rounded(sameCamera && age <= TRACKING_STALE_MS
          ? filtered(faceState, slot, value, age / 1000, FAST_FACE_SHAPES.has(name) ? FAST_FACE_FILTER : FACE_FILTER)
          : restarted(faceState, slot, value));
      }
      lastFace = { weights, rotation: rotationAt(measuredFace.rotation, faceSampledAtMs, sameCamera), sampledAtMs: faceSampledAtMs };
      lastFaceMs = faceSampledAtMs;
      lastFaceCamera = faceCamera;
      trackedFace = heldFace();
    } else if (lastFace && sampledAtMs - lastFaceMs < TRACKING_STALE_MS) trackedFace = heldFace();

    const margin = landmarks ? edgeMargin(landmarks.image) : null;
    if (margin !== null) {
      tooClose = tooClose && sampledAtMs - framedMs <= TRACKING_STALE_MS ? margin < FRAMING_EXIT_MARGIN : margin <= FRAMING_ENTER_MARGIN;
      framedMs = sampledAtMs;
    } else if (sampledAtMs - framedMs > TRACKING_STALE_MS) tooClose = false;
    const upperBody = body !== null && body.leftShoulder !== undefined && body.rightShoulder !== undefined;
    const fullBody = body !== null && upperBody && FULL_BODY_JOINTS.every(name => body[name] !== undefined);
    const tracking: TrackingFrame = {
      sampledAtMs, face: trackedFace, body,
      movement: moving >= 3 ? rounded(Math.min(1, speed / moving / 2)) : null,
      framing: { face: trackedFace !== null, upperBody, fullBody, tooClose },
    };
    previousMs = sampledAtMs;
    return {
      sessionId, source: 'local-camera', timeMs: sampledAtMs, tracking,
      signals: {
        breath: missing(sampledAtMs, 'relative'), breathingRate: missing(sampledAtMs, 'breaths/min'),
        pulseRate: missing(sampledAtMs, 'beats/min'), arterialTrace: missing(sampledAtMs, 'relative'),
        blink: missing(sampledAtMs, 'boolean'), talking: missing(sampledAtMs, 'boolean'),
      },
    };
  };
}
