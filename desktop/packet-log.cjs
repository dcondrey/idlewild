'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LOG_BYTES = 64 * 1024 * 1024;

function packetLogPath(value, root) {
  if (typeof value !== 'string' || !value) throw new Error('A packet log path is required');
  const base = path.resolve(root, '.local');
  const file = path.resolve(root, value);
  if (!file.startsWith(base + path.sep) || !file.endsWith('.jsonl')) throw new Error('Packet logs must be .jsonl files under .local/');
  return file;
}

// Writes are queued on a stream so a slow disk never blocks the main process while SDK callbacks and camera frames are flowing.
// Queued bytes are bounded by maxBytes, so a stalled disk costs at most that much memory.
function createPacketLog(file, { maxBytes = MAX_LOG_BYTES } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'a', 0o600);
  const stream = fs.createWriteStream(file, { fd, autoClose: true });
  let failed = false;
  let closed = null;
  stream.on('error', () => { failed = true; });
  let written = 0;
  let full = false;
  const write = record => {
    if (closed || full || failed) return;
    const line = `${JSON.stringify(record)}\n`;
    const size = Buffer.byteLength(line);
    if (written + size > maxBytes) {
      full = true;
      stream.write(`${JSON.stringify({ kind: 'truncated', atBytes: written })}\n`);
      return;
    }
    stream.write(line);
    written += size;
  };
  return {
    record(event) {
      if (event.kind === 'packet') write({ kind: 'packet', timeMs: event.timeMs, bytes: Buffer.from(event.bytes.buffer, event.bytes.byteOffset, event.bytes.byteLength).toString('base64') });
      else if (event.kind === 'session') write({ kind: 'session', sessionId: event.sessionId, epochUs: event.epochUs, metrics: event.metrics });
    },
    close() {
      closed ??= new Promise(resolve => {
        if (stream.closed) return resolve();
        stream.once('close', resolve);
        stream.end();
      });
      return closed;
    },
  };
}

module.exports = { MAX_LOG_BYTES, packetLogPath, createPacketLog };
