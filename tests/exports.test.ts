import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeAnimation, exportControlData, exportPreview } from '../src/exports.ts';
import { TakeRecorder } from '../src/recording.ts';
import { rehearsalFrame } from '../src/rehearsal.ts';
import type { SceneFrame } from '../src/contracts.ts';
import { setAssetCopyright } from '../src/asset-credits.ts';
import { inspectCharacter } from '../src/imports.ts';

const readerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
before(() => {
  class BlobReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); });
    }
  }
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: BlobReader });
});
after(() => {
  if (readerDescriptor) Object.defineProperty(globalThis, 'FileReader', readerDescriptor);
  else Reflect.deleteProperty(globalThis, 'FileReader');
});

const controls = { motion: 1, sensitivity: 0.8, sound: 0.5 };
function take() {
  const recorder = new TakeRecorder('take-one', 'rehearsal', 'session-one', 42);
  for (const timeMs of [0, 50, 100, 150]) recorder.append(rehearsalFrame(42, 'session-one', timeMs));
  return recorder.finish();
}

function rig() {
  const root = new THREE.Group();
  root.name = 'Performance';
  root.userData = { apiKey: 'never-export' };
  const bone = new THREE.Bone();
  bone.name = 'Chest';
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.userData = { secret: 'never-export' };
  const positions = geometry.getAttribute('position');
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(positions.count * 4), 4));
  const weights = new Float32Array(positions.count * 4);
  for (let index = 0; index < positions.count; index++) weights[index * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.morphAttributes.position = [positions.clone()];
  geometry.morphTargetsRelative = false;
  const material = new THREE.MeshStandardMaterial();
  material.userData = { secret: 'never-export' };
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'Body';
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  root.add(mesh);
  const inputs: SceneFrame[] = [];
  const stage = {
    getExportRoot: () => root,
    update(input: SceneFrame) {
      inputs.push(input);
      root.position.x = input.timeMs / 1000;
      bone.rotation.z = (input.frame?.signals.breath.value ?? 0) * input.controls.sensitivity;
      mesh.morphTargetInfluences![0] = input.frame?.signals.breath.value ?? 0;
    },
  };
  return { root, mesh, bone, geometry, material, inputs, stage };
}

async function glbJSON(blob: Blob) {
  const data = await blob.arrayBuffer();
  const view = new DataView(data);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), data.byteLength);
  const size = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  return { data, json: JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, size))) };
}

test('control export keeps versioned provenance and removes unknown fields at every boundary', async () => {
  const input = take();
  Object.assign(input, { apiKey: 'never-export' });
  Object.assign(input.samples[0], { cameraImage: 'never-export' });
  Object.assign(input.samples[0].signals.breath, { privateData: 'never-export' });
  input.samples[1].signals.breath.provenance = 'replayed';
  const blob = exportControlData(input);
  assert.equal(blob.type, 'application/json');
  const text = await blob.text();
  assert.ok(!text.includes('never-export'));
  const decoded = JSON.parse(text);
  assert.equal(decoded.version, 1);
  assert.equal(decoded.samples[0].signals.breath.provenance, 'synthetic');
  assert.equal(decoded.samples[1].signals.breath.provenance, 'replayed');
  assert.equal(decoded.durationMs, 200);
  assert.throws(() => exportControlData({ ...input, samples: [] }), /nonempty/);
  assert.throws(() => exportControlData({ ...input, durationMs: 180_001 }));
});

