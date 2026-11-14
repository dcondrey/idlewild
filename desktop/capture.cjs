'use strict';

const { createMetricsMapper, MAX_PACKET_BYTES } = require('./metrics.cjs');

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;
const MAX_FRAME_BYTES = MAX_WIDTH * MAX_HEIGHT * 4;
const MIN_FRAME_SPACING_US = Math.floor(1_000_000 / 35);
const MIN_ARRIVAL_SPACING_MS = 1000 / 70;
const MESSAGES = Object.freeze({
  2: 'Authentication failed. Clear the key and enter a valid SmartSpectra key.',
  3: 'The SDK rejected the requested signals. Check account support before retrying.',
  4: 'SmartSpectra credits are exhausted. Stop and check your account.',
  5: 'SmartSpectra could not connect. Check the connection before retrying.',
  6: 'SmartSpectra service failed. Stop and retry later.',
  7: 'Camera input is unavailable. Stop and reconnect the selected camera.',
  13: 'Your key does not authorize the requested signals. Check account entitlements.',
  14: 'Camera frame rate is too low. Stop other camera applications and retry.',
});
const VALIDATION = Object.freeze({
  1: 'No face detected. Face the camera with your chest visible.',
  2: 'More than one face detected. Use the camera alone.',
  3: 'Center your face in the camera preview.',
  4: 'Adjust your distance from the camera.',
  5: 'The image is too dark. Add even lighting.',
  6: 'The image is too bright. Reduce direct lighting.',
  7: 'Move back until your chest is visible.',
  10: 'The camera is adjusting. Keep still briefly.',
  11: 'Camera frame rate is low. Close other camera applications.',
  12: 'Movement is affecting signal quality. Settle comfortably.',
  13: 'Move slightly farther from the camera.',
  14: 'Move slightly closer to the camera.',
  15: 'Lower your face in the camera preview.',
  16: 'Raise your face in the camera preview.',
  17: 'Face forward toward the camera.',
});

function validateFrame(frame) {
  if (!frame || typeof frame !== 'object') throw new Error('Invalid camera frame');
  const { bytes, width, height, stride, timestampUs } = frame;
  if (!Number.isInteger(width) || width < 1 || width > MAX_WIDTH ||
      !Number.isInteger(height) || height < 1 || height > MAX_HEIGHT ||
      !Number.isInteger(stride) || stride !== width * 4 ||
      !(bytes instanceof Uint8Array) || bytes.byteLength !== stride * height || bytes.byteLength > MAX_FRAME_BYTES ||
      !Number.isSafeInteger(timestampUs) || timestampUs < 0) throw new Error('Invalid camera frame');
  return { bytes, width, height, stride, timestampUs };
}

const METRIC_SETS = Object.freeze({
  standard: Object.freeze(['CHEST_BREATHING', 'BREATHING_RATE', 'PULSE_RATE', 'ARTERIAL_PRESSURE_TRACE', 'BLINKING', 'TALKING']),
  core: Object.freeze(['CHEST_BREATHING', 'BREATHING_RATE', 'PULSE_RATE']),
  extended: Object.freeze(['CHEST_BREATHING', 'BREATHING_RATE', 'PULSE_RATE', 'ARTERIAL_PRESSURE_TRACE', 'BLINKING', 'TALKING', 'HRV', 'EXPRESSIONS']),
});

