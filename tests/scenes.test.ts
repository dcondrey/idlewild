import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rehearsalFrame } from '../src/rehearsal.ts';
import type { SceneFrame } from '../src/contracts.ts';
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
