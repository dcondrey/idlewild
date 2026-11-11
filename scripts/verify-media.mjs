import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(await readFile(path.join(root, 'artifacts/ui/report.json'), 'utf8'));
const expected = report.trimmedDurationMs / 1000;
assert.ok(expected > 0, 'Run npm run test:ui before media validation');
const output = { expectedDurationSeconds: expected };
const probe = async file => JSON.parse((await execute('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-show_packets', '-of', 'json', file], { maxBuffer: 8 * 1024 * 1024 })).stdout);
const pcm = async file => {
  const { stdout } = await execute('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024 });
  return Float32Array.from({ length: stdout.length / 4 }, (_, index) => stdout.readFloatLE(index * 4));
};
const wavInfo = await probe(report.exports.wav);
assert.equal(wavInfo.streams[0].codec_name, 'pcm_s16le');
assert.equal(wavInfo.streams[0].sample_rate, '48000');
assert.ok(Math.abs(Number(wavInfo.format.duration) - expected) <= 1 / 48000);
const videoInfo = await probe(report.exports.video);
const audioStream = videoInfo.streams.find(stream => stream.codec_type === 'audio');
const videoStream = videoInfo.streams.find(stream => stream.codec_type === 'video');
assert.ok(audioStream && videoStream, 'Preview must contain audio and video');
const extent = stream => {
  const packets = videoInfo.packets.filter(packet => packet.stream_index === stream.index);
  return { start: Math.min(...packets.map(packet => Number(packet.pts_time))), end: Math.max(...packets.map(packet => Number(packet.pts_time) + Number(packet.duration_time || 0))), packets: packets.length };
};
const videoExtent = extent(videoStream);
const audioExtent = extent(audioStream);
assert.ok(Math.abs(videoExtent.end - expected) < 0.2, 'Video duration follows take within 200 ms');
assert.ok(Math.abs(audioExtent.end - expected) < 0.2, 'Audio duration follows take within 200 ms');
assert.ok(Math.abs(videoExtent.end - audioExtent.end) < 0.15, 'Audio/video end skew stays below 150 ms');
const reference = await pcm(report.exports.wav);
const rendered = await pcm(report.exports.video);
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
assert.ok(rms(reference) > 0.01 && rms(rendered) > 0.01, 'Both exports contain audible procedural sound');
let best = { correlation: -1, lagMs: 0 };
for (let offset = -4800; offset <= 4800; offset += 24) {
  let dot = 0, a = 0, b = 0;
  for (let index = 0; index < reference.length; index += 4) {
    const other = index + offset;
    if (other < 0 || other >= rendered.length) continue;
    dot += reference[index] * rendered[other]; a += reference[index] ** 2; b += rendered[other] ** 2;
  }
  const correlation = dot / Math.sqrt(a * b);
  if (correlation > best.correlation) best = { correlation, lagMs: offset / 48 };
}
assert.ok(best.correlation > 0.9, 'Preview audio matches the standalone waveform');
const { stdout: frames } = await execute('ffmpeg', ['-v', 'error', '-i', report.exports.video, '-vf', 'fps=2,scale=128:72', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
const frameBytes = 128 * 72 * 3;
const count = Math.floor(frames.length / frameBytes);
assert.ok(count >= 2, 'Preview contains multiple decoded frames');
let difference = 0;
for (let index = 0; index < frameBytes; index++) difference += Math.abs(frames[index] - frames[(count - 1) * frameBytes + index]);
difference /= frameBytes * 255;
assert.ok(difference > 0.0005, 'Rendered frames contain changing scene pixels');
const glb = await readFile(report.exports.glb);
const loaded = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
assert.equal(loaded.animations.length, 1);
assert.ok(Math.abs(loaded.animations[0].duration - expected) < 0.0001);
const mixer = new THREE.AnimationMixer(loaded.scene);
mixer.clipAction(loaded.animations[0]).play();
const snapshot = () => { const values = []; loaded.scene.updateMatrixWorld(true); loaded.scene.traverse(node => values.push(...node.matrixWorld.elements)); return values; };
mixer.setTime(0); const first = snapshot(); mixer.setTime(expected * 0.7); const second = snapshot();
assert.ok(first.some((value, index) => Math.abs(value - second[index]) > 0.0001), 'Baked animation changes loaded geometry transforms');
mixer.stopAllAction(); mixer.uncacheRoot(loaded.scene);
Object.assign(output, { wav: { duration: Number(wavInfo.format.duration), rms: rms(reference) }, preview: { video: videoExtent, audio: audioExtent, rms: rms(rendered), waveformMatch: best, decodedFrames: count, meanFrameDifference: difference }, glb: { duration: loaded.animations[0].duration, tracks: loaded.animations[0].tracks.length } });
await writeFile(path.join(root, 'artifacts/ui/media-verification.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