function createCaptureController({ loadSDK, onFrame, onStatus, now, metrics = 'standard', onPacket }) {
  if (typeof loadSDK !== 'function' || typeof onFrame !== 'function' || typeof onStatus !== 'function' || (onPacket !== undefined && typeof onPacket !== 'function')) throw new Error('Invalid capture callbacks');
  if (!Object.hasOwn(METRIC_SETS, metrics)) throw new Error('Invalid metric set');
  const defaultMetrics = metrics;
  const clockOrigin = Date.now();
  const monotonicOrigin = performance.now();
  const clock = now ?? (() => clockOrigin + performance.now() - monotonicOrigin);
  let queue = Promise.resolve();
  let generation = 0;
  let pendingStart = false;
  let disposed = false;
  let active = false;
  let sdk = null;
  let mapper = null;
  let sessionId = null;
  let epochMs = 0;
  let lastFrameUs = -1;
  let lastSubmitUs = -Infinity;
  let lastArrivalMs = -Infinity;
  let lastEmittedMs = -1;
  let timer = null;
  let validationCode = null;
  let needsCleanup = false;
  let phase = 'idle';
  let statusMessage = '';

  function status(nextPhase, message) {
    if (phase === nextPhase && statusMessage === message) return;
    phase = nextPhase;
    statusMessage = message;
    onStatus({ phase, message, sessionId });
  }

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function cancelFrames() {
    active = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  async function cleanup() {
    cancelFrames();
    mapper = null;
    const instance = sdk;
    if (!instance) {
      needsCleanup = false;
      return;
    }
    let failed = false;
    try { await instance.stopAsync(); } catch { failed = true; }
    try {
      await instance.destroy();
      if (sdk === instance) sdk = null;
    } catch { failed = true; }
    needsCleanup = failed;
    if (failed) throw new Error('Capture shutdown failed. Stop again before starting another session.');
  }

  function fail(message) {
    if (!active && !pendingStart) return;
    generation++;
    cancelFrames();
    status('error', message);
    void enqueue(cleanup).catch(() => status('error', 'Capture shutdown failed. Stop again before retrying.'));
  }

  function emit(timeMs) {
    if (!active || !mapper || timeMs <= lastEmittedMs) return;
    const frame = mapper.snapshot(timeMs);
    lastEmittedMs = timeMs;
    onFrame(frame);
    if (validationCode !== null && validationCode !== 0) return;
    if (frame.signals.breath.quality === 'valid') status('ready', 'Live movement controls ready; timing remains unverified.');
    else if (Object.values(frame.signals).some(signal => signal.quality === 'stale')) status('poor-signal', 'Signal is stale. Check framing and lighting, or stop and retry.');
    else if (frame.signals.breath.quality === 'unstable' && mapper.calibrating()) status('warming', 'Learning your breathing range. Breathe normally for a few seconds.');
    else if (frame.signals.breath.quality === 'unstable') status('poor-signal', 'Breathing movement is unstable. Settle comfortably.');
    else status('warming', 'Waiting for a breathing movement signal.');
  }

  return {
    start(request) {
      if (!request || request.consent !== true || typeof request.apiKey !== 'string' || !/^[!-~]{1,512}$/.test(request.apiKey) ||
          typeof request.sessionId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(request.sessionId) ||
          (request.metrics !== undefined && !Object.hasOwn(METRIC_SETS, request.metrics))) return Promise.reject(new Error('Live capture requires consent, a session, and a valid API key.'));
      const metricNames = METRIC_SETS[request.metrics ?? defaultMetrics];
      if (disposed || pendingStart || active || sdk || needsCleanup) return Promise.reject(new Error('Stop the current capture before starting another session.'));
      pendingStart = true;
      const token = ++generation;
      let key = request.apiKey;
      const identity = request.sessionId;
      return enqueue(async () => {
        try {
          if (token !== generation || disposed) throw new Error('Capture start cancelled.');
          sessionId = identity;
          status('starting', 'Starting consented SmartSpectra measurement.');
          const module = await loadSDK();
          if (token !== generation || disposed) throw new Error('Capture start cancelled.');
          const { SmartSpectraSDK, MetricType, SmartSpectraLogLevel, decodeMetrics } = module;
          if (typeof SmartSpectraSDK !== 'function' || typeof decodeMetrics !== 'function' || !MetricType || SmartSpectraLogLevel?.kNone !== 4 || module.PixelFormat?.kRGBA !== 2) throw new Error('SDK interface unavailable');
          const requestedMetrics = metricNames.map(name => MetricType[name]);
          if (!requestedMetrics.every(Number.isInteger)) throw new Error('SDK metric interface unavailable');
          sdk = new SmartSpectraSDK({ apiKey: key, requestedMetrics, enableTelemetry: false, enableAccumulatedOutput: false, logLevel: SmartSpectraLogLevel.kNone });
          key = '';
          epochMs = clock();
          if (!Number.isFinite(epochMs) || epochMs < 0 || !Number.isSafeInteger(Math.floor(epochMs * 1000))) throw new Error('Invalid capture clock');
          mapper = createMetricsMapper({ sessionId, epochUs: BigInt(Math.floor(epochMs * 1000)) });
          if (onPacket) { try { onPacket({ kind: 'session', sessionId, epochUs: String(Math.floor(epochMs * 1000)), metrics: metricNames }); } catch {} }
          lastFrameUs = -1;
          lastSubmitUs = -Infinity;
          lastArrivalMs = -Infinity;
          lastEmittedMs = -1;
          validationCode = null;
          let started = false;
          const current = () => token === generation && sdk !== null;
          sdk.on('metrics', buffer => {
            if (!current() || !active) return;
            try {
              if (!(buffer instanceof Uint8Array) || buffer.byteLength === 0 || buffer.byteLength > MAX_PACKET_BYTES) throw new Error('Invalid packet size');
              const timeMs = Math.max(0, clock() - epochMs);
              if (onPacket) { try { onPacket({ kind: 'packet', timeMs, bytes: buffer }); } catch {} }
              mapper.ingest(decodeMetrics(buffer), timeMs);
              emit(timeMs);
            } catch { fail('SmartSpectra returned invalid data. Stop and retry the session.'); }
          });
          sdk.on('validationStatus', code => {
            if (!current() || !active) return;
            validationCode = code;
            if (code === 0) emit(Math.max(0, clock() - epochMs));
            else status('poor-signal', VALIDATION[code] ?? 'Signal quality is limited. Check framing and lighting.');
          });
          sdk.on('processingStatus', code => {
            if (!current()) return;
            if (code === 5) fail('SmartSpectra processing failed. Stop and retry the session.');
            else if (code === 1 && active && started) fail('SmartSpectra stopped unexpectedly. Stop and retry the session.');
          });
          sdk.on('error', code => {
            if (current()) fail(MESSAGES[code] ?? 'SmartSpectra capture failed. Stop and retry the session.');
          });
          sdk.useCustomInput();
          active = true;
          await sdk.start();
          if (!current() || disposed) throw new Error('Capture start cancelled.');
          started = true;
          status('warming', 'Waiting for a breathing movement signal.');
          timer = setInterval(() => {
            try { emit(Math.max(0, clock() - epochMs)); }
            catch { fail('Capture clock or consumer failed. Stop and retry the session.'); }
          }, 50);
          timer.unref?.();
        } catch {
          const cancelled = token !== generation || disposed;
          cancelFrames();
          try { await cleanup(); } catch {
            status('error', 'Capture shutdown failed. Stop again before retrying.');
            throw new Error('Capture shutdown failed. Stop again before retrying.');
          }
          if (!cancelled) status('error', 'Could not start SmartSpectra. Check the key, account, and connection before retrying.');
          throw new Error(cancelled ? 'Capture start cancelled.' : 'Could not start SmartSpectra. Check the key, account, and connection before retrying.');
        } finally {
          key = '';
          pendingStart = false;
        }
      });
    },

    sendFrame(input) {
      const frame = validateFrame(input);
      if (!active || !sdk) return false;
      const currentMs = clock();
      if (frame.timestampUs <= lastFrameUs || Math.abs(frame.timestampUs / 1000 - currentMs) > 5000) throw new Error('Camera timestamps must be increasing epoch microseconds.');
      lastFrameUs = frame.timestampUs;
      if (frame.timestampUs - lastSubmitUs < MIN_FRAME_SPACING_US || currentMs - lastArrivalMs < MIN_ARRIVAL_SPACING_MS) return false;
      lastSubmitUs = frame.timestampUs;
      lastArrivalMs = currentMs;
      try {
        return sdk.sendFrame(frame.bytes, frame.width, frame.height, frame.stride, 2, frame.timestampUs) === true;
      } catch {
        fail('Camera frame submission failed. Stop and retry the selected camera.');
        return false;
      }
    },

    stop() {
      generation++;
      cancelFrames();
      return enqueue(async () => {
        if (sdk || pendingStart || sessionId) status('stopping', 'Stopping SmartSpectra measurement.');
        try { await cleanup(); }
        catch (error) {
          status('error', error.message);
          throw error;
        }
        sessionId = null;
        status('idle', 'SmartSpectra measurement stopped.');
      });
    },

    dispose() {
      disposed = true;
      return this.stop();
    },
  };
}

module.exports = { createCaptureController, validateFrame, METRIC_SETS, MAX_WIDTH, MAX_HEIGHT, MAX_FRAME_BYTES };
