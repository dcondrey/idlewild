import * as THREE from 'three';

const disposedRoots = new WeakSet<THREE.Object3D>();

export function disposeObject(root: THREE.Object3D): void {
  if (disposedRoots.has(root)) return;
  disposedRoots.add(root);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const images = new Set<ImageBitmap>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    if (material instanceof THREE.ShaderMaterial) {
      for (const uniform of Object.values(material.uniforms)) if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
    }
    material.dispose();
  }
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) images.add(texture.source.data);
    texture.dispose();
  }
  for (const image of images) image.close();
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.removeFromParent();
}

export function fitModel(root: THREE.Object3D, height = 2.7, maxWidth = 5.4): void {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.y <= 0 || Math.max(size.x, size.y, size.z) > 1e8) throw new Error('Model has invalid bounds');
  const scale = Math.min(height / size.y, maxWidth / Math.max(size.x, size.z, 0.001));
  const center = bounds.getCenter(new THREE.Vector3());
  root.scale.multiplyScalar(scale);
  root.position.multiplyScalar(scale).sub(new THREE.Vector3(center.x, bounds.min.y, center.z).multiplyScalar(scale));
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}
