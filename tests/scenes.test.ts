import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rehearsalFrame } from '../src/rehearsal.ts';
import { FACE_SHAPES, type FaceShape, type SceneFrame, type TrackingFrame } from '../src/contracts.ts';
import { createCharacter } from '../src/scenes/character.ts';
import { createBabyDragon, createBrain, createBubbles, createRunner, createStar } from '../src/scenes/procedural.ts';
import { sceneDynamics, signalValue } from '../src/scenes/dynamics.ts';
import { disposeObject, fitModel } from '../src/scenes/resources.ts';

function input(timeMs: number, reducedMotion = false): SceneFrame {
  return { timeMs, seed: 14, controls: { motion: 0.8, sensitivity: 0.9, sound: 0.5 }, frame: rehearsalFrame(14, 'scene-test', timeMs), reducedMotion };
}

function transforms(root: THREE.Object3D) {
  const result: number[][] = [];
  root.traverse(object => result.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()]));
  return result;
}

test('scene signals become neutral for invalid, future and stale input', () => {
  const frame = input(2000);
  const signal = frame.frame!.signals.breath;
  signal.value = 1;
  signal.sampledAtMs = 501;
  assert.ok((signalValue(frame, 'breath') ?? 0) > 0);
  signal.sampledAtMs = 500;
  assert.equal(signalValue(frame, 'breath'), null);
  signal.sampledAtMs = 499;
  assert.equal(signalValue(frame, 'breath'), null);
  signal.sampledAtMs = 2001;
  assert.equal(signalValue(frame, 'breath'), null);
  signal.sampledAtMs = 2000;
  signal.quality = 'unstable';
  assert.equal(signalValue(frame, 'breath'), null);
  signal.quality = 'valid';
  signal.value = null;
  assert.equal(signalValue(frame, 'breath'), null);
  signal.value = 0;
  assert.equal(signalValue(frame, 'breath'), 0);
  const reduced = sceneDynamics(input(500, true));
  assert.deepEqual([reduced.motion, reduced.breath, reduced.blink, reduced.talking], [0, 0, 0, 0]);
});

test('procedural subjects seek deterministically and reduced motion removes time-dependent transforms', () => {
  for (const factory of [createBabyDragon, createBrain, createBubbles, createRunner, createStar]) {
    const subject = factory();
    subject.update(input(1000));
    const before = transforms(subject.root);
    subject.update(input(7000));
    assert.notDeepEqual(transforms(subject.root), before);
    subject.update(input(1000));
    assert.deepEqual(transforms(subject.root), before);
    subject.update(input(0, true));
    const still = transforms(subject.root);
    subject.update(input(8000, true));
    assert.deepEqual(transforms(subject.root), still);
    subject.dispose();
  }
});

test('character overlays do not accumulate on repeated frame or seek', () => {
  const model = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  model.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  const chest = new THREE.Bone();
  chest.name = 'Chest';
  const jaw = new THREE.Bone();
  jaw.name = 'Jaw';
  chest.add(jaw);
  model.add(chest);
  const track = new THREE.QuaternionKeyframeTrack('Jaw.quaternion', [0, 1, 2], [0, 0, 0, 1, 0.1, 0, 0, Math.sqrt(0.99), 0, 0, 0, 1]);
  const subject = createCharacter(model, [new THREE.AnimationClip('Idle', 2, [track])], 'imported');
  const frame = input(500);
  frame.frame!.signals.talking.value = 1;
  subject.update(frame);
  const original = transforms(subject.root);
  subject.update(frame);
  assert.deepEqual(transforms(subject.root), original);
  subject.update(input(1500));
  subject.update(frame);
  assert.deepEqual(transforms(subject.root), original);
  subject.setClips!([]);
  subject.update(input(500, true));
  assert.deepEqual(jaw.quaternion.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(chest.scale.toArray(), [1, 1, 1]);
  subject.dispose();
});

test('missing facial input preserves authored animation while valid zero overrides it', () => {
  const model = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.morphAttributes.position = [geometry.attributes.position.clone(), geometry.attributes.position.clone()];
  geometry.morphAttributes.position[0].name = 'BlinkLeft';
  geometry.morphAttributes.position[1].name = 'JawOpen';
  const face = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  face.name = 'Face';
  model.add(face);
  const track = new THREE.NumberKeyframeTrack('Face.morphTargetInfluences', [0, 1], [0.35, 0.25, 0.35, 0.25]);
  const subject = createCharacter(model, [new THREE.AnimationClip('Idle', 1, [track])], 'imported');
  const frame = input(500);
  frame.controls.motion = 1;
  const expectWeights = (blink: number, jaw: number) => {
    assert.ok(Math.abs(face.morphTargetInfluences![0] - blink) < 1e-6);
    assert.ok(Math.abs(face.morphTargetInfluences![1] - jaw) < 1e-6);
  };
  subject.update({ ...frame, frame: null });
  expectWeights(0.35, 0.25);
  for (const value of [0, 1, 0]) {
    frame.frame!.signals.blink.value = value;
    frame.frame!.signals.talking.value = value;
    subject.update(frame);
    expectWeights(value, value * 0.65);
  }
  frame.frame!.signals.blink.value = null;
  frame.frame!.signals.talking.quality = 'unstable';
  subject.update(frame);
  expectWeights(0.35, 0.25);
  const stale = input(2000);
  stale.frame!.signals.blink.sampledAtMs = 500;
  stale.frame!.signals.talking.sampledAtMs = 500;
  subject.update(stale);
  expectWeights(0.35, 0.25);
  subject.dispose();
});

test('owned shared geometry and materials are disposed once and model fitting preserves translated geometry', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  root.position.set(5, 8, -3);
  fitModel(root, 3);
  const bounds = new THREE.Box3().setFromObject(root);
  assert.ok(Math.abs(bounds.min.y) < 1e-10);
  assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x) < 1e-10);
  assert.ok(Math.abs(bounds.max.y - 3) < 1e-10);
  let geometries = 0, materials = 0;
  geometry.addEventListener('dispose', () => geometries++);
  material.addEventListener('dispose', () => materials++);
  disposeObject(root);
  disposeObject(root);
  assert.deepEqual([geometries, materials], [1, 1]);
});

