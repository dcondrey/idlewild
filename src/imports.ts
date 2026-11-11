import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeObject } from './scenes/resources.ts';
import { assetCopyright, setAssetCopyright } from './asset-credits.ts';

export const IMPORT_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, nodes: 256, vertices: 500000, indices: 1000000, accessorBytes: 64 * 1024 * 1024, texturePixels: 16 * 1024 * 1024, textureDimension: 4096, clips: 64 });
const SUPPORTED_EXTENSIONS = new Set(['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_clearcoat', 'KHR_materials_iridescence', 'KHR_materials_emissive_strength']);
type ObjectValue = Record<string, unknown>;
type Accessor = { count: number; width: number; component: number; normalized: boolean; read(index: number, component?: number): number };
export type CharacterInspection = { data: ArrayBuffer | string; summary: string; kind: 'model' | 'animation'; copyright?: string };

function fail(message: string): never { throw new Error(`Character import: ${message}`); }
function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid ${label}.`);
  return value as ObjectValue;
}
function list(value: unknown, maximum: number, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} exceeds the supported limit of ${maximum}.`);
  return value;
}
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`invalid ${label}.`);
  return value;
}
function finite(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`invalid ${label}.`);
  return value;
}
function vector(value: unknown, length: number, label: string, minimum = -1e6, maximum = 1e6): number[] {
  if (!Array.isArray(value) || value.length !== length) fail(`invalid ${label}.`);
  return value.map(number => finite(number, minimum, maximum, label));
}
function reference(value: unknown, length: number, label: string): number { return integer(value, 0, length - 1, `${label} reference`); }

function decodeURI(value: unknown, image: boolean): Uint8Array {
  if (typeof value !== 'string') fail('a resource URI is missing.');
  const comma = value.indexOf(',');
  const header = value.slice(0, comma);
  const allowed = image ? ['data:image/png;base64', 'data:image/jpeg;base64'] : ['data:application/octet-stream;base64', 'data:application/gltf-buffer;base64'];
  if (!allowed.includes(header)) fail('external resources are blocked; export a GLB or embed PNG/JPEG textures and buffers as base64.');
  const encoded = value.slice(comma + 1);
  if (!encoded.length || encoded.length > Math.ceil(IMPORT_LIMITS.bytes / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('invalid embedded base64 resource.');
  let decoded: string;
  try { decoded = atob(encoded); } catch { fail('invalid embedded base64 resource.'); }
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function dimensions(bytes: Uint8Array, alignedBufferView = false): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 33 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    let offset = 8;
    let size: [number, number] | null = null;
    let chunks = 0;
    while (offset + 12 <= bytes.length && ++chunks <= 4096) {
      const length = view.getUint32(offset);
      const type = view.getUint32(offset + 4);
      if (length > bytes.length - offset - 12) fail('truncated PNG texture.');
      if (type === 0x49484452) {
        if (offset !== 8 || size || length !== 13) fail('invalid PNG header.');
        size = [view.getUint32(offset + 8), view.getUint32(offset + 12)];
      }
      if (type === 0x49454e44) {
        const end = offset + 12;
        const padding = bytes.length - end;
        const validPadding = padding === 0 || (alignedBufferView && padding <= 3 && bytes.length % 4 === 0 && bytes.subarray(end).every(byte => byte === 0));
        if (!size || length !== 0 || !validPadding) fail('invalid PNG end marker.');
        return size;
      }
      offset += 12 + length;
    }
    fail('invalid PNG texture.');
  }
  if (bytes.length >= 4 && view.getUint16(0) === 0xffd8) {
    let offset = 2;
    let size: [number, number] | null = null;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) fail('invalid JPEG marker.');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) break;
      if (offset + 2 > bytes.length) fail('truncated JPEG texture.');
      const length = view.getUint16(offset);
      if (length < 2 || length > bytes.length - offset) fail('truncated JPEG texture.');
      if (marker === 0xc0 || marker === 0xc2) {
        if (size || length < 8) fail('invalid JPEG dimensions.');
        size = [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      }
      if (marker === 0xda) {
        if (!size) fail('unsupported JPEG encoding; use baseline or progressive JPEG.');
        return size;
      }
      offset += length;
    }
  }
  fail('textures must be valid PNG or baseline/progressive JPEG.');
}

