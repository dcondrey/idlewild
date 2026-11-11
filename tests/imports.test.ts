import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { IMPORT_LIMITS, importCharacter, inspectCharacter, validateClipCompatibility, disposeImported } from '../src/imports.ts';
import { getAssetCopyright } from '../src/asset-credits.ts';

function encode(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function triangle() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength: positions.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ name: 'Triangle', mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  };
}

function glb(copyright?: unknown, extras?: Record<string, unknown>): ArrayBuffer {
  const json = triangle();
  const binary = Buffer.from(json.buffers[0].uri.split(',')[1], 'base64');
  const document = { ...json, asset: { ...json.asset, copyright }, scenes: json.scenes.map(scene => ({ ...scene, extras })), buffers: [{ byteLength: binary.length }] };
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(28 + jsonLength + binary.length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, jsonLength).fill(0x20);
  new Uint8Array(buffer, 20, encoded.length).set(encoded);
  view.setUint32(20 + jsonLength, binary.length, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  new Uint8Array(buffer, 28 + jsonLength).set(binary);
  return buffer;
}

test('self-contained GLB and embedded glTF are inspected without loading resources', () => {
  for (const [data, extension] of [[glb(), 'glb'], [encode(triangle()), 'gltf']] as const) {
    const result = inspectCharacter(data, extension);
    assert.equal(result.kind, 'model');
    assert.match(result.summary, /3 vertices/);
    assert.match(result.summary, /static model/);
  }
});

test('standard asset copyright survives GLB import while unrelated metadata is discarded', async () => {
  const credit = 'Example artist — Example character\nCC BY 4.0 https://creativecommons.org/licenses/by/4.0/\nModified for animation.';
  const data = glb(credit, { privateNote: 'Do not copy this metadata.' });
  assert.equal(inspectCharacter(data, 'glb').copyright, credit);
  const imported = await importCharacter(new File([data], 'credited.glb'));
  try {
    assert.equal(getAssetCopyright(imported.root), credit);
    assert.deepEqual(imported.root.userData, {});
  } finally { disposeImported(imported.root); }
});

test('absent copyright remains absent in inspection and parsed character', async () => {
  const data = glb();
  assert.equal(inspectCharacter(data, 'glb').copyright, undefined);
  assert.equal(inspectCharacter(encode(triangle()), 'gltf').copyright, undefined);
  const imported = await importCharacter(new File([data], 'uncredited.glb'));
  try { assert.equal(getAssetCopyright(imported.root), undefined); }
  finally { disposeImported(imported.root); }
});

test('copyright accepts bounded plain text and rejects invalid types and control characters', () => {
  const json = triangle();
  const inspect = (copyright: unknown) => inspectCharacter(encode({ ...json, asset: { ...json.asset, copyright } }), 'gltf');
  for (const length of [4095, 4096]) {
    const credit = 'x'.repeat(length);
    assert.equal(inspect(credit).copyright, credit);
  }
  assert.throws(() => inspect('x'.repeat(4097)), /copyright/);
  for (const value of [null, 0, {}, ['credit'], 'credit\0', 'credit\u000b', 'credit\u001f', 'credit\u007f']) {
    assert.throws(() => inspect(value), /copyright/);
    assert.throws(() => inspectCharacter(glb(value), 'glb'), /copyright/);
  }
  assert.equal(inspect('  Artist\nLicense\tURL\r\n  ').copyright, 'Artist\nLicense\tURL');
});

test('GLB headers, chunk boundaries, versions and file allocation are validated', () => {
  for (const mutate of [
    (view: DataView) => view.setUint32(0, 0, true),
    (view: DataView) => view.setUint32(4, 1, true),
    (view: DataView) => view.setUint32(8, view.byteLength - 1, true),
    (view: DataView) => view.setUint32(12, 0xfffffffc, true),
    (view: DataView) => view.setUint32(12, 3, true),
    (view: DataView) => view.setUint32(16, 0, true),
  ]) {
    const input = glb();
    mutate(new DataView(input));
    assert.throws(() => inspectCharacter(input, 'glb'));
  }
  assert.throws(() => inspectCharacter(new ArrayBuffer(IMPORT_LIMITS.bytes + 1), 'gltf'), /32 MiB/);
  assert.throws(() => inspectCharacter(new ArrayBuffer(1), 'gltf'));
  assert.throws(() => inspectCharacter(new Uint8Array([0xff, 0xfe]).buffer, 'gltf'), /UTF-8/);
});

test('external resources, unknown extensions, sparse data and unsafe properties are rejected', () => {
  for (const uri of ['https://example.com/model.bin', '../secret', 'file:///etc/passwd', 'data:text/html;base64,AAAA', 'blob:foreign']) {
    const json = triangle();
    json.buffers[0].uri = uri;
    assert.throws(() => inspectCharacter(encode(json), 'gltf'), /external resources/);
  }
  const json = triangle();
  assert.throws(() => inspectCharacter(encode({ ...json, extensionsUsed: ['EXT_mesh_gpu_instancing'] }), 'gltf'), /extension/);
  assert.throws(() => inspectCharacter(encode({ ...json, nodes: [{ ...json.nodes[0], extensions: { KHR_draco_mesh_compression: {} } }] }), 'gltf'), /unsupported/);
  assert.throws(() => inspectCharacter(encode({ ...json, accessors: [{ ...json.accessors[0], sparse: {} }] }), 'gltf'), /sparse/);
  const unsafe = JSON.stringify(json).replace('"asset":', '"__proto__":{},"asset":');
  assert.throws(() => inspectCharacter(new TextEncoder().encode(unsafe).buffer, 'gltf'), /unsafe/);
});

test('accessors reject missing references, truncated storage and non-finite floats', () => {
  const json = triangle();
  for (const accessors of [
    [{ ...json.accessors[0], bufferView: 1 }],
    [{ ...json.accessors[0], count: 4 }],
    [{ ...json.accessors[0], count: 1000001 }],
    [{ ...json.accessors[0], byteOffset: 1 }],
    [{ ...json.accessors[0], componentType: 5124 }],
  ]) assert.throws(() => inspectCharacter(encode({ ...json, accessors }), 'gltf'));
  const bytes = new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0]);
  json.buffers[0].uri = `data:application/octet-stream;base64,${Buffer.from(bytes.buffer).toString('base64')}`;
  assert.throws(() => inspectCharacter(encode(json), 'gltf'), /float/);
});

