'use strict';

const { app, BrowserWindow, ipcMain, Menu, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { ENTRY_URL, WORKER_CSP, trustedURL, assetPath, validKey } = require('./security.cjs');
const { createCaptureController } = require('./capture.cjs');
const { createBenchmarkLimit } = require('./benchmark-limit.cjs');
const { createPacketLog, packetLogPath } = require('./packet-log.cjs');

const flag = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const metricSet = flag('sdk-metrics') ?? 'standard';
const packetLogFlag = flag('sdk-packet-log');
const packetLog = packetLogFlag === undefined ? null : createPacketLog(packetLogPath(packetLogFlag, process.cwd()));

protocol.registerSchemesAsPrivileged([{ scheme: 'idlewild', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.setName('Idlewild');
let window = null;
let apiKey = '';
let cameraAllowed = false;
let quitting = false;
let closing = false;

const send = (channel, payload) => {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload);
};
const capture = createCaptureController({
  loadSDK: () => ({ ...require('@smartspectra/node-sdk'), decodeMetrics: require('@smartspectra/node-sdk/messages').decodeMetrics }),
  onFrame: frame => send('studio:metrics', frame),
  metrics: metricSet,
  ...(packetLog ? { onPacket: event => packetLog.record(event) } : {}),
  onStatus: status => {
    if (status.phase === 'idle') benchmarkLimit?.end();
    send('studio:status', status);
  },
});
const benchmarkLimit = process.argv.includes('--live-benchmark') ? createBenchmarkLimit({ expire: () => {
  cameraAllowed = false;
  apiKey = '';
  send('studio:status', { phase: 'error', message: 'The authorized live benchmark has ended. Camera and measurement are stopping.', sessionId: null });
  void capture.dispose().catch(() => send('studio:status', { phase: 'error', message: 'Benchmark cleanup failed. Close Idlewild before another session.', sessionId: null }));
} }) : null;

function authorize(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trustedURL(event.senderFrame.url)) throw new Error('Untrusted request');
}

function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    authorize(event);
    try { return await action(...args); }
    catch { throw new Error('The operation failed. Stop capture and try again; restart Idlewild if it persists.'); }
  });
}

handle('studio:key', key => {
  if (!validKey(key)) throw new Error('Invalid key');
  apiKey = key;
});
handle('studio:clear-key', async () => { apiKey = ''; await capture.stop(); });
handle('studio:camera', async allowed => {
  if (typeof allowed !== 'boolean') throw new Error('Invalid permission');
  cameraAllowed = allowed;
  if (!allowed) await capture.stop();
});
handle('studio:start', async (consent, extended = false) => {
  if (consent !== true || typeof extended !== 'boolean' || !cameraAllowed || !apiKey) throw new Error('Consent, preview and key required');
  benchmarkLimit?.begin();
  await capture.start({ apiKey, consent: true, sessionId: randomUUID(), ...(extended ? { metrics: 'extended' } : {}) });
});
handle('studio:stop', () => capture.stop());
handle('studio:frame', payload => {
  if (!cameraAllowed) throw new Error('Camera permission required');
  return capture.sendFrame(payload);
});

app.whenReady().then(async () => {
  const isolated = session.fromPartition('idlewild');
  isolated.protocol.handle('idlewild', async request => {
    try {
      if (request.method !== 'GET') return new Response('', { status: 405 });
      const file = assetPath(request.url, path.join(__dirname, '../dist'));
      const response = await net.fetch(pathToFileURL(file).href);
      if (!file.endsWith('.js')) return response;
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', WORKER_CSP);
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('', { status: 404 }); }
  });
  isolated.setPermissionCheckHandler((contents, permission, _origin, details) =>
    cameraAllowed && contents === window?.webContents && permission === 'media' && details.isMainFrame === true && details.mediaType === 'video' && trustedURL(details.requestingUrl));
  isolated.setPermissionRequestHandler((contents, permission, callback, details) => callback(
    cameraAllowed && contents === window?.webContents && permission === 'media' && details.isMainFrame === true && trustedURL(details.requestingUrl) &&
    Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'video'));
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 760, minHeight: 620, backgroundColor: '#111922', title: 'Idlewild', webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), session: isolated, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
  } });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => {
    cameraAllowed = false;
    apiKey = '';
    void capture.stop().catch(() => send('studio:status', { phase: 'error', message: 'Capture cleanup failed. Restart Idlewild.', sessionId: null }));
  });
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    cameraAllowed = false;
    apiKey = '';
    void capture.dispose().then(() => { closing = true; window.destroy(); app.quit(); }).catch(() => {
      send('studio:status', { phase: 'error', message: 'Capture could not shut down. Stop capture and close again.', sessionId: null });
    });
  });
  await window.loadURL(ENTRY_URL);
}).catch(() => { process.stderr.write('Idlewild could not start. Build the app and retry.\n'); app.exit(1); });

app.on('before-quit', event => {
  if (quitting || closing) return;
  event.preventDefault();
  apiKey = '';
  cameraAllowed = false;
  void capture.dispose().then(() => { quitting = true; app.quit(); }).catch(() => {
    send('studio:status', { phase: 'error', message: 'Capture could not shut down. Stop capture and quit again.', sessionId: null });
  });
});
app.on('window-all-closed', () => app.quit());
app.on('quit', () => packetLog?.close());
