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

const JOINT_INDICES: Record<BodyJoint, number> = {
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
};
export const MIN_JOINT_CONFIDENCE = 0.65;

function finite(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function rounded(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function rotationFrom(result: FaceResult): NonNullable<TrackingFrame['face']>['rotation'] {
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
  return [rounded(rotation.x), rounded(rotation.y), rounded(rotation.z), rounded(rotation.w)];
}

function faceFrom(result: FaceResult | null): TrackingFrame['face'] {
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
    weights[name] = rounded(category.score);
  }
  if (FACE_SHAPES.some(name => weights[name] === undefined)) return null;
  return { weights: weights as Record<FaceShape, number>, rotation: rotationFrom(result) };
}

function confidence(point: Landmark): number {
  if (!finite(point.visibility ?? NaN, 0, 1) || (point.presence !== undefined && !finite(point.presence, 0, 1))) return 0;
  return Math.min(point.visibility!, point.presence ?? 1);
}

function bodyFrom(result: PoseResult | null): TrackingFrame['body'] {
  if (!result || result.worldLandmarks.length !== 1 || result.landmarks.length !== 1) return null;
  const world = result.worldLandmarks[0];
  const image = result.landmarks[0];
  if (world.length !== 33 || image.length !== 33) return null;
  const body: Partial<Record<BodyJoint, TrackingPoint>> = {};
  for (const name of BODY_JOINTS) {
    const point = world[JOINT_INDICES[name]];
    const normalized = image[JOINT_INDICES[name]];
    const certainty = Math.min(confidence(point), confidence(normalized));
    if (certainty < MIN_JOINT_CONFIDENCE || !finite(normalized.x, 0, 1) || !finite(normalized.y, 0, 1)
      || !finite(point.x, -5, 5) || !finite(point.y, -5, 5) || !finite(point.z, -5, 5)) continue;
    body[name] = [rounded(point.x), rounded(-point.y), rounded(-point.z), rounded(certainty)];
  }
  return Object.keys(body).length ? body : null;
}

function missing(timeMs: number, unit: Unit): Signal {
  return { value: null, quality: 'missing', confidence: null, sampledAtMs: timeMs, unit, provenance: 'measured' };
}

export function createTrackingMapper(sessionId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sessionId)) throw new Error('Invalid tracking session');
  let previous: TrackingFrame | null = null;
  return (face: FaceResult | null, pose: PoseResult | null, sampledAtMs: number): ControlFrame => {
    if (!finite(sampledAtMs, 0, Number.MAX_SAFE_INTEGER) || (previous && sampledAtMs <= previous.sampledAtMs)) throw new Error('Invalid tracking timestamp');
    const body = bodyFrom(pose);
    let movement: number | null = null;
    if (body && previous?.body && sampledAtMs - previous.sampledAtMs <= TRACKING_STALE_MS) {
      const speeds: number[] = [];
      for (const name of BODY_JOINTS) {
        const point = body[name];
        const last = previous.body[name];
        if (point && last) speeds.push(Math.hypot(point[0] - last[0], point[1] - last[1], point[2] - last[2]) * 1000 / (sampledAtMs - previous.sampledAtMs));
      }
      if (speeds.length >= 3) movement = rounded(Math.min(1, speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length / 2));
    }
    const tracking: TrackingFrame = { sampledAtMs, face: faceFrom(face), body, movement };
    previous = tracking;
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
