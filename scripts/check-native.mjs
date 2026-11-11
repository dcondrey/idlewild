import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [root], cwd: root, env });
try {
  await app.firstWindow();
  const result = await app.evaluate(() => {
    const require = process.getBuiltinModule('node:module').createRequire(process.cwd() + '/package.json');
    const { SmartSpectraSDK } = require('@smartspectra/node-sdk');
    return { sdk: SmartSpectraSDK.version, electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch, sessionCreated: false };
  });
  console.log(JSON.stringify(result));
} finally { await app.close(); }