test('character framing survives clips that animate the imported scene root', () => {
  const model = new THREE.Group();
  model.name = 'AnimatedRoot';
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  const scale = new THREE.VectorKeyframeTrack('AnimatedRoot.scale', [0, 1], [0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
  const position = new THREE.VectorKeyframeTrack('AnimatedRoot.position', [0, 1], [4, 3, 2, 4, 3, 2]);
  const subject = createCharacter(model, [new THREE.AnimationClip('Idle', 1, [scale, position])], 'imported');
  for (const time of [0, 500, 900, 0]) {
    subject.update(input(time, true));
    const bounds = new THREE.Box3().setFromObject(subject.root, true);
    assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - 2.7) < 1e-6);
    assert.ok(Math.abs(bounds.min.y) < 1e-6);
    assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x) < 1e-6);
  }
  subject.dispose();
});

test('character framing refreshes skin bounds after activating the selected clip', () => {
  const model = new THREE.Group();
  const geometry = new THREE.BoxGeometry(8, 2, 2);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  const bone = new THREE.Bone();
  bone.name = 'AnimatedBone';
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  model.add(mesh);
  mesh.computeBoundingBox();
  const track = new THREE.VectorKeyframeTrack('AnimatedBone.scale', [0, 1], [0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
  const subject = createCharacter(model, [new THREE.AnimationClip('Idle', 1, [track])], 'imported');
  subject.update(input(500, true));
  const bounds = new THREE.Box3().setFromObject(subject.root, true);
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).x - 5.2) < 1e-6);
  assert.ok(Math.abs(bounds.min.y) < 1e-6);
  subject.dispose();
});

function trackedInput(timeMs: number, tracking: Partial<TrackingFrame> = {}): SceneFrame {
  const result = input(timeMs);
  result.controls.motion = 1;
  result.frame!.source = 'local-camera';
  for (const signal of Object.values(result.frame!.signals)) signal.quality = 'missing';
  result.frame!.tracking = { sampledAtMs: timeMs, face: null, body: null, movement: null, ...tracking };
  return result;
}

