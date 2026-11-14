import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { Channel, ControlFrame, Quality, SceneControls, SceneFrame, SceneId, Take } from './contracts.ts';
import { BRAIN_EXAMPLE_IDS, CORE_FACE_SHAPES, SIGNAL_STALE_MS, TAKE_LIMITS } from './contracts.ts';
import { frameAt } from './recording.ts';
import { MAX_TAKE_JSON_BYTES, validateTake } from './validation.ts';
import { renderWav } from './audio.ts';
import { getAssetCopyright } from './asset-credits.ts';
import { trackingAt } from './tracking-frame.ts';
import { SCENE_IDS } from './scenes/registry.ts';

const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const MAX_NODES = 512;
const MAX_VALUES = 8 * 1024 * 1024;
const SAMPLE_MS = 1000 / TAKE_LIMITS.samplesPerSecond;

interface ExportOptions {
  signal?: AbortSignal;
  reducedMotion?: boolean;
  onProgress?: (fraction: number) => void;
}

interface ExportStage {
  update(input: SceneFrame): void;
  getExportRoot(): THREE.Object3D;
}

function playableTake(input: Take): Take {
  const take = validateTake(input);
  if (!take.samples.length || take.durationMs <= 0) throw new Error('Record a nonempty take before exporting.');
  return take;
}

function settings(input: SceneControls): SceneControls {
  const result = {} as SceneControls;
  for (const key of ['motion', 'sensitivity', 'sound'] as const) {
    if (!Number.isFinite(input[key]) || input[key] < 0 || input[key] > 1) throw new Error('Export controls must be between zero and one.');
    result[key] = input[key];
  }
  if (input.brainExample !== undefined) {
    if (!BRAIN_EXAMPLE_IDS.includes(input.brainExample)) throw new Error('Unknown brain example.');
    result.brainExample = input.brainExample;
  }
  return result;
}

function inputAt(take: Take, timeMs: number, controls: SceneControls, reducedMotion: boolean): SceneFrame {
  return {
    timeMs, seed: take.seed, controls, reducedMotion,
    frame: frameAt(take, Math.min(timeMs, Math.max(0, take.durationMs - 0.001))),
  };
}

export function exportControlData(take: Take): Blob {
  const blob = new Blob([JSON.stringify(playableTake(take))], { type: 'application/json' });
  if (blob.size > MAX_TAKE_JSON_BYTES) throw new Error('Control export exceeds the supported size.');
  return blob;
}

export interface SignalReading { value: number | null; quality: Quality | 'cached'; confidence: number | null }

/** Valid and unstable readings keep their value; missing, stale (by label or age) and nonfinite readings carry none.
 * Breath replayed by continuity during speech keeps its value but is labelled `cached`, never as a measurement. */
export function signalReading(frame: ControlFrame, channel: Channel): SignalReading {
  const signal = frame.signals[channel];
  if (signal.provenance === 'replayed') {
    const usable = signal.value !== null && Number.isFinite(signal.value) && frame.timeMs - signal.sampledAtMs < SIGNAL_STALE_MS;
    return usable ? { value: signal.value, quality: 'cached', confidence: null } : { value: null, quality: 'missing', confidence: null };
  }
  const aged = frame.timeMs - signal.sampledAtMs >= SIGNAL_STALE_MS;
  const quality: Quality = aged && (signal.quality === 'valid' || signal.quality === 'unstable') ? 'stale' : signal.quality;
  const usable = (quality === 'valid' || quality === 'unstable') && signal.value !== null && Number.isFinite(signal.value);
  return { value: usable ? signal.value : null, quality: usable ? quality : quality === 'valid' || quality === 'unstable' ? 'missing' : quality, confidence: signal.confidence };
}

const CSV_SIGNALS: readonly [Channel, string, number][] = [
  ['breath', 'breath', 4], ['breathingRate', 'breathing_rate', 2], ['pulseRate', 'pulse_rate', 2], ['arterialTrace', 'arterial', 4],
];

export const SIGNAL_CSV_COLUMNS: readonly string[] = [
  'time_s', 'source',
  'breath', 'breath_quality', 'breathing_rate', 'breathing_rate_quality', 'pulse_rate', 'pulse_rate_quality', 'arterial', 'arterial_quality',
  'blink', 'talking', 'movement', 'qx', 'qy', 'qz', 'qw', ...CORE_FACE_SHAPES,
];

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function fixed(value: number | null | undefined, digits: number): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '' : value.toFixed(digits);
}

