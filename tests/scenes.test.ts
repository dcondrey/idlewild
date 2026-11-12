import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rehearsalFrame } from '../src/rehearsal.ts';
import { FACE_SHAPES, SIGNAL_STALE_MS, type Channel, type FaceShape, type SceneFrame, type Signal, type TrackingFrame } from '../src/contracts.ts';
import type { SceneSubject } from '../src/scenes/types.ts';
import { createCharacter } from '../src/scenes/character.ts';
import { createBubbles, createRunner, createStar } from '../src/scenes/procedural.ts';
import { sceneDynamics, signalValue } from '../src/scenes/dynamics.ts';
import { disposeObject, fitModel } from '../src/scenes/resources.ts';

function input(timeMs: number, reducedMotion = false): SceneFrame {
  return { timeMs, seed: 14, controls: { motion: 0.8, sensitivity: 0.9, sound: 0.5 }, frame: rehearsalFrame(14, 'scene-test', timeMs), reducedMotion };
}

function transforms(root: THREE.Object3D) {
  const result: number[][] = [];
  root.traverse(object => result.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray(),
    ...(object instanceof THREE.Mesh && object.morphTargetInfluences ? object.morphTargetInfluences : [])]));
  return result;
}

function difference(a: number[][], b: number[][]) {
  assert.equal(a.length, b.length);
  let largest = 0;
  a.forEach((values, index) => {
    assert.equal(values.length, b[index].length);
    values.forEach((value, part) => { largest = Math.max(largest, Math.abs(value - b[index][part])); });
  });
  return largest;
}