function inspectJSON(value: unknown): void {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++count > 150000 || entry.depth > 32) fail('JSON structure is too complex.');
    if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) fail('non-finite JSON number.');
    if (!entry.value || typeof entry.value !== 'object') continue;
    for (const key in entry.value) {
      const child = (entry.value as ObjectValue)[key];
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail('unsafe JSON property.');
      if (key === 'extensions') {
        for (const extension of Object.keys(object(child, 'extensions'))) {
          if (!SUPPORTED_EXTENSIONS.has(extension)) fail(`unsupported ${extension}; re-export uncompressed core glTF 2.0.`);
        }
      }
      if (key === 'name' && (typeof child !== 'string' || child.length > 128)) fail('names must be at most 128 characters.');
      if (pending.length + count >= 150000) fail('JSON structure is too complex.');
      pending.push({ value: child, depth: entry.depth + 1 });
    }
  }
}

export function inspectCharacter(data: ArrayBuffer, extension: 'glb' | 'gltf'): CharacterInspection {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 2 || data.byteLength > IMPORT_LIMITS.bytes) fail('file must be between 2 bytes and 32 MiB.');
  let jsonBytes = new Uint8Array(data);
  let binary: Uint8Array | null = null;
  if (extension === 'glb') {
    if (data.byteLength < 20) fail('truncated GLB header.');
    const view = new DataView(data);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength) fail('invalid GLB 2.0 header or length.');
    let offset = 12;
    let chunks = 0;
    while (offset < data.byteLength) {
      if (offset + 8 > data.byteLength || chunks > 1) fail('unsupported GLB chunk layout.');
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      if (length % 4 || length > data.byteLength - offset - 8) fail('invalid GLB chunk length.');
      const bytes = new Uint8Array(data, offset + 8, length);
      if (chunks === 0 && type === 0x4e4f534a) jsonBytes = bytes;
      else if (chunks === 1 && type === 0x004e4942) binary = bytes;
      else fail('GLB requires JSON followed by at most one binary chunk.');
      offset += 8 + length;
      chunks++;
    }
  } else if (extension !== 'gltf') fail('choose a .glb or self-contained .gltf file.');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)); } catch { fail('invalid UTF-8 glTF JSON.'); }
  inspectJSON(parsed);
  const json = object(parsed, 'glTF document');
  const asset = object(json.asset, 'asset');
  const copyright = assetCopyright(asset.copyright);
  if (asset.version !== '2.0' || (asset.minVersion !== undefined && asset.minVersion !== '2.0')) fail('only glTF 2.0 is supported.');
  for (const key of ['extensionsRequired', 'extensionsUsed']) {
    for (const name of list(json[key], 16, key)) if (typeof name !== 'string' || !SUPPORTED_EXTENSIONS.has(name)) fail('unsupported extension; re-export uncompressed core glTF 2.0.');
  }
  if (json.cameras !== undefined && list(json.cameras, 0, 'cameras').length) fail('remove imported cameras.');
  const bufferDefs = list(json.buffers, 16, 'buffers').map(value => object(value, 'buffer'));
  let bufferBytes = 0;
  const buffers = bufferDefs.map((buffer, index) => {
    const length = integer(buffer.byteLength, 1, IMPORT_LIMITS.bytes, 'buffer length');
    bufferBytes += length;
    if (bufferBytes > IMPORT_LIMITS.bytes) fail('decoded buffers exceed 32 MiB.');
    if (buffer.uri === undefined) {
      if (index !== 0 || !binary || length > binary.length || binary.length - length > 3) fail('missing or inconsistent GLB binary buffer.');
      return binary.subarray(0, length);
    }
    const bytes = decodeURI(buffer.uri, false);
    if (bytes.length !== length) fail('embedded buffer length differs from its declaration.');
    return bytes;
  });
  const views = list(json.bufferViews, 4096, 'buffer views').map(value => {
    const definition = object(value, 'buffer view');
    const buffer = buffers[reference(definition.buffer, buffers.length, 'buffer')];
    const offset = integer(definition.byteOffset ?? 0, 0, buffer.length, 'buffer view offset');
    const length = integer(definition.byteLength, 1, buffer.length - offset, 'buffer view length');
    const stride = definition.byteStride === undefined ? 0 : integer(definition.byteStride, 4, 252, 'buffer stride');
    if (stride % 4) fail('buffer stride must be a multiple of four.');
    return { bytes: buffer.subarray(offset, offset + length), stride };
  });
  let accessorBytes = 0;
  const accessors: Accessor[] = list(json.accessors, 4096, 'accessors').map(value => {
    const definition = object(value, 'accessor');
    if (definition.sparse !== undefined) fail('sparse accessors are unsupported; export dense geometry and animation.');
    const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
    const width = typeof definition.type === 'string' ? widths[definition.type] : undefined;
    if (!width) fail('unsupported accessor shape.');
    const component = integer(definition.componentType, 5120, 5126, 'component type');
    const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const size = sizes[component];
    if (!size || (width === 16 && component !== 5126)) fail('unsupported accessor component type.');
    const count = integer(definition.count, 1, IMPORT_LIMITS.indices, 'accessor count');
    accessorBytes += count * width * size;
    if (accessorBytes > IMPORT_LIMITS.accessorBytes) fail('accessor allocation exceeds 64 MiB.');
    const view = views[reference(definition.bufferView, views.length, 'accessor buffer view')];
    const offset = integer(definition.byteOffset ?? 0, 0, view.bytes.length, 'accessor offset');
    const stride = view.stride || width * size;
    if (offset % size || stride < width * size || stride % size || (view.stride && offset % stride + width * size > stride) || offset + (count - 1) * stride + width * size > view.bytes.length) fail('accessor extends beyond its buffer view.');
    if (view.stride && Math.floor(offset / stride) * stride + count * stride > view.bytes.length) fail('interleaved accessor extends beyond its buffer view.');
    if (definition.normalized !== undefined && typeof definition.normalized !== 'boolean') fail('invalid normalized accessor flag.');
    if (definition.min !== undefined) vector(definition.min, width, 'accessor minimum');
    if (definition.max !== undefined) vector(definition.max, width, 'accessor maximum');
    const dataView = new DataView(view.bytes.buffer, view.bytes.byteOffset, view.bytes.byteLength);
    const read = (index: number, part = 0) => {
      const at = offset + index * stride + part * size;
      switch (component) {
        case 5120: return dataView.getInt8(at);
        case 5121: return dataView.getUint8(at);
        case 5122: return dataView.getInt16(at, true);
        case 5123: return dataView.getUint16(at, true);
        case 5125: return dataView.getUint32(at, true);
        default: return dataView.getFloat32(at, true);
      }
    };
    if (component === 5126) for (let index = 0; index < count; index++) for (let part = 0; part < width; part++) finite(read(index, part), -1e6, 1e6, 'accessor float');
    return { count, width, component, normalized: definition.normalized === true, read };
  });
  let texturePixels = 0;
  const images = list(json.images, 32, 'images').map(value => {
    const image = object(value, 'image');
    if (image.uri !== undefined && image.bufferView !== undefined) fail('texture has conflicting sources.');
    if (image.mimeType !== undefined && image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg') fail('only PNG/JPEG textures are supported.');
    const bytes = image.uri === undefined ? views[reference(image.bufferView, views.length, 'image buffer view')].bytes : decodeURI(image.uri, true);
    if (bytes.length > 8 * 1024 * 1024) fail('each encoded texture must be at most 8 MiB.');
    const [width, height] = dimensions(bytes, image.uri === undefined);
    integer(width, 1, IMPORT_LIMITS.textureDimension, 'texture width');
    integer(height, 1, IMPORT_LIMITS.textureDimension, 'texture height');
    texturePixels += width * height;
    if (texturePixels > IMPORT_LIMITS.texturePixels) fail('decoded textures exceed 64 MiB.');
    return { pixels: width * height };
  });
  const samplers = list(json.samplers, 32, 'texture samplers').map(value => object(value, 'texture sampler'));
  for (const sampler of samplers) {
    for (const key of ['wrapS', 'wrapT']) if (sampler[key] !== undefined && ![33071, 33648, 10497].includes(sampler[key] as number)) fail('unsupported texture wrapping.');
    if (sampler.magFilter !== undefined && ![9728, 9729].includes(sampler.magFilter as number)) fail('unsupported texture magnification filter.');
    if (sampler.minFilter !== undefined && ![9728, 9729, 9984, 9985, 9986, 9987].includes(sampler.minFilter as number)) fail('unsupported texture minification filter.');
  }
  const textures = list(json.textures, 32, 'textures').map(value => {
    const texture = object(value, 'texture');
    reference(texture.source, images.length, 'texture image');
    if (texture.sampler !== undefined) reference(texture.sampler, samplers.length, 'texture sampler');
    return texture;
  });
  let textureUsePixels = 0;
  function textureInfo(value: unknown) {
    if (value === undefined) return;
    const info = object(value, 'material texture');
    const texture = textures[reference(info.index, textures.length, 'material texture')];
    textureUsePixels += images[texture.source as number].pixels;
    if (textureUsePixels > IMPORT_LIMITS.texturePixels) fail('material texture allocations exceed 64 MiB.');
    integer(info.texCoord ?? 0, 0, 1, 'texture coordinate set');
    if (info.scale !== undefined) finite(info.scale, -16, 16, 'normal scale');
    if (info.strength !== undefined) finite(info.strength, 0, 1, 'occlusion strength');
    const transform = info.extensions && object(info.extensions, 'texture extensions').KHR_texture_transform;
    if (transform) {
      const map = object(transform, 'texture transform');
      if (map.offset !== undefined) vector(map.offset, 2, 'texture offset');
      if (map.scale !== undefined) vector(map.scale, 2, 'texture scale');
      if (map.rotation !== undefined) finite(map.rotation, -1e6, 1e6, 'texture rotation');
      if (map.texCoord !== undefined) integer(map.texCoord, 0, 1, 'texture coordinate set');
    }
  }
  const materials = list(json.materials, 128, 'materials').map(value => {
    const material = object(value, 'material');
    if (material.pbrMetallicRoughness !== undefined) {
      const pbr = object(material.pbrMetallicRoughness, 'PBR material');
      if (pbr.baseColorFactor !== undefined) vector(pbr.baseColorFactor, 4, 'base color', 0, 1);
      for (const key of ['metallicFactor', 'roughnessFactor']) if (pbr[key] !== undefined) finite(pbr[key], 0, 1, key);
      textureInfo(pbr.baseColorTexture);
      textureInfo(pbr.metallicRoughnessTexture);
    }
    for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) textureInfo(material[key]);
    if (material.emissiveFactor !== undefined) vector(material.emissiveFactor, 3, 'emissive color', 0, 1);
    if (material.alphaMode !== undefined && !['OPAQUE', 'MASK', 'BLEND'].includes(material.alphaMode as string)) fail('invalid alpha mode.');
    if (material.alphaCutoff !== undefined) finite(material.alphaCutoff, 0, 1, 'alpha cutoff');
    if (material.doubleSided !== undefined && typeof material.doubleSided !== 'boolean') fail('invalid double-sided flag.');
    if (material.extensions !== undefined) {
      const extensions = object(material.extensions, 'material extensions');
      for (const [name, value] of Object.entries(extensions)) {
        const extension = object(value, 'material extension');
        if (name === 'KHR_materials_unlit') continue;
        const fields: Record<string, [number, number]> = name === 'KHR_materials_clearcoat'
          ? { clearcoatFactor: [0, 1], clearcoatRoughnessFactor: [0, 1] }
          : name === 'KHR_materials_iridescence'
            ? { iridescenceFactor: [0, 1], iridescenceIor: [1, 3], iridescenceThicknessMinimum: [0, 10000], iridescenceThicknessMaximum: [0, 10000] }
            : name === 'KHR_materials_emissive_strength' ? { emissiveStrength: [0, 100] } : {};
        if (!Object.keys(fields).length) fail('extension is not supported on a material.');
        for (const [field, [minimum, maximum]] of Object.entries(fields)) if (extension[field] !== undefined) finite(extension[field], minimum, maximum, field);
        if (name === 'KHR_materials_iridescence' && ((extension.iridescenceThicknessMinimum ?? 100) as number) > ((extension.iridescenceThicknessMaximum ?? 400) as number)) fail('iridescence thickness bounds are reversed.');
        const textureFields = name === 'KHR_materials_clearcoat' ? ['clearcoatTexture', 'clearcoatRoughnessTexture', 'clearcoatNormalTexture'] : name === 'KHR_materials_iridescence' ? ['iridescenceTexture', 'iridescenceThicknessTexture'] : [];
        for (const field of textureFields) textureInfo(extension[field]);
      }
    }
    return material;
  });
  let vertices = 0;
  let indices = 0;
  let morphVertices = 0;
  const meshes = list(json.meshes, 128, 'meshes').map(value => {
    const mesh = object(value, 'mesh');
    const primitives = list(mesh.primitives, 32, 'mesh primitives');
    if (!primitives.length) fail('mesh contains no primitives.');
    let meshVertices = 0;
    let meshIndices = 0;
    let morphs: number | null = null;
    const jointAccessors: Accessor[] = [];
    for (const value of primitives) {
      const primitive = object(value, 'primitive');
      const mode = primitive.mode ?? 4;
      if (mode !== 0 && mode !== 1 && mode !== 4) fail('only triangles, line segments, and points are supported.');
      const groupSize = mode === 4 ? 3 : mode === 1 ? 2 : 1;
      const attributes = object(primitive.attributes, 'mesh attributes');
      const position = accessors[reference(attributes.POSITION, accessors.length, 'position accessor')];
      if (position.width !== 3 || position.component !== 5126 || position.normalized) fail('positions must be float VEC3.');
      meshVertices += position.count;
      for (const [semantic, index] of Object.entries(attributes)) {
        const attribute = accessors[reference(index, accessors.length, 'attribute')];
        const widths: Record<string, number[]> = { POSITION: [3], NORMAL: [3], TANGENT: [4], TEXCOORD_0: [2], TEXCOORD_1: [2], COLOR_0: [3, 4], JOINTS_0: [4], WEIGHTS_0: [4] };
        if (!widths[semantic]?.includes(attribute.width) || attribute.count !== position.count) fail('unsupported or mismatched vertex attribute.');
        if (['NORMAL', 'TANGENT'].includes(semantic) && (attribute.component !== 5126 || attribute.normalized)) fail('normal and tangent attributes must be floats.');
        if (['TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0', 'WEIGHTS_0'].includes(semantic) && !(attribute.component === 5126 && !attribute.normalized) && !([5121, 5123].includes(attribute.component) && attribute.normalized)) fail('texture, color, and weight attributes must use floats or normalized unsigned integers.');
        if (semantic === 'WEIGHTS_0' && attribute.component === 5126) for (let i = 0; i < attribute.count; i++) for (let part = 0; part < 4; part++) finite(attribute.read(i, part), 0, 1, 'skin weight');
        if (semantic === 'JOINTS_0') {
          if (![5121, 5123].includes(attribute.component) || attribute.normalized) fail('joint indices must be unsigned bytes or shorts.');
          jointAccessors.push(attribute);
        }
      }
      if ((attributes.JOINTS_0 === undefined) !== (attributes.WEIGHTS_0 === undefined)) fail('skin joints and weights must be supplied together.');
      if (primitive.indices !== undefined) {
        const index = accessors[reference(primitive.indices, accessors.length, 'index accessor')];
        if (index.width !== 1 || ![5121, 5123, 5125].includes(index.component) || index.normalized || index.count % groupSize) fail('invalid primitive indices.');
        meshIndices += index.count;
        for (let i = 0; i < index.count; i++) if (index.read(i) >= position.count) fail('triangle index is outside its vertex array.');
      } else if (position.count % groupSize) fail('non-indexed geometry does not match its primitive mode.');
      if (primitive.material !== undefined) reference(primitive.material, materials.length, 'material');
      const targets = list(primitive.targets, 32, 'morph targets');
      if (mode !== 4 && (targets.length || attributes.JOINTS_0 !== undefined)) fail('morphs and skins require triangle geometry.');
      if (morphs !== null && targets.length !== morphs) fail('all mesh primitives must have matching morph counts.');
      morphs = targets.length;
      morphVertices += targets.length * position.count;
      if (morphVertices > 1000000) fail('morph allocations exceed one million vertices.');
      for (const target of targets) for (const [semantic, index] of Object.entries(object(target, 'morph target'))) {
        const attribute = accessors[reference(index, accessors.length, 'morph accessor')];
        if (!['POSITION', 'NORMAL', 'TANGENT'].includes(semantic) || attribute.width !== 3 || attribute.component !== 5126 || attribute.count !== position.count) fail('invalid morph target attribute.');
      }
    }
    if (mesh.weights !== undefined) vector(mesh.weights, morphs ?? 0, 'mesh morph weights', -4, 4);
    vertices += meshVertices;
    indices += meshIndices;
    if (vertices > IMPORT_LIMITS.vertices || indices > IMPORT_LIMITS.indices) fail('geometry exceeds 500,000 vertices or 1,000,000 indices.');
    return { vertices: meshVertices, indices: meshIndices, morphs: morphs ?? 0, jointAccessors, primitives: primitives.length };
  });
  const nodes = list(json.nodes, IMPORT_LIMITS.nodes, 'nodes').map(value => object(value, 'node'));
  const skins = list(json.skins, 32, 'skins').map(value => {
    const skin = object(value, 'skin');
    const joints = list(skin.joints, 128, 'skin joints');
    if (!joints.length || new Set(joints).size !== joints.length) fail('skin joints must be nonempty and unique.');
    for (const joint of joints) reference(joint, nodes.length, 'joint node');
    if (skin.skeleton !== undefined) reference(skin.skeleton, nodes.length, 'skeleton');
    if (skin.inverseBindMatrices !== undefined) {
      const matrices = accessors[reference(skin.inverseBindMatrices, accessors.length, 'inverse bind matrices')];
      if (matrices.width !== 16 || matrices.component !== 5126 || matrices.count !== joints.length) fail('inverse bind matrices do not match the skin.');
    }
    return joints.length;
  });
  const parents = new Set<number>();
  let instanceVertices = 0;
  let instanceIndices = 0;
  for (const node of nodes) {
    if (node.camera !== undefined) fail('imported cameras are unsupported.');
    if (node.matrix !== undefined) {
      if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) fail('node mixes matrix and component transforms.');
      vector(node.matrix, 16, 'node matrix');
    }
    if (node.translation !== undefined) vector(node.translation, 3, 'node translation');
    if (node.scale !== undefined) vector(node.scale, 3, 'node scale', -10000, 10000);
    if (node.rotation !== undefined) {
      const rotation = vector(node.rotation, 4, 'node quaternion', -1, 1);
      if (Math.abs(rotation.reduce((sum, value) => sum + value * value, 0) - 1) > 0.01) fail('node quaternion is not normalized.');
    }
    for (const child of list(node.children, IMPORT_LIMITS.nodes, 'node children')) {
      const index = reference(child, nodes.length, 'child node');
      if (parents.has(index)) fail('nodes must form a tree with one parent each.');
      parents.add(index);
    }
    if (node.mesh !== undefined) {
      const mesh = meshes[reference(node.mesh, meshes.length, 'node mesh')];
      instanceVertices += mesh.vertices;
      instanceIndices += mesh.indices;
      if (node.weights !== undefined) vector(node.weights, mesh.morphs, 'node morph weights', -4, 4);
      if (node.skin !== undefined) {
        const joints = skins[reference(node.skin, skins.length, 'node skin')];
        if (mesh.jointAccessors.length !== mesh.primitives) fail('all skinned primitives require joint attributes.');
        for (const accessor of mesh.jointAccessors) for (let i = 0; i < accessor.count; i++) for (let part = 0; part < 4; part++) if (accessor.read(i, part) >= joints) fail('vertex refers to a joint outside its skin.');
      } else if (mesh.jointAccessors.length) fail('joint attributes require a skin.');
    } else if (node.skin !== undefined || node.weights !== undefined) fail('skin and morph weights require a mesh.');
  }
  if (instanceVertices > IMPORT_LIMITS.vertices || instanceIndices > IMPORT_LIMITS.indices) fail('instanced geometry exceeds the scene budget.');
  const scenes = list(json.scenes, 1, 'scenes');
  if (scenes.length !== 1 || (json.scene !== undefined && json.scene !== 0)) fail('export exactly one scene.');
  const roots = list(object(scenes[0], 'scene').nodes, IMPORT_LIMITS.nodes, 'scene roots');
  const visited = new Set<number>();
  function visit(index: number, depth: number) {
    if (visited.has(index) || depth > 64) fail('node graph contains a cycle, duplicate root, or excessive depth.');
    visited.add(index);
    for (const child of list(nodes[index].children, IMPORT_LIMITS.nodes, 'node children')) visit(child as number, depth + 1);
  }
  for (const root of roots) {
    const index = reference(root, nodes.length, 'scene root');
    if (parents.has(index)) fail('scene root also has a parent.');
    visit(index, 0);
  }
  if (visited.size !== nodes.length) fail('all nodes must belong to the exported scene.');
  let channels = 0;
  const animations = list(json.animations, IMPORT_LIMITS.clips, 'animation clips');
  for (const value of animations) {
    const animation = object(value, 'animation');
    if (animation.parameters !== undefined) fail('legacy animation parameters are unsupported.');
    const samplers = list(animation.samplers, 256, 'animation samplers').map(value => object(value, 'animation sampler'));
    const targets = new Set<string>();
    const animationChannels = list(animation.channels, 256, 'animation channels');
    if (!animationChannels.length) fail('animation clips must contain channels.');
    for (const value of animationChannels) {
      if (++channels > 4096) fail('animation channels exceed 4096.');
      const channel = object(value, 'animation channel');
      const sampler = samplers[reference(channel.sampler, samplers.length, 'animation sampler')];
      const target = object(channel.target, 'animation target');
      const nodeIndex = reference(target.node, nodes.length, 'animation node');
      const node = nodes[nodeIndex];
      if (!['translation', 'rotation', 'scale', 'weights'].includes(target.path as string)) fail('unsupported animation property.');
      const binding = `${nodeIndex}:${target.path}`;
      if (targets.has(binding)) fail('duplicate animation channel target.');
      targets.add(binding);
      const input = accessors[reference(sampler.input, accessors.length, 'animation input')];
      const output = accessors[reference(sampler.output, accessors.length, 'animation output')];
      const interpolation = sampler.interpolation ?? 'LINEAR';
      if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(interpolation as string)) fail('unsupported animation interpolation.');
      if (input.width !== 1 || input.component !== 5126 || input.normalized || input.count > 12000 || output.component !== 5126 || output.normalized) fail('invalid animation accessor format or more than 12,000 keys.');
      let previous = -1;
      for (let i = 0; i < input.count; i++) {
        const time = finite(input.read(i), 0, 600, 'animation time');
        if (time <= previous) fail('animation times must strictly increase.');
        previous = time;
      }
      let width = target.path === 'rotation' ? 4 : 3;
      if (target.path === 'weights') {
        width = node.mesh === undefined ? 0 : meshes[node.mesh as number].morphs;
        if (!width || output.width !== 1) fail('morph animation requires matching mesh targets.');
      } else if (output.width !== width) fail('animation output shape does not match its target.');
      const factor = interpolation === 'CUBICSPLINE' ? 3 : 1;
      if (output.count * output.width !== input.count * width * factor) fail('animation key count does not match its target.');
    }
  }
  const kind = meshes.length ? 'model' : 'animation';
  if (!nodes.length || (kind === 'animation' && !animations.length)) fail('file contains neither a model nor an animation.');
  const summary = kind === 'animation' ? `${animations.length} animation clip(s); matching named rig required.` : `${instanceVertices.toLocaleString('en-US')} vertices · ${skins.length ? `${skins.length} skin(s)` : 'static model; creative root motion'} · ${animations.length} clip(s).`;
  return { data: extension === 'glb' ? data : JSON.stringify(json), kind, summary, copyright };
}