export function exportSignalCsv(input: Take): Blob {
  const take = playableTake(input);
  const lines = [SIGNAL_CSV_COLUMNS.map(csvCell).join(',')];
  for (const frame of take.samples) {
    const cells = [fixed(frame.timeMs / 1000, 3), frame.source];
    for (const [channel, , digits] of CSV_SIGNALS) {
      const reading = signalReading(frame, channel);
      cells.push(fixed(reading.value, digits), reading.quality);
    }
    for (const channel of ['blink', 'talking'] as const) cells.push(fixed(signalReading(frame, channel).value, 0));
    const tracking = trackingAt({ timeMs: frame.timeMs, seed: take.seed, controls: { motion: 0, sensitivity: 0, sound: 0 }, frame, reducedMotion: false });
    cells.push(fixed(tracking?.movement, 4));
    const rotation = tracking?.face?.rotation ?? null;
    for (let index = 0; index < 4; index++) cells.push(fixed(rotation?.[index], 5));
    for (const shape of CORE_FACE_SHAPES) cells.push(fixed(tracking?.face?.weights[shape], 4));
    lines.push(cells.map(csvCell).join(','));
  }
  const blob = new Blob([lines.join('\r\n'), '\r\n'], { type: 'text/csv' });
  if (blob.size > MAX_TAKE_JSON_BYTES) throw new Error('CSV export exceeds the supported size.');
  return blob;
}

function exportNodes(root: THREE.Object3D): THREE.Object3D[] {
  const nodes: THREE.Object3D[] = [];
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();
  let geometryBytes = 0;
  let pixels = 0;
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (nodes.length >= MAX_NODES) throw new Error('Animation export supports at most 512 scene nodes.');
    nodes.push(node);
    if (nodes.length + pending.length + node.children.length > MAX_NODES) throw new Error('Animation export supports at most 512 scene nodes.');
    pending.push(...node.children);
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points)) continue;
    const geometry: THREE.BufferGeometry = node.geometry;
    if (!geometries.has(geometry)) {
      geometries.add(geometry);
      const attributes = [...Object.values(geometry.attributes), ...Object.values(geometry.morphAttributes).flat()];
      if (geometry.index) attributes.push(geometry.index);
      for (const attribute of attributes) {
        geometryBytes += attribute.array.byteLength;
        if (geometryBytes > MAX_EXPORT_BYTES / 2) throw new Error('Geometry exceeds the 32 MiB animation export limit.');
        for (const value of attribute.array) if (!Number.isFinite(value)) throw new Error('Geometry contains invalid coordinates.');
      }
    }
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof THREE.ShaderMaterial) throw new Error('Custom shader materials cannot be exported to reusable glTF.');
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture) || textures.has(value)) continue;
        textures.add(value);
        if (value instanceof THREE.VideoTexture || value instanceof THREE.CompressedTexture) throw new Error('Video and compressed textures are not supported by this exporter.');
        const image = value.image;
        const width = image?.width;
        const height = image?.height;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('A texture is unavailable or exceeds the export limits.');
        pixels += width * height;
        if (pixels > 8 * 1024 * 1024) throw new Error('Textures exceed the animation export pixel budget.');
      }
    }
  }
  const included = new Set(nodes);
  for (const node of nodes) {
    if (node instanceof THREE.SkinnedMesh && node.skeleton.bones.some(bone => !included.has(bone))) throw new Error('The character skeleton must be contained in the exported scene.');
  }
  return nodes;
}

const SIGNAL_NODES: readonly [Channel, string][] = [['breath', 'breath'], ['breathingRate', 'breathing_rate'], ['pulseRate', 'pulse_rate'], ['arterialTrace', 'arterial']];

type Property = 'position' | 'quaternion' | 'scale' | 'morphTargetInfluences';
type CapturedTrack = { node: THREE.Object3D; property: Property; width: number; values: Float32Array; changed: boolean };

function valuesFor(node: THREE.Object3D, property: Property): number[] {
  if (property === 'morphTargetInfluences') return (node as THREE.Mesh).morphTargetInfluences ?? [];
  return node[property].toArray();
}