function loadModel(name: 'robot' | 'dragon' | 'snow') {
  const bytes = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
  const loader = new GLTFLoader().register(() => ({ name: 'idlewild_test_untextured', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return loader.parseAsync(new Uint8Array(bytes).buffer, '');
}

function expectDisposed(subject: SceneSubject) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  subject.root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  const counts = new Map<object, number>();
  const count = (key: object) => () => { counts.set(key, (counts.get(key) ?? 0) + 1); };
  for (const geometry of geometries) geometry.addEventListener('dispose', count(geometry));
  for (const material of materials) material.addEventListener('dispose', count(material));
  for (const texture of textures) texture.addEventListener('dispose', count(texture));
  subject.dispose();
  subject.dispose();
  assert.ok(geometries.size > 0 && materials.size > 0);
  for (const resource of [...geometries, ...materials, ...textures]) assert.equal(counts.get(resource), 1);
}

const SIGNAL_SAMPLES = { breath: 0.8, breathingRate: 24, pulseRate: 96, blink: 1, talking: 1 } as const;

function signalFrame(timeMs: number, valid: Partial<Record<Channel, number>> = {}, ageMs = 0): SceneFrame {
  const result = input(timeMs);
  for (const [channel, signal] of Object.entries(result.frame!.signals) as [Channel, Signal][]) {
    const value = valid[channel];
    if (value === undefined) {
      signal.quality = 'missing';
      signal.value = null;
    } else {
      signal.value = value;
      signal.sampledAtMs = timeMs - ageMs;
    }
  }
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
  for (const factory of [createBubbles, createRunner, createStar]) {
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

function trackingRig(kind: 'imported' | 'runner' = 'imported') {
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
  const subject = createCharacter(model, [new THREE.AnimationClip('Idle', 2, [morph, arm])], kind);
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
  const left = bones['DEF-UpperArm_1.L'].quaternion.clone().normalize();
  const right = bones['DEF-UpperArm_1.R'].quaternion.clone();
  for (const confidence of [0.449, 0.45, 0.451, 0.6, 0.601]) {
    const frame = trackedInput(500, { body: {
      leftShoulder: [0.25, 1, 0, confidence], leftElbow: [0.25, 0.6, 0, 1],
      rightShoulder: [-0.25, 1, 0, 1], rightElbow: [-0.25, 0.6, 0, 0.44],
    } });
    subject.update(frame);
    assert.ok(bones['DEF-UpperArm_1.R'].quaternion.angleTo(right) < 1e-7);
    if (confidence <= 0.45) assert.ok(bones['DEF-UpperArm_1.L'].quaternion.angleTo(left) < 1e-7);
    else if (confidence < 0.6) assert.ok(bones['DEF-UpperArm_1.L'].quaternion.angleTo(left) > 1e-6 && bones['DEF-UpperArm_1.L'].quaternion.angleTo(left) < 0.01);
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

function expressiveFrame(timeMs: number): SceneFrame {
  const weights = Object.fromEntries(FACE_SHAPES.map(name => [name, 0])) as Record<FaceShape, number>;
  return trackedInput(timeMs, { face: { weights, rotation: null }, body: {
    leftShoulder: [0.25, 0.6, 0, 1], rightShoulder: [-0.25, 0.6, 0, 1],
    leftHip: [0.15, 0, 0, 1], rightHip: [-0.15, 0, 0, 1],
    leftWrist: [0.25, -0.1, 0, 1], rightWrist: [-0.25, -0.1, 0, 1],
  } });
}

test('creative dynamics separate posture and expression from movement and physiological signals', () => {
  const frame = expressiveFrame(1000);
  const rest = sceneDynamics(frame);
  assert.deepEqual([rest.breath, rest.movement, rest.armSpread, rest.armLift, rest.smile, rest.jaw], [0, 0, 0, 0, 0, 0]);
  const tracking = frame.frame!.tracking!;
  tracking.body!.leftWrist = [0.85, 1.1, 0, 1];
  tracking.body!.rightWrist = [-0.85, 1.1, 0, 1];
  tracking.body!.leftShoulder![0] += 0.2;
  tracking.body!.rightShoulder![0] += 0.2;
  Object.assign(tracking.face!.weights, { mouthSmileLeft: 0.8, mouthSmileRight: 0.6, jawOpen: 0.7, browInnerUp: 0.5, eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 });
  const active = sceneDynamics(frame);
  assert.ok(active.armSpread > 0.9 && active.armLift > 0.9 && active.lean > 0.3);
  assert.ok(active.smile > 0.69 && active.jaw > 0.69 && active.brow > 0.49 && active.blink > 0.89);
  assert.deepEqual([active.breath, active.movement], [0, 0]);
  tracking.face!.sampledAtMs = 700;
  const olderFace = sceneDynamics(frame);
  assert.equal(olderFace.smile, 0);
  assert.ok(olderFace.armLift > 0.9);
  delete tracking.body!.leftHip;
  delete tracking.body!.rightHip;
  assert.ok(sceneDynamics(frame).armLift > 0.9);
  frame.controls.sensitivity = 0;
  const disabled = sceneDynamics(frame);
  assert.deepEqual([disabled.armSpread, disabled.armLift, disabled.lean, disabled.jaw], [0, 0, 0, 0]);
});

test('bubbles and star react distinctly to facial expressions and posture at the same timestamp', () => {
  for (const factory of [createBubbles, createStar]) {
    const subject = factory();
    const frame = expressiveFrame(1000);
    subject.update(frame);
    const rest = transforms(subject.root);
    const face = structuredClone(frame);
    Object.assign(face.frame!.tracking!.face!.weights, { jawOpen: 0.9, mouthSmileLeft: 0.8, mouthSmileRight: 0.8, eyeBlinkLeft: 0.7, eyeBlinkRight: 0.7 });
    subject.update(face);
    const expressive = transforms(subject.root);
    assert.ok(difference(expressive, rest) > 0.05);
    const body = structuredClone(frame);
    body.frame!.tracking!.body!.leftWrist = [0.85, 1.1, 0, 1];
    body.frame!.tracking!.body!.rightWrist = [-0.85, 1.1, 0, 1];
    subject.update(body);
    const pose = transforms(subject.root);
    assert.ok(difference(pose, rest) > 0.05);
    assert.ok(difference(pose, expressive) > 0.05);
    subject.update(face);
    assert.deepEqual(transforms(subject.root), expressive);
    subject.update(frame);
    assert.deepEqual(transforms(subject.root), rest);
    body.reducedMotion = true;
    subject.update(body);
    const still = transforms(subject.root);
    face.reducedMotion = true;
    subject.update(face);
    assert.deepEqual(transforms(subject.root), still);
    subject.dispose();
  }
});

test('tracked limbs use a stable neutral basis instead of inheriting authored twist', () => {
  const { subject, bones } = trackingRig();
  const rest = bones['DEF-UpperArm_1.L'].quaternion.clone();
  const twisted = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.8));
  subject.setClips!([new THREE.AnimationClip('Twist', 2, [new THREE.QuaternionKeyframeTrack('DEF-UpperArm_1.L.quaternion', [0, 1, 2], [...rest.toArray(), ...twisted.toArray(), ...rest.toArray()])])]);
  const body: TrackingFrame['body'] = { leftShoulder: [0.25, 1, 0, 1], leftElbow: [0.25, 0.6, 0, 1] };
  subject.update(trackedInput(0, { body }));
  const tracked = bones['DEF-UpperArm_1.L'].quaternion.clone();
  subject.update(trackedInput(1000, { body }));
  assert.ok(bones['DEF-UpperArm_1.L'].quaternion.angleTo(tracked) < 1e-6);
  subject.update(trackedInput(1000));
  assert.ok(bones['DEF-UpperArm_1.L'].quaternion.angleTo(twisted) < 1e-6);
  subject.update(trackedInput(1000, { sampledAtMs: 701, body }));
  assert.ok(bones['DEF-UpperArm_1.L'].quaternion.angleTo(twisted) < 0.001);
  subject.dispose();
});

test('detailed runner cycles use anatomical segments, loop, seek and stop under reduced motion', () => {
  const { subject, bones } = trackingRig('runner');
  for (const [variant, cadence] of [[0, 5.5], [1, 7], [2, 8.5]] as const) {
    subject.setVariant!(variant);
    subject.update(trackedInput(0));
    const start = transforms(subject.root);
    const period = 2 * Math.PI / cadence * 1000;
    subject.update(trackedInput(period / 4));
    assert.ok(direction(bones['DEF-Thigh_1.L'], bones['DEF-Knee_1.L']).z > 0.25);
    const stride = transforms(subject.root);
    assert.notDeepEqual(stride, start);
    subject.update(trackedInput(period));
    const end = transforms(subject.root);
    end.forEach((values, index) => values.forEach((value, part) => assert.ok(Math.abs(value - start[index][part]) < 1e-5)));
    subject.update(trackedInput(period / 4));
    assert.deepEqual(transforms(subject.root), stride);
  }
  const still = trackedInput(0);
  still.reducedMotion = true;
  subject.update(still);
  const neutral = transforms(subject.root);
  still.timeMs = 2000;
  still.frame!.timeMs = 2000;
  still.frame!.tracking!.sampledAtMs = 2000;
  subject.update(still);
  assert.deepEqual(transforms(subject.root), neutral);
  const face = expressiveFrame(500);
  face.frame!.tracking!.face!.weights.jawOpen = 0.8;
  subject.update(face);
  assert.ok(Math.abs((subject.root.getObjectByName('TrackedFace') as THREE.Mesh).morphTargetInfluences![2] - 0.8) < 1e-6);
  subject.dispose();
});

test('dragon framing keeps forward orientation and uniform proportions consistent with other characters', () => {
  const results = [];
  for (const kind of ['dragon', 'imported'] as const) {
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial()));
    const subject = createCharacter(model, [], kind);
    subject.update(input(0, true));
    assert.ok(new THREE.Vector3(0, 0, 1).transformDirection(model.matrixWorld).z > 0.9999);
    const size = new THREE.Box3().setFromObject(subject.root).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x / size.y - 0.5) < 1e-8 && Math.abs(size.z / size.y - 1.5) < 1e-8);
    results.push(size.toArray());
    subject.dispose();
  }
  assert.deepEqual(results[0], results[1]);
});

