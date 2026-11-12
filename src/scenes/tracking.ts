import * as THREE from 'three';
import { FACE_SHAPES, type BodyJoint, type FaceShape, type SceneFrame, type TrackingFrame, type TrackingPoint } from '../contracts.ts';
import { trackingAt } from '../tracking-frame.ts';

export interface CharacterMorph { mesh: THREE.Mesh; index: number; name: string }
type PointSource = BodyJoint | readonly [BodyJoint, BodyJoint];
interface Segment { bone: THREE.Bone; end: THREE.Object3D; from: PointSource; to: PointSource; limit: number }
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function point(value: TrackingPoint | undefined): value is TrackingPoint {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    value.slice(0, 3).every(coordinate => Math.abs(coordinate) <= 5) && value[3] >= 0.6 && value[3] <= 1;
}

function descendant(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let parent = object.parent; parent; parent = parent.parent) if (parent === ancestor) return true;
  return false;
}

function faceSources(name: string, available: Set<string>): readonly FaceShape[] | null {
  const direct = FACE_SHAPES.find(shape => normalize(shape) === name);
  if (direct && !(name === 'mouthfunnel' && !available.has('mouthpucker'))) return [direct];
  switch (name) {
    case 'blinkleft': return ['eyeBlinkLeft'];
    case 'blinkright': return ['eyeBlinkRight'];
    case 'blink': return ['eyeBlinkLeft', 'eyeBlinkRight'];
    case 'mouthopen': return ['jawOpen'];
    case 'smile': case 'smileopen': return ['mouthSmileLeft', 'mouthSmileRight'];
    case 'browdown': return ['browDownLeft', 'browDownRight'];
    case 'mouthfunnel': return ['mouthFunnel', 'mouthPucker'];
    case 'mouthff': return ['mouthPressLeft', 'mouthPressRight'];
    default: return null;
  }
}

