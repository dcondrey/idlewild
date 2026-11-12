import * as THREE from 'three';
import { sceneDynamics, signalValue } from './dynamics.ts';
import { RUNNER_PACE } from './procedural.ts';
import { disposeObject, fitModel } from './resources.ts';
import { BONE_ALIASES, boneFinder, createRunnerMotion, createTracking, type CharacterMorph } from './tracking.ts';
import type { SceneSubject } from './types.ts';

const PULSE_GLOW = new THREE.Color(0xff7a3d);

export function createCharacter(model: THREE.Group, clips: THREE.AnimationClip[], kind: 'rex' | 'imported' | 'runner'): SceneSubject {
  const root = new THREE.Group();
  root.name = `${kind}_Performance`;
  const framing = new THREE.Group();
  framing.name = `${kind}_Framing`;
  framing.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const runClip = kind === 'runner' ? clips.find(candidate => candidate.name.toLowerCase() === 'run') : undefined;
  const clip = runClip ?? clips.find(candidate => candidate.name.toLowerCase() === 'idle') ?? clips[0];
  if (clip) mixer.clipAction(clip).play();
  mixer.setTime(0);
  framing.updateMatrixWorld(true);
  model.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) {
      object.computeBoundingBox();
      object.frustumCulled = false;
    }
  });
  fitModel(framing, 2.7, 5.2);
  root.add(framing);
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  const morphs: (CharacterMorph & { kind: 'blink' | 'talking' | null; initial: number })[] = [];
  const glowMaterials = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  model.traverse(object => {
    if (object instanceof THREE.Bone) bones.push(object);
    if (object instanceof THREE.Mesh) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshStandardMaterial && !glowMaterials.has(material)) glowMaterials.set(material, material.emissive.clone());
      }
    }
    if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) {
      for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
        const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
        const kind = ['blink', 'blinkleft', 'blinkright', 'eyeblinkleft', 'eyeblinkright'].includes(normalized) ? 'blink' : ['jawopen', 'mouthopen'].includes(normalized) ? 'talking' : null;
        morphs.push({ mesh: object, index, name, kind, initial: object.morphTargetInfluences[index] });
      }
    }
  });
  const findBone = boneFinder(bones);
  const chest = findBone(BONE_ALIASES.chest);
  const jaw = findBone(BONE_ALIASES.jaw);
  const head = findBone(BONE_ALIASES.head) ?? findBone(BONE_ALIASES.neck);
  const blinkMorphs = morphs.some(morph => morph.kind === 'blink');
  const jawMorphs = morphs.some(morph => morph.kind === 'talking');
  const pitch = new THREE.Vector3(1, 0, 0), roll = new THREE.Vector3(0, 0, 1), offset = new THREE.Quaternion();
  const tilt = (bone: THREE.Bone, axis: THREE.Vector3, angle: number) => { if (angle !== 0) bone.quaternion.multiply(offset.setFromAxisAngle(axis, angle)); };
  const animationPose = bones.map(bone => ({ bone, quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
  const applyTracking = createTracking(model, bones, morphs);
  const run = kind === 'runner' && !runClip ? createRunnerMotion(model, bones) : null;
  let runnerVariant: 0 | 1 | 2 = 1;
  let disposed = false;
  function restoreAnimationPose() {
    for (const transform of animationPose) {
      transform.bone.quaternion.copy(transform.quaternion);
      transform.bone.scale.copy(transform.scale);
    }
    for (const morph of morphs) morph.mesh.morphTargetInfluences![morph.index] = morph.initial;
  }
  function rememberAnimationPose() {
    for (const transform of animationPose) {
      transform.quaternion.copy(transform.bone.quaternion);
      transform.scale.copy(transform.bone.scale);
    }
    for (const morph of morphs) morph.initial = morph.mesh.morphTargetInfluences![morph.index];
  }
  return {
    root,
    setVariant: kind === 'runner' ? variant => {
      if (variant !== 0 && variant !== 1 && variant !== 2) throw new Error('Unknown runner profile');
      runnerVariant = variant;
    } : undefined,
    setClips(nextClips) {
      if (disposed) throw new Error('Character is disposed');
      restoreAnimationPose();
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      rememberAnimationPose();
      const next = nextClips.find(candidate => candidate.name.toLowerCase() === 'idle') ?? nextClips[0];
      if (next) mixer.clipAction(next).play();
    },
    update(input) {
      if (disposed) return;
      const { time, motion, breath, breathingPace, pulsePace, blink, talking } = sceneDynamics(input);
      const signals = motion > 0 && input.frame?.source !== 'local-camera';
      restoreAnimationPose();
      mixer.setTime(time * motion * (runClip ? RUNNER_PACE[runnerVariant] : 1));
      rememberAnimationPose();
      const headPitch = -pulsePace * 0.3 + (signals && !blinkMorphs ? blink * 0.1 : 0);
      const headRoll = signals && !jaw && !jawMorphs ? talking * 0.1 : 0;
      root.rotation.set((chest ? 0 : -breathingPace * 0.08) + (head ? 0 : headPitch * 0.4), 0, breath * 0.03 + (head ? 0 : headRoll * 0.4));
      if (!chest) root.scale.set(1 + breath * 0.04, 1, 1 + breath * 0.08);
      if (run) {
        root.position.y = 0;
        root.position.y = run(input, runnerVariant);
      }
      for (const [material, base] of glowMaterials) material.emissive.copy(base).lerp(PULSE_GLOW, pulsePace * 0.5);
      if (chest) {
        chest.scale.x *= 1 + breath * 0.08;
        chest.scale.z *= 1 + breath * 0.12;
        tilt(chest, pitch, -breathingPace * 0.25 - breath * 0.08);
      }
      if (head) {
        tilt(head, pitch, headPitch);
        tilt(head, roll, headRoll);
      }
      if (signals) {
        if (jaw) tilt(jaw, pitch, talking * 0.15);
        for (const morph of morphs) {
          if (morph.kind && signalValue(input, morph.kind) !== null) morph.mesh.morphTargetInfluences![morph.index] = morph.kind === 'blink' ? blink : talking * 0.9;
        }
      }
      applyTracking(input);
      root.updateMatrixWorld(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      disposeObject(root);
    },
  };
}
