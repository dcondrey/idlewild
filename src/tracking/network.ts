export function localTrackingFetch(location: string, fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  const origin = new URL(location);
  return async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    const method = options?.method ?? (input instanceof Request ? input.method : 'GET');
    const asset = /^\/tracking\/(face_landmarker\.task|pose_landmarker_lite\.task|wasm\/vision_wasm_module_internal\.(js|wasm))$/.test(url.pathname);
    const query = !url.search || (/\.js$/.test(url.pathname) && /^\?task=(face|pose)$/.test(url.search));
    if (url.protocol !== origin.protocol || url.host !== origin.host || url.username || url.password || url.hash || !asset || !query || method.toUpperCase() !== 'GET') throw new TypeError('Local tracking blocks non-asset network requests');
    return fetch(input, options);
  };
}
