import * as THREE from 'three';
import { sceneDynamics } from './dynamics.ts';
import { disposeObject, fitModel } from './resources.ts';
import type { SceneSubject } from './types.ts';

export function createCharacter(model: THREE.Group, clips: THREE.AnimationClip[], kind: 'robot' | 'dragon' | 'imported'): SceneSubject {
  const root = new THREE.Group();
  root.name = `${kind}_Performance`;
  const framing = new THREE.Group();
  framing.name = `${kind}_Framing`;
  framing.rotation.y = kind === 'dragon' ? Math.PI / 3 : 0;
  framing.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clip = clips.find(candidate => candidate.name.toLowerCase() === 'idle') ?? clips[0];
  if (clip) mixer.clipAction(clip).play();
  mixer.setTime(0);
  framing.updateMatrixWorld(true);
  model.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) {
      object.computeBoundingBox();
      object.frustumCulled = false;
    }
  });
  fitModel(framing, kind === 'dragon' ? 2.65 : 2.7, 5.2);
  root.add(framing);
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  const morphs: { mesh: THREE.Mesh; index: number; kind: 'blink' | 'talking'; initial: number }[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Bone) bones.push(object);
    if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) {
      for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
        const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
        if (['blink', 'blinkleft', 'blinkright', 'eyeblinkleft', 'eyeblinkright'].includes(normalized)) morphs.push({ mesh: object, index, kind: 'blink', initial: object.morphTargetInfluences[index] });
        if (['jawopen', 'mouthopen'].includes(normalized)) morphs.push({ mesh: object, index, kind: 'talking', initial: object.morphTargetInfluences[index] });
      }
    }
  });
  const findBone = (...names: string[]) => bones.find(bone => names.includes(bone.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const chest = kind === 'robot' ? findBone('abdomen', 'torso') : kind === 'dragon' ? findBone('spine1', 'stomach') : findBone('chest', 'spine1', 'spine2', 'mixamorigspine1', 'mixamorigspine2');
  const jaw = kind === 'dragon' ? findBone('mouthlower') : findBone('jaw', 'mixamorigjaw');
  const alteredBones = [chest, jaw].filter((bone): bone is THREE.Bone => bone !== undefined);
  const animationPose = alteredBones.map(bone => ({ bone, quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
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
      const { time, motion, breath, blink, talking } = sceneDynamics(input);
      restoreAnimationPose();
      mixer.setTime(time * motion);
      rememberAnimationPose();
      if (chest) {
        chest.scale.x *= 1 + breath * 0.025;
        chest.scale.z *= 1 + breath * 0.04;
      } else root.scale.set(1 + breath * 0.012, 1, 1 + breath * 0.025);
      if (jaw) jaw.rotation.x += talking * 0.08;
      for (const morph of morphs) morph.mesh.morphTargetInfluences![morph.index] = morph.kind === 'blink' ? blink : talking * 0.65;
      root.rotation.z = breath * 0.015;
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
