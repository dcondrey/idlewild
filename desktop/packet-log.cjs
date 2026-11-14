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

function createPacketLog(file, { maxBytes = MAX_LOG_BYTES } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'a', 0o600);
  let written = 0;
  let full = false;
  let closed = false;
  const write = record => {
    if (closed || full) return;
    const line = `${JSON.stringify(record)}\n`;
    const size = Buffer.byteLength(line);
    if (written + size > maxBytes) {
      full = true;
      fs.writeSync(fd, `${JSON.stringify({ kind: 'truncated', atBytes: written })}\n`);
      return;
    }
    fs.writeSync(fd, line);
    written += size;
  };
  return {
    record(event) {
      if (event.kind === 'packet') write({ kind: 'packet', timeMs: event.timeMs, bytes: Buffer.from(event.bytes.buffer, event.bytes.byteOffset, event.bytes.byteLength).toString('base64') });
      else if (event.kind === 'session') write({ kind: 'session', sessionId: event.sessionId, epochUs: event.epochUs, metrics: event.metrics });
    },
    close() {
      if (closed) return;
      closed = true;
      fs.closeSync(fd);
    },
  };
}

module.exports = { MAX_LOG_BYTES, packetLogPath, createPacketLog };
