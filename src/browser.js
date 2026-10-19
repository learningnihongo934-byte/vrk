'use strict';
// VRK's window, tab strip and everything that drives web pages. The browser
// UI (src/ui) is the window's own page; each tab is a sandboxed
// WebContentsView laid over the area below the toolbar. Menus live in
// browser-menus.js and the UI/page bridges in browser-ipc.js.

const { app, BrowserWindow, WebContentsView, Menu, clipboard, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { parse: parseDomain } = require('tldts');
const { USER_AGENT, DEAD_PROXY, siteOf, originOf, parseURL, isLocalHost } = require('./shield');
const { Extensions } = require('./extensions');
const { isRisky } = require('./downloads');

const UI_DIR = path.join(__dirname, 'ui');
const UI_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const DEFAULT_CHROME_HEIGHT = 84;

const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
};
// DuckDuckGo's onion service, so Tor tab searches never leave the Tor network.
const TOR_SEARCH = 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/?q=%s';
const INTERNAL_TITLES = { settings: 'Settings', history: 'History', themes: 'Theme Editor', features: 'Features' };

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const BLOCKED_SCHEMES = /^(vrk|file|chrome|chrome-untrusted|devtools|view-source):/i;
const PROXY_ERRORS = new Set([-120, -121, -130, -111, -15]);

const CONTENT_PREFS = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: true, // runs VRK's page preload in iframes too (still sandboxed: no Node)
  nodeIntegrationInWorker: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  spellcheck: false,
  navigateOnDragDrop: false,
  safeDialogs: true,
};

// Lockdown mode also drops WebGL, a common exploit target (WebGPU is off in main.js).
const LOCKDOWN_PREFS = { webgl: false };

