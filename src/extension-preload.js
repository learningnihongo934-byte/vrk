'use strict';
// Runs in extension pages and background service workers (only on
// chrome-extension:// URLs) and fills in the Chrome APIs Electron doesn't have:
// action/browserAction, more of tabs, windows, contextMenus, notifications and
// commands. Calls go to VRK's extension host (extension-host.js); events come
// back the same way.

const { contextBridge, ipcRenderer } = require('electron');

// In a service worker's preload there's no `location`, so the check happens
// inside the worker itself (install, below); web pages' workers get nothing.
const maybeExtension = typeof location === 'undefined' || location.protocol === 'chrome-extension:';

if (maybeExtension) {
  const listeners = [];
  ipcRenderer.on('vrk-ext-event', (_event, name, payload) => {
    for (const fn of listeners) fn(name, payload);
  });
  const bridge = {
    // A worker's very first calls can arrive before VRK has hooked it up: retry briefly.
    call: async (method, args) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await ipcRenderer.invoke('vrk-ext', String(method), args);
        } catch (err) {
          if (attempt >= 30 || !/No handler registered/i.test(String(err?.message))) throw err;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    },
    subscribe: (fn) => listeners.push(fn),
  };

  // Runs in the extension's own world.
  const install = (vrk) => {
    if (globalThis.location?.protocol !== 'chrome-extension:') return;
    const chrome = globalThis.chrome || (globalThis.chrome = {});
    const events = new Map(); // "tabs.onUpdated" -> Set(listener)
    const makeEvent = (name) => {
      if (!events.has(name)) events.set(name, new Set());
      const set = events.get(name);
      return {
        addListener: (fn) => typeof fn === 'function' && set.add(fn),
        removeListener: (fn) => set.delete(fn),
        hasListener: (fn) => set.has(fn),
        hasListeners: () => set.size > 0,
      };
    };
    vrk.subscribe((name, payload) => {
      for (const fn of events.get(name) || []) {
        try {
          fn(...payload);
        } catch (err) {
          console.error(err);
        }
      }
    });

    // Promise style, and callback style (last argument) like Chrome.
    const method = (name) =>
      function (...args) {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const promise = vrk.call(name, args);
        if (!callback) return promise;
        promise.then(
          (value) => callback(value),
          (err) => {
            try {
              chrome.runtime.lastError = { message: String(err?.message || err) };
              callback();
            } finally {
              delete chrome.runtime.lastError;
            }
          },
        );
        return undefined;
      };
    const namespace = (prefix, methods, eventNames, extra = {}) => {
      const ns = { ...extra };
      for (const m of methods) ns[m] = method(`${prefix}.${m}`);
      for (const e of eventNames) ns[e] = makeEvent(`${prefix}.${e}`);
      return ns;
    };

    // Turns ImageData (or { size: ImageData }) into data URLs the host can draw.
    const toDataUrl = async (imageData) => {
      const canvas = new OffscreenCanvas(imageData.width, imageData.height);
      canvas.getContext('2d').putImageData(imageData, 0, 0);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:image/png;base64,${btoa(binary)}`;
    };

    const actionMethods = ['setBadgeText', 'getBadgeText', 'setBadgeBackgroundColor', 'getBadgeBackgroundColor', 'setBadgeTextColor', 'getBadgeTextColor', 'setTitle', 'getTitle', 'setPopup', 'getPopup', 'enable', 'disable', 'isEnabled', 'openPopup', 'getUserSettings'];
    const action = namespace('action', actionMethods, ['onClicked']);
    const setIcon = method('action.setIcon');
    action.setIcon = function (details, callback) {
      const run = async () => {
        const d = { ...(details || {}) };
        if (d.imageData) {
          if (typeof ImageData !== 'undefined' && d.imageData instanceof ImageData) d.dataUrl = await toDataUrl(d.imageData);
          else d.dataUrl = Object.fromEntries(await Promise.all(Object.entries(d.imageData).map(async ([size, img]) => [size, await toDataUrl(img)])));
          delete d.imageData;
        }
        return setIcon(d);
      };
      const promise = run();
      if (typeof callback === 'function') promise.then(() => callback(), () => callback());
      else return promise;
    };
    // Electron has a bare chrome.action of its own: fill in (and replace) its members.
    const fill = (target, source) => {
      for (const [name, value] of Object.entries(source)) {
        try {
          Object.defineProperty(target, name, { value, configurable: true, writable: true, enumerable: true });
        } catch {}
      }
      return target;
    };
    for (const key of ['action', 'browserAction', 'pageAction']) {
      if (chrome[key] && typeof chrome[key] === 'object') fill(chrome[key], action);
      else chrome[key] = action;
    }
    if (!chrome.pageAction.show) fill(chrome.pageAction, { show: action.enable, hide: action.disable });

    // tabs: keep Electron's own (sendMessage, executeScript, reload…), add the rest.
    const tabs = chrome.tabs || (chrome.tabs = {});
    for (const m of ['query', 'get', 'getCurrent', 'create', 'update', 'remove', 'highlight']) tabs[m] = method(`tabs.${m}`);
    for (const e of ['onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onHighlighted', 'onMoved', 'onReplaced', 'onAttached', 'onDetached', 'onZoomChange']) {
      try {
        Object.defineProperty(tabs, e, { value: makeEvent(`tabs.${e}`), configurable: true, writable: true });
      } catch {}
    }
    if (tabs.TAB_ID_NONE == null) tabs.TAB_ID_NONE = -1;

    if (!chrome.windows) {
      chrome.windows = namespace('windows', ['get', 'getCurrent', 'getLastFocused', 'getAll', 'create', 'update', 'remove'], ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged'], { WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2 });
    }

    if (!chrome.contextMenus) {
      const create = method('contextMenus.create');
      const menus = namespace('contextMenus', ['update', 'remove', 'removeAll'], ['onClicked', 'onShown', 'onHidden'], { ACTION_MENU_TOP_LEVEL_LIMIT: 6 });
      let next = 0;
      // Chrome returns the id right away, so make it here.
      menus.create = (props = {}, callback) => {
        const id = props.id ?? `vrk-menu-${(next += 1)}`;
        create({ ...props, id, onclick: undefined }).then(() => typeof callback === 'function' && callback(), () => typeof callback === 'function' && callback());
        if (typeof props.onclick === 'function') menus.onClicked.addListener((info, tab) => info.menuItemId === id && props.onclick(info, tab));
        return id;
      };
      menus.refresh = () => Promise.resolve();
      chrome.contextMenus = menus;
      if (!chrome.menus) chrome.menus = menus;
    }

    if (!chrome.notifications) {
      chrome.notifications = namespace('notifications', ['create', 'clear', 'getAll'], ['onClicked', 'onClosed', 'onButtonClicked'], {
        update: () => Promise.resolve(false),
        getPermissionLevel: (cb) => (cb ? cb('granted') : Promise.resolve('granted')),
      });
    }
    if (!chrome.commands) chrome.commands = namespace('commands', ['getAll'], ['onCommand']);
  };

  try {
    contextBridge.executeInMainWorld({ func: install, args: [bridge] });
  } catch (err) {
    console.error('VRK extension APIs could not be added:', err);
  }
}