test('every scene responds to each SDK signal only while it is valid and fresh', async () => {
  const [robot, dragon, snow] = await Promise.all((['robot', 'dragon', 'snow'] as const).map(loadModel));
  const subjects: [string, SceneSubject][] = [
    ['robot', createCharacter(robot.scene, robot.animations, 'robot')],
    ['dragon', createCharacter(dragon.scene, dragon.animations, 'dragon')],
    ['snow', createCharacter(snow.scene, snow.animations, 'imported')],
    ['runner character', trackingRig('runner').subject],
    ['bubbles', createBubbles()], ['star', createStar()], ['runner', createRunner()],
  ];
  for (const [name, subject] of subjects) {
    const capture = (frame: SceneFrame) => { subject.update(frame); return transforms(subject.root); };
    const absent = capture(signalFrame(1000));
    assert.deepEqual(capture({ ...signalFrame(1000), frame: null }), absent, name);
    for (const [channel, value] of Object.entries(SIGNAL_SAMPLES)) {
      assert.ok(difference(capture(signalFrame(1000, { [channel]: value })), absent) > 1e-3, `${name} ignores ${channel}`);
      assert.deepEqual(capture(signalFrame(1000, { [channel]: value }, SIGNAL_STALE_MS)), absent, `${name} uses stale ${channel}`);
    }
    const all = capture(signalFrame(1000, SIGNAL_SAMPLES));
    capture(signalFrame(4200, SIGNAL_SAMPLES));
    assert.deepEqual(capture(signalFrame(1000, SIGNAL_SAMPLES)), all, `${name} seek`);
    const still = signalFrame(0);
    still.reducedMotion = true;
    const frozen = capture(still);
    for (const timeMs of [1000, 6000]) {
      const reduced = signalFrame(timeMs, SIGNAL_SAMPLES);
      reduced.reducedMotion = true;
      assert.deepEqual(capture(reduced), frozen, `${name} reduced motion`);
    }
    expectDisposed(subject);
  }
});

