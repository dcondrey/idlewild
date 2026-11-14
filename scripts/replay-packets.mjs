import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { TakeRecorder } from '../src/recording.ts';

const require = createRequire(import.meta.url);
const { createMetricsMapper } = require('../desktop/metrics.cjs');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

const [input, output] = process.argv.slice(2);
if (!input) throw new Error('Usage: node scripts/replay-packets.mjs <packets.jsonl> [take.json]');
const records = (await readFile(input, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
const session = records.find(record => record.kind === 'session');
if (!session) throw new Error('The packet log has no session record.');
const packets = records.filter(record => record.kind === 'packet');
if (!packets.length) throw new Error('The packet log has no packets.');

const mapper = createMetricsMapper({ sessionId: session.sessionId, epochUs: BigInt(session.epochUs) });
const recorder = new TakeRecorder(`replay-${session.sessionId}`.slice(0, 128), 'live', session.sessionId, 20261111);
const stats = { packets: packets.length, groups: {} };
let tick = 0;
let last = -1;
const append = frame => { if (!recorder.full && frame.timeMs > last) { recorder.append(frame); last = frame.timeMs; } };
for (const packet of packets) {
  const decoded = decodeMetrics(new Uint8Array(Buffer.from(packet.bytes, 'base64')));
  for (const [group, fields] of Object.entries(decoded.toJSON?.() ?? decoded)) {
    if (!fields || typeof fields !== 'object') continue;
    for (const [field, values] of Object.entries(fields)) {
      const key = `${group}.${field}`;
      const count = Array.isArray(values) ? values.length : 1;
      stats.groups[key] = (stats.groups[key] ?? 0) + count;
    }
  }
  for (; tick < packet.timeMs; tick += 50) append(mapper.snapshot(tick));
  append(mapper.ingest(decoded, packet.timeMs));
}
const take = recorder.finish();
const target = output ?? path.join(path.dirname(input), 'replayed-take.json');
await writeFile(target, JSON.stringify(take), { mode: 0o600 });
console.log(JSON.stringify({ target, samples: take.samples.length, durationMs: take.durationMs, ...stats }, null, 2));
