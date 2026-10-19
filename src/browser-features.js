'use strict';
// History, address-bar suggestions, themes, the opening animation and the
// default-browser setting (mixed into Browser).

const { app, WebContentsView, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const SUGGESTION_ROW = 44; // must match .row in ui/suggest.html
const SUGGESTION_PAD = 6;
const bare = (url) => url.replace(/^https?:\/\/(www\.)?/i, '');
const truncate = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

module.exports = {
  // ── History ──────────────────────────────────────────────────────────────

  recordVisit(tab, url, title = '') {
    if (tab.tor || !this.settings.get('saveHistory') || !/^https?:\/\//.test(url)) return;
    tab.historyId = this.history.add(url, title);
  },

  recentHistoryItems(limit) {
    if (this.locked) return []; // the History menu stays empty while VRK is locked
    const seen = new Set();
    const items = [];
    for (const visit of this.history.list({ limit: limit * 4 })) {
      if (seen.has(visit.url)) continue;
      seen.add(visit.url);
      items.push({ label: truncate(visit.title || bare(visit.url), 60), click: () => this.createTab(visit.url) });
      if (items.length >= limit) break;
    }
    return items;
  },

  reopenClosedTab() {
    const last = this.closedTabs.pop();
    if (!last) return;
    const tab = this.createTab(last.url, { tor: last.tor, container: last.container });
    if (tab) {
      this.order = this.order.filter((id) => id !== tab.id);
      this.order.splice(Math.min(last.index, this.order.length), 0, tab.id);
      this.queueState();
    }
  },

  // A link opened from another app (Mail, Messages, …) while VRK is the default browser.
  openFromOtherApp(url) {
    const tab = this.createTab(url);
    if (tab && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
    }
  },

  // ── Default browser ──────────────────────────────────────────────────────

  defaultBrowserStatus() {
    return {
      isDefault: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https'),
      canSet: app.isPackaged, // a development run would register Electron itself
    };
  },

  // macOS asks you to confirm; resolves once you've answered (or after a minute).
  async makeDefaultBrowser() {
    if (!app.isPackaged) return this.defaultBrowserStatus();
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
    for (let i = 0; i < 60 && !this.defaultBrowserStatus().isDefault; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return this.defaultBrowserStatus();
  },

  openInternal(page) {
    const existing = [...this.tabs.values()].find((t) => t.internal === page);
    const tab = existing || this.createTab(`vrk://${page}`);
    if (tab) this.activate(tab.id);
  },

  // ── Address-bar suggestions ──────────────────────────────────────────────
  // Suggestions draw in their own transparent view so they float above pages.

  createSuggestView() {
    this.suggestView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        session: this.uiSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.suggestView.setBackgroundColor('#00000000');
    const wc = this.suggestView.webContents;
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('did-finish-load', () => this.sendTheme());
    wc.loadURL('vrk://ui/suggest.html');
    this.suggestVisible = false;
    this.suggestions = [];
  },

  computeSuggestions(text) {
    const tab = this.activeTab;
    const input = String(text || '').trim().slice(0, 500);
    if (!input) return { items: [], completion: null };
    const q = input.toLowerCase();
    const searchBase = this.searchUrlFor(tab?.tor).split('%s')[0];
    const resolved = this.resolveText(input, tab?.tor);
    const items = [];
    const seen = new Set();
    const add = (item) => {
      if (!item.url || seen.has(item.url)) return;
      seen.add(item.url);
      items.push(item);
    };

    const history = !tab?.tor && this.settings.get('saveHistory') ? this.history.suggest(input, 8) : [];
    const marks = [...this.bookmarks.walk()].filter((n) => n.url && (n.url.toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q))).slice(0, 3);

    // Inline completion: the best history/bookmark URL that starts with what you typed.
    let completion = null;
    if (!/\s/.test(input)) {
      const candidates = [...history.map((h) => h.url), ...marks.map((m) => m.url)];
      const match = candidates.find((url) => bare(url).toLowerCase().startsWith(q.replace(/^https?:\/\/(www\.)?/, '')));
      if (match) {
        const host = bare(match).split('/')[0];
        completion = host.toLowerCase().startsWith(q) ? host : bare(match);
        add({ kind: 'history', url: match, title: history.find((h) => h.url === match)?.title || match, detail: 'Go to' });
      }
    }

    if (resolved?.startsWith(searchBase) && !/^https?:\/\//i.test(input)) {
      add({ kind: 'search', url: resolved, title: input, detail: `Search ${tab?.tor ? 'DuckDuckGo over Tor' : this.searchEngine.name}` });
    } else if (resolved) {
      add({ kind: 'url', url: resolved, title: resolved, detail: 'Go to address' });
    }
    for (const mark of marks) add({ kind: 'bookmark', url: mark.url, title: mark.title || mark.url, detail: 'Bookmark' });
    for (const h of history) add({ kind: 'history', url: h.url, title: h.title || h.url, detail: h.count > 1 ? `Visited ${h.count} times` : 'History' });
    return { items: items.slice(0, 8), completion };
  },

  showSuggestions(text, rect) {
    const result = this.computeSuggestions(text);
    this.suggestions = result.items;
    if (!result.items.length || this.win.isDestroyed() || !rect) {
      this.hideSuggestions();
      return result;
    }
    this.suggestView.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: result.items.length * SUGGESTION_ROW + SUGGESTION_PAD * 2,
    });
    this.suggestView.webContents.send('vrk:suggestions', { items: result.items, tor: Boolean(this.activeTab?.tor) });
    if (!this.suggestVisible) {
      this.win.contentView.addChildView(this.suggestView);
      this.suggestVisible = true;
    }
    return result;
  },

  hideSuggestions() {
    if (this.suggestVisible && !this.win.isDestroyed()) this.win.contentView.removeChildView(this.suggestView);
    this.suggestVisible = false;
  },

  highlightSuggestion(index) {
    if (this.suggestVisible) this.suggestView.webContents.send('vrk:suggest-highlight', Number(index));
  },

  pickSuggestion(index) {
    const item = this.suggestions[Number(index)];
    this.hideSuggestions();
    if (!item) return;
    this.send('suggest-picked');
    const tab = this.activeTab || this.createTab();
    this.loadInTab(tab, item.url);
  },

  // ── Themes ───────────────────────────────────────────────────────────────

  sendTheme() {
    const theme = this.themes.get(this.settings.get('themeId'));
    const classic = { theme: this.settings.get('theme'), accent: this.settings.get('accent'), density: this.settings.get('density') };
    const payload = { theme, classic };
    this.send('theme', payload);
    if (this.suggestView && !this.suggestView.webContents.isDestroyed()) this.suggestView.webContents.send('vrk:theme', payload);
  },

  // vrk://media/<name>: a theme's image or video, with byte ranges so video can stream and loop.
  serveMedia(request, name) {
    const media = this.themes.mediaPath(name);
    if (!media) return new Response('Not found', { status: 404 });
    const size = fs.statSync(media.file).size;
    // CORS lets the theme editor read an image's pixels to build a palette from it.
    const headers = { 'content-type': media.type, 'accept-ranges': 'bytes', 'access-control-allow-origin': 'vrk://ui' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
    if (!range || (!range[1] && !range[2])) {
      return new Response(Readable.toWeb(fs.createReadStream(media.file)), { headers: { ...headers, 'content-length': String(size) } });
    }
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(media.file, { start, end })), {
      status: 206,
      headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` },
    });
  },

  async chooseThemeMedia() {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: 'Choose a Background',
      buttonLabel: 'Use as Background',
      filters: [{ name: 'Images and videos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'mp4', 'm4v', 'webm', 'mov'] }],
      properties: ['openFile'],
    });
    if (canceled) return null;
    return this.themes.importMedia(filePaths[0]);
  },

  async exportThemeFile(id) {
    const theme = this.themes.get(id);
    if (theme.classic) return false;
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      title: 'Export Theme',
      defaultPath: `${theme.name.replace(/[^\w -]/g, '') || 'theme'}.vrktheme`,
      filters: [{ name: 'VRK theme', extensions: ['vrktheme'] }],
    });
    if (canceled || !filePath) return false;
    this.themes.exportTheme(id, filePath);
    this.toast(`Exported “${theme.name}”.`);
    return true;
  },

  async importThemeFile() {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: 'Import Theme',
      filters: [{ name: 'VRK theme', extensions: ['vrktheme'] }],
      properties: ['openFile'],
    });
    if (canceled) return null;
    return this.themes.importTheme(filePaths[0]);
  },

  // ── Opening animation ────────────────────────────────────────────────────

  finishSplash() {
    if (!this.splashing) return;
    this.splashing = false;
    this.updateView();
    this.queueState();
  },
};
