import * as THREE from 'three';
import { FACE_SHAPES, type BodyJoint, type FaceShape, type SceneFrame, type TrackingFrame } from '../contracts.ts';
import { trackingAt } from '../tracking-frame.ts';
import { clamp, confidenceWeight, sceneDynamics, trackedPoint, trackingStrength } from './dynamics.ts';

export interface CharacterMorph { mesh: THREE.Mesh; index: number; name: string }
type PointSource = BodyJoint | readonly [BodyJoint, BodyJoint];
interface Segment { bone: THREE.Bone; end: THREE.Object3D; from: PointSource; to: PointSource; limit: number; direction: THREE.Vector3; rotation: THREE.Quaternion }
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export const BONE_ALIASES = Object.freeze({
  spine: ['defspine', 'mixamorigspine', 'spine', 'spine01', 'abdomen'],
  chest: ['chest', 'defchest', 'defribcage', 'defspine003', 'mixamorigspine2', 'spine2', 'spine03', 'upperchest', 'torso', 'mixamorigspine1', 'spine1', 'spine02', 'stomach'],
  neck: ['defneck', 'mixamorigneck', 'neck', 'neck01'],
  head: ['defhead', 'mixamorighead', 'head'],
  jaw: ['defjaw', 'jaw', 'mixamorigjaw', 'mouthlower', 'lowerjaw'],
});

function limbAliases(side: 'left' | 'right', s: 'l' | 'r') {
  return {
    shoulder: [`defshoulder${s}`, `mixamorig${side}shoulder`, `${side}shoulder`, `shoulder${s}`, `clavicle${s}`],
    arm: [`defupperarm1${s}`, `defupperarm${s}`, `mixamorig${side}arm`, `${side}upperarm`, `${side}arm`, `upperarm${s}`],
    forearm: [`defforearm1${s}`, `defforearm${s}`, `mixamorig${side}forearm`, `${side}forearm`, `${side}lowerarm`, `lowerarm${s}`, `forearm${s}`],
    hand: [`defwrist${s}`, `defhand${s}`, `mixamorig${side}hand`, `${side}hand`, `wrist${s}`, `palm2${s}`, `hand${s}`],
    thigh: [`defthigh1${s}`, `defthigh${s}`, `mixamorig${side}upleg`, `${side}upleg`, `${side}upperleg`, `upperleg${s}`, `thigh${s}`],
    shin: [`defknee1${s}`, `defshin${s}`, `mixamorig${side}leg`, `${side}leg`, `${side}lowerleg`, `lowerleg${s}`, `calf${s}`, `shin${s}`],
    foot: [`deffoot${s}`, `mixamorig${side}foot`, `${side}foot`, `foot${s}`],
  };
}

export function boneFinder(bones: readonly THREE.Bone[]) {
  const byName = new Map<string, THREE.Bone>();
  for (const bone of bones) if (!byName.has(normalize(bone.name))) byName.set(normalize(bone.name), bone);
  return (aliases: readonly string[]) => {
    for (const alias of aliases) {
      const bone = byName.get(alias);
      if (bone) return bone;
    }
    return undefined;
  };
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

const LIMITS = Object.freeze({ arm: Math.PI, elbow: 2.6, hip: 2.1, knee: 2.6, head: Math.PI / 2 });

function bodyRig(model: THREE.Object3D, bones: readonly THREE.Bone[]) {
  const find = boneFinder(bones);
  const objects = new Map<string, THREE.Object3D>();
  model.traverse(object => { if (!objects.has(normalize(object.name))) objects.set(normalize(object.name), object); });
  const segments: Segment[] = [];
  function add(bone: THREE.Bone | undefined, end: THREE.Object3D | undefined, from: PointSource, to: PointSource, limit: number) {
    if (!bone || !end || !descendant(end, bone)) return;
    const direction = end.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()));
    if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 1e-10) return;
    if (bone.parent) direction.applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    segments.push({ bone, end, from, to, limit, direction: direction.normalize(), rotation: bone.quaternion.clone() });
  }
  const spine = find(BONE_ALIASES.spine);
  add(spine, [...BONE_ALIASES.chest, ...BONE_ALIASES.neck].map(name => find([name])).find(end => end && spine && descendant(end, spine)),
    ['leftHip', 'rightHip'], ['leftShoulder', 'rightShoulder'], Math.PI / 3);
  for (const [side, suffix] of [['left', 'l'], ['right', 'r']] as const) {
    const names = limbAliases(side, suffix);
    const shoulder = find(names.shoulder), arm = find(names.arm), forearm = find(names.forearm), hand = find(names.hand);
    const thigh = find(names.thigh), shin = find(names.shin), foot = find(names.foot);
    add(shoulder, arm, ['leftShoulder', 'rightShoulder'], `${side}Shoulder`, Math.PI / 3);
    add(arm, forearm, `${side}Shoulder`, `${side}Elbow`, LIMITS.arm);
    add(forearm, hand, `${side}Elbow`, `${side}Wrist`, LIMITS.elbow);
    add(thigh, shin, `${side}Hip`, `${side}Knee`, LIMITS.hip);
    add(shin, foot && shin && descendant(foot, shin) ? foot : objects.get(`lowerleg${suffix}end`), `${side}Knee`, `${side}Ankle`, LIMITS.knee);
  }
  const depth = (bone: THREE.Bone) => { let value = 0; for (let parent = bone.parent; parent; parent = parent.parent) value++; return value; };
  segments.sort((a, b) => depth(a.bone) - depth(b.bone));
  return { segments, find };
}

