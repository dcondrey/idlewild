'use strict';

const path = require('node:path');
const ENTRY_URL = 'idlewild://studio/index.html';
const WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";

function trustedURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'idlewild:' && url.host === 'studio' && url.pathname === '/index.html' && !url.search && !url.username && !url.password;
  } catch { return false; }
}

function assetPath(value, root) {
  const url = new URL(value);
  if (url.protocol !== 'idlewild:' || url.host !== 'studio' || url.username || url.password) throw new Error('Invalid resource');
  const name = decodeURIComponent(url.pathname);
  if (url.search && !(/^\/tracking\/wasm\/vision_wasm_module_internal\.js$/.test(name) && /^\?task=(face|pose)$/.test(url.search))) throw new Error('Invalid resource');
  if (!/^\/(index\.html|assets\/[A-Za-z0-9_.-]+|models\/[A-Za-z0-9_.-]+\.glb|tracking\/(face_landmarker\.task|pose_landmarker_lite\.task|wasm\/vision_wasm_module_internal\.(js|wasm)))$/.test(name)) throw new Error('Invalid resource');
  return path.join(root, name.slice(1));
}

function validKey(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 512 && /^[\x21-\x7e]+$/.test(value);
}

module.exports = { ENTRY_URL, WORKER_CSP, trustedURL, assetPath, validKey };
