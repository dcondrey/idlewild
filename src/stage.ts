import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { SceneFrame, SceneId } from './contracts.ts';
import { createCharacter } from './scenes/character.ts';
import { createBabyDragon, createBrain, createBubbles, createRunner, createStar } from './scenes/procedural.ts';
import { disposeObject } from './scenes/resources.ts';
import type { SceneSubject } from './scenes/types.ts';
import { setAssetCopyright } from './asset-credits.ts';
import { SCENE_IDS } from './scenes/registry.ts';

type AssetState = { phase: 'loading' | 'ready' | 'error'; message: string };

export interface Stage {
  update(input: SceneFrame): void;
  resize(width: number, height: number): void;
  dispose(): void;
  setScene(scene: SceneId): void;
  setDetailView(enabled: boolean): void;
  setRunnerVariant(variant: 0 | 1 | 2): void;
  getExportRoot(): THREE.Object3D;
  setImported(root: THREE.Group | null, clips: THREE.AnimationClip[]): void;
  setImportedClips(clips: THREE.AnimationClip[]): void;
  whenReady(): Promise<void>;
  diagnostics(): Readonly<{
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
    contextLost: boolean;
    assets: Readonly<Record<'robot' | 'dragon', Readonly<AssetState>>>;
  }>;
}

