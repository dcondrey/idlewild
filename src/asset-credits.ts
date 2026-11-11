import type { Object3D } from 'three';

const copyrights = new WeakMap<Object3D, string>();
export const MAX_COPYRIGHT_LENGTH = 4096;

export function assetCopyright(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > MAX_COPYRIGHT_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('Asset copyright must be plain text of at most 4096 characters.');
  return value.trim() || undefined;
}

export function setAssetCopyright(root: Object3D, value: unknown): void {
  const copyright = assetCopyright(value);
  if (copyright) copyrights.set(root, copyright);
  else copyrights.delete(root);
}

export function getAssetCopyright(root: Object3D): string | undefined {
  const notices = new Set<string>();
  root.traverse(node => {
    const notice = copyrights.get(node);
    if (notice) notices.add(notice);
  });
  return assetCopyright([...notices].join('\n\n'));
}