function trackingRig() {
  const model = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const names = ['BlinkLeft', 'BlinkRight', 'JawOpen', 'SmileOpen', 'BrowDown', 'MouthFunnel', 'MouthFf', 'AuthoredDetail'];
  geometry.morphAttributes.position = names.map(name => {
    const attribute = geometry.attributes.position.clone();
    attribute.name = name;
    return attribute;
  });
  const face = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  face.name = 'TrackedFace';
  model.add(face);
  const bones: Record<string, THREE.Bone> = {};
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number) => {
    const object = new THREE.Bone();
    object.name = name;
    object.position.set(x, y, 0);
    parent.add(object);
    bones[name] = object;
    return object;
  };
  const hips = bone('DEF-Hips', model, 0, 0.6);
  const spine = bone('DEF-Spine', hips, 0, 0.15);
  const chest = bone('Chest', spine, 0, 0.35);
  bone('DEF-Head', chest, 0, 0.35);
  for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
    const shoulder = bone(`DEF-Shoulder.${side}`, chest, sign * 0.15, 0.08);
    const arm = bone(`DEF-UpperArm_1.${side}`, shoulder, sign * 0.1, 0);
    const upperEnd = bone(`DEF-UpperArm_2.${side}`, arm, sign * 0.14, 0);
    const forearm = bone(`DEF-Forearm_1.${side}`, upperEnd, sign * 0.14, 0);
    const lowerEnd = bone(`DEF-Forearm_2.${side}`, forearm, sign * 0.12, 0);
    bone(`DEF-Wrist.${side}`, lowerEnd, sign * 0.12, 0);
    const thigh = bone(`DEF-Thigh_1.${side}`, hips, sign * 0.15, 0);
    const knee = bone(`DEF-Knee_1.${side}`, thigh, 0, -0.4);
    bone(`DEF-Foot.${side}`, knee, 0, -0.4);
  }
  const weights = [0.35, 0.2, 0.25, 0.1, 0.12, 0, 0, 0.27];
  const morph = new THREE.NumberKeyframeTrack('TrackedFace.morphTargetInfluences', [0, 2], [...weights, ...weights]);
  const authored = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.2).toArray();
  const arm = new THREE.QuaternionKeyframeTrack('DEF-UpperArm_1.L.quaternion', [0, 2], [...authored, ...authored]);
  const subject = createCharacter(model, [new THREE.AnimationClip('Idle', 2, [morph, arm])], 'imported');
  return { subject, bones, face };
}

function direction(from: THREE.Object3D, to: THREE.Object3D) {
  return to.getWorldPosition(new THREE.Vector3()).sub(from.getWorldPosition(new THREE.Vector3())).normalize();
}

test('local body tracking follows physical limb segments rather than Snow bone axes', () => {
  const { subject, bones } = trackingRig();
  const frame = trackedInput(500, { body: {
    leftShoulder: [0.25, 1.2, 0, 1], rightShoulder: [-0.25, 1.2, 0, 1],
    leftElbow: [0.25, 0.9, 0, 1], rightElbow: [-0.25, 0.9, 0, 1],
    leftWrist: [0.25, 0.6, 0, 1], rightWrist: [-0.25, 0.6, 0, 1],
    leftHip: [0.15, 0.6, 0, 1], rightHip: [-0.15, 0.6, 0, 1],
    leftKnee: [0.15, 0.25, 0.2, 1], rightKnee: [-0.15, 0.25, 0, 1],
    leftAnkle: [0.15, -0.1, 0.2, 1], rightAnkle: [-0.15, -0.1, 0, 1],
  } });
  subject.update(frame);
  for (const side of ['L', 'R']) {
    assert.ok(direction(bones[`DEF-UpperArm_1.${side}`], bones[`DEF-Forearm_1.${side}`]).dot(new THREE.Vector3(0, -1, 0)) > 0.9999);
    assert.ok(direction(bones[`DEF-Forearm_1.${side}`], bones[`DEF-Wrist.${side}`]).dot(new THREE.Vector3(0, -1, 0)) > 0.9999);
  }
  assert.ok(direction(bones['DEF-Thigh_1.L'], bones['DEF-Knee_1.L']).dot(new THREE.Vector3(0, -0.35, 0.2).normalize()) > 0.9999);
  assert.ok(direction(bones['DEF-Knee_1.L'], bones['DEF-Foot.L']).dot(new THREE.Vector3(0, -1, 0)) > 0.9999);
  const first = transforms(subject.root);
  subject.update(frame);
  assert.deepEqual(transforms(subject.root), first);
  subject.update(trackedInput(1500, { body: { leftShoulder: [0, 1, 0, 1], leftElbow: [0.4, 1, 0.2, 1] } }));
  subject.update(frame);
  assert.deepEqual(transforms(subject.root), first);
  subject.dispose();
});