export async function createStage(canvas: HTMLCanvasElement): Promise<Stage> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const world = new THREE.Scene();
  world.background = new THREE.Color(0x10182b);
  world.fog = new THREE.Fog(0x10182b, 10, 25);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
  camera.position.set(0, 2.5, 8.1);
  camera.lookAt(0, 1.6, 0);
  world.add(new THREE.HemisphereLight(0xc2e9ff, 0x3c2e4e, 2.4));
  const key = new THREE.DirectionalLight(0xffe3d1, 3.3);
  key.position.set(-3, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
  key.shadow.normalBias = 0.025;
  world.add(key);
  const rim = new THREE.DirectionalLight(0x92abff, 2.5);
  rim.position.set(4, 3, -4);
  world.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshStandardMaterial({ color: 0x263048, roughness: 0.88, metalness: 0.08 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.025;
  floor.receiveShadow = true;
  world.add(floor);
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.9, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x303b53, roughness: 0.7, metalness: 0.18 }));
  platform.position.y = -0.07;
  platform.receiveShadow = true;
  world.add(platform);

  const subjects = new Map<SceneId, SceneSubject>();
  let selected: SceneId = 'robot';
  let detailView = false;
  let disposed = false;
  let contextLost = false;
  const assets: Record<'robot' | 'dragon', AssetState> = {
    robot: { phase: 'loading', message: 'Loading robot…' },
    dragon: { phase: 'loading', message: 'Loading European dragon…' },
  };
  const pending = new Set<AbortController>();
  function frameCamera() {
    const subject = subjects.get('imported');
    if (detailView && selected === 'imported' && subject) {
      const bounds = new THREE.Box3().setFromObject(subject.root, true);
      const height = bounds.getSize(new THREE.Vector3()).y;
      const target = bounds.getCenter(new THREE.Vector3());
      let head: THREE.Object3D | null = null;
      subject.root.traverse(node => {
        if (node instanceof THREE.Bone && ['head', 'defhead', 'mixamorighead'].includes(node.name.toLowerCase().replace(/[^a-z]/g, ''))) head = node;
      });
      if (head) { (head as THREE.Object3D).getWorldPosition(target); target.y += height * 0.07; }
      const radius = Math.max(0.15, height * (head ? 0.15 : 0.3));
      const distance = radius / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect)) + radius;
      camera.position.set(target.x, target.y + radius * 0.06, target.z + distance);
      camera.lookAt(target);
      return;
    }
    const distance = Math.max(selected === 'dragon' ? 7.5 : 8.1, 2.8 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect) + 1.2);
    camera.position.set(0, selected === 'dragon' ? 2.1 : 2.5, distance);
    camera.lookAt(0, selected === 'dragon' ? 0.7 : 1.6, 0);
  }
  const lost = (event: Event) => { event.preventDefault(); contextLost = true; };
  const restored = () => { contextLost = false; };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);

  function attach(id: SceneId, subject: SceneSubject) {
    subject.root.visible = selected === id;
    subjects.set(id, subject);
    world.add(subject.root);
  }

  try {
    attach('bubbles', createBubbles());
    attach('star', createStar());
    attach('baby-dragon', createBabyDragon());
    attach('runner', createRunner());
    attach('brain', createBrain());
  } catch (error) {
    for (const subject of subjects.values()) subject.dispose();
    disposeObject(world);
    key.shadow.dispose();
    renderer.dispose();
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
    throw error;
  }

  async function load(id: 'robot' | 'dragon') {
    const controller = new AbortController();
    pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let loaded: THREE.Group | null = null;
    try {
      const response = await fetch(`./models/${id}.glb`, { signal: controller.signal });
      if (!response.ok) throw new Error('Asset unavailable');
      const data = await response.arrayBuffer();
      if (data.byteLength > 8 * 1024 * 1024) throw new Error('Asset exceeds limit');
      if (disposed) return;
      const gltf = await new GLTFLoader().parseAsync(data, './models/');
      loaded = gltf.scene;
      if (disposed) { disposeObject(loaded); loaded = null; return; }
      setAssetCopyright(loaded, id === 'robot'
        ? 'RobotExpressive by Tomas Laulhe (Quaternius), adapted by Don McCurdy. CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/ . Source: https://github.com/mrdoob/three.js/tree/eba30de865cfbf31ac736f792defd9a60ff28d57/examples/models/gltf/RobotExpressive'
        : 'Dragon sample by afk.ai. CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/ . Source: https://afk.ai/auto-rig/dragon');
      const subject = createCharacter(loaded, gltf.animations, id);
      loaded = null;
      attach(id, subject);
      assets[id] = { phase: 'ready', message: '' };
    } catch {
      if (loaded) disposeObject(loaded);
      assets[id] = { phase: 'error', message: `Could not load ${id === 'dragon' ? 'European dragon' : 'robot'}. Choose another scene or reload the studio.` };
    } finally {
      clearTimeout(timeout);
      pending.delete(controller);
    }
  }

  const ready = Promise.all([load('robot'), load('dragon')]).then(() => undefined);
  return {
    update(input) {
      if (disposed || contextLost) return;
      subjects.get(selected)?.update(input);
      renderer.render(world, camera);
    },
    resize(width, height) {
      if (disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const w = Math.min(Math.floor(width), 4096);
      const h = Math.min(Math.floor(height), 4096);
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      frameCamera();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, 4096 / w, 4096 / h);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
    },
    setScene(id) {
      if (disposed) throw new Error('Stage is disposed');
      if (!SCENE_IDS.includes(id)) throw new Error('Unknown scene');
      selected = id;
      detailView = false;
      frameCamera();
      for (const [name, subject] of subjects) subject.root.visible = name === id;
    },
    setDetailView(enabled) {
      if (disposed) throw new Error('Stage is disposed');
      detailView = enabled;
      frameCamera();
    },
    setRunnerVariant(variant) {
      if (!Number.isInteger(variant) || variant < 0 || variant > 2) throw new Error('Unknown runner');
      subjects.get('runner')?.setVariant?.(variant);
    },
    getExportRoot() {
      if (disposed) throw new Error('Stage is disposed');
      const subject = subjects.get(selected);
      if (!subject) throw new Error('The selected scene is not ready to export');
      return subject.root;
    },
    setImported(model, clips) {
      if (disposed) throw new Error('Stage is disposed');
      const previous = subjects.get('imported');
      const subject = model ? createCharacter(model, clips, 'imported') : null;
      previous?.dispose();
      subjects.delete('imported');
      if (subject) attach('imported', subject);
    },
    setImportedClips(clips) {
      if (disposed) throw new Error('Stage is disposed');
      const subject = subjects.get('imported');
      if (!subject?.setClips) throw new Error('Import a character before adding an animation');
      subject.setClips(clips);
    },
    whenReady: () => ready,
    diagnostics() {
      return Object.freeze({
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0, contextLost,
        assets: Object.freeze({ robot: Object.freeze({ ...assets.robot }), dragon: Object.freeze({ ...assets.dragon }) }),
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of pending) controller.abort();
      for (const subject of subjects.values()) subject.dispose();
      subjects.clear();
      disposeObject(world);
      key.shadow.dispose();
      renderer.dispose();
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    },
  };
}
