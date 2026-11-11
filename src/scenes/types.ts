import type * as THREE from 'three';
import type { SceneFrame } from '../contracts.ts';

export interface SceneSubject {
  root: THREE.Group;
  update(input: SceneFrame): void;
  dispose(): void;
  setVariant?(variant: 0 | 1 | 2): void;
  setClips?(clips: THREE.AnimationClip[]): void;
}