export async function bakeAnimation(take: Take, stage: ExportStage, controls: SceneControls, options: ExportOptions = {}): Promise<Blob> {
  take = playableTake(take);
  controls = settings(controls);
  options.signal?.throwIfAborted();
  const root = stage.getExportRoot();
  const nodes = exportNodes(root);
  const copyright = getAssetCopyright(root);
  const count = Math.ceil(take.durationMs / SAMPLE_MS) + 1;
  const times = Float32Array.from({ length: count }, (_, index) => Math.min(index * SAMPLE_MS, take.durationMs) / 1000);
  const captures: CapturedTrack[] = [];
  let valueCount = 0;
  for (const node of nodes) {
    const properties: Property[] = ['position', 'quaternion', 'scale'];
    if (node instanceof THREE.Mesh && node.morphTargetInfluences?.length) properties.push('morphTargetInfluences');
    for (const property of properties) {
      const width = valuesFor(node, property).length;
      if (width > 64) throw new Error('Animation export supports at most 64 morph targets per mesh.');
      valueCount += count * width;
      if (valueCount > MAX_VALUES || captures.length >= 2048) throw new Error('Animation exceeds the export budget. Trim the take or use a smaller rig.');
      captures.push({ node, property, width, values: new Float32Array(count * width), changed: false });
    }
  }
  const provenance: Record<string, { startMs: number; endMs: number; source: string; quality: string }[]> = {};
  const signalTracks = SIGNAL_NODES.map(([channel, name]) => ({ channel, name, values: new Float32Array(count * 3), seen: false }));
  for (let index = 0; index < count; index++) {
    if (index % 20 === 0) {
      options.signal?.throwIfAborted();
      options.onProgress?.(index / count * 0.8);
      await new Promise(resolve => setTimeout(resolve, 0));
      options.signal?.throwIfAborted();
    }
    if (stage.getExportRoot() !== root) throw new Error('The scene changed during animation export.');
    const timeMs = Math.min(index * SAMPLE_MS, take.durationMs);
    const input = inputAt(take, timeMs, controls, options.reducedMotion ?? false);
    stage.update(input);
    for (const capture of captures) {
      const values = valuesFor(capture.node, capture.property);
      if (values.length !== capture.width || values.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error('Animation contains invalid transforms or morph weights.');
      for (let component = 0; component < capture.width; component++) {
        const value = values[component];
        capture.values[index * capture.width + component] = value;
        if (index && Math.abs(value - capture.values[component]) > 1e-6) capture.changed = true;
      }
    }
    for (const track of signalTracks) {
      const reading = input.frame ? signalReading(input.frame, track.channel) : null;
      if (reading?.value === null || !reading) continue;
      const code = reading.quality === 'valid' ? 1 : reading.quality === 'cached' ? 0.25 : 0.5;
      track.values.set([reading.value, code, reading.confidence ?? 0], index * 3);
      track.seen = true;
    }
    if (timeMs < take.durationMs) {
      for (const channel of ['breath', 'breathingRate', 'pulseRate', 'arterialTrace', 'blink', 'talking'] as const) {
        const signal = input.frame?.signals[channel];
        const source = signal?.value !== null ? signal?.provenance ?? 'missing' : 'missing';
        const quality = signal?.quality ?? 'missing';
        const segments = provenance[channel] ??= [];
        const previous = segments.at(-1);
        if (previous?.source === source && previous.quality === quality) previous.endMs = Math.min(timeMs + SAMPLE_MS, take.durationMs);
        else segments.push({ startMs: timeMs, endMs: Math.min(timeMs + SAMPLE_MS, take.durationMs), source, quality });
      }
      if (take.source !== 'rehearsal') {
        const tracking = trackingAt(input);
        for (const channel of ['face', 'body'] as const) {
          const available = tracking && tracking[channel] !== null;
          const segments = provenance[channel] ??= [];
          const source = available ? 'local-camera-estimate' : 'missing';
          const quality = available ? 'tracked' : 'missing';
          const previous = segments.at(-1);
          if (previous?.source === source) previous.endMs = Math.min(timeMs + SAMPLE_MS, take.durationMs);
          else segments.push({ startMs: timeMs, endMs: Math.min(timeMs + SAMPLE_MS, take.durationMs), source, quality });
        }
      }
    }
  }
  options.signal?.throwIfAborted();
  if (!captures.some(capture => capture.changed)) throw new Error('This take produces no animated transforms. Increase motion or choose another scene.');
  root.updateMatrixWorld(true);
  const clone = cloneSkeleton(root);
  const clones = new Map<THREE.Object3D, THREE.Object3D>();
  const allocatedGeometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const allocatedMaterials = new Map<THREE.Material, THREE.Material>();
  function pair(original: THREE.Object3D, copied: THREE.Object3D) {
    clones.set(original, copied);
    copied.userData = {};
    copied.animations = [];
    if (copied instanceof THREE.Mesh || copied instanceof THREE.Line || copied instanceof THREE.Points) {
      const originalGeometry: THREE.BufferGeometry = copied.geometry;
      let geometry = allocatedGeometries.get(originalGeometry);
      if (!geometry) {
        geometry = originalGeometry.clone();
        geometry.userData = {};
        allocatedGeometries.set(originalGeometry, geometry);
      }
      copied.geometry = geometry;
      const clean = (material: THREE.Material) => {
        let result = allocatedMaterials.get(material);
        if (!result) {
          result = material.clone();
          result.userData = {};
          allocatedMaterials.set(material, result);
        }
        return result;
      };
      copied.material = Array.isArray(copied.material) ? copied.material.map(clean) : clean(copied.material);
    }
    original.children.forEach((child, index) => pair(child, copied.children[index]));
  }
  try {
    pair(root, clone);
    const tracks: THREE.KeyframeTrack[] = [];
    for (const capture of captures) {
      const node = clones.get(capture.node)!;
      const initial = capture.values.subarray(0, capture.width);
      if (capture.property === 'morphTargetInfluences') (node as THREE.Mesh).morphTargetInfluences = Array.from(initial);
      else node[capture.property].fromArray(initial);
      if (!capture.changed) continue;
      const name = `${node.uuid}.${capture.property}`;
      const Track = capture.property === 'quaternion' ? THREE.QuaternionKeyframeTrack : capture.property === 'morphTargetInfluences' ? THREE.NumberKeyframeTrack : THREE.VectorKeyframeTrack;
      tracks.push(new Track(name, times, capture.values));
    }
    const signalNodes = signalTracks.filter(track => track.seen);
    if (signalNodes.length) {
      const group = new THREE.Group();
      group.name = 'IdlewildSignals';
      group.userData = { idlewild: { encoding: 'translation = (value, quality, confidence); quality 1 valid, 0.5 unstable, 0.25 cached breath replayed during speech (not measured), 0 missing or stale (value and confidence 0); stepped interpolation', units: { breath: 'relative, about -1..1', breathing_rate: 'breaths/min', pulse_rate: 'beats/min', arterial: 'relative, uncalibrated' }, source: take.source } };
      for (const track of signalNodes) {
        const node = new THREE.Object3D();
        node.name = track.name;
        node.position.fromArray(track.values, 0);
        group.add(node);
        tracks.push(new THREE.VectorKeyframeTrack(`${node.uuid}.position`, times, track.values, THREE.InterpolateDiscrete));
      }
      clone.add(group);
    }
    clone.updateMatrixWorld(true);
    clone.userData = { idlewild: {
      version: 1, takeId: take.id, source: take.source, seed: take.seed, durationMs: take.durationMs,
      timeUnit: 'seconds', sampleIntervalMs: SAMPLE_MS, controls, reducedMotion: options.reducedMotion ?? false,
      provenance, appearance: 'Static materials; animated transforms and morph weights only.',
      adaptation: 'Adapted in Idlewild: performance animation baked into transforms and morph weights; textures may be resized.',
    } };
    const clip = new THREE.AnimationClip('Idlewild_Performance', take.durationMs / 1000, tracks);
    options.onProgress?.(0.85);
    const result = await new GLTFExporter().parseAsync(clone, { binary: true, onlyVisible: false, trs: true, animations: [clip], maxTextureSize: 2048, copyright });
    options.signal?.throwIfAborted();
    if (!(result instanceof ArrayBuffer) || result.byteLength > MAX_EXPORT_BYTES) throw new Error('Animation export exceeds the 64 MiB limit.');
    options.onProgress?.(1);
    return new Blob([result], { type: 'model/gltf-binary' });
  } finally {
    for (const geometry of allocatedGeometries.values()) geometry.dispose();
    for (const material of allocatedMaterials.values()) material.dispose();
    clone.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
  }
}

export function previewMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

function timed<T>(promise: Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value as T);
    };
    const timer = setTimeout(() => finish(new Error('The media operation timed out. Retry the export.')), milliseconds);
    const abort = () => finish(signal?.reason ?? new DOMException('Export cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    promise.then(value => finish(null, value), error => finish(error));
  });
}

