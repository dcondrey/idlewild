import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { localTrackingFetch } from '../src/tracking/network.ts';
const { trustedURL, assetPath, validKey } = createRequire(import.meta.url)('../desktop/security.cjs');

test('desktop resources and privileged sender URLs are confined', () => {
  assert.equal(trustedURL('idlewild://studio/index.html'), true);
  for (const url of ['https://studio/index.html', 'idlewild://other/index.html', 'idlewild://studio/index.html?x=1', 'idlewild://studio/assets/index.html', 'idlewild://user@studio/index.html']) assert.equal(trustedURL(url), false);
  assert.equal(assetPath('idlewild://studio/assets/app-123.js', '/app/dist'), '/app/dist/assets/app-123.js');
  assert.equal(assetPath('idlewild://studio/tracking/face_landmarker.task', '/app/dist'), '/app/dist/tracking/face_landmarker.task');
  assert.equal(assetPath('idlewild://studio/tracking/wasm/vision_wasm_module_internal.js?task=face', '/app/dist'), '/app/dist/tracking/wasm/vision_wasm_module_internal.js');
  for (const url of ['idlewild://studio/tracking/other.task', 'idlewild://studio/tracking/face_landmarker.task?task=face', 'idlewild://studio/tracking/wasm/vision_wasm_module_internal.js?task=other', 'idlewild://studio/index.html?task=pose', 'idlewild://studio/tracking/wasm/../LICENSE']) assert.throws(() => assetPath(url, '/app/dist'));
  for (const url of ['file:///etc/passwd', 'idlewild://studio/%2e%2e/package.json', 'idlewild://studio/assets/..%2f..%2fsecret', 'idlewild://studio/models/file.bin', 'idlewild://studio/assets/%00.js']) assert.throws(() => assetPath(url, '/app/dist'));
});

test('keys are bounded printable non-whitespace values', () => {
  assert.equal(validKey('a'.repeat(7)), false);
  assert.equal(validKey('a'.repeat(8)), true);
  assert.equal(validKey('a'.repeat(512)), true);
  assert.equal(validKey('a'.repeat(513)), false);
  assert.equal(validKey('not a key'), false);
  assert.equal(validKey(null), false);
});

test('tracking network permits only same-origin model assets and blocks telemetry before transport', async () => {
  const calls: string[] = [];
  const confined = localTrackingFetch('idlewild://studio/assets/worker.js', async input => { calls.push(String(input)); return new Response('fixture'); });
  for (const url of ['idlewild://studio/tracking/face_landmarker.task', 'idlewild://studio/tracking/wasm/vision_wasm_module_internal.wasm']) assert.equal((await confined(url)).status, 200);
  for (const url of ['https://odml.pa.googleapis.com/v1/log', 'idlewild://other/tracking/face_landmarker.task', 'idlewild://studio/index.html', 'idlewild://studio/tracking/../index.html', 'idlewild://studio/tracking/face_landmarker.task?key=anything', 'file:///tracking/face_landmarker.task', 'data:application/wasm,anything']) await assert.rejects(confined(url));
  await assert.rejects(confined('idlewild://studio/tracking/face_landmarker.task', { method: 'POST' }));
  assert.equal(calls.length, 2);
});