export function createTracking(model: THREE.Object3D, bones: readonly THREE.Bone[], morphs: readonly CharacterMorph[]) {
  const byName = new Map(bones.map(bone => [normalize(bone.name), bone]));
  const find = (...names: string[]) => names.map(name => byName.get(name)).find(bone => bone !== undefined);
  const objects = new Map<string, THREE.Object3D>();
  model.traverse(object => { if (!objects.has(normalize(object.name))) objects.set(normalize(object.name), object); });
  const segments: Segment[] = [];
  function add(bone: THREE.Bone | undefined, end: THREE.Object3D | undefined, from: PointSource, to: PointSource, limit = Math.PI) {
    if (bone && end && descendant(end, bone)) segments.push({ bone, end, from, to, limit });
  }
  add(find('defspine', 'mixamorigspine', 'spine', 'abdomen'),
    find('chest', 'defchest', 'mixamorigspine2', 'spine2', 'torso', 'defneck', 'mixamorigneck', 'neck'),
    ['leftHip', 'rightHip'], ['leftShoulder', 'rightShoulder'], Math.PI / 3);
  for (const [side, suffix] of [['left', 'l'], ['right', 'r']] as const) {
    const shoulder = find(`defshoulder${suffix}`, `mixamorig${side}shoulder`, `${side}shoulder`, `shoulder${suffix}`);
    const arm = find(`defupperarm1${suffix}`, `mixamorig${side}arm`, `${side}arm`, `upperarm${suffix}`);
    const forearm = find(`defforearm1${suffix}`, `mixamorig${side}forearm`, `${side}forearm`, `lowerarm${suffix}`, `forearm${suffix}`);
    const hand = find(`defwrist${suffix}`, `mixamorig${side}hand`, `${side}hand`, `wrist${suffix}`, `palm2${suffix}`, `hand${suffix}`);
    const thigh = find(`defthigh1${suffix}`, `mixamorig${side}upleg`, `${side}upleg`, `upperleg${suffix}`, `thigh${suffix}`);
    const shin = find(`defknee1${suffix}`, `mixamorig${side}leg`, `${side}leg`, `lowerleg${suffix}`, `calf${suffix}`);
    const foot = find(`deffoot${suffix}`, `mixamorig${side}foot`, `${side}foot`, `foot${suffix}`);
    add(shoulder, arm, ['leftShoulder', 'rightShoulder'], `${side}Shoulder`, Math.PI / 3);
    add(arm, forearm, `${side}Shoulder`, `${side}Elbow`);
    add(forearm, hand, `${side}Elbow`, `${side}Wrist`);
    add(thigh, shin, `${side}Hip`, `${side}Knee`);
    add(shin, foot && shin && descendant(foot, shin) ? foot : objects.get(`lowerleg${suffix}end`), `${side}Knee`, `${side}Ankle`);
  }
  const depth = (bone: THREE.Bone) => { let value = 0; for (let parent = bone.parent; parent; parent = parent.parent) value++; return value; };
  segments.sort((a, b) => depth(a.bone) - depth(b.bone));
  const available = new Set(morphs.map(morph => normalize(morph.name)));
  const faces = morphs.flatMap(morph => {
    const name = normalize(morph.name), sources = faceSources(name, available);
    return sources ? [{ ...morph, sources, maximum: name === 'mouthfunnel' }] : [];
  });
  const head = find('defhead', 'mixamorighead', 'head');
  const headBasis = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion(), rotation = new THREE.Quaternion(), delta = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), observed = new THREE.Vector3();
  const origin = new THREE.Vector3(), destination = new THREE.Vector3();
  if (head) headBasis.copy(model.getWorldQuaternion(parentRotation).invert()).multiply(head.getWorldQuaternion(rotation));

  function read(body: NonNullable<TrackingFrame['body']>, source: PointSource, target: THREE.Vector3): boolean {
    if (typeof source === 'string') {
      const value = body[source];
      if (!point(value)) return false;
      target.set(value[0], value[1], value[2]);
    } else {
      const a = body[source[0]], b = body[source[1]];
      if (!point(a) || !point(b)) return false;
      target.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    }
    return true;
  }

  function applyWorld(bone: THREE.Bone, target: THREE.Quaternion, amount: number) {
    if (bone.parent) target.premultiply(bone.parent.getWorldQuaternion(parentRotation).invert());
    if (![target.x, target.y, target.z, target.w].every(Number.isFinite) || target.lengthSq() < 1e-8) return;
    bone.quaternion.slerp(target.normalize(), amount).normalize();
  }

  return (input: SceneFrame) => {
    const tracking = input.reducedMotion ? null : trackingAt(input);
    const amount = Number.isFinite(input.controls.motion) ? THREE.MathUtils.clamp(input.controls.motion, 0, 1) : 0;
    if (!tracking || amount === 0) return;
    if (tracking.body) for (const segment of segments) {
      if (!read(tracking.body, segment.from, from) || !read(tracking.body, segment.to, to)) continue;
      observed.subVectors(to, from);
      if (observed.lengthSq() < 1e-8 || observed.lengthSq() > 9) continue;
      segment.bone.getWorldPosition(origin);
      segment.end.getWorldPosition(destination);
      destination.sub(origin);
      if (!Number.isFinite(destination.lengthSq()) || destination.lengthSq() < 1e-10) continue;
      delta.setFromUnitVectors(destination.normalize(), observed.normalize());
      const angle = identity.angleTo(delta);
      if (angle > segment.limit) delta.slerp(identity, 1 - segment.limit / angle);
      rotation.copy(delta).multiply(segment.bone.getWorldQuaternion(parentRotation));
      applyWorld(segment.bone, rotation, amount);
    }
    if (!tracking.face) return;
    for (const morph of faces) {
      const values = morph.sources.map(source => tracking.face!.weights[source]);
      if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) continue;
      const value = morph.maximum ? Math.max(...values) : values.reduce((sum, current) => sum + current, 0) / values.length;
      const weights = morph.mesh.morphTargetInfluences!;
      weights[morph.index] = THREE.MathUtils.lerp(weights[morph.index], value, amount);
    }
    const orientation = tracking.face.rotation;
    if (head && Array.isArray(orientation) && orientation.length === 4 && orientation.every(Number.isFinite)) {
      delta.fromArray(orientation);
      if (delta.lengthSq() < 0.99 || delta.lengthSq() > 1.01) return;
      delta.normalize();
      const angle = identity.angleTo(delta);
      if (angle > Math.PI / 2) delta.slerp(identity, 1 - Math.PI / 2 / angle);
      rotation.copy(delta).multiply(model.getWorldQuaternion(parentRotation)).multiply(headBasis);
      applyWorld(head, rotation, amount);
    }
  };
}
