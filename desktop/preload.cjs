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
  startLive: (consent, extended = false) => ipcRenderer.invoke('studio:start', consent, extended),
  stopLive: () => ipcRenderer.invoke('studio:stop'),
  sendFrame: frame => ipcRenderer.invoke('studio:frame', frame),
  onFrame: callback => listen('studio:metrics', callback),
  onStatus: callback => listen('studio:status', callback),
  onMenu: callback => listen('studio:menu', callback),
  setMenuState: state => ipcRenderer.send('studio:menu-state', state),
  getPreferences: () => ipcRenderer.invoke('studio:preferences:get'),
  setPreferences: partial => ipcRenderer.invoke('studio:preferences:set', partial),
}));