test('blink is a subtle uniform response that keeps bubbles round', () => {
  const bubbles = createBubbles();
  bubbles.update(signalFrame(1000, { blink: 0 }));
  const open = bubbles.root.children.map(child => child.scale.clone());
  bubbles.update(signalFrame(1000, { blink: 1 }));
  bubbles.root.children.forEach((child, index) => {
    assert.ok(Math.abs(child.scale.x - child.scale.y) < 1e-12 && Math.abs(child.scale.z - child.scale.y) < 1e-12);
    const ratio = child.scale.y / open[index].y;
    assert.ok(ratio > 0.9 && ratio < 0.97);
  });
  bubbles.dispose();
  const star = createStar();
  const core = star.root.getObjectByName('StarCore')!;
  star.update(signalFrame(1000, { blink: 0 }));
  const shape = core.scale.y / core.scale.x;
  star.update(signalFrame(1000, { blink: 1 }));
  assert.ok(Math.abs(core.scale.y / core.scale.x - shape) < 1e-12);
  star.dispose();
});

test('a runner asset with an authored Run clip plays it at the selected pace instead of the procedural cycle', () => {
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
  const pacer = new THREE.Bone();
  pacer.name = 'Pacer';
  model.add(pacer);
  const clips = [
    new THREE.AnimationClip('Idle', 2, [new THREE.VectorKeyframeTrack('Pacer.position', [0, 2], [0, 0, 0, 0, 2, 0])]),
    new THREE.AnimationClip('Run', 2, [new THREE.VectorKeyframeTrack('Pacer.position', [0, 2], [0, 0, 0, 2, 0, 0])]),
  ];
  const subject = createCharacter(model, clips, 'runner');
  const travelled = (variant: 0 | 1 | 2) => {
    subject.setVariant!(variant);
    subject.update(trackedInput(1000));
    assert.equal(pacer.position.y, 0);
    return pacer.position.x;
  };
  const easy = travelled(0), steady = travelled(1), brisk = travelled(2);
  assert.ok(easy > 0);
  assert.ok(Math.abs(easy / steady - 0.8) < 1e-9 && Math.abs(brisk / steady - 1.2) < 1e-9);
  assert.throws(() => subject.setVariant!(3 as 0));
  subject.dispose();
});

test('runner pace stays bounded and faster or deeper breathing earns no extra stride', () => {
  const procedural = createRunner();
  const { subject: character } = trackingRig('runner');
  const cases: [SceneSubject, string[]][] = [
    [procedural, ['Hip_L', 'Knee_L', 'Shoulder_R', 'Pelvis']],
    [character, ['DEF-Thigh_1.L', 'DEF-Knee_1.L', 'DEF-UpperArm_1.R']],
  ];
  for (const [subject, names] of cases) {
    for (let timeMs = 0; timeMs <= 1000; timeMs += 125) {
      subject.update(signalFrame(timeMs, { breath: 0, breathingRate: 8 }));
      const calm = names.map(name => subject.root.getObjectByName(name)!.quaternion.clone());
      const height = subject.root.getObjectByName(names[0])!.getWorldPosition(new THREE.Vector3()).y;
      subject.update(signalFrame(timeMs, { breath: 1, breathingRate: 30 }));
      names.forEach((name, index) => assert.ok(subject.root.getObjectByName(name)!.quaternion.angleTo(calm[index]) < 1e-6, name));
      if (subject === procedural) {
        assert.ok(Math.abs(subject.root.getObjectByName('Hip_L')!.rotation.x) <= 0.4 + 1e-9);
        assert.ok(Math.abs(subject.root.getObjectByName(names[0])!.getWorldPosition(new THREE.Vector3()).y - height) < 1e-9);
      }
    }
    subject.dispose();
  }
});

test('tracked limbs layer over authored idle motion on untracked joints', () => {
  const { subject, bones } = trackingRig();
  const rest = bones['DEF-Spine'].quaternion.clone();
  const bent = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3));
  subject.setClips!([new THREE.AnimationClip('Idle', 2, [new THREE.QuaternionKeyframeTrack('DEF-Spine.quaternion', [0, 1, 2], [...rest.toArray(), ...bent.toArray(), ...rest.toArray()])])]);
  const body: TrackingFrame['body'] = { leftShoulder: [0.25, 1, 0, 1], leftElbow: [0.25, 0.6, 0, 1] };
  for (const [timeMs, authored] of [[0, rest], [1000, bent]] as const) {
    subject.update(trackedInput(timeMs, { body }));
    assert.ok(bones['DEF-Spine'].quaternion.angleTo(authored) < 1e-6);
    assert.ok(direction(bones['DEF-UpperArm_1.L'], bones['DEF-Forearm_1.L']).y < -0.9999);
  }
  subject.dispose();
});