test('node limits, cycles, duplicate ownership and non-finite transforms fail before parsing', () => {
  const json = triangle();
  for (const count of [255, 256]) {
    const nodes = Array.from({ length: count }, (_, index) => index === 0 ? json.nodes[0] : { name: `node_${index}` });
    assert.equal(inspectCharacter(encode({ ...json, nodes, scenes: [{ nodes: nodes.map((_, index) => index) }] }), 'gltf').kind, 'model');
  }
  assert.throws(() => inspectCharacter(encode({ ...json, nodes: new Array(257).fill({}) }), 'gltf'), /nodes/);
  assert.throws(() => inspectCharacter(encode({ ...json, nodes: [{ ...json.nodes[0], children: [0] }] }), 'gltf'), /root|cycle/);
  assert.throws(() => inspectCharacter(encode({ ...json, nodes: [{ children: [2] }, { children: [2] }, json.nodes[0]], scenes: [{ nodes: [0, 1] }] }), 'gltf'), /one parent/);
  assert.throws(() => inspectCharacter(encode({ ...json, nodes: [{ ...json.nodes[0], translation: [null, 0, 0] }] }), 'gltf'), /translation/);
  assert.throws(() => inspectCharacter(encode({ ...json, nodes: [{ ...json.nodes[0], rotation: [0, 0, 0, 0] }] }), 'gltf'), /quaternion/);
});