function createAim() {
  const parent = new THREE.Quaternion(), rotation = new THREE.Quaternion(), delta = new THREE.Quaternion();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), axis = new THREE.Vector3();
  return (segment: Segment, direction: THREE.Vector3, amount: number) => {
    if (amount <= 0 || !Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 1e-8) return;
    if (segment.bone.parent) segment.bone.parent.getWorldQuaternion(parent); else parent.identity();
    from.copy(segment.direction).applyQuaternion(parent).normalize();
    to.copy(direction).normalize();
    axis.crossVectors(from, to);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0).applyQuaternion(parent).cross(from);
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1).applyQuaternion(parent).cross(from);
    delta.setFromAxisAngle(axis.normalize(), Math.min(from.angleTo(to), segment.limit));
    rotation.copy(delta).multiply(parent).multiply(segment.rotation).premultiply(parent.invert());
    if (![rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite) || rotation.lengthSq() < 1e-8) return;
    segment.bone.quaternion.slerp(rotation.normalize(), amount).normalize();
  };
}

export function createTracking(model: THREE.Object3D, bones: readonly THREE.Bone[], morphs: readonly CharacterMorph[]) {
  const { segments, find } = bodyRig(model, bones);
  const aim = createAim();
  const available = new Set(morphs.map(morph => normalize(morph.name)));
  const faces = morphs.flatMap(morph => {
    const name = normalize(morph.name), sources = faceSources(name, available);
    return sources ? [{ ...morph, sources, maximum: name === 'mouthfunnel' }] : [];
  });
  const head = find(BONE_ALIASES.head);
  const found = find(BONE_ALIASES.neck);
  const neck = head && found && descendant(head, found) ? found : undefined;
  const headBasis = new THREE.Quaternion(), neckBasis = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion(), rotation = new THREE.Quaternion(), delta = new THREE.Quaternion(), share = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), observed = new THREE.Vector3();
  if (head) headBasis.copy(model.getWorldQuaternion(parentRotation).invert()).multiply(head.getWorldQuaternion(rotation));
  if (neck) neckBasis.copy(model.getWorldQuaternion(parentRotation).invert()).multiply(neck.getWorldQuaternion(rotation));

  function read(body: NonNullable<TrackingFrame['body']>, source: PointSource, target: THREE.Vector3): number | null {
    if (typeof source === 'string') {
      const value = body[source];
      if (!trackedPoint(value)) return null;
      target.set(value[0], value[1], value[2]);
      return value[3];
    } else {
      const a = body[source[0]], b = body[source[1]];
      if (!trackedPoint(a) || !trackedPoint(b)) return null;
      target.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      return Math.min(a[3], b[3]);
    }
  }

  function applyWorld(bone: THREE.Bone, target: THREE.Quaternion, amount: number) {
    if (bone.parent) target.premultiply(bone.parent.getWorldQuaternion(parentRotation).invert());
    if (![target.x, target.y, target.z, target.w].every(Number.isFinite) || target.lengthSq() < 1e-8) return;
    bone.quaternion.slerp(target.normalize(), amount).normalize();
  }

  return (input: SceneFrame) => {
    const tracking = input.reducedMotion ? null : trackingAt(input);
    const amount = trackingStrength(input);
    if (!tracking || amount === 0) return;
    if (tracking.body) for (const segment of segments) {
      const a = read(tracking.body, segment.from, from), b = read(tracking.body, segment.to, to);
      if (a === null || b === null) continue;
      observed.subVectors(to, from);
      if (observed.lengthSq() < 1e-8 || observed.lengthSq() > 9) continue;
      aim(segment, observed, amount * confidenceWeight(Math.min(a, b)));
    }
    if (!tracking.face) return;
    const faceAmount = trackingStrength(input, tracking.face.sampledAtMs);
    const observedWeights = tracking.face.weights;
    for (const morph of faces) {
      let total = 0, maximum = 0, valid = true;
      for (const source of morph.sources) {
        const weight = observedWeights[source];
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) { valid = false; break; }
        total += weight;
        maximum = Math.max(maximum, weight);
      }
      if (!valid) continue;
      const weights = morph.mesh.morphTargetInfluences!;
      weights[morph.index] = THREE.MathUtils.lerp(weights[morph.index], morph.maximum ? maximum : total / morph.sources.length, faceAmount);
    }
    const orientation = tracking.face.rotation;
    if (head && Array.isArray(orientation) && orientation.length === 4 && orientation.every(Number.isFinite)) {
      delta.fromArray(orientation);
      if (delta.lengthSq() < 0.99 || delta.lengthSq() > 1.01) return;
      delta.normalize();
      const angle = identity.angleTo(delta);
      if (angle > LIMITS.head) delta.slerp(identity, 1 - LIMITS.head / angle);
      if (neck) {
        share.copy(identity).slerp(delta, 0.5);
        rotation.copy(share).multiply(model.getWorldQuaternion(parentRotation)).multiply(neckBasis);
        applyWorld(neck, rotation, faceAmount);
      }
      rotation.copy(delta).multiply(model.getWorldQuaternion(parentRotation)).multiply(headBasis);
      applyWorld(head, rotation, faceAmount);
    }
  };
}

