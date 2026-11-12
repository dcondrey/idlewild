import type { SceneId } from '../contracts.ts';

export interface SceneEntry {
  id: string;
  scene: SceneId;
  label: string;
  title: string;
  caption: string;
  group: 'default' | 'yours';
  model?: string;
  credit?: string;
}

export const SCENE_REGISTRY: readonly SceneEntry[] = Object.freeze(([
  { id: 'rex', scene: 'rex', label: 'Rex', title: 'Rex', caption: 'A sporty showman with a long chin and big expressions.', group: 'default', credit: 'Rex Rig (CC) Blender Foundation | studio.blender.org, CC BY 4.0, modified' },
  { id: 'bubbles', scene: 'bubbles', label: 'Bubbles', title: 'In suspension', caption: 'An iridescent interpretation of movement, not measured airflow.', group: 'default' },
  { id: 'star', scene: 'star', label: 'Star', title: 'A little starlight', caption: 'A soft glow shaped by the same performance.', group: 'default' },
  { id: 'sprite', scene: 'imported', label: 'Sprite', title: 'Sprite', caption: 'A small forest sprite with a big, expressive face.', group: 'default', model: './models/sprite.glb', credit: 'Sprite Rig (CC) Blender Foundation | studio.blender.org, CC BY 4.0, modified' },
  { id: 'runner', scene: 'runner', label: 'Runner', title: 'Find your stride', caption: 'A comfortable, bounded creative pace. Faster breathing earns no reward.', group: 'default', credit: 'Rain Rig (CC) Blender Foundation | studio.blender.org, CC BY 4.0, modified' },
  { id: 'brain', scene: 'brain', label: 'Brain', title: 'Body & brain', caption: 'Educational simulation based on published studies; not your measured brain activity.', group: 'default', credit: 'Brain for Blender by Anderson Winkler (brainder.org), CC BY-SA 3.0, modified' },
  { id: 'imported', scene: 'imported', label: 'Your character', title: 'Your character', caption: 'A new home for the same performance.', group: 'yours' },
] satisfies SceneEntry[]).map(entry => Object.freeze(entry)));

export const SCENE_IDS: readonly SceneId[] = Object.freeze([...new Set(SCENE_REGISTRY.map(entry => entry.scene))]);