export function validateClipCompatibility(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): void {
  if (!clips.length || clips.length > IMPORT_LIMITS.clips) fail('choose between one and 64 animation clips.');
  const names = new Map<string, THREE.Object3D[]>();
  root.traverse(node => { if (node.name) names.set(node.name, [...(names.get(node.name) ?? []), node]); });
  for (const clip of clips) {
    if (!Number.isFinite(clip.duration) || clip.duration < 0 || clip.duration > 600 || !clip.tracks.length || clip.tracks.length > 4096) fail('invalid animation duration or tracks.');
    const bindings = new Set<string>();
    for (const track of clip.tracks) {
      if (bindings.has(track.name)) fail('duplicate clip track binding.');
      bindings.add(track.name);
      if (!track.times.length || track.times.length > 12000 || track.values.length > 12000 * 32 * 3) fail('clip track allocation exceeds the supported limit.');
      let previous = -1;
      for (const time of track.times) {
        if (!Number.isFinite(time) || time < 0 || time > clip.duration || time <= previous) fail('clip key times must increase within its duration.');
        previous = time;
      }
      for (const value of track.values) finite(value, -1e6, 1e6, 'clip value');
      const binding = THREE.PropertyBinding.parseTrackName(track.name);
      if (binding.objectName || binding.propertyIndex !== undefined || !['position', 'quaternion', 'scale', 'morphTargetInfluences'].includes(binding.propertyName)) fail('clip has an unsupported track binding.');
      const targets = names.get(binding.nodeName);
      if (targets && targets.length !== 1) fail('clip target names are ambiguous; export unique node names.');
      const node = targets?.[0] ?? root.getObjectByProperty('uuid', binding.nodeName);
      if (!node) fail('clip target names do not match this character.');
      const width = binding.propertyName === 'quaternion' ? 4 : binding.propertyName === 'morphTargetInfluences' ? (node as THREE.Mesh).morphTargetInfluences?.length ?? 0 : 3;
      const factory = (track as THREE.KeyframeTrack & { createInterpolant?: { isInterpolantFactoryMethodGLTFCubicSpline?: boolean } }).createInterpolant;
      const factor = factory?.isInterpolantFactoryMethodGLTFCubicSpline ? 3 : 1;
      if (!width || track.getValueSize() !== width * factor) fail('clip morph or transform dimensions do not match this character.');
    }
  }
}

