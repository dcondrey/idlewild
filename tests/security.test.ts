import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { trustedURL, assetPath, validKey } = createRequire(import.meta.url)('../desktop/security.cjs');

test('desktop resources and privileged sender URLs are confined', () => {
  assert.equal(trustedURL('idlewild://studio/index.html'), true);
  for (const url of ['https://studio/index.html', 'idlewild://other/index.html', 'idlewild://studio/index.html?x=1', 'idlewild://studio/assets/index.html', 'idlewild://user@studio/index.html']) assert.equal(trustedURL(url), false);
  assert.equal(assetPath('idlewild://studio/assets/app-123.js', '/app/dist'), '/app/dist/assets/app-123.js');
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