test('elbow aim clamps to an anatomical range without snapping near a folded pose', () => {
  const { subject, bones } = trackingRig();
  let previous: THREE.Vector3 | null = null;
  for (const angle of [2, 2.5, 2.55, 2.6, 2.65, 2.8, 3, 3.1, 3.13]) {
    subject.update(trackedInput(500, { body: {
      leftShoulder: [0.25, 1, 0, 1], leftElbow: [0.25, 0.6, 0, 1],
      leftWrist: [0.25 + Math.sin(angle) * 0.3, 0.6 - Math.cos(angle) * 0.3, 0, 1],
    } }));
    const forearm = direction(bones['DEF-Forearm_1.L'], bones['DEF-Wrist.L']);
    const flexion = direction(bones['DEF-UpperArm_1.L'], bones['DEF-Forearm_1.L']).angleTo(forearm);
    assert.ok(Math.abs(flexion - Math.min(angle, 2.6)) < 1e-4, String(angle));
    if (previous) assert.ok(previous.angleTo(forearm) <= 0.5 + 1e-6);
    previous = forearm;
  }
  subject.dispose();
});

test('dragon, robot and Snow face forward and share the same uniform fitting rule', async t => {
  const forward = new Map<string, THREE.Vector3>();
  for (const [name, kind, back, front] of [['robot', 'robot', null, null], ['dragon', 'dragon', 'hips', 'mouth_upper_tip'], ['snow', 'imported', 'DEF-FootL', 'DEF-ToesL']] as const) {
    const gltf = await loadModel(name);
    const subject = createCharacter(gltf.scene, gltf.animations, kind);
    subject.update(input(0, true));
    const framing = gltf.scene.parent!;
    assert.ok(Math.abs(framing.scale.x - framing.scale.y) < 1e-12 && Math.abs(framing.scale.z - framing.scale.y) < 1e-12, name);
    assert.ok(new THREE.Vector3(0, 0, 1).transformDirection(gltf.scene.matrixWorld).z > 0.9999, name);
    const bounds = new THREE.Box3().setFromObject(subject.root);
    const size = bounds.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z);
    assert.ok(Math.abs(bounds.min.y) < 1e-6 && Math.abs(bounds.getCenter(new THREE.Vector3()).x) < 1e-6, name);
    assert.ok(size.y <= 2.7 + 1e-6 && footprint <= 5.2 + 1e-6, name);
    assert.ok(Math.abs(size.y - 2.7) < 1e-6 || Math.abs(footprint - 5.2) < 1e-6, name);
    if (name === 'dragon') assert.ok(Math.abs(footprint - 5.2) < 1e-6);
    t.diagnostic(`${name} fitted size ${size.toArray().map(value => value.toFixed(3)).join(' x ')}`);
    if (back && front) {
      const vector = subject.root.getObjectByName(front)!.getWorldPosition(new THREE.Vector3()).sub(subject.root.getObjectByName(back)!.getWorldPosition(new THREE.Vector3()));
      vector.y = 0;
      forward.set(name, vector.normalize());
    }
    expectDisposed(subject);
  }
  assert.ok(forward.get('dragon')!.z > 0.95 && forward.get('snow')!.z > 0.95);
  assert.ok(forward.get('dragon')!.dot(forward.get('snow')!) > 0.95);
});

test('Snow arms follow tracked directions overhead without a clamp or axis snap', async () => {
  const gltf = await loadModel('snow');
  const subject = createCharacter(gltf.scene, gltf.animations, 'imported');
  const arm = subject.root.getObjectByName('DEF-UpperArm_1L')!, forearm = subject.root.getObjectByName('DEF-Forearm_1L')!;
  for (const [x, z] of [[0, 0], [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01]]) {
    subject.update(trackedInput(500, { body: { leftShoulder: [0.2, 1.4, 0, 1], leftElbow: [0.2 + x, 1.7, z, 1] } }));
    assert.ok(direction(arm, forearm).angleTo(new THREE.Vector3(x, 0.3, z).normalize()) < 1e-3, `${x} ${z}`);
  }
  subject.dispose();
});

import { BRAIN_EXAMPLES, BRAIN_MAPPED_REGIONS, BRAIN_RULE_IDS, brainRegionActivity, createAnatomicalBrain, topBrainRegions } from '../src/scenes/brain.ts';