function resolveInput(text, searchUrl) {
  const input = String(text || '').trim().slice(0, 8192);
  if (!input) return null;
  if (/^vrk:\/\/[a-z]+\/?$/i.test(input)) return input.toLowerCase().replace(/\/$/, '');
  if (/^https?:\/\//i.test(input)) return input;
  if (/^about:blank$/i.test(input)) return 'about:blank';
  const hostMatch = !/\s/.test(input) && input.match(/^([^/?#:]+)(:\d+)?([/?#].*)?$/);
  if (hostMatch) {
    const host = hostMatch[1].toLowerCase();
    if (host.endsWith('.onion')) return `http://${input}`;
    if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return `${isLocalHost(host) ? 'http' : 'https'}://${input}`;
    }
    const info = parseDomain(host);
    if (info.domain && info.isIcann) return `https://${input}`;
  }
  return searchUrl.replace('%s', encodeURIComponent(input));
}

const hostOf = (url) => parseURL(url)?.hostname || '';
const internalPageOf = (url) => /^vrk:\/\/([a-z]+)/i.exec(url || '')?.[1]?.toLowerCase() || null;

class Browser {
  constructor({ shield, tor, vpn, settings, vault, bookmarks, importer, history, themes, updater = null, configDir, initialUrls = [] }) {
    Object.assign(this, { shield, tor, vpn, settings, vault, bookmarks, importer, history, themes, updater, configDir, initialUrls });
    this.closedTabs = []; // for Reopen Closed Tab (memory only)
    // The opening animation plays over the window; pages attach once it finishes.
    this.splashing = settings.get('showSplash') && !process.env.VRK_SELFTEST && !process.env.VRK_SHOTS;
    this.tabs = new Map();
    this.byContents = new Map(); // webContents id -> tab
    this.order = [];
    this.activeId = null;
    this.nextTabId = 1;
    this.chromeHeight = DEFAULT_CHROME_HEIGHT;
    this.attached = null;
    this.htmlFullscreen = false;
    this.permissions = new Map();
    this.nextPermissionId = 1;
    this.passwordOffers = new Map();
    this.nextOfferId = 1;
    this.usernameHints = new Map(); // webContents id -> username typed on an earlier sign-in step
    this.sessionOrigins = new Set(); // origins opened this session (memory only), to protect kept sign-ins' storage
    this.downloads = new Map();
    this.nextDownloadId = 1;
    this.favicons = new Map();
    this.networkChain = Promise.resolve();

    // The main profile is kept on disk (unless memory-only mode is on) so
    // sign-ins you choose to keep, and extensions, survive restarts.
    const memoryOnly = settings.launched.memoryOnly;
    this.normal = this.newProfile('normal', memoryOnly ? null : path.join(configDir, 'Profile'));
    this.torProfile = null; // created with the first Tor tab
    this.normalPrepared = false;
    this.locked = false;

    this.createWindow();
    this.setupAppLock();
    this.createSuggestView();
    this.registerIpc();
    themes.on('change', () => this.sendTheme());
    if (this.splashing) setTimeout(() => this.finishSplash(), 6000); // never let the animation block the browser
    this.extensions = new Extensions({
      session: this.normal.session,
      dir: path.join(configDir, 'Extensions'),
      metaFile: path.join(configDir, 'extensions.json'),
      fetchSession: shield.updateSession,
      uiSession: this.uiSession,
      hooks: {
        blockedSites: () => this.settings.get('extensionBlockedSites'),
        createTab: (details) => {
          const tab = this.createTab(details.url || null, { background: details.active === false });
          return [tab.wc, this.win];
        },
        selectTab: (wc) => !wc.isDestroyed() && this.byContents.has(wc.id) && this.activate(this.byContents.get(wc.id).id),
        // Called both when an extension closes a tab (page still alive: close it)
        // and while a page is being torn down (nothing left to do).
        removeTab: (wc) => !wc.isDestroyed() && this.byContents.has(wc.id) && this.closeTab(this.byContents.get(wc.id).id),
        confirmInstall: (details) => this.confirmExtensionInstall(details),
        // Normal tabs only: Tor and container tabs stay invisible to extensions.
        tabs: () => this.order.map((id) => this.tabs.get(id)).filter((t) => t && !t.tor && !t.container).map((t) => t.wc),
        activeContents: () => (this.activeTab && !this.activeTab.tor && !this.activeTab.container ? this.activeTab.wc : null),
        window: () => this.win,
        extensionMenu: (ext, rect) => this.showExtensionMenu(ext, rect),
      },
    });
    this.extensions.on('change', () => this.send('extensions-changed'));

    // A site in your history isn't flagged as a lookalike again.
    shield.isFamiliarSite = (site) => {
      for (const entry of this.history.byUrl.values()) if (siteOf(entry.url) === site) return true;
      return false;
    };
    shield.on('interception', ({ host, issuer }) => this.onInterception(host, issuer));
    updater?.on('change', () => this.send('update-status'));
    updater?.on('ready', ({ latest }) =>
      this.toast(`A security update is ready (Electron ${latest}). It installs when you quit VRK, or now:`, { label: 'Restart Now', restartToUpdate: true }),
    );
    shield.on('blocked', (contentsId) => {
      const tab = this.byContents.get(contentsId);
      if (tab) tab.blocked += 1;
      this.queueState();
    });
    shield.askPermission = (request) => this.askPermission(request);
    tor.on('change', () => this.applyNetwork());
    vpn.on('change', () => this.applyNetwork());
    vault.on('change', () => this.queueState());
    bookmarks.on('change', () => this.queueState());
    settings.on('change', (key) => this.onSettingChanged(key));
    this.applyNetwork();
    this.prepareNormalProfile();
  }

  get activeTab() {
    return this.tabs.get(this.activeId) || null;
  }

  get searchEngine() {
    return SEARCH_ENGINES[this.settings.get('searchEngine')] || SEARCH_ENGINES.google;
  }

  searchUrlFor(tor) {
    return tor ? TOR_SEARCH : this.searchEngine.url;
  }

  resolveText(text, tor) {
    return resolveInput(text, this.searchUrlFor(tor));
  }

  // Before anything loads: erase what the last session left behind (except
  // kept sign-ins), then load extensions so their content scripts are ready.
  async prepareNormalProfile() {
    try {
      if (this.normal.persistent && this.settings.get('clearOnQuit')) await this.clearNormalProfile();
    } catch (err) {
      console.error('VRK: startup cleanup failed', err);
    }
    try {
      await this.extensions.init();
      this.scheduleExtensionSafetyCheck();
      for (const tab of this.tabs.values()) if (!tab.tor && !tab.container) this.extensions.api.addTab(tab.wc);
      if (this.activeTab && !this.activeTab.tor && !this.activeTab.container) this.extensions.api.selectTab(this.activeTab.wc);
    } catch (err) {
      console.error('VRK: extensions failed to load', err);
    }
    this.normalPrepared = true;
    this.applyNetwork();
  }

  clearNormalProfile() {
    const keepSites = this.settings.get('keepSites');
    const extensionOrigins = this.normal.session.extensions.getAllExtensions().map((ext) => ext.url.replace(/\/$/, ''));
    const keptOrigins = [...this.sessionOrigins].filter((origin) => keepSites.includes(siteOf(origin)));
    return this.shield.clearSiteData(this.normal, { keepSites, keepOrigins: [...extensionOrigins, ...keptOrigins] });
  }

  // Called by main.js before quitting.
  async prepareQuit() {
    if (this.normal.persistent && this.settings.get('clearOnQuit')) {
      // Close pages first so nothing they're still loading can write after the wipe.
      for (const tab of [...this.tabs.values()]) if (!tab.tor) this.destroyTab(tab);
      await this.normal.session.closeAllConnections().catch(() => {});
      await Promise.allSettled([this.clearNormalProfile(), ...this.containerProfileList().filter((p) => p.persistent).map((p) => this.clearProfile(p))]);
    } else {
      await Promise.allSettled([this.normal, ...this.containerProfileList()].map((p) => p.session.cookies.flushStore()));
    }
  }

  onSettingChanged(key) {
    if (key === 'theme') this.win.setBackgroundColor(this.settings.get('theme') === 'light' ? '#f4f5f8' : '#0b0c10');
    if (key === 'torBridge') this.tor.setBridge(this.settings.get('torBridge'));
    if (key === 'torIsolateSites') this.tor.setIsolation(this.settings.get('torIsolateSites'));
    if (['themeId', 'theme', 'accent', 'density'].includes(key)) this.sendTheme();
    if (key === 'historyDays') this.history.prune(this.settings.get('historyDays'));
    if (key === 'extensionBlockedSites' && this.extensions.ready) this.extensions.enforceAllSiteAccess().catch(() => {});
    this.queueState();
  }

  // ── Window ──────────────────────────────────────────────────────────────

  createWindow() {
    const uiSession = session.fromPartition('vrk-ui');
    this.uiSession = uiSession;
    uiSession.setUserAgent(USER_AGENT);
    uiSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    uiSession.setPermissionCheckHandler(() => false);
    // The UI is served from the private vrk://ui origin (never file://) and
    // loads nothing else (extension icons and favicons arrive as
    // data: URLs).
    uiSession.protocol.handle('vrk', (request) => {
      const { host, pathname } = new URL(request.url);
      if (host === 'media') return this.serveMedia(request, decodeURIComponent(pathname.slice(1)));
      const file = path.normalize(path.join(UI_DIR, decodeURIComponent(pathname)));
      if (host !== 'ui' || !file.startsWith(UI_DIR + path.sep)) return new Response('Not found', { status: 404 });
      try {
        const type = UI_TYPES[path.extname(file)] || 'application/octet-stream';
        return new Response(fs.readFileSync(file), { headers: { 'content-type': type } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    uiSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: !/^(vrk|crx|devtools):/.test(details.url) });
    });

    const light = this.settings.get('theme') === 'light';
    this.win = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 600,
      minHeight: 400,
      show: false,
      title: 'VRK',
      backgroundColor: light ? '#f4f5f8' : '#0b0c10',
      titleBarStyle: 'hidden',
      // macOS: the traffic lights over the tab strip. Windows and Linux: their
      // minimize, maximize and close buttons drawn over the tab strip's right end.
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 14, y: 14 } }
        : { titleBarOverlay: { color: '#00000000', symbolColor: light ? '#30323a' : '#e9eaf0', height: 40 } }),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        session: uiSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.ui = this.win.webContents;
    this.ui.on('will-navigate', (event) => event.preventDefault());
    this.ui.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.ui.loadURL('vrk://ui/index.html');
    if (!process.env.VRK_SELFTEST && !process.env.VRK_SHOTS) this.win.once('ready-to-show', () => this.win.show());
    this.win.on('resize', () => this.layout());
    this.win.on('close', (event) => this.os?.handleBrowserClose(event)); // in VRKOS, closing hides it
    // Tab pages live in their own views, which don't close with the window.
    this.win.on('closed', () => {
      for (const tab of [...this.tabs.values()]) this.destroyTab(tab);
    });
    for (const event of ['enter-full-screen', 'leave-full-screen']) {
      this.win.on(event, () => {
        this.layout();
        this.queueState();
      });
    }
  }

  layout() {
    if (!this.attached || this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    const top = this.htmlFullscreen ? 0 : this.chromeHeight;
    const bounds = { x: 0, y: top, width, height: Math.max(0, height - top) };
    // Letterboxing, as in Tor Browser: Tor pages get a size rounded down to
    // steps of 200×100, so your exact window size can't help identify you.
    if (this.activeTab?.tor && this.activeTab.view === this.attached && !this.htmlFullscreen && bounds.width >= 200 && bounds.height >= 100) {
      const w = Math.floor(bounds.width / 200) * 200;
      const h = Math.floor(bounds.height / 100) * 100;
      Object.assign(bounds, { x: Math.floor((bounds.width - w) / 2), width: w, height: h });
    }
    this.attached.setBounds(bounds);
  }

  // Tor tabs report UTC and US English, like everyone else using Tor Browser.
  applyTorEmulation(wc) {
    try {
      wc.debugger.attach('1.3');
      wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: 'UTC' }).catch(() => {});
      wc.debugger.sendCommand('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => {});
    } catch {
      // Already attached (e.g. DevTools-driven tests): keep going without it.
    }
  }

  isPageShown(tab) {
    return !tab.isNewTab && !tab.internal && !tab.error && !tab.crashed && !tab.pendingUrl;
  }

  updateView() {
    if (this.win.isDestroyed()) return;
    const tab = this.activeTab;
    const wanted = tab && !this.splashing && !this.locked && this.isPageShown(tab) ? tab.view : null;
    if (this.attached && this.attached !== wanted) {
      this.win.contentView.removeChildView(this.attached);
      this.attached = null;
    }
    if (wanted && this.attached !== wanted) {
      this.win.contentView.addChildView(wanted);
      this.attached = wanted;
      if (this.suggestVisible) this.win.contentView.addChildView(this.suggestView); // keep suggestions on top
    }
    this.layout();
  }

  syncTitle() {
    if (this.win.isDestroyed()) return;
    const tab = this.activeTab;
    const title = this.locked ? null : tab?.internal ? INTERNAL_TITLES[tab.internal] : tab && !tab.isNewTab ? tab.title || hostOf(tab.url) : null;
    this.win.setTitle(title ? `${title} — VRK` : 'VRK');
  }

  // ── Profiles & network routing (Tor, VPN, kill switches) ─────────────────

  newProfile(kind, storagePath = null) {
    const profile = this.shield.createProfile(kind, { storagePath });
    profile.session.on('will-download', (_event, item, wc) => this.trackDownload(item, kind === 'tor', wc));
    return profile;
  }

  ensureTorProfile() {
    if (!this.torProfile) {
      this.torProfile = this.newProfile('tor');
      this.applyNetwork();
    }
    if (this.tor.state === 'off' || this.tor.state === 'error') this.tor.start();
    return this.torProfile;
  }

  vpnProxyRules() {
    if (this.vpn.state === 'off') return null;
    return this.vpn.state === 'on' ? `socks5://127.0.0.1:${this.vpn.socksPort}` : DEAD_PROXY;
  }

  networkPlan() {
    const vpnRules = this.vpnProxyRules();
    const vpnDown = this.vpn.state === 'connecting' || this.vpn.state === 'error';
    const plan = [
      {
        profile: this.normal,
        proxy: vpnRules ? { mode: 'fixed_servers', proxyRules: vpnRules } : { mode: 'direct' },
        // The VPN kill switch blocks every request while the VPN is connecting
        // or down; 'init' holds pages until last session's data is erased.
        gate: vpnDown ? 'vpn' : this.normalPrepared ? null : 'init',
      },
    ];
    for (const profile of this.containerProfileList()) {
      plan.push({
        profile,
        proxy: vpnRules ? { mode: 'fixed_servers', proxyRules: vpnRules } : { mode: 'direct' },
        gate: vpnDown ? 'vpn' : profile.prepared ? null : 'init',
      });
    }
    if (this.torProfile) {
      const ready = this.tor.state === 'ready';
      plan.push({
        profile: this.torProfile,
        proxy: {
          mode: 'fixed_servers',
          proxyRules: ready ? `socks5://127.0.0.1:${this.tor.socksPort}` : DEAD_PROXY,
          proxyBypassRules: '<-loopback>', // even localhost goes through Tor (which refuses it)
        },
        gate: ready ? null : 'tor',
      });
    }
    return plan;
  }

  applyNetwork() {
    // Close gates immediately when a connection becomes unsafe...
    for (const { profile, gate } of this.networkPlan()) if (gate) profile.gate = gate;
    // ...then reconfigure proxies one change at a time, reopening a gate only
    // once its session's proxy matches the current plan.
    this.networkChain = this.networkChain.then(() => this.applyNetworkNow()).catch((err) => console.error(err));
    this.queueState();
    return this.networkChain;
  }

  async applyNetworkNow() {
    for (const { profile } of this.networkPlan()) {
      const planned = () => this.networkPlan().find((entry) => entry.profile === profile);
      const target = planned();
      if (!target) continue;
      const key = JSON.stringify(target.proxy);
      if (profile.proxyKey !== key) {
        profile.gate ||= 'switching';
        await profile.session.setProxy(target.proxy);
        await profile.session.closeAllConnections(); // drop sockets opened under the old route
        profile.proxyKey = key;
      }
      const latest = planned();
      if (latest && JSON.stringify(latest.proxy) === key && profile.gate !== 'destroyed') profile.gate = latest.gate;
    }
    const vpnRules = this.vpnProxyRules();
    await this.shield.updateSession.setProxy(vpnRules ? { mode: 'fixed_servers', proxyRules: vpnRules } : { mode: 'direct' });
    this.tor.setUpstreamProxy(vpnRules ? vpnRules.replace('socks5://', '') : null);
    this.flushPending();
    this.queueState();
  }

  flushPending() {
    for (const tab of this.tabs.values()) {
      if (tab.pendingUrl && !tab.profile.gate) this.loadInTab(tab, tab.pendingUrl);
    }
  }

  // ── Tabs ────────────────────────────────────────────────────────────────

  createTab(url = null, { background = false, after = null, tor = false, container = null } = {}) {
    if (this.win.isDestroyed()) return null;
    if (tor && !this.tor.available) {
      this.toast('Tor is not bundled with this build. Run “npm run fetch-binaries”.');
      tor = false;
      if (!url) return null;
    }
    const profile = tor ? this.ensureTorProfile() : (container && this.containerProfile(container)) || this.normal;
    const view = new WebContentsView({ webPreferences: { ...CONTENT_PREFS, ...(this.settings.launched.lockdown ? LOCKDOWN_PREFS : {}), session: profile.session } });
    view.setBackgroundColor('#ffffff');
    const tab = {
      id: this.nextTabId++,
      view,
      wc: view.webContents,
      profile,
      tor,
      container: profile.container || null,
      title: '',
      url: '',
      internal: null,
      favicon: null,
      faviconUrl: null,
      loading: false,
      loadPhase: 'idle',
      blocked: 0,
      error: null,
      crashed: false,
      isNewTab: true,
      pendingUrl: null,
      audible: false,
      zoom: 1,
    };
    this.tabs.set(tab.id, tab);
    this.byContents.set(tab.wc.id, tab);
    const at = after == null ? -1 : this.order.indexOf(after);
    if (at >= 0) this.order.splice(at + 1, 0, tab.id);
    else this.order.push(tab.id);
    this.wireTab(tab);
    if (tor) this.applyTorEmulation(tab.wc);
    if (!tor && !tab.container && this.extensions.ready) this.extensions.api.addTab(tab.wc);
    if (url) this.loadInTab(tab, url);
    if (background) this.queueState();
    else this.activate(tab.id);
    return tab;
  }

  setLoadPhase(tab, phase) {
    tab.loadPhase = phase;
    this.queueState();
  }

  wireTab(tab) {
    const { wc } = tab;
    wc.once('destroyed', () => {
      if (this.tabs.get(tab.id) !== tab) return; // already closed through closeTab/destroyTab
      this.tabs.delete(tab.id);
      this.byContents.delete(tab.wc.id);
      this.order = this.order.filter((id) => id !== tab.id);
      if (this.attached === tab.view) this.attached = null;
      if (this.activeId === tab.id) this.activeId = null;
      this.queueState();
    });
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    wc.setWindowOpenHandler((details) => this.onWindowOpen(tab, details));
    wc.on('did-create-window', (win) => this.hardenPopup(win, tab));
    wc.on('page-title-updated', (_event, title) => {
      tab.title = title;
      if (tab.historyId) this.history.setTitle(tab.historyId, title);
      if (tab.id === this.activeId) this.syncTitle();
      this.queueState();
    });
    wc.on('page-favicon-updated', (_event, icons) => this.setFavicon(tab, icons));
    wc.on('did-start-loading', () => {
      tab.loading = true;
      this.setLoadPhase(tab, 'start');
    });
    wc.on('dom-ready', () => this.setLoadPhase(tab, 'dom'));
    wc.on('did-stop-loading', () => {
      tab.loading = false;
      this.setLoadPhase(tab, 'done');
    });
    wc.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument) tab.blocked = 0;
    });
    wc.on('did-navigate', (_event, url) => this.onCommitted(tab, url));
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      tab.url = url;
      this.recordVisit(tab, url);
      this.queueState();
    });
    wc.on('did-fail-load', (_event, code, name, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.onLoadFailed(tab, code, name, url);
    });
    wc.on('render-process-gone', (_event, { reason }) => {
      if (reason === 'clean-exit') return;
      tab.crashed = true;
      tab.loading = false;
      this.updateView();
      this.queueState();
    });
    wc.on('audio-state-changed', (event) => {
      tab.audible = event.audible;
      this.queueState();
    });
    wc.on('found-in-page', (_event, result) => {
      if (tab.id === this.activeId) this.send('find-result', { active: result.activeMatchOrdinal, total: result.matches });
    });
    wc.on('enter-html-full-screen', () => this.setHtmlFullscreen(true));
    wc.on('leave-html-full-screen', () => this.setHtmlFullscreen(false));
    wc.on('context-menu', (_event, params) => this.showContextMenu(tab, params));
    wc.on('zoom-changed', (_event, direction) => this.zoom(direction === 'in' ? 1 : -1, tab));
    wc.on('select-bluetooth-device', (event, _devices, callback) => {
      event.preventDefault();
      callback('');
    });
  }

  onCommitted(tab, url) {
    this.shield.navigationCommitted(tab.wc.id);
    const leftSite = siteOf(tab.url);
    if (leftSite && leftSite !== siteOf(url)) this.siteLeft(tab.profile, leftSite);
    // Chromium commits its own error page after a failure; keep VRK's error panel up.
    if (tab.error && tab.error.url === url && Date.now() - tab.error.at < 1500) return;
    Object.assign(tab, { url, error: null, crashed: false, isNewTab: false, internal: null, favicon: null, faviconUrl: null, retriedUrl: null });
    const origin = originOf(url);
    if (!tab.tor && origin) this.sessionOrigins.add(origin);
    this.recordVisit(tab, url);
    this.setLoadPhase(tab, 'commit');
    if (tab.id === this.activeId) this.updateView();
    this.offerStoreInstall(tab, url);
  }

  onLoadFailed(tab, code, name, url) {
    if (code === -20 && tab.profile.gate) {
      // Blocked by a kill switch: retry automatically once the connection is back.
      tab.pendingUrl = url;
      tab.loading = false;
      if (tab.id === this.activeId) this.updateView();
      return this.queueState();
    }
    if (tab.tor && (code === -7 || code === -118) && tab.retriedUrl !== url) {
      // Building a fresh Tor circuit (especially to an onion service) can outlast
      // Chromium's connect timeout; the second attempt reuses the finished circuit.
      tab.retriedUrl = url;
      tab.wc.loadURL(url).catch(() => {});
      return;
    }
    const threat = this.shield.takeThreat(tab.wc.id, url);
    if (threat) {
      const host = hostOf(url);
      tab.error =
        threat.kind === 'lookalike'
          ? {
              title: `This isn’t ${threat.target}`,
              desc: `${host} looks like ${threat.target}, but it’s a different site. Sites like this are often set up to steal passwords. If you meant ${threat.target}, go there instead.`,
            }
          : threat.kind === 'phishing'
          ? {
              title: 'Deceptive site ahead',
              desc: `${host} is a known phishing site. It may try to trick you into giving away passwords, card numbers or other personal information.`,
            }
          : {
              title: 'Dangerous site ahead',
              desc: `${host} is known to spread malware. It may try to install software that steals your information or damages your Mac.`,
            };
      const names = { phishing: 'PHISHING_SITE_BLOCKED', malware: 'MALWARE_SITE_BLOCKED', lookalike: 'LOOKALIKE_DOMAIN' };
      Object.assign(tab.error, { code, name: names[threat.kind], url, danger: threat.kind, target: threat.target || null, at: Date.now() });
      Object.assign(tab, { url, loading: false, loadPhase: 'done', isNewTab: false });
      if (tab.id === this.activeId) this.updateView();
      return this.queueState();
    }
    const upgrade = this.shield.takePendingUpgrade(tab.wc.id, url, code);
    const { title, desc } = upgrade
      ? { title: "This site doesn't support HTTPS", desc: '' } // the UI explains the choice
      : this.describeError(tab, code, url);
    tab.error = { code, name, url, title, desc, insecureUrl: upgrade?.httpUrl || null, at: Date.now() };
    Object.assign(tab, { url, loading: false, loadPhase: 'done', isNewTab: false });
    if (tab.id === this.activeId) this.updateView();
    this.queueState();
  }

  describeError(tab, code, url) {
    const host = hostOf(url);
    if (code <= -200 && code > -300) {
      return {
        title: 'Connection not secure',
        desc: `${host}'s security certificate isn't valid, so VRK refused to connect. Someone could be impersonating it.`,
      };
    }
    if (PROXY_ERRORS.has(code) && tab.tor) {
      return host.endsWith('.onion')
        ? { title: 'Onion site unreachable', desc: `The onion service ${host} may be offline, or its address is mistyped.` }
        : { title: "Tor couldn't reach this site", desc: `The Tor exit relay couldn't connect to ${host}. Try again or use New Tor Identity.` };
    }
    if (PROXY_ERRORS.has(code) && this.vpn.state === 'on') {
      return { title: "VPN couldn't reach this site", desc: `The VPN server couldn't connect to ${host}.` };
    }
    switch (code) {
      case -105:
      case -137:
        return { title: "This site can't be found", desc: `VRK couldn't find ${host}. Check the spelling.` };
      case -106:
        return { title: "You're offline", desc: 'Check your internet connection and try again.' };
      case -102:
        return { title: 'Connection refused', desc: `${host} refused the connection.` };
      case -7:
      case -118:
        return { title: 'Connection timed out', desc: `${host} took too long to respond.` };
      case -310:
        return { title: 'Too many redirects', desc: `${host} redirected too many times.` };
      default:
        return { title: "This page couldn't load", desc: `Something went wrong while loading ${host || 'this page'}.` };
    }
  }

  loadInTab(tab, url) {
    const internal = internalPageOf(url);
    if (internal) {
      const page = INTERNAL_TITLES[internal] ? internal : 'settings';
      Object.assign(tab, { error: null, crashed: false, isNewTab: false, pendingUrl: null, loading: false, internal: page, url: `vrk://${page}`, title: INTERNAL_TITLES[page] });
      if (tab.id === this.activeId) {
        this.updateView();
        this.syncTitle();
      }
      return this.queueState();
    }
    Object.assign(tab, { error: null, crashed: false, isNewTab: false, internal: null, url });
    if (tab.profile.gate) {
      // Tor still connecting, the VPN kill switch engaged, or startup cleanup running: hold the navigation.
      tab.pendingUrl = url;
      tab.loading = false;
      if (tab.tor) this.ensureTorProfile();
    } else {
      tab.pendingUrl = null;
      tab.loading = true;
      tab.wc.loadURL(url).catch(() => {}); // failures surface through did-fail-load
    }
    if (tab.id === this.activeId) {
      this.updateView();
      if (this.isPageShown(tab)) tab.wc.focus();
    }
    this.queueState();
  }

  activate(id) {
    const tab = this.tabs.get(Number(id));
    if (!tab || this.win.isDestroyed()) return;
    const previous = this.activeTab;
    if (previous && previous !== tab && !previous.wc.isDestroyed()) previous.wc.stopFindInPage('clearSelection');
    if (previous !== tab) this.hideSuggestions();
    this.activeId = tab.id;
    this.updateView();
    this.syncTitle();
    if (!tab.tor && !tab.container && this.extensions.ready) this.extensions.api.selectTab(tab.wc);
    if (this.isPageShown(tab)) tab.wc.focus();
    else if (tab.isNewTab) this.focusAddress({ newTab: true });
    else this.ui.focus(); // VRK pages and error pages: no need to grab the address bar
    this.queueState();
  }

  closeTab(id) {
    const tab = this.tabs.get(Number(id));
    if (!tab || this.win.isDestroyed()) return;
    const index = this.order.indexOf(tab.id);
    if (/^https?:/.test(tab.url) && !tab.internal) {
      this.closedTabs.push({ url: tab.url, tor: tab.tor, container: tab.container, index });
      if (this.closedTabs.length > 25) this.closedTabs.shift();
    }
    this.destroyTab(tab);
    if (/^https?:/.test(tab.url)) this.siteLeft(tab.profile, siteOf(tab.url));
    if (!this.order.length) {
      this.win.close(); // closing the last tab quits VRK, which erases browsing data
      return;
    }
    if (this.activeId === null) this.activate(this.order[Math.min(index, this.order.length - 1)]);
    else this.queueState();
  }

  destroyTab(tab) {
    this.tabs.delete(tab.id);
    this.byContents.delete(tab.wc.id);
    this.order = this.order.filter((id) => id !== tab.id);
    if (this.attached === tab.view) {
      if (!this.win.isDestroyed()) this.win.contentView.removeChildView(tab.view);
      this.attached = null;
    }
    if (this.activeId === tab.id) this.activeId = null;
    this.shield.navigationCommitted(tab.wc.id);
    for (const [id, request] of this.permissions) if (request.tabId === tab.id) this.resolvePermission(id, false);
    for (const [id, offer] of this.passwordOffers) if (offer.tabId === tab.id) this.passwordOffers.delete(id);
    if (!tab.wc.isDestroyed()) tab.wc.close();
  }

  selectTab(index) {
    const id = index < 0 ? this.order[this.order.length - 1] : this.order[index];
    if (id) this.activate(id);
  }

  cycleTab(delta) {
    if (this.order.length < 2) return;
    const i = this.order.indexOf(this.activeId);
    this.activate(this.order[(i + delta + this.order.length) % this.order.length]);
  }

  navigate(text) {
    let tab = this.activeTab;
    if (!tab) tab = this.createTab();
    const url = resolveInput(text, this.searchUrlFor(tab.tor));
    if (!url) return;
    if (internalPageOf(url) && tab.tor) return this.openSettings(); // settings always open in a normal tab
    this.loadInTab(tab, url);
  }

  openSettings(section = null) {
    const existing = [...this.tabs.values()].find((t) => t.internal === 'settings');
    const tab = existing || this.createTab('vrk://settings');
    this.activate(tab.id);
    if (section) this.send('settings-section', section);
  }

  back() {
    const tab = this.activeTab;
    if (tab?.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack();
  }

  forward() {
    const tab = this.activeTab;
    if (tab?.wc.navigationHistory.canGoForward()) tab.wc.navigationHistory.goForward();
  }

  reload(force = false) {
    const tab = this.activeTab;
    if (!tab || tab.isNewTab || tab.internal) return;
    if (tab.error || tab.crashed || tab.pendingUrl) return this.retry();
    if (force) tab.wc.reloadIgnoringCache();
    else tab.wc.reload();
  }

  stop() {
    this.activeTab?.wc.stop();
  }

  retry() {
    const tab = this.activeTab;
    if (tab) this.loadInTab(tab, tab.pendingUrl || tab.error?.url || tab.url);
  }

  // The dangerous-site warning's “Back to safety”.
  leaveDangerousSite() {
    const tab = this.activeTab;
    if (!tab?.error?.danger) return;
    const { target } = tab.error;
    tab.error = null;
    if (target) return this.loadInTab(tab, `https://${target}/`); // a lookalike: go to the real site
    if (tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack();
    else Object.assign(tab, { isNewTab: true, url: '', title: '' });
    this.updateView();
    if (tab.isNewTab) this.focusAddress({ newTab: true });
    this.queueState();
  }

  // “Visit this site anyway”: allowed for this host until VRK quits (or Burn).
  visitDangerousSite() {
    const tab = this.activeTab;
    const url = tab?.error?.danger && tab.error.url;
    if (!url) return;
    tab.profile.dangerAllowed.add(hostOf(url));
    this.loadInTab(tab, url);
  }

  loadInsecure() {
    const tab = this.activeTab;
    const url = tab?.error?.insecureUrl;
    if (!url) return;
    tab.profile.httpAllowed.add(siteOf(url)); // for this session, and only this site
    this.loadInTab(tab, url);
  }

  toggleMute(id) {
    const tab = this.tabs.get(Number(id));
    if (!tab) return;
    tab.wc.setAudioMuted(!tab.wc.isAudioMuted());
    this.queueState();
  }

  zoom(direction, tab = this.activeTab) {
    if (!tab || tab.wc.isDestroyed()) return;
    const current = tab.wc.getZoomFactor();
    let next = 1;
    if (direction > 0) next = ZOOM_STEPS.find((z) => z > current + 0.001) ?? 5;
    if (direction < 0) next = [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? 0.25;
    tab.wc.setZoomFactor(next);
    tab.zoom = next;
    this.queueState();
  }

  print() {
    const tab = this.activeTab;
    if (tab && this.isPageShown(tab)) tab.wc.print();
  }

  toggleDevTools() {
    const tab = this.activeTab;
    if (!tab || !this.isPageShown(tab)) return;
    if (tab.wc.isDevToolsOpened()) tab.wc.closeDevTools();
    else tab.wc.openDevTools({ mode: 'detach' });
  }

  setHtmlFullscreen(on) {
    this.htmlFullscreen = on;
    if (on && !this.win.isFullScreen()) {
      this.fullscreenByPage = true;
      this.win.setFullScreen(true);
    }
    if (!on && this.fullscreenByPage) {
      this.fullscreenByPage = false;
      if (this.win.isFullScreen()) this.win.setFullScreen(false);
    }
    this.layout();
    this.queueState();
  }

  async setFavicon(tab, icons) {
    const url = icons.find((icon) => /^(https?:|data:image\/)/.test(icon));
    if (!url || url === tab.faviconUrl) return;
    tab.faviconUrl = url;
    if (url.startsWith('data:')) {
      tab.favicon = url;
      return this.queueState();
    }
    // Fetched through the tab's own session, so Tor tab favicons go over Tor and VPN tabs over the VPN.
    const key = `${tab.profile.kind}|${url}`;
    let dataUrl = this.favicons.get(key);
    if (!dataUrl) {
      try {
        const res = await tab.profile.session.fetch(url);
        const type = (res.headers.get('content-type') || '').split(';')[0];
        const body = Buffer.from(await res.arrayBuffer());
        if (!res.ok || !type.startsWith('image/') || body.length > 256 * 1024) return;
        dataUrl = `data:${type};base64,${body.toString('base64')}`;
        if (this.favicons.size > 300) this.favicons.delete(this.favicons.keys().next().value);
        this.favicons.set(key, dataUrl);
      } catch {
        return;
      }
    }
    if (tab.faviconUrl === url && this.tabs.has(tab.id)) {
      tab.favicon = dataUrl;
      this.queueState();
    }
  }

  // ── Popups, links and context menus ─────────────────────────────────────

  onWindowOpen(tab, { url, disposition }) {
    if (BLOCKED_SCHEMES.test(url)) return { action: 'deny' };
    if (disposition === 'new-window' || url === 'about:blank') {
      // Real popups (sign-in windows and the like) keep their opener and their tab's session.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { backgroundColor: '#ffffff', autoHideMenuBar: true, webPreferences: { ...CONTENT_PREFS } },
      };
    }
    this.createTab(url, { background: disposition === 'background-tab', after: tab.id, tor: tab.tor, container: tab.container });
    return { action: 'deny' };
  }

  hardenPopup(win, opener) {
    const { webContents: wc } = win;
    if (wc.session !== opener.wc.session) {
      win.destroy(); // never let a popup escape its tab's profile (e.g. out of Tor)
      return;
    }
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    wc.setWindowOpenHandler(({ url }) => {
      if (!BLOCKED_SCHEMES.test(url)) this.createTab(url, { tor: opener.tor, container: opener.container });
      return { action: 'deny' };
    });
    wc.on('context-menu', (_event, params) => this.showContextMenu({ id: null, wc, tor: opener.tor, container: opener.container }, params));
    if (!opener.tor && !opener.container && this.extensions.ready) this.extensions.api.addTab(wc);
  }

  showContextMenu(target, p) {
    const { wc } = target;
    const items = [];
    const sep = { type: 'separator' };
    const openInTab = (url, tor = target.tor, container = target.container) => this.createTab(url, { background: true, after: target.id, tor, container });
    if (p.linkURL && !BLOCKED_SCHEMES.test(p.linkURL)) {
      items.push({ label: target.tor ? 'Open Link in New Tor Tab' : 'Open Link in New Tab', click: () => openInTab(p.linkURL) });
      if (!target.tor && this.tor.available) items.push({ label: 'Open Link in New Tor Tab', click: () => openInTab(p.linkURL, true) });
      if (!target.tor && this.containers().length) {
        items.push({
          label: 'Open Link in Container',
          submenu: [
            target.container && { label: 'No Container', click: () => openInTab(p.linkURL, false, null) },
            ...this.containerMenuItems((container) => openInTab(p.linkURL, false, container)),
          ].filter(Boolean),
        });
      }
      items.push({ label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) }, sep);
    }
    if (p.mediaType === 'image' && p.srcURL && !p.srcURL.startsWith('data:')) {
      items.push(
        { label: 'Open Image in New Tab', click: () => openInTab(p.srcURL) },
        { label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) },
        sep,
      );
    }
    const selection = p.selectionText.trim();
    if (p.isEditable) {
      items.push(
        { label: 'Undo', enabled: p.editFlags.canUndo, click: () => wc.undo() },
        { label: 'Redo', enabled: p.editFlags.canRedo, click: () => wc.redo() },
        sep,
        { label: 'Cut', enabled: p.editFlags.canCut, click: () => wc.cut() },
        { label: 'Copy', enabled: p.editFlags.canCopy, click: () => wc.copy() },
        { label: 'Paste', enabled: p.editFlags.canPaste, click: () => wc.paste() },
        { label: 'Select All', click: () => wc.selectAll() },
        sep,
      );
    } else if (selection) {
      const short = selection.length > 28 ? `${selection.slice(0, 28)}…` : selection;
      items.push(
        { label: 'Copy', click: () => wc.copy() },
        { label: `Search for “${short}”`, click: () => openInTab(this.searchUrlFor(target.tor).replace('%s', encodeURIComponent(selection))) },
        sep,
      );
    }
    if (!items.length) {
      const history = wc.navigationHistory;
      items.push(
        { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
        { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
        { label: 'Reload', click: () => wc.reload() },
        sep,
      );
    }
    if (!target.tor && !target.container && this.extensions.ready) {
      const extensionItems = this.extensions.api.contextMenuItems(wc, p);
      if (extensionItems.length) items.push(...extensionItems, sep);
    }
    items.push({ label: 'Inspect Element', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) || this.win });
  }

  // ── Find in page ─────────────────────────────────────────────────────────

  openFind() {
    const tab = this.activeTab;
    if (!tab || !this.isPageShown(tab)) return;
    this.ui.focus();
    this.send('find-open');
  }

  findNext(forward) {
    if (this.activeTab && this.isPageShown(this.activeTab)) {
      this.ui.focus();
      this.send('find-next', forward);
    }
  }

  find(text, forward, isNewSearch) {
    const tab = this.activeTab;
    if (!tab || !this.isPageShown(tab)) return;
    if (!text) return tab.wc.stopFindInPage('clearSelection');
    tab.wc.findInPage(String(text).slice(0, 1000), { forward, findNext: isNewSearch });
  }

  // ── Burn, Tor identity, VPN actions ──────────────────────────────────────

  async burn() {
    if (this.burning) return;
    this.burning = true;
    for (const tab of [...this.tabs.values()]) this.destroyTab(tab);
    for (const win of BrowserWindow.getAllWindows()) if (win !== this.win) win.destroy();
    for (const id of [...this.permissions.keys()]) this.resolvePermission(id, false);
    this.passwordOffers.clear();
    this.downloads.clear();
    this.closedTabs = [];
    this.hideSuggestions();
    this.history.clear(); // history is browsing data too
    this.fingerprintKey = null; // sites see a new fingerprint from now on
    this.normal.dangerAllowed.clear();
    this.favicons.clear();
    const oldTor = this.torProfile;
    this.torProfile = null;
    for (const profile of [this.normal, ...this.containerProfileList()]) {
      profile.grants.clear();
      profile.httpAllowed.clear();
      profile.dangerAllowed.clear();
    }
    // Pages are closed and their connections dropped first, so no late response can set a cookie after the wipe.
    await Promise.allSettled([this.normal, ...this.containerProfileList()].map((p) => p.session.closeAllConnections()));
    await Promise.allSettled([this.clearNormalProfile(), ...this.containerProfileList().map((p) => this.clearProfile(p)), oldTor && this.shield.destroyProfile(oldTor)]);
    this.shield.resetSessionState();
    // Forget every origin except those of sites you stay signed in to.
    const keepSites = this.settings.get('keepSites');
    for (const origin of this.sessionOrigins) if (!keepSites.includes(siteOf(origin))) this.sessionOrigins.delete(origin);
    this.tor.newIdentity().catch(() => {});
    this.burning = false;
    this.createTab();
    this.send('burned', { kept: this.settings.get('keepSites').length });
  }

  async newTorIdentity() {
    if (!this.tor.available) return;
    const activeWasTor = this.activeTab?.tor ?? true;
    for (const tab of [...this.tabs.values()]) if (tab.tor) this.destroyTab(tab);
    const old = this.torProfile;
    this.torProfile = null;
    if (old) {
      for (const win of BrowserWindow.getAllWindows()) if (win !== this.win && win.webContents.session === old.session) win.destroy();
      await this.shield.destroyProfile(old);
    }
    await this.tor.newIdentity().catch(() => {});
    this.torFingerprintKey = null;
    this.createTab(null, { tor: true, background: !activeWasTor });
    this.toast('New Tor identity: fresh circuits, and all Tor tab data erased.');
  }

  setTorBridge(bridge) {
    this.settings.set('torBridge', bridge);
    this.tor.setBridge(bridge);
  }

  async vpnConnect(id) {
    this.settings.set('vpnOn', true);
    await this.vpn.connect(id).catch((err) => this.toast(err.message));
  }

  async vpnDisconnect() {
    this.settings.set('vpnOn', false);
    await this.vpn.disconnect();
  }

  trackDownload(item, viaTor, wc = null) {
    const id = this.nextDownloadId++;
    const url = item.getURL();
    let referrer = '';
    try {
      referrer = wc && !wc.isDestroyed() ? wc.getURL() : '';
    } catch {}
    const host = hostOf(url);
    // Installers and scripts only over an encrypted connection, so nobody can swap them on the way.
    if (this.settings.get('downloadProtection') && isRisky(item.getFilename()) && url.startsWith('http:') && !isLocalHost(host)) {
      item.cancel();
      this.toast(`Blocked ${item.getFilename()}: installers and scripts are only downloaded over a secure (HTTPS) connection.`);
      return;
    }
    if (!this.settings.get('downloadsAsk')) {
      // Save straight to ~/Downloads without overwriting anything.
      const dir = app.getPath('downloads');
      const { name, ext } = path.parse(item.getFilename());
      let file = path.join(dir, `${name}${ext}`);
      for (let n = 1; fs.existsSync(file); n += 1) file = path.join(dir, `${name} (${n})${ext}`);
      item.setSavePath(file);
    }
    this.toast(`Downloading ${item.getFilename()}…`);
    item.once('done', async (_event, state) => {
      if (state === 'completed') {
        const file = item.getSavePath();
        const verdict = await this.protectDownload(file, { url, referrer });
        if (verdict.malware) return;
        this.downloads.set(id, file);
        const notes = [
          verdict.risky && `It can run programs on your Mac, so open it only if you trust ${host || 'where it came from'}; macOS checks it first.`,
          viaTor && 'Files from Tor tabs can reveal your IP when opened.',
        ].filter(Boolean);
        this.toast(`Downloaded ${path.basename(file)}.${notes.length ? ` ${notes.join(' ')}` : ''}`, { label: 'Show in Finder', download: id });
      } else if (state === 'interrupted') {
        this.toast(`Download failed: ${item.getFilename()}`);
      }
    });
  }

  // ── State for the UI ─────────────────────────────────────────────────────

  focusAddress({ newTab = false } = {}) {
    this.ui.focus();
    this.send('focus-address', { newTab });
  }

  toast(text, action = null, { danger = false } = {}) {
    this.send('toast', { text, action, danger });
  }

  send(channel, payload) {
    if (!this.ui.isDestroyed()) this.ui.send(`vrk:${channel}`, payload);
  }

  queueState() {
    if (this.stateQueued) return;
    this.stateQueued = true;
    setTimeout(() => {
      this.stateQueued = false;
      if (!this.win.isDestroyed()) this.send('state', this.snapshot());
    }, 16);
  }

  snapshot() {
    const { tor, vpn, settings } = this;
    const active = this.activeTab;
    const barNodes = this.bookmarks.data.bar.map((n) => ({ id: n.id, title: n.title, url: n.url || null, icon: n.icon || null, folder: Boolean(n.children) }));
    return {
      activeId: this.activeId,
      fullscreen: this.win.isFullScreen(),
      totalBlocked: this.shield.totalBlocked,
      chromium: process.versions.chrome,
      searchName: this.searchEngine.name,
      searchEngine: this.settings.get('searchEngine'),
      platform: process.platform,
      ui: Object.fromEntries(
        ['theme', 'accent', 'density', 'ntpBackground', 'ntpShowStats', 'ntpShowBookmarks', 'bookmarksBar', 'showVpnButton', 'showTorButton', 'showBurnButton', 'clearOnQuit'].map((k) => [k, settings.get(k)]),
      ),
      bookmarksBar: barNodes,
      bookmarked: Boolean(active && !active.isNewTab && !active.internal && this.bookmarks.findByUrl(active.url)),
      keptSite: Boolean(active && settings.get('keepSites').includes(siteOf(active.url))),
      extensionsReady: this.extensions.ready,
      history: { on: settings.get('saveHistory'), count: this.history.count, persistent: this.history.persistent },
      mode: settings.mode(),
      splash: this.splashing,
      themeId: settings.get('themeId'),
      canReopen: this.closedTabs.length > 0,
      locked: this.locked,
      tor: { available: tor.available, state: tor.state, progress: tor.progress, summary: tor.summary, error: tor.lastError, bridge: tor.bridge },
      vpn: { available: vpn.available, state: vpn.state, name: vpn.active?.name || null, error: vpn.lastError, hasConfigs: vpn.configs.length > 0 },
      tabs: this.order.map((id) => this.tabs.get(id)).filter((tab) => tab && !tab.wc.isDestroyed()).map((tab) => this.tabState(tab)),
    };
  }

  tabState(tab) {
    const history = tab.wc.navigationHistory;
    return {
      id: tab.id,
      contentsId: tab.wc.id,
      tor: tab.tor,
      container: tab.container ? this.containerInfo(tab.container) : null,
      title: tab.title,
      url: tab.pendingUrl || tab.url,
      internal: tab.internal,
      favicon: tab.favicon,
      loading: tab.loading,
      loadPhase: tab.loadPhase,
      blocked: tab.blocked,
      isNewTab: tab.isNewTab,
      error: tab.error && { title: tab.error.title, desc: tab.error.desc, name: tab.error.name, insecureUrl: tab.error.insecureUrl, danger: tab.error.danger || null, target: tab.error.target || null },
      crashed: tab.crashed,
      waiting: tab.pendingUrl ? tab.profile.gate || 'init' : null,
      audible: tab.audible,
      muted: tab.wc.isAudioMuted(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      zoom: tab.zoom,
      shieldsUp: !this.shield.isSiteShieldsDown(tab.url),
    };
  }

  shutdown() {
    this.tor.shutdown();
    this.vpn.shutdown();
  }
}

Object.assign(Browser.prototype, require('./browser-menus'), require('./browser-ipc'), require('./browser-features'), require('./browser-security'), require('./browser-containers'));

module.exports = { Browser, resolveInput, SEARCH_ENGINES, hostOf };
