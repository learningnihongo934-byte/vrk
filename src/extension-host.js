'use strict';
// VRK's own extension host: the Chrome extension APIs Electron doesn't have
// built in. Electron runs extensions (content scripts, background workers,
// storage, runtime, scripting); this adds what makes them feel at home in a
// browser:
//
//   chrome.action / browserAction   toolbar buttons, badges, icons, popups
//   chrome.tabs (query, create…)    VRK's real tabs, plus tab events
//   chrome.windows                  VRK's window, and pop-out windows
//   chrome.contextMenus / menus     items in the page's right-click menu
//   chrome.notifications            system notifications
//
// Extension code reaches this through extension-preload.js (in extension pages
// and background service workers). The extension is always identified from
// the page or worker that sent the message, never from what it claims.

const { BrowserWindow, Menu, Notification, ipcMain, nativeImage, webContents: allContents } = require('electron');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const PRELOAD = path.join(__dirname, 'extension-preload.js');
const EXT_URL = /^chrome-extension:\/\/([a-p]{32})\//;
const IMAGE_TYPES = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon' };

class ExtensionHost extends EventEmitter {
  constructor({ session, hooks }) {
    super();
    this.session = session;
    this.hooks = hooks; // tabs(), activeContents(), window(), createTab(details), selectTab(wc), removeTab(wc), createWindow(details)
    this.actions = new Map(); // extension id -> action state
    this.menus = new Map(); // extension id -> Map(menu id -> item)
    this.notifications = new Map(); // `${ext}:${id}` -> Notification
    this.workers = new Map(); // service worker version id -> { id: extension id, worker }
    this.tracked = new Set(); // webContents ids we report as tabs
    this.popup = null;

    session.registerPreloadScript({ type: 'frame', filePath: PRELOAD });
    session.registerPreloadScript({ type: 'service-worker', filePath: PRELOAD });

    // Extension pages (popups, options, MV2 background pages).
    ipcMain.handle('vrk-ext', (event, method, args) => {
      const id = EXT_URL.exec(event.senderFrame?.url || '')?.[1];
      if (!id || event.sender.session !== this.session) throw new Error('Not allowed.');
      return this.call(id, method, Array.isArray(args) ? args : [], event.sender);
    });
    // Background service workers (MV3) have their own IPC channel each.
    session.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
      if (runningStatus === 'stopped') return void this.workers.delete(versionId);
      if (this.workers.has(versionId)) return; // hooked up as early as possible: 'starting', else 'running'
      const worker = session.serviceWorkers.getWorkerFromVersionID(versionId);
      const id = EXT_URL.exec(`${worker?.scope || ''}/`)?.[1];
      if (!worker || !id) return;
      this.workers.set(versionId, { id, worker });
      try {
        worker.ipc.handle('vrk-ext', (_event, method, args) => this.call(id, method, Array.isArray(args) ? args : [], null));
      } catch {
        // Already handled for this worker.
      }
    });
    session.extensions.on('extension-unloaded', (_event, ext) => {
      this.actions.delete(ext.id);
      this.menus.delete(ext.id);
      this.emit('change');
    });
    session.extensions.on('extension-loaded', () => this.emit('change'));
  }

  // ── Talking to extensions ───────────────────────────────────────────────

  // Sends an event (like tabs.onUpdated) to one extension, or all of them.
  dispatch(extensionId, name, ...payload) {
    for (const { id, worker } of this.workers.values()) {
      if (extensionId && id !== extensionId) continue;
      try {
        if (!worker.isDestroyed()) worker.send('vrk-ext-event', name, payload);
      } catch {}
    }
    for (const wc of allContents.getAllWebContents()) {
      if (wc.isDestroyed() || wc.session !== this.session) continue;
      const id = EXT_URL.exec(wc.getURL())?.[1];
      if (id && (!extensionId || id === extensionId)) wc.send('vrk-ext-event', name, payload);
    }
  }

  extension(id) {
    return this.session.extensions.getExtension(id);
  }

  call(id, method, args, sender) {
    const ext = this.extension(id);
    if (!ext) throw new Error('Unknown extension.');
    const fn = API[method];
    if (!fn) throw new Error(`${method} isn't supported in VRK.`);
    return fn.call(this, ext, args, sender);
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────

  // Called by VRK for every normal tab (not Tor or container tabs).
  addTab(wc) {
    if (this.tracked.has(wc.id)) return;
    this.tracked.add(wc.id);
    const id = wc.id;
    const update = (changes) => !wc.isDestroyed() && this.dispatch(null, 'tabs.onUpdated', id, changes, null);
    wc.on('did-start-loading', () => update({ status: 'loading' }));
    wc.on('did-stop-loading', () => update({ status: 'complete' }));
    wc.on('did-navigate', (_e, url) => update({ url }));
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => isMainFrame && update({ url }));
    wc.on('page-title-updated', (_e, title) => update({ title }));
    wc.on('page-favicon-updated', (_e, icons) => icons[0] && update({ favIconUrl: icons[0] }));
    wc.once('destroyed', () => {
      this.tracked.delete(id);
      this.dispatch(null, 'tabs.onRemoved', id, { windowId: this.windowId(), isWindowClosing: false });
    });
    setImmediate(() => !wc.isDestroyed() && this.dispatch(null, 'tabs.onCreated', null, id));
  }

  selectTab(wc) {
    if (wc.isDestroyed()) return;
    this.dispatch(null, 'tabs.onActivated', { tabId: wc.id, windowId: this.windowId() });
    this.emit('change'); // per-tab badges
  }

  windowId() {
    return this.hooks.window()?.id ?? -1;
  }

  tabList() {
    return this.hooks.tabs().filter((wc) => !wc.isDestroyed());
  }

  // What an extension may see: URLs and titles only with the "tabs" permission
  // or access to that site, as in Chrome.
  tabInfo(ext, wc) {
    const active = this.hooks.activeContents();
    const list = this.tabList();
    const url = wc.getURL();
    const perms = [...(ext.manifest.permissions || []), ...(ext.manifest.host_permissions || []), ...(ext.manifest.optional_permissions || [])];
    const sees = perms.includes('tabs') || perms.some((p) => p === '<all_urls>' || /^(\*|https?):\/\//.test(p));
    return {
      id: wc.id,
      index: Math.max(0, list.indexOf(wc)),
      windowId: this.windowId(),
      active: wc === active,
      highlighted: wc === active,
      selected: wc === active,
      pinned: false,
      incognito: false,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      status: wc.isLoading() ? 'loading' : 'complete',
      audible: wc.isCurrentlyAudible(),
      mutedInfo: { muted: wc.isAudioMuted() },
      width: 0,
      height: 0,
      ...(sees ? { url, title: wc.getTitle(), favIconUrl: undefined } : {}),
    };
  }

  findTab(tabId) {
    return this.tabList().find((wc) => wc.id === Number(tabId)) || null;
  }

  // ── Toolbar buttons ──────────────────────────────────────────────────────

  action(ext) {
    if (!this.actions.has(ext.id)) {
      const m = ext.manifest.action || ext.manifest.browser_action || ext.manifest.page_action || {};
      this.actions.set(ext.id, { title: m.default_title || ext.name, popup: m.default_popup || '', icon: this.iconFromManifest(ext, m.default_icon || ext.manifest.icons), text: '', color: null, enabled: true, tabs: new Map() });
    }
    return this.actions.get(ext.id);
  }

  // An icon from the extension's own files, as a data URL (largest up to 64px).
  iconFromManifest(ext, icon) {
    if (!icon) return null;
    let file = typeof icon === 'string' ? icon : null;
    if (!file && typeof icon === 'object') {
      const sizes = Object.keys(icon).map(Number).filter(Boolean).sort((a, b) => a - b);
      const pick = sizes.filter((s) => s <= 64).pop() || sizes[0];
      file = icon[pick];
    }
    return file ? this.fileUrl(ext, file) : null;
  }

  fileUrl(ext, relative) {
    const full = path.normalize(path.join(ext.path, String(relative).replace(/^\//, '')));
    if (!full.startsWith(ext.path + path.sep)) return null; // stays inside the extension
    const type = IMAGE_TYPES[path.extname(full).toLowerCase()];
    try {
      return type ? `data:${type};base64,${fs.readFileSync(full).toString('base64')}` : null;
    } catch {
      return null;
    }
  }

  // For VRK's toolbar: every extension's button, as it looks on the active tab.
  toolbarState() {
    const active = this.hooks.activeContents();
    const tabId = active?.id ?? -1;
    return this.session.extensions
      .getAllExtensions()
      .filter((ext) => ext.manifest.action || ext.manifest.browser_action || ext.manifest.page_action || ext.manifest.icons)
      .map((ext) => {
        const a = this.action(ext);
        const t = a.tabs.get(tabId) || {};
        return { id: ext.id, title: t.title ?? a.title, text: t.text ?? a.text, color: t.color ?? a.color, icon: t.icon ?? a.icon, enabled: t.enabled ?? a.enabled };
      });
  }

  // A click on an extension's toolbar button (rect: the button, in the browser window).
  activate(extensionId, rect, contextMenu) {
    const ext = this.extension(extensionId);
    if (!ext) return;
    const active = this.hooks.activeContents();
    const a = this.action(ext);
    const t = (active && a.tabs.get(active.id)) || {};
    if (contextMenu) {
      return this.hooks.extensionMenu?.(ext, rect);
    }
    if ((t.enabled ?? a.enabled) === false) return;
    const popup = t.popup ?? a.popup;
    if (popup) return this.openPopup(ext, popup, rect);
    this.dispatch(ext.id, 'action.onClicked', active ? this.tabInfo(ext, active) : null);
  }

  openPopup(ext, page, rect) {
    this.closePopup();
    const parent = this.hooks.window();
    const content = parent.getContentBounds();
    const popup = new BrowserWindow({
      parent,
      x: Math.round(content.x + (rect?.x || 0) + (rect?.width || 0) - 360),
      y: Math.round(content.y + (rect?.y || 0) + (rect?.height || 0) + 4),
      width: 360,
      height: 120,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      roundedCorners: true,
      backgroundColor: '#ffffff',
      webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false, enablePreferredSizeMode: true },
    });
    this.popup = popup;
    // The popup sizes itself to its page, like Chrome's (25×25 to 800×600).
    popup.webContents.on('preferred-size-changed', (_e, size) => {
      if (popup.isDestroyed()) return;
      const width = Math.max(25, Math.min(800, size.width));
      const height = Math.max(25, Math.min(600, size.height));
      const bounds = popup.getBounds();
      const right = Math.min(content.x + content.width, Math.round(content.x + (rect?.x || 0) + (rect?.width || 0)));
      popup.setBounds({ x: Math.max(content.x, right - width), y: bounds.y, width, height });
    });
    popup.once('ready-to-show', () => !popup.isDestroyed() && popup.show());
    popup.on('blur', () => !popup.webContents.isDevToolsOpened() && this.closePopup());
    popup.on('closed', () => this.popup === popup && (this.popup = null));
    popup.webContents.setWindowOpenHandler(({ url }) => {
      this.hooks.createTab({ url, active: true });
      return { action: 'deny' };
    });
    popup.loadURL(`${ext.url}${String(page).replace(/^\//, '')}`);
  }

  closePopup() {
    if (this.popup && !this.popup.isDestroyed()) this.popup.close();
    this.popup = null;
  }

  // ── Right-click menu items ───────────────────────────────────────────────

  // Items extensions added for this right-click (Electron context-menu params).
  contextMenuItems(wc, params) {
    const contexts = new Set(['all', 'page']);
    if (params.linkURL) contexts.add('link');
    if (params.selectionText) contexts.add('selection');
    if (params.mediaType === 'image') contexts.add('image');
    if (params.mediaType === 'video') contexts.add('video');
    if (params.mediaType === 'audio') contexts.add('audio');
    if (params.isEditable) contexts.add('editable');
    if (params.frameURL) contexts.add('frame');
    if (params.selectionText || params.linkURL || params.mediaType !== 'none' || params.isEditable) contexts.delete('page');
    const out = [];
    for (const [extId, items] of this.menus) {
      const ext = this.extension(extId);
      if (!ext) continue;
      const fits = (item) => item.visible !== false && (item.contexts || ['page']).some((c) => contexts.has(c));
      const build = (parentId) =>
        [...items.values()]
          .filter((item) => (item.parentId ?? null) === parentId && fits(item))
          .map((item) => {
            if (item.type === 'separator') return { type: 'separator' };
            const children = build(item.id);
            const label = String(item.title || '').replace(/%s/g, (params.selectionText || '').slice(0, 40));
            const entry = { label, enabled: item.enabled !== false };
            if (children.length) entry.submenu = children;
            else {
              if (item.type === 'checkbox' || item.type === 'radio') Object.assign(entry, { type: item.type, checked: Boolean(item.checked) });
              entry.click = () => {
                const info = {
                  menuItemId: item.id,
                  parentMenuItemId: item.parentId,
                  editable: Boolean(params.isEditable),
                  pageUrl: params.pageURL,
                  frameUrl: params.frameURL || undefined,
                  linkUrl: params.linkURL || undefined,
                  srcUrl: params.srcURL || undefined,
                  selectionText: params.selectionText || undefined,
                  mediaType: params.mediaType !== 'none' ? params.mediaType : undefined,
                };
                this.dispatch(extId, 'contextMenus.onClicked', info, this.tabInfo(ext, wc));
              };
            }
            return entry;
          });
      const top = build(null);
      if (top.length > 1) out.push({ label: ext.name, submenu: top });
      else out.push(...top);
    }
    return out;
  }
}

// ── The API, by method name. `this` is the host; args come from the extension. ──

const tabOptions = (args) => args[0] && typeof args[0] === 'object' ? args[0] : {};
const forTab = (state, tabId) => {
  if (tabId == null) return state;
  if (!state.tabs.has(Number(tabId))) state.tabs.set(Number(tabId), {});
  return state.tabs.get(Number(tabId));
};

const API = {
  // chrome.action / chrome.browserAction
  'action.setBadgeText'(ext, args) {
    const { text = '', tabId } = tabOptions(args);
    forTab(this.action(ext), tabId).text = String(text ?? '').slice(0, 8);
    this.emit('change');
  },
  'action.getBadgeText'(ext, args) {
    const a = this.action(ext);
    const { tabId } = tabOptions(args);
    return (tabId != null && a.tabs.get(Number(tabId))?.text) ?? a.text;
  },
  'action.setBadgeBackgroundColor'(ext, args) {
    const { color, tabId } = tabOptions(args);
    forTab(this.action(ext), tabId).color = color;
    this.emit('change');
  },
  'action.getBadgeBackgroundColor'(ext, args) {
    const a = this.action(ext);
    const { tabId } = tabOptions(args);
    const c = (tabId != null && a.tabs.get(Number(tabId))?.color) ?? a.color;
    return Array.isArray(c) ? c : [139, 123, 255, 255];
  },
  'action.setBadgeTextColor'() {},
  'action.getBadgeTextColor'() {
    return [255, 255, 255, 255];
  },
  'action.setTitle'(ext, args) {
    const { title = '', tabId } = tabOptions(args);
    forTab(this.action(ext), tabId).title = String(title);
    this.emit('change');
  },
  'action.getTitle'(ext, args) {
    const a = this.action(ext);
    const { tabId } = tabOptions(args);
    return (tabId != null && a.tabs.get(Number(tabId))?.title) ?? a.title;
  },
  // details: { path } (file or { size: file }) or { dataUrl } (made from imageData in the preload)
  'action.setIcon'(ext, args) {
    const { path: file, dataUrl, tabId } = tabOptions(args);
    let icon = null;
    if (dataUrl) icon = typeof dataUrl === 'string' ? dataUrl : Object.values(dataUrl).pop();
    else if (file) icon = this.iconFromManifest(ext, file);
    if (icon && /^data:image\//.test(icon)) forTab(this.action(ext), tabId).icon = icon;
    this.emit('change');
  },
  'action.setPopup'(ext, args) {
    const { popup = '', tabId } = tabOptions(args);
    forTab(this.action(ext), tabId).popup = String(popup);
  },
  'action.getPopup'(ext, args) {
    const a = this.action(ext);
    const { tabId } = tabOptions(args);
    const page = (tabId != null && a.tabs.get(Number(tabId))?.popup) ?? a.popup;
    return page ? `${ext.url}${page.replace(/^\//, '')}` : '';
  },
  'action.enable'(ext, args) {
    forTab(this.action(ext), args[0] ?? null).enabled = true;
    this.emit('change');
  },
  'action.disable'(ext, args) {
    forTab(this.action(ext), args[0] ?? null).enabled = false;
    this.emit('change');
  },
  'action.isEnabled'(ext, args) {
    const a = this.action(ext);
    return (args[0] != null && a.tabs.get(Number(args[0]))?.enabled) ?? a.enabled;
  },
  'action.openPopup'(ext) {
    const a = this.action(ext);
    if (a.popup) this.openPopup(ext, a.popup, null);
  },
  'action.getUserSettings'() {
    return { isOnToolbar: true };
  },

  // chrome.tabs (the parts Electron leaves to the browser)
  'tabs.query'(ext, args) {
    const q = tabOptions(args);
    return this.tabList()
      .map((wc) => this.tabInfo(ext, wc))
      .filter(
        (t) =>
          (q.active == null || t.active === q.active) &&
          (q.highlighted == null || t.highlighted === q.highlighted) &&
          (q.audible == null || t.audible === q.audible) &&
          (q.status == null || t.status === q.status) &&
          (q.windowId == null || q.windowId < 0 || t.windowId === q.windowId) &&
          (q.index == null || t.index === q.index) &&
          (!q.url || !t.url || [].concat(q.url).some((pattern) => matchPattern(pattern, t.url))) &&
          (!q.title || !t.title || new RegExp(`^${String(q.title).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(t.title)),
      )
      .sort((a, b) => a.index - b.index)
      .filter(() => q.currentWindow !== false && q.lastFocusedWindow !== false); // VRK has one browser window
  },
  'tabs.get'(ext, args) {
    const wc = this.findTab(args[0]);
    if (!wc) throw new Error(`No tab with id: ${args[0]}.`);
    return this.tabInfo(ext, wc);
  },
  'tabs.getCurrent'(ext, _args, sender) {
    const wc = sender && this.findTab(sender.id);
    return wc ? this.tabInfo(ext, wc) : undefined;
  },
  async 'tabs.create'(ext, args) {
    const { url, active } = tabOptions(args);
    const full = url && !/^[a-z][a-z0-9+.-]*:/i.test(url) ? `${ext.url}${String(url).replace(/^\//, '')}` : url;
    const [wc] = await this.hooks.createTab({ url: full || null, active: active !== false });
    return this.tabInfo(ext, wc);
  },
  'tabs.update'(ext, args) {
    const [first, second] = args;
    const wc = typeof first === 'number' ? this.findTab(first) : this.hooks.activeContents();
    const props = (typeof first === 'number' ? second : first) || {};
    if (!wc) throw new Error('No such tab.');
    if (props.url && /^(https?|chrome-extension):/i.test(props.url)) wc.loadURL(props.url);
    if (props.active || props.highlighted) this.hooks.selectTab(wc);
    if (typeof props.muted === 'boolean') wc.setAudioMuted(props.muted);
    return this.tabInfo(ext, wc);
  },
  'tabs.remove'(_ext, args) {
    for (const id of [].concat(args[0])) {
      const wc = this.findTab(id);
      if (wc) this.hooks.removeTab(wc);
    }
  },
  'tabs.highlight'(ext, args) {
    const { tabs } = tabOptions(args);
    const list = this.tabList();
    const wc = list[[].concat(tabs)[0]];
    if (wc) this.hooks.selectTab(wc);
    return API['windows.getCurrent'].call(this, ext, []);
  },

  // chrome.windows: VRK's main window
  'windows.getCurrent'(ext, args) {
    return windowInfo(this, ext, tabOptions(args).populate);
  },
  'windows.getLastFocused'(ext, args) {
    return windowInfo(this, ext, tabOptions(args).populate);
  },
  'windows.get'(ext, args) {
    return windowInfo(this, ext, args[1]?.populate);
  },
  'windows.getAll'(ext, args) {
    return [windowInfo(this, ext, tabOptions(args).populate)];
  },
  async 'windows.create'(ext, args) {
    const details = tabOptions(args);
    const urls = [].concat(details.url || []).map((u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `${ext.url}${String(u).replace(/^\//, '')}`));
    if (details.type === 'popup' || details.type === 'panel') {
      const win = await this.hooks.createWindow({ ...details, url: urls[0] });
      return { id: win.id, focused: true, top: 0, left: 0, width: details.width || 420, height: details.height || 640, incognito: false, type: 'popup', state: 'normal', alwaysOnTop: false, tabs: [] };
    }
    for (const url of urls) await this.hooks.createTab({ url, active: true });
    return windowInfo(this, ext, true);
  },
  'windows.update'(ext, args) {
    const props = args[1] || {};
    const win = BrowserWindow.fromId(Number(args[0]));
    if (win && props.focused) win.focus();
    if (win && props.state === 'minimized') win.minimize();
    return windowInfo(this, ext, false);
  },
  'windows.remove'(_ext, args) {
    const win = BrowserWindow.fromId(Number(args[0]));
    if (win && win !== this.hooks.window()) win.close(); // never VRK's own window
  },

  // chrome.contextMenus / chrome.menus
  'contextMenus.create'(ext, args) {
    const props = tabOptions(args);
    if (!this.menus.has(ext.id)) this.menus.set(ext.id, new Map());
    const items = this.menus.get(ext.id);
    const id = props.id ?? `vrk-${items.size + 1}-${Date.now()}`;
    items.set(id, { ...props, id });
    return id;
  },
  'contextMenus.update'(ext, args) {
    const item = this.menus.get(ext.id)?.get(args[0]);
    if (item) Object.assign(item, args[1] || {});
  },
  'contextMenus.remove'(ext, args) {
    this.menus.get(ext.id)?.delete(args[0]);
  },
  'contextMenus.removeAll'(ext) {
    this.menus.delete(ext.id);
  },

  // chrome.notifications
  'notifications.create'(ext, args) {
    const [first, second] = args;
    const id = typeof first === 'string' ? first : `vrk-${Date.now()}`;
    const options = (typeof first === 'string' ? second : first) || {};
    if (!Notification.isSupported()) return id;
    let icon;
    if (options.iconUrl && !/^(https?|data):/i.test(options.iconUrl)) {
      const file = path.normalize(path.join(ext.path, options.iconUrl.replace(/^\//, '')));
      if (file.startsWith(ext.path + path.sep)) icon = nativeImage.createFromPath(file);
    }
    const n = new Notification({ title: String(options.title || ext.name), body: String(options.message || ''), icon, silent: Boolean(options.silent) });
    n.on('click', () => this.dispatch(ext.id, 'notifications.onClicked', id));
    n.on('close', () => {
      this.notifications.delete(`${ext.id}:${id}`);
      this.dispatch(ext.id, 'notifications.onClosed', id, true);
    });
    this.notifications.get(`${ext.id}:${id}`)?.close();
    this.notifications.set(`${ext.id}:${id}`, n);
    n.show();
    return id;
  },
  'notifications.clear'(ext, args) {
    const n = this.notifications.get(`${ext.id}:${args[0]}`);
    n?.close();
    return Boolean(n);
  },
  'notifications.getAll'(ext) {
    return Object.fromEntries([...this.notifications.keys()].filter((k) => k.startsWith(`${ext.id}:`)).map((k) => [k.slice(ext.id.length + 1), true]));
  },

  // chrome.commands: VRK doesn't bind extension shortcuts (yet)
  'commands.getAll'() {
    return [];
  },
};

function windowInfo(host, ext, populate) {
  const win = host.hooks.window();
  const b = win.getBounds();
  return {
    id: win.id,
    focused: win.isFocused(),
    top: b.y,
    left: b.x,
    width: b.width,
    height: b.height,
    incognito: false,
    type: 'normal',
    state: win.isFullScreen() ? 'fullscreen' : win.isMaximized() ? 'maximized' : win.isMinimized() ? 'minimized' : 'normal',
    alwaysOnTop: false,
    ...(populate ? { tabs: host.tabList().map((wc) => host.tabInfo(ext, wc)) } : {}),
  };
}

// Chrome match patterns ("*://*.example.com/*", "<all_urls>").
function matchPattern(pattern, url) {
  if (pattern === '<all_urls>') return /^(https?|wss?|file|ftp):/.test(url);
  const m = /^(\*|https?|wss?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const [, scheme, host, rest] = m;
  if (scheme === '*' ? !/^(https?|wss?):$/.test(u.protocol) : u.protocol !== `${scheme}:`) return false;
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      if (u.hostname !== base && !u.hostname.endsWith(`.${base}`)) return false;
    } else if (u.hostname !== host) return false;
  }
  const re = new RegExp(`^${rest.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return re.test(u.pathname + u.search);
}

module.exports = { ExtensionHost, matchPattern };