type Pose = NonNullable<TrackingFrame['body']>;
const BRAIN_REST: Pose = {
  leftShoulder: [0.2, 1.4, 0, 1], rightShoulder: [-0.2, 1.4, 0, 1], leftElbow: [0.22, 1.1, 0, 1], rightElbow: [-0.22, 1.1, 0, 1],
  leftWrist: [0.22, 0.8, 0, 1], rightWrist: [-0.22, 0.8, 0, 1], leftHip: [0.12, 0.9, 0, 1], rightHip: [-0.12, 0.9, 0, 1],
  leftKnee: [0.12, 0.48, 0, 1], rightKnee: [-0.12, 0.48, 0, 1], leftAnkle: [0.12, 0.06, 0, 1], rightAnkle: [-0.12, 0.06, 0, 1],
};

function brainPose(changes: Partial<Pose> = {}, movement = 0, timeMs = 1000): SceneFrame {
  const body = Object.fromEntries(Object.entries({ ...BRAIN_REST, ...changes }).map(([joint, point]) => [joint, [...point!]])) as Pose;
  return trackedInput(timeMs, { body, movement });
}

const lit = (activity: Map<string, number>) => new Map([...activity].filter(([, value]) => value > 0));
const RAISED_LEFT_ARM: Partial<Pose> = { leftElbow: [0.5, 1.45, 0, 1], leftWrist: [0.8, 1.5, 0, 1] };
const RAISED_RIGHT_ARM: Partial<Pose> = { rightElbow: [-0.5, 1.45, 0, 1], rightWrist: [-0.8, 1.5, 0, 1] };
const RAISED_LEFT_KNEE: Partial<Pose> = { leftKnee: [0.12, 0.85, 0.42, 1], leftAnkle: [0.12, 0.45, 0.45, 1] };
const SEATED: Partial<Pose> = { ...RAISED_LEFT_KNEE, rightKnee: [-0.12, 0.85, 0.42, 1], rightAnkle: [-0.12, 0.45, 0.45, 1] };

function loadBrain() {
  const bytes = readFileSync(new URL('../public/models/brain.glb', import.meta.url));
  return new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
}

test('brain mapping lateralizes each arm to the opposite precentral and postcentral regions with bilateral support', () => {
  assert.equal(lit(brainRegionActivity(brainPose())).size, 0);
  const left = brainRegionActivity(brainPose(RAISED_LEFT_ARM));
  assert.ok(left.get('ctx-rh-precentral')! > 0.9);
  assert.ok(left.get('ctx-rh-precentral')! > left.get('ctx-lh-precentral')! && left.get('ctx-lh-precentral')! > 0);
  assert.ok(left.get('ctx-rh-postcentral')! > (left.get('ctx-lh-postcentral') ?? 0));
  assert.ok(left.get('Left-Cerebellum-Cortex')! > (left.get('Right-Cerebellum-Cortex') ?? 0));
  const right = brainRegionActivity(brainPose(RAISED_RIGHT_ARM));
  assert.ok(right.get('ctx-lh-precentral')! > right.get('ctx-rh-precentral')!);
  assert.deepEqual(topBrainRegions(brainPose(RAISED_LEFT_ARM), 1).map(({ region, label, rule }) => [region, label, rule]), [['ctx-rh-precentral', 'Right precentral', 'M1']]);
});

test('brain mapping places leg flexion medially and less lateralized than arm movement, ignoring still sitting', () => {
  const arm = brainRegionActivity(brainPose(RAISED_LEFT_ARM));
  const leg = brainRegionActivity(brainPose(RAISED_LEFT_KNEE));
  assert.equal(arm.get('ctx-rh-paracentral') ?? 0, 0);
  assert.equal(topBrainRegions(brainPose(RAISED_LEFT_KNEE), 1)[0].region, 'ctx-rh-paracentral');
  assert.ok(leg.get('ctx-rh-paracentral')! > leg.get('ctx-lh-paracentral')!);
  assert.ok(leg.get('ctx-rh-paracentral')! > (leg.get('ctx-rh-precentral') ?? 0));
  assert.ok(leg.get('ctx-lh-paracentral')! / leg.get('ctx-rh-paracentral')! > arm.get('ctx-lh-precentral')! / arm.get('ctx-rh-precentral')!);
  assert.equal(lit(brainRegionActivity(brainPose(SEATED))).size, 0);
  const moving = brainRegionActivity(brainPose(SEATED, 1));
  assert.ok(moving.get('ctx-lh-paracentral')! > 0.9 && moving.get('ctx-lh-paracentral') === moving.get('ctx-rh-paracentral'));
});