test('partial body occlusion and confidence boundaries recover each authored limb independently', () => {
  const { subject, bones } = trackingRig();
  const neutral = trackedInput(500);
  subject.update(neutral);
  const left = bones['DEF-UpperArm_1.L'].quaternion.clone();
  const right = bones['DEF-UpperArm_1.R'].quaternion.clone();
  for (const confidence of [0.599, 0.6, 0.601]) {
    const frame = trackedInput(500, { body: {
      leftShoulder: [0.25, 1, 0, confidence], leftElbow: [0.25, 0.6, 0, 1],
      rightShoulder: [-0.25, 1, 0, 1], rightElbow: [-0.25, 0.6, 0, 0.59],
    } });
    subject.update(frame);
    assert.ok(bones['DEF-UpperArm_1.R'].quaternion.angleTo(right) < 1e-7);
    if (confidence < 0.6) assert.ok(bones['DEF-UpperArm_1.L'].quaternion.angleTo(left) < 1e-7);
    else assert.ok(direction(bones['DEF-UpperArm_1.L'], bones['DEF-Forearm_1.L']).y < -0.9999);
  }
  subject.update(trackedInput(500, { body: { leftShoulder: [0.25, 1, 0, 1] } }));
  assert.ok(bones['DEF-UpperArm_1.L'].quaternion.angleTo(left) < 1e-7);
  subject.update(trackedInput(500, { body: { leftShoulder: [0.25, 1, 0, 1], leftElbow: [NaN, 0.6, 0, 1] } }));
  assert.ok(bones['DEF-UpperArm_1.L'].quaternion.angleTo(left) < 1e-7);
  subject.dispose();
});

test('local tracking expires at 300 ms and missing, future, foreign-source or reduced-motion input restores authored poses', () => {
  const { subject } = trackingRig();
  const neutral = trackedInput(500);
  subject.update(neutral);
  const authored = transforms(subject.root);
  const body: TrackingFrame['body'] = { leftShoulder: [0.25, 1, 0, 1], leftElbow: [0.25, 0.6, 0, 1] };
  for (const age of [299, 300, 301]) {
    subject.update(trackedInput(500, { sampledAtMs: 500 - age, body }));
    if (age < 300) assert.notDeepEqual(transforms(subject.root), authored);
    else assert.deepEqual(transforms(subject.root), authored);
  }
  const foreign = trackedInput(500, { body });
  foreign.frame!.source = 'live';
  const reduced = trackedInput(500, { body });
  reduced.reducedMotion = true;
  for (const frame of [neutral, { ...neutral, frame: null }, trackedInput(500, { sampledAtMs: 501, body }), foreign, reduced]) {
    subject.update(trackedInput(500, { body }));
    subject.update(frame);
    assert.deepEqual(transforms(subject.root), authored);
  }
  subject.update(trackedInput(500, { sampledAtMs: 475, body }));
  const fresh = transforms(subject.root);
  subject.update(trackedInput(0, { sampledAtMs: -25, body }));
  assert.deepEqual(transforms(subject.root), fresh);
  subject.dispose();
});

test('local facial weights map Snow aliases, preserve unmatched animation and restore on loss', () => {
  const { subject, face, bones } = trackingRig();
  const neutral = trackedInput(500);
  subject.update(neutral);
  const authored = [...face.morphTargetInfluences!];
  const head = bones['DEF-Head'].getWorldQuaternion(new THREE.Quaternion());
  const weights = Object.fromEntries(FACE_SHAPES.map(name => [name, 0])) as Record<FaceShape, number>;
  Object.assign(weights, { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1, jawOpen: 0.7, mouthSmileLeft: 0.8, mouthSmileRight: 0.4, browDownLeft: 0.4, browDownRight: 0.2, mouthFunnel: 0.2, mouthPucker: 0.6, mouthPressLeft: 0.2, mouthPressRight: 0.6 });
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
  const frame = trackedInput(500, { face: { weights, rotation: [rotation.x, rotation.y, rotation.z, rotation.w] } });
  for (const signal of [frame.frame!.signals.blink, frame.frame!.signals.talking]) {
    signal.quality = 'valid';
    signal.value = 0;
  }
  subject.update(frame);
  const expected = [0.9, 0.1, 0.7, 0.6, 0.3, 0.6, 0.4, authored[7]];
  expected.forEach((value, index) => assert.ok(Math.abs(face.morphTargetInfluences![index] - value) < 1e-6));
  assert.ok(bones['DEF-Head'].getWorldQuaternion(new THREE.Quaternion()).angleTo(rotation.clone().multiply(head)) < 1e-6);
  const first = transforms(subject.root);
  subject.update(frame);
  assert.deepEqual(transforms(subject.root), first);
  frame.frame!.tracking!.sampledAtMs = 200;
  subject.update(frame);
  assert.deepEqual(face.morphTargetInfluences, authored);
  assert.ok(bones['DEF-Head'].getWorldQuaternion(new THREE.Quaternion()).angleTo(head) < 1e-6);
  frame.frame!.tracking!.sampledAtMs = 500;
  frame.reducedMotion = true;
  subject.update(frame);
  assert.deepEqual(face.morphTargetInfluences, authored);
  subject.dispose();
});
