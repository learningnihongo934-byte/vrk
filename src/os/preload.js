'use strict';
// The bridge VRKOS's own pages (desktop and apps) use. The main process
// answers only VRKOS windows; web pages never get this preload.

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['state', 'theme', 'args', 'pty-data', 'pty-exit', 'launchpad']);
const listeners = new Map();
ipcRenderer.on('vrkos:event', (_event, name, payload) => {
  for (const callback of listeners.get(name) || []) callback(payload);
});

contextBridge.exposeInMainWorld('vrkos', {
  call: (name, ...args) => ipcRenderer.invoke('vrkos:call', String(name), ...args),
  on: (name, callback) => {
    if (!EVENTS.has(name) || typeof callback !== 'function') return;
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(callback);
  },
  ptyWrite: (id, data) => ipcRenderer.send('vrkos:pty-write', String(id), String(data)),
  fileUrl: (file) => `vrk://file/?path=${encodeURIComponent(file)}`,
});