test('brain face and head rules need a fresh face and stay bilateral', () => {
  const weights = Object.fromEntries(FACE_SHAPES.map(name => [name, 0])) as Record<FaceShape, number>;
  const frame = trackedInput(1000, { face: { weights, rotation: [0, Math.sin(0.2), 0, Math.cos(0.2)] }, body: null });
  const turned = brainRegionActivity(frame);
  assert.ok(turned.get('ctx-lh-insula')! > 0.2 && turned.get('ctx-lh-insula') === turned.get('ctx-rh-insula'));
  assert.ok(turned.get('Left-Putamen')! > 0);
  frame.frame!.tracking!.face!.rotation = null;
  assert.equal(lit(brainRegionActivity(frame)).size, 0);
  Object.assign(weights, { mouthSmileLeft: 0.8, mouthSmileRight: 0.8 });
  assert.deepEqual(new Set(topBrainRegions(frame, 8).map(entry => entry.rule)), new Set(['F1']));
  frame.frame!.tracking!.face!.sampledAtMs = 1000 - 300;
  assert.equal(lit(brainRegionActivity(frame)).size, 0);
});

test('brain signal rules fire only for valid, fresh, non-replayed samples and never map physiology to regions', async () => {
  const blink = lit(brainRegionActivity(signalFrame(1000, { blink: 1 })));
  assert.deepEqual([...blink.keys()].sort(), ['ctx-lh-caudalmiddlefrontal', 'ctx-lh-superiorfrontal', 'ctx-rh-caudalmiddlefrontal', 'ctx-rh-superiorfrontal']);
  assert.equal(topBrainRegions(signalFrame(1000, { talking: 1 }), 1)[0].rule, 'S6');
  for (const channel of ['blink', 'talking'] as const) {
    assert.equal(lit(brainRegionActivity(signalFrame(1000, { [channel]: 1 }, SIGNAL_STALE_MS))).size, 0, channel);
    const unstable = signalFrame(1000, { [channel]: 1 });
    unstable.frame!.signals[channel].quality = 'unstable';
    assert.equal(lit(brainRegionActivity(unstable)).size, 0, channel);
    const replayed = signalFrame(1000, { [channel]: 1 });
    replayed.frame!.signals[channel].provenance = 'replayed';
    assert.equal(lit(brainRegionActivity(replayed)).size, 0, channel);
  }
  for (const channel of ['breath', 'breathingRate', 'pulseRate'] as const) assert.equal(lit(brainRegionActivity(signalFrame(1000, { [channel]: SIGNAL_SAMPLES[channel] }))).size, 0, channel);
  const subject = createAnatomicalBrain((await loadBrain()).scene);
  const capture = (frame: SceneFrame) => { subject.update(frame); return transforms(subject.root); };
  const absent = capture(signalFrame(1000));
  for (const channel of ['breath', 'breathingRate', 'pulseRate'] as const) {
    assert.ok(difference(capture(signalFrame(1000, { [channel]: SIGNAL_SAMPLES[channel] })), absent) > 1e-3, channel);
    assert.deepEqual(capture(signalFrame(1000, { [channel]: SIGNAL_SAMPLES[channel] }, SIGNAL_STALE_MS)), absent, channel);
  }
  subject.dispose();
});

test('missing, stale, low-confidence or reduced-motion input leaves the brain at its neutral baseline', async () => {
  const missing: SceneFrame[] = [{ ...input(1000), frame: null }, trackedInput(1000), signalFrame(1000)];
  const stale = brainPose(RAISED_LEFT_ARM);
  stale.frame!.tracking!.sampledAtMs = 1000 - 300;
  const doubtful = brainPose({ leftShoulder: [0.2, 1.4, 0, 0.4], leftElbow: [0.5, 1.45, 0, 0.4], leftWrist: [0.8, 1.5, 0, 0.4] });
  const reduced = brainPose(RAISED_LEFT_ARM);
  reduced.reducedMotion = true;
  for (const frame of [...missing, stale, doubtful, reduced]) {
    assert.equal(lit(brainRegionActivity(frame)).size, 0);
    assert.deepEqual(topBrainRegions(frame), []);
  }
  const subject = createAnatomicalBrain((await loadBrain()).scene);
  const glow = () => {
    const values = new Set<number>();
    subject.root.traverse(object => { if (object instanceof THREE.Mesh && object.name.startsWith('ctx-')) values.add((object.material as THREE.MeshStandardMaterial).emissiveIntensity); });
    return [...values];
  };
  subject.update(brainPose(RAISED_LEFT_ARM));
  assert.ok(glow().length > 1);
  assert.equal(subject.topRegions(1)[0].region, 'ctx-rh-precentral');
  subject.update(stale);
  const baseline = glow();
  assert.equal(baseline.length, 1);
  assert.ok(baseline[0] > 0);
  assert.deepEqual(subject.topRegions(), []);
  subject.dispose();
});