test('baked GLB reloads with meaningful bone, root and morph animation at the take clock', async () => {
  const fixture = rig();
  const input = take();
  const copyright = 'Fixture by Test Artist. CC BY 4.0: https://creativecommons.org/licenses/by/4.0/';
  setAssetCopyright(fixture.mesh, copyright);
  input.samples[1].signals.breath.provenance = 'replayed';
  let geometryDisposed = false;
  let materialDisposed = false;
  fixture.geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  fixture.material.addEventListener('dispose', () => { materialDisposed = true; });
  const blob = await bakeAnimation(input, fixture.stage, Object.assign({ ...controls }, { apiKey: 'never-export' }));
  assert.equal(blob.type, 'model/gltf-binary');
  const { data, json } = await glbJSON(blob);
  assert.equal(json.asset.copyright, copyright);
  assert.equal(inspectCharacter(data, 'glb').copyright, copyright);
  assert.ok(!JSON.stringify(json).includes('never-export'));
  assert.deepEqual(fixture.inputs.map(input => input.timeMs), [0, 50, 100, 150, 200]);
  assert.ok(fixture.inputs.every(input => input.seed === 42));
  assert.equal(geometryDisposed, false);
  assert.equal(materialDisposed, false);
  assert.deepEqual(fixture.root.userData, { apiKey: 'never-export' });
  const animation = json.animations[0];
  assert.deepEqual(new Set(animation.channels.map((channel: { target: { path: string } }) => channel.target.path)), new Set(['translation', 'rotation', 'weights']));
  assert.equal(json.skins.length, 1);
  const meta = json.nodes.find((node: { extras?: { idlewild?: unknown } }) => node.extras?.idlewild).extras.idlewild;
  assert.equal(meta.source, 'rehearsal');
  assert.match(meta.adaptation, /Adapted in Idlewild/);
  assert.equal(meta.durationMs, 200);
  assert.deepEqual(meta.provenance.breath.map((segment: { source: string }) => segment.source), ['synthetic', 'replayed', 'synthetic']);
  const gltf = await new GLTFLoader().parseAsync(data, '');
  assert.equal(gltf.animations.length, 1);
  assert.ok(Math.abs(gltf.animations[0].duration - 0.2) < 1e-6);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations[0]).play();
  mixer.setTime(0.1);
  assert.ok(Math.abs(gltf.scene.getObjectByName('Performance')!.position.x - 0.1) < 1e-6);
  const expected = input.samples[2].signals.breath.value!;
  const exportedMesh = gltf.scene.getObjectByName('Body') as THREE.SkinnedMesh;
  assert.ok(exportedMesh.isSkinnedMesh);
  assert.ok(Math.abs(exportedMesh.morphTargetInfluences![0] - expected) < 1e-6);
  assert.ok(Math.abs(gltf.scene.getObjectByName('Chest')!.rotation.z - expected * controls.sensitivity) < 1e-6);
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  fixture.geometry.dispose();
  fixture.material.dispose();
  fixture.mesh.skeleton.dispose();
});

test('baking preserves gaps and rejects constant, nonfinite or changing scene output', async () => {
  const input = take();
  input.samples.splice(1, 2);
  const fixture = rig();
  await bakeAnimation(input, fixture.stage, controls);
  assert.equal(fixture.inputs[1].frame, null);
  assert.equal(fixture.inputs[2].frame, null);
  const staticRoot = new THREE.Group();
  await assert.rejects(bakeAnimation(take(), { getExportRoot: () => staticRoot, update() {} }, controls), /no animated transforms/);
  await assert.rejects(bakeAnimation(take(), { getExportRoot: () => staticRoot, update() { staticRoot.position.x = NaN; } }, controls), /invalid transforms/);
  await assert.rejects(bakeAnimation(take(), { getExportRoot: () => new THREE.Group(), update() {} }, controls), /scene changed/);
  await assert.rejects(bakeAnimation(take(), fixture.stage, { ...controls, motion: 1.01 }), /between zero and one/);
  fixture.geometry.dispose();
  fixture.material.dispose();
  fixture.mesh.skeleton.dispose();
});

test('baking enforces node and morph boundaries before allocating tracks', async () => {
  for (const count of [511, 512, 513]) {
    const root = new THREE.Group();
    for (let index = 1; index < count; index++) root.add(new THREE.Group());
    const stage = { getExportRoot: () => root, update(input: SceneFrame) { root.position.x = input.timeMs; } };
    if (count <= 512) assert.ok((await bakeAnimation(take(), stage, controls)).size > 0);
    else await assert.rejects(bakeAnimation(take(), stage, controls), /512/);
  }
  const fixture = rig();
  fixture.mesh.morphTargetInfluences = Array(65).fill(0);
  await assert.rejects(bakeAnimation(take(), fixture.stage, controls), /64 morph/);
  fixture.geometry.dispose();
  fixture.material.dispose();
  fixture.mesh.skeleton.dispose();
});

test('cancellation stops baking before scene sampling and at cooperative yield boundaries', async () => {
  const fixture = rig();
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(bakeAnimation(take(), fixture.stage, controls, { signal: alreadyAborted.signal }), { name: 'AbortError' });
  assert.equal(fixture.inputs.length, 0);
  const controller = new AbortController();
  await assert.rejects(bakeAnimation(take(), fixture.stage, controls, { signal: controller.signal, onProgress() { controller.abort(); } }), { name: 'AbortError' });
  fixture.geometry.dispose();
  fixture.material.dispose();
  fixture.mesh.skeleton.dispose();
});

test('preview reports unavailable encoders without claiming an output', async () => {
  await assert.rejects(exportPreview({ take: take(), scene: 'rex', controls, canvas: {} as HTMLCanvasElement, update() {} }), /cannot encode/);
});