export const disposeImported = disposeObject;

export async function importCharacter(file: File): Promise<{ root: THREE.Group; clips: THREE.AnimationClip[]; summary: string; kind: 'model' | 'animation' }> {
  if (file.size > IMPORT_LIMITS.bytes || file.size < 2) fail('file must be between 2 bytes and 32 MiB.');
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'glb' && extension !== 'gltf') fail('choose a .glb or self-contained .gltf file.');
  const inspection = inspectCharacter(await file.arrayBuffer(), extension);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (!url.startsWith('data:') && !url.startsWith('blob:')) fail('external resource request blocked.');
    return url;
  });
  const loader = new GLTFLoader(manager);
  const meshes: THREE.Object3D[] = [];
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];
  const pending: Promise<unknown>[] = [];
  loader.register(parser => ({
    name: 'IdlewildImportOwnership',
    loadMesh(index) {
      const promise = parser.loadMesh(index).then(mesh => { meshes.push(mesh); return mesh; });
      pending.push(promise);
      return promise;
    },
    loadMaterial(index) {
      const promise = parser.loadMaterial(index).then(material => { materials.push(material); return material; });
      pending.push(promise);
      return promise;
    },
    loadTexture(index) {
      const promise = parser.loadTexture(index).then(texture => {
        if (!texture) fail('a texture could not be decoded; re-export it as PNG/JPEG.');
        textures.push(texture);
        return texture;
      });
      pending.push(promise);
      return promise;
    },
  }));
  let root: THREE.Group | null = null;
  try {
    const gltf = await loader.parseAsync(inspection.data, '');
    root = gltf.scene;
    root.traverse(node => { node.userData = {}; });
    setAssetCopyright(root, inspection.copyright);
    root.updateWorldMatrix(true, true);
    root.traverse(node => {
      for (const value of node.matrixWorld.elements) finite(value, -1e12, 1e12, 'combined node transform');
    });
    if (gltf.animations.length) validateClipCompatibility(root, gltf.animations);
    const decodedImages = new Set<unknown>();
    let pixels = 0;
    for (const texture of textures) {
      if (!texture.image) fail('a texture could not be decoded; re-export it as PNG/JPEG.');
      if (decodedImages.has(texture.image)) continue;
      decodedImages.add(texture.image);
      const image = object(texture.image, 'decoded texture');
      pixels += integer(image.width, 1, IMPORT_LIMITS.textureDimension, 'decoded texture width') * integer(image.height, 1, IMPORT_LIMITS.textureDimension, 'decoded texture height');
      if (pixels > IMPORT_LIMITS.texturePixels) fail('decoded textures exceed 64 MiB.');
    }
    return { root, clips: gltf.animations, summary: inspection.summary, kind: inspection.kind };
  } catch {
    let settled = 0;
    while (settled < pending.length) {
      const batch = pending.slice(settled);
      settled = pending.length;
      await Promise.allSettled(batch);
    }
    const owned = new THREE.Group();
    if (root) owned.add(root);
    else for (const mesh of meshes) owned.add(mesh);
    disposeObject(owned);
    for (const material of materials) material.dispose();
    for (const texture of textures) {
      texture.dispose();
      if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap && texture.source.data.width > 0) texture.source.data.close();
    }
    fail('could not load this character; verify its textures, named rig, and animation compatibility.');
  }
}
