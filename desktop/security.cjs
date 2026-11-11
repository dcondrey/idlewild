'use strict';

const path = require('node:path');
const ENTRY_URL = 'idlewild://studio/index.html';

function trustedURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'idlewild:' && url.host === 'studio' && url.pathname === '/index.html' && !url.search && !url.username && !url.password;
  } catch { return false; }
}

function assetPath(value, root) {
  const url = new URL(value);
  if (url.protocol !== 'idlewild:' || url.host !== 'studio' || url.username || url.password || url.search) throw new Error('Invalid resource');
  const name = decodeURIComponent(url.pathname);
  if (!/^\/(index\.html|assets\/[A-Za-z0-9_.-]+|models\/[A-Za-z0-9_.-]+\.glb)$/.test(name)) throw new Error('Invalid resource');
  return path.join(root, name.slice(1));
}

function validKey(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 512 && /^[\x21-\x7e]+$/.test(value);
}

module.exports = { ENTRY_URL, trustedURL, assetPath, validKey };
