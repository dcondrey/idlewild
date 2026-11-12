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
  { id: 'robot', scene: 'robot', label: 'Robot', title: 'The robot', caption: 'A small character with a rhythm of its own.', group: 'default', credit: 'RobotExpressive by Tomás Laulhé (Quaternius), CC0' },
  { id: 'snow', scene: 'imported', label: 'Snow', title: 'Snow', caption: 'An expressive face and body rig for close facial detail.', group: 'default', model: './models/snow.glb', credit: 'Snow Rig (CC) Blender Foundation | studio.blender.org' },
  { id: 'bubbles', scene: 'bubbles', label: 'Bubbles', title: 'In suspension', caption: 'An iridescent interpretation of movement, not measured airflow.', group: 'default' },
  { id: 'star', scene: 'star', label: 'Star', title: 'A little starlight', caption: 'A soft glow shaped by the same performance.', group: 'default' },
  { id: 'dragon', scene: 'dragon', label: 'Dragon', title: 'The European dragon', caption: 'Ancient wings. A new performance.', group: 'default', credit: 'Dragon sample by afk.ai, CC0' },
  { id: 'sprite', scene: 'imported', label: 'Sprite', title: 'Sprite', caption: 'A small forest sprite with a big, expressive face.', group: 'default', model: './models/sprite.glb', credit: 'Sprite Rig (CC) Blender Foundation | studio.blender.org, CC BY 4.0, modified' },
  { id: 'runner', scene: 'runner', label: 'Runner', title: 'Find your stride', caption: 'A comfortable, bounded creative pace. Faster breathing earns no reward.', group: 'default', credit: 'Rain Rig (CC) Blender Foundation | studio.blender.org, CC BY 4.0, modified' },
  { id: 'brain', scene: 'brain', label: 'Brain', title: 'Body & brain', caption: 'Educational simulation based on published studies; not your measured brain activity.', group: 'default', credit: 'Brain for Blender by Anderson Winkler (brainder.org), CC BY-SA 3.0, modified' },
  { id: 'imported', scene: 'imported', label: 'Your character', title: 'Your character', caption: 'A new home for the same performance.', group: 'yours' },
] satisfies SceneEntry[]).map(entry => Object.freeze(entry)));

export const SCENE_IDS: readonly SceneId[] = Object.freeze([...new Set(SCENE_REGISTRY.map(entry => entry.scene))]);