export function createRunnerMotion(model: THREE.Object3D, bones: readonly THREE.Bone[]) {
  const { segments } = bodyRig(model, bones);
  const limbs = segments.filter(segment => typeof segment.from === 'string' && /(?:Shoulder|Elbow|Hip|Knee)$/.test(segment.from));
  if (limbs.length !== 8) throw new Error('Runner requires compatible upper and lower arm and leg segments');
  const spine = segments.find(segment => Array.isArray(segment.from) && segment.from[0] === 'leftHip');
  const feet = limbs.filter(segment => typeof segment.from === 'string' && segment.from.endsWith('Knee')).map(segment => segment.end);
  const position = new THREE.Vector3(), direction = new THREE.Vector3(), orientation = new THREE.Quaternion();
  const lowestFoot = () => {
    let lowest = Infinity;
    for (const foot of feet) lowest = Math.min(lowest, foot.getWorldPosition(position).y);
    return lowest;
  };
  const ground = lowestFoot();
  const aim = createAim();
  const profiles = [{ cadence: 5.5, stride: 0.38 }, { cadence: 7, stride: 0.55 }, { cadence: 8.5, stride: 0.72 }];
  return (input: SceneFrame, variant: 0 | 1 | 2) => {
    const { time, motion } = sceneDynamics(input);
    if (motion === 0) return 0;
    const { cadence, stride } = profiles[variant];
    const phase = time * cadence;
    model.getWorldQuaternion(orientation);
    if (spine) aim(spine, direction.set(0, 1, 0.12).applyQuaternion(orientation), motion);
    for (const segment of limbs) {
      const joint = segment.from as BodyJoint;
      const left = joint.startsWith('left');
      const cycle = Math.sin(phase + (left ? 0 : Math.PI));
      let angle = cycle * stride, outward = 0;
      if (joint.endsWith('Knee')) angle -= 0.18 + Math.max(0, -cycle) * 1.05;
      if (joint.endsWith('Shoulder') || joint.endsWith('Elbow')) {
        angle = -cycle * stride * 0.8 + (joint.endsWith('Elbow') ? 1.3 : 0);
        outward = (left ? 1 : -1) * 0.15;
      }
      aim(segment, direction.set(outward, -Math.cos(angle), Math.sin(angle)).applyQuaternion(orientation), motion);
    }
    return Math.max(0, ground - lowestFoot()) + Math.sin(phase) ** 2 * 0.035 * clamp(motion);
  };
}
