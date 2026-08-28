'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('growbar', {
  getState: () => ipcRenderer.invoke('state:get'),
  // Sandboxed Electron preload scripts may only require Electron's supported
  // built-ins. Keep the catalog in the main process and cross the existing
  // IPC bridge instead of requiring a local CommonJS module here.
  getGelLibrary: () => ipcRenderer.invoke('gel-library:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  reconnect: () => ipcRenderer.invoke('connection:retry'),
  applyEvent: (event) => ipcRenderer.invoke('schedule:apply', event),
  applyCurrent: () => ipcRenderer.invoke('schedule:apply-current'),
  startOverride: (presetId, fps, zones) => ipcRenderer.invoke('override:start', presetId, fps, zones),
  startCustomOverride: (event) => ipcRenderer.invoke('override:start-custom', event),
  cancelOverride: () => ipcRenderer.invoke('override:cancel'),
  setPartitionLayout: (zones) => ipcRenderer.invoke('partition:set-layout', zones),
  adoptDirect: () => ipcRenderer.invoke('direct:adopt'),
  hide: () => ipcRenderer.invoke('window:hide'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app-state', listener);
    return () => ipcRenderer.removeListener('app-state', listener);
  }
});
