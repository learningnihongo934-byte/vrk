'use strict';
// Native menus and dialogs for VRK's browser window (mixed into Browser).

const { Menu, dialog } = require('electron');
const path = require('node:path');
const { Tor } = require('./tor');
const { siteOf } = require('./shield');

// Plain-language descriptions of what an extension's permissions allow.
const PERMISSION_TEXT = {
  tabs: 'See your open tabs and their addresses',
  history: 'Read your browsing history',
  bookmarks: 'Read and change your bookmarks',
  cookies: 'Read and change cookies',
  downloads: 'Manage your downloads',
  clipboardRead: 'Read your clipboard',
  clipboardWrite: 'Write to your clipboard',
  geolocation: 'Know your location',
  notifications: 'Show notifications',
  webRequest: 'Watch your network traffic',
  declarativeNetRequest: 'Block or change network requests',
  nativeMessaging: 'Talk to apps on your computer',
  management: 'Manage your other extensions',
  privacy: 'Change privacy settings',
  proxy: 'Change how you connect to the internet',
  scripting: 'Run code on web pages',
};

const SEARCH_CHOICES = { google: 'Google', bing: 'Bing' };

module.exports = {
  popup(template, x, y) {
    Menu.buildFromTemplate(template.filter(Boolean)).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  },

  // Right-click on an extension's toolbar button.
  showExtensionMenu(ext, rect) {
    const options = this.extensions.optionsUrl(ext.id);
    this.popup(
      [
        { label: ext.name, enabled: false },
        { type: 'separator' },
        options && { label: 'Options', click: () => this.createTab(options) },
        { label: 'Site Access & Settings…', click: () => this.openSettings('extensions') },
      ],
      (rect?.x || 0) + (rect?.width || 0) / 2,
      (rect?.y || 0) + (rect?.height || 0) + 4,
    );
  },

  // The address bar's "Search with" switcher, like Firefox's.
  showSearchMenu(x, y) {
    const current = this.settings.get('searchEngine');
    this.popup(
      [
        { label: 'Search with:', enabled: false },
        ...['google', 'bing'].map((id) => ({ label: SEARCH_CHOICES[id], type: 'radio', checked: current === id, click: () => this.settings.set('searchEngine', id) })),
        { type: 'separator' },
        { label: 'More Search Engines…', click: () => this.openSettings('search') },
      ],
      x,
      y,
    );
  },

  showMainMenu(x, y) {
    const tab = this.activeTab;
    const zoom = Math.round((tab?.zoom || 1) * 100);
    const canBookmark = tab && !tab.isNewTab && !tab.internal && /^https?:/.test(tab.url);
    this.popup(
      [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => this.createTab() },
        { label: 'New Tor Tab', accelerator: 'Shift+CmdOrCtrl+N', enabled: this.tor.available, click: () => this.createTab(null, { tor: true }) },
        { type: 'separator' },
        { label: this.bookmarks.findByUrl(tab?.url) ? 'Remove Bookmark' : 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', enabled: Boolean(canBookmark), click: () => this.toggleBookmark() },
        {
          label: 'Bookmarks Bar',
          submenu: [
            ['always', 'Always Show'],
            ['newtab', 'Show on New Tab Only'],
            ['never', 'Never Show'],
          ].map(([value, label]) => ({ label, type: 'radio', checked: this.settings.get('bookmarksBar') === value, click: () => this.settings.set('bookmarksBar', value) })),
        },
        { type: 'separator' },
        { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: () => this.openFind() },
        {
          label: `Zoom (${zoom}%)`,
          submenu: [
            { label: 'Zoom In', click: () => this.zoom(1) },
            { label: 'Zoom Out', click: () => this.zoom(-1) },
            { label: 'Actual Size', click: () => this.zoom(0) },
          ],
        },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => this.print() },
        { type: 'separator' },
        { label: 'History', accelerator: 'CmdOrCtrl+Y', click: () => this.openInternal('history') },
        { label: 'Features & Comparison', click: () => this.openInternal('features') },
        { label: this.os?.active ? 'Show VRKOS Desktop' : 'VRKOS Desktop', accelerator: 'Alt+CmdOrCtrl+O', click: () => this.os?.enter() },
        this.os?.active && { label: 'Leave VRKOS', click: () => this.os.leave() },
        { label: 'Reopen Closed Tab', accelerator: 'Shift+CmdOrCtrl+T', enabled: this.closedTabs.length > 0, click: () => this.reopenClosedTab() },
        { label: 'Theme Editor', click: () => this.openInternal('themes') },
        { type: 'separator' },
        { label: 'Passwords', click: () => this.openSettings('passwords') },
        { label: 'Extensions', click: () => this.openSettings('extensions') },
        { label: 'Import from Another Browser…', click: () => this.openSettings('import') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => this.openSettings() },
        { type: 'separator' },
        { label: 'Burn Browsing Data & History', accelerator: 'Shift+CmdOrCtrl+Backspace', click: () => this.burn() },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => this.toggleDevTools() },
        { label: 'About VRK', click: () => this.showAbout() },
      ],
      x,
      y,
    );
  },

  showShieldsMenu(x, y) {
    const tab = this.activeTab;
    const site = tab && !tab.isNewTab && !tab.internal ? siteOf(tab.url) : null;
    const up = !site || !this.shield.shieldsDown.has(site);
    const kept = site && this.settings.get('keepSites').includes(site);
    const blocking = this.settings.get('blockAds');
    const on = (key, label) => ({ label: `${this.settings.get(key) ? '✓' : '✕'}  ${label}`, enabled: false });
    this.popup(
      [
        { label: blocking ? `${tab?.blocked || 0} ads & trackers blocked on this page` : 'Ad & tracker blocking is off', enabled: false },
        { label: `${this.shield.totalBlocked} blocked since launch`, enabled: false },
        { type: 'separator' },
        site && blocking && {
          label: `Block ads & trackers on ${site}`,
          type: 'checkbox',
          checked: up,
          click: () => {
            this.shield.setShields(site, !up);
            tab.wc.reload();
          },
        },
        site && {
          label: `Allow JavaScript on ${site}`,
          sublabel: 'Off stops the site’s scripts (some sites won’t work)',
          type: 'checkbox',
          checked: !this.shield.scriptsBlockedOn(site),
          click: () => {
            this.shield.setScripts(site, this.shield.scriptsBlockedOn(site));
            tab.wc.reload();
          },
        },
        site && !tab.tor && {
          label: `Let extensions run on ${site}`,
          sublabel: 'Off keeps every extension away from this site',
          type: 'checkbox',
          checked: !this.settings.get('extensionBlockedSites').includes(site),
          click: () => {
            this.settings.setSite('extensionBlockedSites', site, !this.settings.get('extensionBlockedSites').includes(site));
            setTimeout(() => !tab.wc.isDestroyed() && tab.wc.reload(), 600); // after the extensions reload
          },
        },
        site && !tab.tor && this.settings.get('clearOnQuit') && {
          label: `Stay signed in to ${site}`,
          sublabel: 'Keep its cookies when VRK quits',
          type: 'checkbox',
          checked: Boolean(kept),
          click: () => this.settings.keepSite(site, !kept),
        },
        site && { type: 'separator' },
        on('blockAds', 'Ads, trackers & cookie banners blocked'),
        on('httpsOnly', 'HTTPS-only'),
        on('blockThirdPartyCookies', 'Third-party cookies blocked'),
        on('stripTrackingParams', 'Tracking parameters stripped from links'),
        on('sendGpc', 'Global Privacy Control sent'),
        { label: `✓  Encrypted DNS · WebRTC leak protection · ${this.settings.get('saveHistory') && !this.settings.launched.memoryOnly ? 'Encrypted history' : 'No history'}`, enabled: false },
        this.settings.launched.lockdown && { label: '✓  Lockdown mode', enabled: false },
        { type: 'separator' },
        { label: 'Privacy Settings…', click: () => this.openSettings('privacy') },
      ],
      x,
      y,
    );
  },

  showVpnMenu(x, y) {
    const { vpn } = this;
    const status = {
      off: 'VPN is off',
      connecting: `Connecting to ${vpn.active?.name || 'VPN'}…`,
      on: `Connected · ${vpn.active?.name}`,
      error: 'VPN down · kill switch is blocking traffic',
    }[vpn.state];
    this.popup(
      [
        { label: status, enabled: false },
        vpn.lastError && { label: vpn.lastError, enabled: false },
        { type: 'separator' },
        vpn.configs.length && {
          label: 'VPN',
          type: 'checkbox',
          checked: vpn.state !== 'off',
          click: () => (vpn.state === 'off' ? this.vpnConnect() : this.vpnDisconnect()),
        },
        vpn.configs.length && { type: 'separator' },
        ...vpn.configs.map((config) => ({
          label: `${config.name}  —  ${config.endpoint}`,
          type: 'radio',
          checked: config.id === vpn.activeId,
          click: () => this.vpnConnect(config.id),
        })),
        vpn.configs.length && { type: 'separator' },
        { label: 'Import WireGuard Config…', enabled: vpn.available, click: () => this.importVpnConfig() },
        vpn.configs.length && {
          label: 'Remove Server',
          submenu: vpn.configs.map((config) => ({ label: config.name, click: () => vpn.removeConfig(config.id) })),
        },
        { label: 'Get a WireGuard Config from Proton VPN…', click: () => this.createTab('https://account.protonvpn.com/downloads') },
        !vpn.available && { label: 'wireproxy is missing: run “npm run fetch-binaries”', enabled: false },
      ],
      x,
      y,
    );
  },

  showTorMenu(x, y) {
    const { tor } = this;
    const status = {
      off: 'Tor is off',
      starting: `Connecting to Tor… ${tor.progress}%`,
      ready: 'Connected to the Tor network',
      error: 'Tor could not connect',
    }[tor.state];
    this.popup(
      [
        { label: 'New Tor Tab', accelerator: 'Shift+CmdOrCtrl+N', enabled: tor.available, click: () => this.createTab(null, { tor: true }) },
        { label: 'New Tor Identity', accelerator: 'Shift+CmdOrCtrl+U', enabled: Boolean(this.torProfile), click: () => this.newTorIdentity() },
        { type: 'separator' },
        { label: status, enabled: false },
        tor.state === 'error' && tor.lastError && { label: tor.lastError.slice(0, 90), enabled: false },
        this.vpn.state !== 'off' && { label: 'Tor runs through your VPN', enabled: false },
        { type: 'separator' },
        {
          label: 'Bridges (for networks that block Tor)',
          enabled: tor.available,
          submenu: Object.entries(Tor.bridges).map(([key, bridge]) => ({
            label: bridge.label,
            type: 'radio',
            checked: tor.bridge === key,
            click: () => this.setTorBridge(key),
          })),
        },
        { label: 'Check Tor Connection', enabled: tor.available, click: () => this.createTab('https://check.torproject.org/', { tor: true }) },
        !tor.available && { label: 'Tor is missing: run “npm run fetch-binaries”', enabled: false },
      ],
      x,
      y,
    );
  },

  // ── Bookmarks ────────────────────────────────────────────────────────────

  toggleBookmark() {
    const tab = this.activeTab;
    if (!tab || tab.isNewTab || tab.internal || !/^https?:/.test(tab.url)) return;
    const existing = this.bookmarks.findByUrl(tab.url);
    if (existing) {
      this.bookmarks.remove(existing.id);
      this.toast('Bookmark removed.');
    } else {
      this.bookmarks.add({ url: tab.url, title: tab.title || tab.url, icon: tab.favicon });
      this.toast(`Bookmarked “${tab.title || tab.url}”.`);
    }
  },

  findBookmark(id) {
    for (const node of this.bookmarks.walk()) if (node.id === id) return node;
    return null;
  },

  openBookmark(id, how = 'current') {
    const node = this.findBookmark(id);
    if (!node?.url) return;
    if (how === 'tab') this.createTab(node.url, { background: false });
    else if (how === 'background') this.createTab(node.url, { background: true });
    else if (how === 'tor') this.createTab(node.url, { tor: true });
    else if (this.activeTab && !this.activeTab.tor) this.loadInTab(this.activeTab, node.url);
    else this.createTab(node.url);
  },

  // A folder's contents as a dropdown, with nested folders as submenus.
  showBookmarkFolder(id, x, y) {
    const folder = this.findBookmark(id);
    if (!folder?.children) return;
    const build = (nodes) =>
      nodes.length
        ? nodes.map((n) => (n.children ? { label: n.title, submenu: build(n.children) } : { label: n.title.slice(0, 80), click: () => this.openBookmark(n.id) }))
        : [{ label: '(empty)', enabled: false }];
    const items = build(folder.children);
    const urls = [...this.bookmarks.walk(folder.children)].filter((n) => n.url);
    if (urls.length > 1) items.push({ type: 'separator' }, { label: `Open All (${urls.length}) in New Tabs`, click: () => urls.forEach((n) => this.openBookmark(n.id, 'background')) });
    this.popup(items, x, y);
  },

  showBookmarkContextMenu(id, x, y) {
    const node = this.findBookmark(id);
    if (!node) return;
    this.popup(
      [
        node.url && { label: 'Open in New Tab', click: () => this.openBookmark(id, 'tab') },
        node.url && this.tor.available && { label: 'Open in New Tor Tab', click: () => this.openBookmark(id, 'tor') },
        node.url && { type: 'separator' },
        { label: node.children ? 'Delete Folder' : 'Delete', click: () => this.bookmarks.remove(id) },
      ],
      x,
      y,
    );
  },

  // ── Dialogs ──────────────────────────────────────────────────────────────

  async confirmExtensionInstall({ name, source, manifest }) {
    const permissions = [...(manifest?.permissions || []), ...(manifest?.optional_permissions || [])].filter((p) => typeof p === 'string');
    const hosts = [...(manifest?.host_permissions || []), ...permissions.filter((p) => p.includes('://') || p === '<all_urls>')];
    const lines = [...new Set(permissions.map((p) => PERMISSION_TEXT[p]).filter(Boolean))];
    if (hosts.some((h) => h === '<all_urls>' || /^\*:\/\/\*\//.test(h) || h === 'https://*/*')) lines.unshift('Read and change all your data on all websites');
    else if (hosts.length) lines.unshift(`Read and change your data on ${hosts.length} site${hosts.length === 1 ? '' : 's'}`);
    if (manifest?.content_scripts?.length && !lines.length) lines.push('Run on the websites it targets');
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question',
      message: `Add “${name}” to VRK?`,
      detail: `From ${source}.\n\n${lines.length ? `It can:\n• ${lines.join('\n• ')}` : 'It asks for no special permissions.'}\n\nExtensions run only in normal tabs, never in Tor tabs.`,
      buttons: ['Add Extension', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    return response === 0;
  },

  async importVpnConfig() {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: 'Import WireGuard Config',
      buttonLabel: 'Import',
      filters: [{ name: 'WireGuard config', extensions: ['conf'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled) return;
    let imported = null;
    for (const file of filePaths) {
      try {
        imported = this.vpn.importConfig(file);
      } catch (err) {
        this.toast(`${path.basename(file)}: ${err.message}`);
      }
    }
    if (imported) {
      this.toast(`Added VPN server “${imported.name}”. Connecting…`);
      this.vpnConnect(imported.id);
    }
  },

  showAbout() {
    const updated = this.shield.listsUpdatedAt ? new Date(this.shield.listsUpdatedAt).toLocaleDateString() : 'never';
    dialog.showMessageBox(this.win, {
      type: 'none',
      message: 'VRK',
      detail: [
        'The private browser.',
        '',
        `Engine: Chromium ${process.versions.chrome}`,
        `Electron ${process.versions.electron}`,
        `Filter lists updated: ${updated}`,
        `Tor: ${this.tor.available ? 'bundled' : 'not bundled'} · VPN: ${this.vpn.available ? 'WireGuard (wireproxy)' : 'not bundled'}`,
        '',
        'No telemetry. In Standard mode your history is saved encrypted on this Mac only; Private and Memory-only modes save none.',
        '',
        'Extension support: VRK’s own extension host on Electron’s built-in extension system.',
      ].join('\n'),
      buttons: ['OK'],
    });
  },
};
