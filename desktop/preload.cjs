'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('idlewild', Object.freeze({
  setKey: key => ipcRenderer.invoke('studio:key', key),
  clearKey: () => ipcRenderer.invoke('studio:clear-key'),
  allowCamera: allowed => ipcRenderer.invoke('studio:camera', allowed),
  startLive: consent => ipcRenderer.invoke('studio:start', consent),
  stopLive: () => ipcRenderer.invoke('studio:stop'),
  sendFrame: frame => ipcRenderer.invoke('studio:frame', frame),
  onFrame: callback => listen('studio:metrics', callback),
  onStatus: callback => listen('studio:status', callback),
}));