test('vertex and index references are checked against declared geometry budgets', () => {
  for (const count of [499999, 500000, 500001]) {
    const bytes = new Uint8Array(count * 12 + 8);
    const view = new DataView(bytes.buffer);
    view.setUint16(count * 12, 0, true);
    view.setUint16(count * 12 + 2, 1, true);
    view.setUint16(count * 12 + 4, 2, true);
    const json = {
      ...triangle(),
      buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
      bufferViews: [{ buffer: 0, byteLength: count * 12 }, { buffer: 0, byteOffset: count * 12, byteLength: 6 }],
      accessors: [{ bufferView: 0, componentType: 5126, count, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    };
    if (count <= 500000) assert.equal(inspectCharacter(encode(json), 'gltf').kind, 'model');
    else assert.throws(() => inspectCharacter(encode(json), 'gltf'), /geometry/);
  }
  const json = triangle();
  const bytes = new Uint8Array(42);
  bytes.set(Buffer.from(json.buffers[0].uri.split(',')[1], 'base64'));
  new DataView(bytes.buffer).setUint16(40, 3, true);
  const invalid = {
    ...json, buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
    bufferViews: [...json.bufferViews, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [...json.accessors, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  };
  assert.throws(() => inspectCharacter(encode(invalid), 'gltf'), /outside its vertex/);
});

test('texture headers are bounded before image decoding', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8N8AAAAASUVORK5CYII=', 'base64');
  for (const width of [4095, 4096, 4097]) {
    const image = Buffer.from(png);
    image.writeUInt32BE(width, 16);
    const json = { ...triangle(), images: [{ uri: `data:image/png;base64,${image.toString('base64')}` }] };
    if (width <= 4096) assert.equal(inspectCharacter(encode(json), 'gltf').kind, 'model');
    else assert.throws(() => inspectCharacter(encode(json), 'gltf'), /width/);
  }
  assert.throws(() => inspectCharacter(encode({ ...triangle(), images: [{ uri: 'data:image/png;base64,AAAA' }] }), 'gltf'), /PNG/);
});

test('PNG buffer views allow only zero padding needed for four-byte alignment', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8N8AAAAASUVORK5CYII=', 'base64');
  const imageDocument = (bytes: Buffer) => {
    const json = triangle();
    return {
      ...json,
      buffers: [...json.buffers, { byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
      bufferViews: [...json.bufferViews, { buffer: 1, byteLength: bytes.length }],
      images: [{ bufferView: 1, mimeType: 'image/png' }],
    };
  };
  const observed = new Set<number>();
  for (let length = 0; length < 4; length++) {
    const payload = Buffer.from(`note\0${'x'.repeat(length)}`);
    const chunk = Buffer.alloc(12 + payload.length);
    chunk.writeUInt32BE(payload.length);
    chunk.write('tEXt', 4, 'ascii');
    payload.copy(chunk, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    const image = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
    const padding = (4 - image.length % 4) % 4;
    observed.add(padding);
    const aligned = Buffer.concat([image, Buffer.alloc(padding)]);
    assert.equal(inspectCharacter(encode(imageDocument(image)), 'gltf').kind, 'model');
    assert.equal(inspectCharacter(encode(imageDocument(aligned)), 'gltf').kind, 'model');
    assert.throws(() => inspectCharacter(encode(imageDocument(Buffer.concat([image, Buffer.alloc(4)]))), 'gltf'), /PNG end marker/);
    assert.throws(() => inspectCharacter(encode(imageDocument(Buffer.concat([aligned, Buffer.alloc(1)]))), 'gltf'), /PNG end marker/);
    if (padding) {
      const nonzero = Buffer.from(aligned);
      nonzero[nonzero.length - 1] = 1;
      assert.throws(() => inspectCharacter(encode(imageDocument(nonzero)), 'gltf'), /PNG end marker/);
      assert.throws(() => inspectCharacter(encode({ ...triangle(), images: [{ uri: `data:image/png;base64,${aligned.toString('base64')}` }] }), 'gltf'), /PNG end marker/);
    }
    assert.throws(() => inspectCharacter(encode(imageDocument(image.subarray(0, -1))), 'gltf'), /PNG/);
    const malformedEnd = Buffer.from(image);
    malformedEnd.writeUInt32BE(1, malformedEnd.length - 12);
    assert.throws(() => inspectCharacter(encode(imageDocument(malformedEnd)), 'gltf'), /PNG/);
  }
  assert.deepEqual([...observed].sort(), [0, 1, 2, 3]);
});

test('animation-only files validate timing, shape and target references', () => {
  const values = new Float32Array([0, 1, 0, 0, 0, 1, 0, 0]);
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: values.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(values.buffer).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR' }, { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' }],
    nodes: [{ name: 'Hips' }], scenes: [{ nodes: [0] }],
    animations: [{ samplers: [{ input: 0, output: 1 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }],
  };
  assert.equal(inspectCharacter(encode(json), 'gltf').kind, 'animation');
  json.animations[0].channels[0].target.node = 1;
  assert.throws(() => inspectCharacter(encode(json), 'gltf'), /animation node/);
  json.animations[0].channels[0].target.node = 0;
  values[1] = 0;
  json.buffers[0].uri = `data:application/octet-stream;base64,${Buffer.from(values.buffer).toString('base64')}`;
  assert.throws(() => inspectCharacter(encode(json), 'gltf'), /strictly increase/);
});

test('clip compatibility requires unique named targets and matching morph dimensions', () => {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'Hips';
  root.add(hips);
  const clip = new THREE.AnimationClip('Move', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 1, 0, 0])]);
  assert.doesNotThrow(() => validateClipCompatibility(root, [clip]));
  assert.throws(() => validateClipCompatibility(new THREE.Group(), [clip]), /do not match/);
  const duplicate = new THREE.Bone();
  duplicate.name = 'Hips';
  root.add(duplicate);
  assert.throws(() => validateClipCompatibility(root, [clip]), /ambiguous/);
  root.remove(duplicate);
  const face = new THREE.Mesh();
  face.name = 'Face';
  face.morphTargetInfluences = [0, 0];
  root.add(face);
  const matching = new THREE.AnimationClip('Face', 1, [new THREE.NumberKeyframeTrack('Face.morphTargetInfluences', [0, 1], [0, 0, 1, 0])]);
  assert.doesNotThrow(() => validateClipCompatibility(root, [matching]));
  const mismatched = new THREE.AnimationClip('Face', 1, [new THREE.NumberKeyframeTrack('Face.morphTargetInfluences', [0, 1], [0, 1])]);
  assert.throws(() => validateClipCompatibility(root, [mismatched]), /dimensions/);
  face.geometry.dispose();
  (face.material as THREE.Material).dispose();
});

test('studio material extensions round-trip through bounded preflight validation', () => {
  const material = {
    extensions: {
      KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.12 },
      KHR_materials_iridescence: { iridescenceFactor: 1, iridescenceIor: 1.32, iridescenceThicknessMinimum: 120, iridescenceThicknessMaximum: 440 },
      KHR_materials_emissive_strength: { emissiveStrength: 0.45 },
    },
  };
  const json = { ...triangle(), materials: [material], extensionsUsed: Object.keys(material.extensions) };
  assert.equal(inspectCharacter(encode(json), 'gltf').kind, 'model');
  for (const extensions of [
    { KHR_materials_clearcoat: { clearcoatFactor: 1.01 } },
    { KHR_materials_clearcoat: { clearcoatNormalTexture: { index: 0 } } },
    { KHR_materials_iridescence: { iridescenceIor: '1.32' } },
    { KHR_materials_iridescence: { iridescenceThicknessMinimum: 500, iridescenceThicknessMaximum: 400 } },
    { KHR_materials_iridescence: { iridescenceTexture: { index: -1 } } },
    { KHR_materials_emissive_strength: { emissiveStrength: 101 } },
  ]) assert.throws(() => inspectCharacter(encode({ ...json, materials: [{ extensions }] }), 'gltf'));
});

test('line segments used by the educational scene are accepted without skins or morphs', () => {
  const json = triangle();
  const lines = { ...json, accessors: [{ ...json.accessors[0], count: 2 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }] };
  assert.equal(inspectCharacter(encode(lines), 'gltf').kind, 'model');
  assert.throws(() => inspectCharacter(encode({ ...lines, accessors: json.accessors }), 'gltf'), /primitive mode/);
  assert.throws(() => inspectCharacter(encode({ ...lines, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1, targets: [{ POSITION: 0 }] }] }] }), 'gltf'), /morphs and skins/);
});