export async function exportPreview(options: ExportOptions & {
  take: Take; scene: SceneId; controls: SceneControls; canvas: HTMLCanvasElement;
  update(input: SceneFrame): void;
  overlay?: (ctx: CanvasRenderingContext2D, width: number, height: number, timeMs: number) => void;
}): Promise<Blob> {
  const take = playableTake(options.take);
  const controls = settings(options.controls);
  const mimeType = previewMimeType();
  if (!mimeType || typeof AudioContext === 'undefined') throw new Error('This runtime cannot encode a WebM preview with audio. Use the desktop app.');
  if (!SCENE_IDS.includes(options.scene)) throw new Error('Unknown export scene.');
  const { canvas, signal } = options;
  if (!Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width < 1 || canvas.height < 1 || canvas.width > 4096 || canvas.height > 4096) throw new Error('The stage viewport exceeds the preview export limits.');
  signal?.throwIfAborted();
  const context = new AudioContext({ sampleRate: 48_000 });
  let source: AudioBufferSourceNode | null = null;
  let sourceStarted = false;
  let destination: MediaStreamAudioDestinationNode | null = null;
  let video: MediaStream | null = null;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let animation = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let stopTimeout: ReturnType<typeof setTimeout> | null = null;
  let finalFrameTimeout: ReturnType<typeof setTimeout> | null = null;
  let abort = () => {};
  try {
    await timed(context.resume(), 10_000, signal);
    const wav = await renderWav(take, options.scene, controls, signal);
    const audio = await timed(context.decodeAudioData(await wav.arrayBuffer()), 10_000, signal);
    signal?.throwIfAborted();
    const output = document.createElement('canvas');
    const scale = Math.min(1, 1280 / canvas.width, 720 / canvas.height);
    output.width = Math.max(2, Math.floor(canvas.width * scale / 2) * 2);
    output.height = Math.max(2, Math.floor(canvas.height * scale / 2) * 2);
    const drawing = output.getContext('2d');
    if (!drawing || typeof output.captureStream !== 'function') throw new Error('Canvas recording is unavailable in this runtime.');
    const sourceLabel = take.source === 'rehearsal' ? 'SYNTHETIC REHEARSAL' : take.source === 'local-camera' ? 'LOCAL CAMERA TRACKING' : take.samples.some(sample => sample.tracking) ? 'SMARTSPECTRA + LOCAL TRACKING' : 'SMARTSPECTRA RECORDING';
    const render = (timeMs: number) => {
      options.update(inputAt(take, timeMs, controls, options.reducedMotion ?? false));
      drawing.drawImage(canvas, 0, 0, output.width, output.height);
      const font = Math.max(10, Math.min(16, output.width / 55));
      if (options.overlay) {
        drawing.save();
        options.overlay(drawing, output.width, output.height - font * 2.5, timeMs);
        drawing.restore();
      }
      const label = `${sourceLabel} · ${options.scene === 'brain' ? 'Educational simulation — not your measured brain activity' : options.scene}`;
      drawing.fillStyle = 'rgba(8, 15, 28, 0.9)';
      drawing.fillRect(0, output.height - font * 2.5, output.width, font * 2.5);
      drawing.font = `600 ${font}px sans-serif`;
      drawing.fillStyle = '#e7f3ff';
      drawing.fillText(label, 12, output.height - font * 0.8, output.width - 24);
    };
    render(0);
    video = output.captureStream(0);
    const videoTrack = video.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!videoTrack || typeof videoTrack.requestFrame !== 'function') throw new Error('Manual canvas capture is unavailable in this runtime.');
    destination = context.createMediaStreamDestination();
    source = context.createBufferSource();
    source.buffer = audio;
    source.connect(destination);
    stream = new MediaStream([videoTrack, ...destination.stream.getAudioTracks()]);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 96_000 });
    const activeRecorder = recorder;
    const activeSource = source;
    const chunks: Blob[] = [];
    let bytes = 0;
    let epoch = 0;
    let nextFrame = 0;
    let lastRendered = 0;
    let ending = false;
    let failure: unknown = null;
    return await new Promise<Blob>((resolve, reject) => {
      const finish = (error?: unknown) => {
        if (error) failure = error;
        if (ending) return;
        ending = true;
        cancelAnimationFrame(animation);
        activeSource.onended = null;
        try { if (sourceStarted) activeSource.stop(); }
        catch { failure ??= new Error('Audio export could not stop cleanly.'); }
        stopTimeout = setTimeout(() => reject(new Error('The encoder did not finish. Retry the export.')), 5000);
        try {
          if (activeRecorder.state === 'inactive') reject(failure ?? new Error('The encoder stopped unexpectedly.'));
          else activeRecorder.stop();
        } catch { reject(failure ?? new Error('The encoder could not finalize the preview.')); }
      };
      const tick = () => {
        if (ending) return;
        try {
          if (context.state !== 'running') throw new Error('Audio processing was interrupted. Keep the studio active and retry.');
          const timeMs = Math.min(take.durationMs, Math.max(0, context.currentTime - epoch) * 1000);
          if (timeMs - lastRendered > 250) throw new Error('Preview rendering stalled. Keep the studio visible and retry.');
          if (timeMs >= nextFrame) {
            render(timeMs);
            videoTrack.requestFrame();
            lastRendered = timeMs;
            options.onProgress?.(timeMs / take.durationMs);
            nextFrame = timeMs + 1000 / 30;
          }
          animation = requestAnimationFrame(tick);
        } catch (error) { finish(error); }
      };
      abort = () => finish(signal?.reason ?? new DOMException('Export cancelled.', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      activeRecorder.ondataavailable = event => {
        if (!event.data.size || failure) return;
        bytes += event.data.size;
        if (bytes > MAX_EXPORT_BYTES) { finish(new Error('Preview exceeds 64 MiB. Trim the take and retry.')); return; }
        chunks.push(event.data);
      };
      activeRecorder.onerror = () => finish(new Error('WebM encoding failed. Try a shorter take.'));
      activeRecorder.onstop = () => {
        try {
          if (failure) reject(failure);
          else if (!ending || !bytes) reject(new Error('The encoder produced no complete preview.'));
          else {
            options.onProgress?.(1);
            resolve(new Blob(chunks, { type: activeRecorder.mimeType || mimeType }));
          }
        } catch (error) { reject(error); }
      };
      timeout = setTimeout(() => finish(new Error('Preview recording timed out. Keep the studio active and retry.')), take.durationMs + 15_000);
      if (signal?.aborted) { reject(signal.reason ?? new DOMException('Export cancelled.', 'AbortError')); return; }
      activeRecorder.start(250);
      epoch = context.currentTime;
      activeSource.onended = () => {
        if (take.durationMs - lastRendered > 250) { finish(new Error('Preview rendering stalled. Keep the studio visible and retry.')); return; }
        try {
          cancelAnimationFrame(animation);
          render(take.durationMs);
          videoTrack.requestFrame();
          finalFrameTimeout = setTimeout(() => finish(), 2000 / 30);
        } catch (error) { finish(error); }
      };
      activeSource.start(epoch);
      sourceStarted = true;
      videoTrack.requestFrame();
      tick();
    });
  } finally {
    let cleanupFailed = false;
    signal?.removeEventListener('abort', abort);
    cancelAnimationFrame(animation);
    if (timeout !== null) clearTimeout(timeout);
    if (stopTimeout !== null) clearTimeout(stopTimeout);
    if (finalFrameTimeout !== null) clearTimeout(finalFrameTimeout);
    if (recorder) {
      recorder.onstart = recorder.onstop = recorder.ondataavailable = recorder.onerror = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { cleanupFailed = true; }
    }
    if (source) {
      source.onended = null;
      try { if (sourceStarted) source.stop(); } catch { cleanupFailed = true; }
      try { source.disconnect(); } catch { cleanupFailed = true; }
    }
    try { destination?.disconnect(); } catch { cleanupFailed = true; }
    for (const track of new Set([...(stream?.getTracks() ?? []), ...(video?.getTracks() ?? []), ...(destination?.stream.getTracks() ?? [])])) {
      try { track.stop(); } catch { cleanupFailed = true; }
    }
    try { await context.close(); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw new Error('Preview resources did not close cleanly. Reload the studio before exporting again.');
  }
}
