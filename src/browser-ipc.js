'use strict';
// IPC between VRK's main process, its browser UI, and web pages (mixed into
// Browser). The UI may drive everything; web pages may only use the password
// manager channels, and only for their own origin.

const { app, clipboard, dialog, ipcMain, shell, systemPreferences } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const { siteOf, originOf, parseURL, isLocalHost } = require('./shield');
const { Extensions } = require('./extensions');
const { totpCode } = require('./totp');

const hostOf = (url) => parseURL(url)?.hostname || '';

function describePermission(permission, details) {
  if (permission === 'media') {
    const types = details.mediaTypes?.length ? details.mediaTypes : ['audio', 'video'];
    return `use your ${types.map((t) => (t === 'video' ? 'camera' : 'microphone')).join(' and ')}`;
  }
  if (permission === 'openExternal') {
    const scheme = parseURL(details.externalURL)?.protocol.replace(':', '') || 'external';
    return `open “${scheme}” links in another app`;
  }
  return {
    geolocation: 'know your location',
    notifications: 'show notifications',
    'clipboard-read': 'read your clipboard',
    midi: 'use MIDI devices',
  }[permission];
}

module.exports = {
  registerIpc() {
    // ── One-way commands from the UI ──
    const commands = {
      'ui-ready': () => {
        this.sendTheme();
        if (!this.order.length) {
          const urls = this.initialUrls.splice(0);
          if (urls.length) for (const url of urls) this.createTab(url);
          else this.createTab();
        }
        this.queueState();
      },
      'new-tab': (tor) => this.createTab(null, { tor: Boolean(tor) }),
      'new-container-tab': (id) => this.createTab(null, { container: String(id) }),
      'close-tab': (id) => this.closeTab(id),
      'activate-tab': (id) => this.activate(id),
      'toggle-mute': (id) => this.toggleMute(id),
      navigate: (text) => this.navigate(text),
      back: () => this.back(),
      forward: () => this.forward(),
      reload: () => this.reload(),
      stop: () => this.stop(),
      burn: () => this.burn(),
      retry: () => this.retry(),
      'load-insecure': () => this.loadInsecure(),
      'danger-back': () => this.leaveDangerousSite(),
      'danger-visit': () => this.visitDangerousSite(),
      'vpn-off': () => this.vpnDisconnect(),
      'vpn-retry': () => this.vpnConnect(),
      'tor-retry': () => this.tor.restart(),
      'tor-identity': () => this.newTorIdentity(),
      'toggle-bookmark': () => this.toggleBookmark(),
      'open-bookmark': (id, how) => this.openBookmark(String(id), String(how)),
      'bookmark-folder': (id, x, y) => this.showBookmarkFolder(String(id), Number(x), Number(y)),
      'bookmark-context': (id, x, y) => this.showBookmarkContextMenu(String(id), Number(x), Number(y)),
      'open-settings': (section) => this.openSettings(section ? String(section) : null),
      menu: (name, x, y) => {
        const show = { search: this.showSearchMenu, main: this.showMainMenu, shields: this.showShieldsMenu, vpn: this.showVpnMenu, tor: this.showTorMenu, 'new-tab': this.showNewTabMenu }[name];
        show?.call(this, Number(x) || 0, Number(y) || 0);
      },
      find: (text, forward, isNew) => this.find(text, Boolean(forward), Boolean(isNew)),
      'stop-find': () => this.activeTab?.wc.stopFindInPage('clearSelection'),
      'chrome-height': (height) => {
        const h = Math.round(Number(height));
        if (h >= 40 && h <= 400 && h !== this.chromeHeight) {
          this.chromeHeight = h;
          this.layout();
        }
      },
      permission: (id, allow) => this.resolvePermission(id, allow),
      'password-answer': (id, action, keep) => this.answerPasswordOffer(Number(id), String(action), Boolean(keep)),
      'reveal-download': (id) => {
        const file = this.downloads.get(Number(id));
        if (file) shell.showItemInFolder(file);
      },
      'store-install': (store, id) => this.installFromStore(String(store), String(id)),
      'splash-done': () => this.finishSplash(),
      unlock: () => this.unlock(),
      'suggest-highlight': (index) => this.highlightSuggestion(index),
      'suggest-hide': () => this.hideSuggestions(),
      'reopen-closed': () => this.reopenClosedTab(),
      'open-internal': (page) => this.openInternal(String(page)),
      'open-url': (url, how) => {
        if (!/^https?:\/\//i.test(String(url))) return; // pages from history or top sites only
        if (how === 'tab' || how === 'background') this.createTab(String(url), { background: how === 'background' });
        else this.loadInTab(this.activeTab?.tor || !this.activeTab ? this.createTab() : this.activeTab, String(url));
      },
    };
    for (const [name, handler] of Object.entries(commands)) {
      ipcMain.on(`vrk:${name}`, (event, ...args) => {
        if (event.sender !== this.ui) return; // only the browser UI may drive the browser
        if (this.locked && !['ui-ready', 'chrome-height', 'splash-done', 'unlock'].includes(name)) return;
        handler(...args);
      });
    }

    // ── Requests from the UI's settings page ──
    const requests = {
      'settings:get': () => this.settingsData(),
      'settings:set': (key, value) => ({ ok: this.settings.set(String(key), value), pendingRestart: this.settings.pendingRestart() }),
      'settings:keep-site': (site, keep) => this.settings.keepSite(String(site), Boolean(keep)),
      'settings:site': (key, site, on) => ['jsBlockedSites', 'jsAllowedSites', 'keepSites', 'extensionBlockedSites'].includes(key) && this.settings.setSite(key, String(site), Boolean(on)),
      'settings:forget-sign-ins': async () => {
        this.settings.set('keepSites', []);
        await this.clearNormalProfile();
        return true;
      },
      'settings:restart': () => {
        app.relaunch();
        app.quit();
      },
      'settings:update-lists': () => this.shield.refreshLists({ force: true }).then(() => true),
      'settings:make-default': () => this.makeDefaultBrowser(),
      'os:enter': () => this.os?.enter(),
      'passwords:remove': (id) => this.vault.remove(String(id)),
      'passwords:reveal': (id) => this.revealPassword(String(id)),
      'passwords:check': () => this.checkPasswords(),
      'containers:add': (name, color) => this.addContainer(String(name), String(color)),
      'containers:update': (id, changes) => this.updateContainer(String(id), { name: changes?.name, color: changes?.color }),
      'containers:remove': (id) => this.removeContainer(String(id)),
      'permissions:list': () => this.listPermissions(),
      'permissions:revoke': (key, tor) => this.revokePermission(String(key), Boolean(tor)),
      'clipboard:clear': () => {
        clipboard.clear();
        this.toast('Clipboard cleared.');
      },
      'passkeys:remove': (id) => this.vault.removePasskey(String(id)),
      'passwords:set-totp': (id, input) => this.setLoginTotp(String(id), input ? String(input).slice(0, 2000) : null),
      'passwords:totp-code': (id) => this.loginTotpCode(String(id)),
      'passwords:scan-qr': () => this.scanTotpQr(),
      'update:check': () => this.updater?.check({ manual: true }) ?? null,
      'update:restart': () => {
        if (this.updater?.installOnExit({ relaunch: true })) app.quit();
      },
      'backup:export': (passphrase) => this.exportBackup(String(passphrase || '')),
      'backup:restore': (passphrase) => this.restoreBackup(String(passphrase || '')),
      'extensions:list': () => this.extensions.list(),
      'extensions:set-enabled': (id, enabled) => this.extensions.setEnabled(String(id), Boolean(enabled)),
      'extensions:remove': (id) => this.extensions.remove(String(id)),
      'extensions:set-access': (id, mode, sites) => this.extensions.setSiteAccess(String(id), String(mode), Array.isArray(sites) ? sites.slice(0, 200) : []),
      'extensions:options': (id) => {
        const url = this.extensions.optionsUrl(String(id));
        if (url) this.createTab(url);
      },
      'extensions:install-file': () => this.installExtensionFile(),
      'extensions:install-store': (store, id) => this.installFromStore(String(store), String(id)),
      'import:detect': () => this.importer.detect(),
      'import:browser': (request) => this.importer.importBrowser({ ...request, what: { ...request.what }, session: this.normal.session }),
      'import:file': () => this.importFile(),
      'import:choose-folder': (browserId) => this.chooseImportFolder(String(browserId)),
      'import:privacy-settings': () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'),
      'settings:set-mode': (mode) => ({ ok: this.settings.setMode(String(mode)), pendingRestart: this.settings.pendingRestart() }),
      suggest: (text, rect) => this.showSuggestions(String(text), rect && { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width) }),
      'history:list': (options = {}) =>
        this.history.list({ query: String(options.query || ''), before: Number(options.before) || Infinity, limit: Math.min(Number(options.limit) || 200, 1000) }),
      'history:remove': (ids) => this.history.removeIds(Array.isArray(ids) ? ids.map(Number) : []),
      'history:clear': (range) => {
        const ago = { hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3 }[range];
        this.history.clear(ago ? Date.now() - ago : 0);
        return true;
      },
      'history:top': (limit = 8) =>
        [...this.history.byUrl.values()]
          .filter((e) => e.count > 1)
          .sort((a, b) => b.count - a.count || b.last - a.last)
          .slice(0, Math.min(Number(limit) || 8, 24))
          .map(({ url, title }) => ({ url, title })),
      'themes:list': () => ({ themes: this.themes.list(), activeId: this.settings.get('themeId') }),
      'themes:save': (theme) => this.themes.save(theme),
      'themes:delete': (id) => {
        if (this.settings.get('themeId') === id) this.settings.set('themeId', 'classic');
        this.themes.remove(String(id));
        return true;
      },
      'themes:apply': (id) => this.settings.set('themeId', String(id)),
      'themes:choose-media': () => this.chooseThemeMedia(),
      'themes:export': (id) => this.exportThemeFile(String(id)),
      'themes:import': () => this.importThemeFile(),
    };
    for (const [name, handler] of Object.entries(requests)) {
      ipcMain.handle(`vrk:${name}`, async (event, ...args) => {
        if (event.sender !== this.ui) throw new Error('Not allowed.');
        if (!this.allowedWhileLocked(name)) throw new Error('VRK is locked.');
        return handler(...args);
      });
    }

    // ── The suggestion dropdown may only pick a suggestion ──
    ipcMain.on('vrk:suggest-pick', (event, index) => {
      if (event.sender === this.suggestView?.webContents) this.pickSuggestion(index);
    });

    // ── Web pages: the password manager, for the page's own origin only ──
    ipcMain.on('vrk-page:config', (event) => {
      const context = this.pageContext(event);
      let topUrl = '';
      try {
        topUrl = event.senderFrame?.top?.url || event.sender.getURL();
      } catch {}
      const tor = Boolean(this.torProfile) && event.sender.session === this.torProfile.session;
      const container = this.containerProfileList().find((p) => p.session === event.sender.session)?.container || '';
      const shieldsUp = !this.shield.isSiteShieldsDown(topUrl);
      event.returnValue = {
        gpc: this.settings.get('sendGpc'),
        passwords: Boolean(context) && (this.settings.get('offerPasswords') || this.vault.count > 0 || this.vault.passkeyCount > 0),
        passkeys: Boolean(context) && this.settings.get('passkeys'),
        uv: Boolean(systemPreferences.canPromptTouchID?.()) || Boolean(this.passkeyApproval),
        bait: this.settings.get('blockAds') && this.settings.get('blockBait') && shieldsUp,
        rejectBanners: this.settings.get('rejectCookieBanners') && shieldsUp,
        // Tor tabs always randomize; normal tabs unless turned off (or shields are down for the site).
        seed: (tor || this.settings.get('fingerprintProtection')) && shieldsUp ? this.fingerprintSeed(topUrl, tor, container) : null,
        noWebgl: tor && this.settings.get('torSecurity') !== 'standard',
      };
    });
    ipcMain.handle('vrk-page:pw-list', (event) => {
      const context = this.pageContext(event);
      if (!context) return [];
      return this.vault.forOrigin(context.origin).map((l) => ({ id: l.id, username: l.username, site: hostOf(l.origin) }));
    });
    ipcMain.handle('vrk-page:pw-fill', (event, id) => {
      const context = this.pageContext(event);
      const login = context && this.vault.get(String(id));
      // Never hand a password to a different site than it was saved for.
      if (!login || siteOf(login.origin) !== context.site) return null;
      return { username: login.username, password: login.password };
    });
    ipcMain.handle('vrk-page:passkey', async (event, kind, request) => {
      const context = this.pageContext(event);
      if (!context || !['create', 'get', 'list'].includes(kind) || !request || typeof request !== 'object') return { fallback: true };
      try {
        return await this.passkeyRequest(context, kind, request);
      } catch (err) {
        console.error('VRK passkey:', err);
        return { error: 'NotAllowedError' };
      }
    });
    ipcMain.on('vrk-page:clipboard-command', (event, text) => {
      const tab = this.byContents.get(event.sender.id);
      if (!tab || typeof text !== 'string' || !this.settings.get('clipboardGuard')) return;
      let host = '';
      try {
        host = hostOf(event.senderFrame?.url || '') || hostOf(tab.url);
      } catch {}
      this.warnClipboardCommand(tab, host, text);
    });
    // 2FA codes, for the page's own site only.
    ipcMain.handle('vrk-page:totp-list', (event) => {
      const context = this.pageContext(event);
      if (!context) return [];
      return this.vault.forOrigin(context.origin).filter((l) => l.totp && siteOf(l.origin) === context.site).map((l) => ({ id: l.id, username: l.username, issuer: l.totp.issuer || '' }));
    });
    ipcMain.handle('vrk-page:totp-code', (event, id) => {
      const context = this.pageContext(event);
      const login = context && this.vault.get(String(id));
      if (!login?.totp || siteOf(login.origin) !== context.site) return null;
      return totpCode(login.totp).code;
    });
    ipcMain.on('vrk-page:pw-hint', (event, value) => {
      const context = this.pageContext(event);
      if (context && typeof value === 'string') this.usernameHints.set(event.sender.id, { site: context.site, value: value.slice(0, 256), at: Date.now() });
    });
    ipcMain.on('vrk-page:pw-offer', (event, data) => {
      const context = this.pageContext(event);
      if (!context || !data || typeof data.password !== 'string' || !data.password) return;
      let username = typeof data.username === 'string' ? data.username.slice(0, 256) : '';
      const hint = this.usernameHints.get(event.sender.id);
      if (!username && hint && hint.site === context.site && Date.now() - hint.at < 10 * 60 * 1000) username = hint.value;
      this.checkPasswordReuse(context, data.password.slice(0, 1024));
      this.offerPasswordSave(context, username, data.password.slice(0, 1024));
    });
  },

  // A per-site number that seeds fingerprint randomizing, from a key that's
  // new every launch (and after Burn, or a new Tor identity for Tor tabs).
  // Each container sees its own fingerprint too, so sites can't link them that way.
  fingerprintSeed(topUrl, tor, container = '') {
    const key = tor ? (this.torFingerprintKey ||= crypto.randomBytes(32)) : (this.fingerprintKey ||= crypto.randomBytes(32));
    return crypto.createHmac('sha256', key).update(`${container}|${siteOf(topUrl) || 'none'}`).digest().readInt32LE(0);
  },

  // Who's asking: the top frame of a page in the main (non-Tor) profile,
  // on HTTPS or localhost. Anything else gets nothing.
  pageContext(event) {
    const frame = event.senderFrame;
    if (!frame || frame.parent || !this.isWebSession(event.sender.session)) return null;
    const origin = originOf(frame.url);
    if (!origin) return null;
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'https:' && !(protocol === 'http:' && isLocalHost(hostname))) return null;
    return { origin, site: siteOf(origin), tabId: this.byContents.get(event.sender.id)?.id ?? null };
  },

  // ── Password manager ─────────────────────────────────────────────────────

  offerPasswordSave({ origin, site, tabId }, username, password) {
    if (!this.settings.get('offerPasswords') || this.vault.isNever(origin) || this.vault.has(origin, username, password)) return;
    const updating = this.vault.forOrigin(origin).some((l) => l.origin === origin && l.username === username);
    const id = this.nextOfferId++;
    this.passwordOffers.set(id, { origin, site, username, password, tabId });
    this.send('password-offer', {
      id,
      host: hostOf(origin),
      username,
      updating,
      site,
      canKeep: this.normal.persistent && this.settings.get('clearOnQuit') && !this.settings.get('keepSites').includes(site),
    });
  },

  answerPasswordOffer(id, action, keep) {
    const offer = this.passwordOffers.get(id);
    if (!offer) return;
    this.passwordOffers.delete(id);
    if (action === 'save') {
      this.vault.upsert(offer);
      if (keep) this.settings.keepSite(offer.site, true);
      this.warnIfBreached(offer);
      this.toast(this.vault.persistent ? 'Password saved, encrypted with your Mac’s Keychain.' : 'Password saved for this session (Keychain unavailable).');
    } else if (action === 'never') {
      this.vault.never(offer.origin);
    }
  },

  async revealPassword(id) {
    const login = this.vault.get(id);
    if (!login) return null;
    if (systemPreferences.canPromptTouchID?.()) {
      try {
        await systemPreferences.promptTouchID('show a saved password');
      } catch {
        return null;
      }
    }
    return login.password;
  },

  // ── Permissions ──────────────────────────────────────────────────────────

  askPermission({ webContents, origin, permission, details, profile }) {
    return new Promise((resolve) => {
      const id = this.nextPermissionId++;
      const tab = this.byContents.get(webContents.id);
      this.permissions.set(id, { resolve, tabId: tab?.id ?? null });
      this.send('permission', { id, host: hostOf(origin), what: describePermission(permission, details), tor: profile.kind === 'tor' });
    });
  },

  resolvePermission(id, allow) {
    const request = this.permissions.get(Number(id));
    if (!request) return;
    this.permissions.delete(Number(id));
    request.resolve(Boolean(allow));
    this.send('permission-done', Number(id));
  },

  // ── Extensions & import ──────────────────────────────────────────────────

  // On an Edge or Firefox add-on page, offer to install it into VRK.
  offerStoreInstall(tab, url) {
    if (tab.tor || tab.id !== this.activeId) return;
    const target = Extensions.storeTarget(url);
    if (!target) return;
    const label = target.store === 'edge' ? 'Add to VRK' : 'Add to VRK (experimental)';
    const text = target.store === 'edge' ? 'This Edge add-on works in VRK.' : 'Firefox add-ons are converted to work in VRK. Simple ones work; some may not.';
    this.toast(text, { label, store: target.store, id: target.id });
  },

  async installFromStore(store, id) {
    try {
      const ext = store === 'edge' ? await this.extensions.installFromEdge(id) : store === 'firefox' ? await this.extensions.installFromFirefox(id) : null;
      if (ext) this.toast(`Added “${ext.name}”.`);
    } catch (err) {
      this.toast(`Couldn’t add that extension: ${err.message}`);
    }
  },

  async installExtensionFile() {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: 'Add Extension',
      buttonLabel: 'Add',
      message: 'Choose a .crx, .zip or .xpi file, or an unpacked extension folder.',
      filters: [{ name: 'Extensions', extensions: ['crx', 'zip', 'xpi'] }],
      properties: ['openFile', 'openDirectory'],
    });
    if (canceled) return null;
    try {
      const ext = await this.extensions.installFile(filePaths[0]);
      if (ext) this.toast(`Added “${ext.name}”.`);
      return ext ? ext.name : null;
    } catch (err) {
      this.toast(`Couldn’t add that extension: ${err.message}`);
      return null;
    }
  },

  // Picking the folder in the macOS file picker is what lets VRK read it.
  async chooseImportFolder(browserId) {
    const name = this.importer.detect().find((b) => b.id === browserId)?.name || 'the browser';
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: `Choose your ${name} profile folder`,
      message: browserId === 'firefox' ? 'Pick the profile folder (like “xxxxxxxx.default-release”) inside Firefox → Profiles.' : `Pick ${name}’s folder or a profile in it (like “Default”).`,
      buttonLabel: 'Use This Folder',
      defaultPath: this.importer.profileFolderHint(browserId),
      properties: ['openDirectory', 'showHiddenFiles'],
    });
    if (canceled) return { canceled: true };
    try {
      const profiles = this.importer.addProfileFolder(browserId, filePaths[0]);
      return { profiles, browsers: this.importer.detect() };
    } catch (err) {
      return { error: err.message };
    }
  },

  async importFile() {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: 'Import Passwords or Bookmarks',
      buttonLabel: 'Import',
      filters: [{ name: 'Password CSV or bookmarks HTML', extensions: ['csv', 'html', 'htm'] }],
      properties: ['openFile'],
    });
    if (canceled) return null;
    return this.importer.importFile(filePaths[0]).catch((err) => ({ passwords: 0, sites: 0, bookmarks: 0, errors: [err.message] }));
  },

  settingsData() {
    return {
      settings: this.settings.all(),
      pendingRestart: this.settings.pendingRestart(),
      persistentProfile: this.normal.persistent,
      passwords: this.vault.summary(),
      passkeys: this.vault.passkeySummary(),
      passwordsEncrypted: this.vault.persistent,
      bookmarkCount: [...this.bookmarks.walk()].filter((n) => n.url).length,
      mode: this.settings.mode(),
      historyCount: this.history.count,
      historyPersistent: this.history.persistent,
      listsUpdatedAt: this.shield.listsUpdatedAt,
      blocklists: { hosts: this.shield.hostlist.size, dangerous: this.shield.safety.count, dangerousUpdatedAt: this.shield.safety.updatedAt },
      defaultBrowser: this.defaultBrowserStatus(),
      canLock: this.canLock(),
      updates: this.updater?.summary() || null,
      interceptions: [...(this.interceptions || new Map())].map(([issuer, hosts]) => ({ issuer, hosts: [...hosts].slice(0, 20) })),
      permissions: this.listPermissions(),
      versions: { chromium: process.versions.chrome, electron: process.versions.electron, app: app.getVersion() },
      configDir: path.basename(this.configDir),
    };
  },
};