test('brain subject seeks deterministically, freezes under reduced motion and disposes once', async () => {
  const frame = brainPose(RAISED_LEFT_KNEE, 0.4);
  assert.deepEqual(brainRegionActivity(frame), brainRegionActivity(structuredClone(frame)));
  const subject = createAnatomicalBrain((await loadBrain()).scene);
  subject.update(input(1000));
  const before = transforms(subject.root);
  const activity = subject.topRegions(8);
  subject.update(input(7000));
  assert.notDeepEqual(transforms(subject.root), before);
  subject.update(input(1000));
  assert.deepEqual(transforms(subject.root), before);
  assert.deepEqual(subject.topRegions(8), activity);
  subject.update(input(0, true));
  const still = transforms(subject.root);
  subject.update(input(8000, true));
  assert.deepEqual(transforms(subject.root), still);
  expectDisposed(subject);
});

test('brain asset keeps anatomical axes, mapped DK regions and its CC BY-SA credit', async () => {
  const gltf = await loadBrain();
  assert.match(gltf.asset.copyright ?? '', /CC BY-SA 3\.0/);
  const centers = new Map<string, THREE.Vector3>();
  const left = new THREE.Box3(), right = new THREE.Box3();
  gltf.scene.updateWorldMatrix(true, true);
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const bounds = new THREE.Box3().setFromObject(object);
    centers.set(object.name, bounds.getCenter(new THREE.Vector3()));
    if (object.name.startsWith('ctx-lh-')) left.union(bounds);
    if (object.name.startsWith('ctx-rh-')) right.union(bounds);
  });
  for (const region of BRAIN_MAPPED_REGIONS) assert.ok(centers.has(region), region);
  assert.ok(left.getCenter(new THREE.Vector3()).x > 0 && right.getCenter(new THREE.Vector3()).x < 0);
  for (const side of ['lh', 'rh']) {
    assert.ok(centers.get(`ctx-${side}-frontalpole`)!.z > centers.get(`ctx-${side}-lateraloccipital`)!.z, side);
    assert.ok(centers.get(`ctx-${side}-paracentral`)!.y > centers.get(`ctx-${side}-inferiortemporal`)!.y, side);
  }
  assert.ok(centers.get('Left-Cerebellum-Cortex')!.x > 0 && centers.get('Left-Cerebellum-Cortex')!.z < centers.get('ctx-lh-precentral')!.z);
  disposeObject(gltf.scene);
});

test('every brain mapping rule cites a row in BRAIN-EVIDENCE.md', () => {
  const evidence = readFileSync(new URL('../docs/BRAIN-EVIDENCE.md', import.meta.url), 'utf8');
  for (const id of BRAIN_RULE_IDS) assert.match(evidence, new RegExp(`^\\| ${id} \\|`, 'm'), id);
});

test('a selected brain example lights only its study regions and ignores every live input', () => {
  for (const example of Object.values(BRAIN_EXAMPLES)) {
    const select = (frame: SceneFrame): SceneFrame => ({ ...frame, controls: { ...frame.controls, brainExample: example.id } });
    const expected = new Map(example.regions.map(([region, weight]) => [region, weight]));
    const idle = lit(brainRegionActivity(select(input(1000))));
    assert.deepEqual(idle, expected, example.id);
    assert.deepEqual(lit(brainRegionActivity(select(brainPose(RAISED_LEFT_ARM, 1)))), expected, `${example.id} ignores tracking`);
    assert.deepEqual(lit(brainRegionActivity(select(signalFrame(1000, SIGNAL_SAMPLES)))), expected, `${example.id} ignores body signals`);
    assert.ok(topBrainRegions(select(input(1000)), 8).every(region => region.rule === example.rule));
    assert.ok(example.regions.every(([, weight]) => weight > 0 && weight <= 1));
  }
  const unknown = { ...input(1000), controls: { ...input(1000).controls, brainExample: 'constructor' as never } };
  assert.equal(lit(brainRegionActivity(unknown)).size, 0);
});

test('a pulse trend never changes brain regions', () => {
  const frame = signalFrame(1000, SIGNAL_SAMPLES);
  const trended: SceneFrame = { ...frame, frame: { ...frame.frame!, trends: { pulseRate: { direction: 'rising', changePerMinute: 30, windowMs: 20_000, samples: 20 } } } };
  assert.deepEqual(brainRegionActivity(trended), brainRegionActivity(frame));
});
