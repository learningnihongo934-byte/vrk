'use strict';
// VRKOS: a full-screen desktop inside VRK. It's part of the VRK app (not a
// separate operating system) and runs on your Mac's own hardware.
//
//  - The desktop (wallpaper, menu bar, dock, Launchpad, desktop icons) is one
//    window filling the screen, always at the back, like a real desktop. Every
//    app is an ordinary window on top of it, so windows move, overlap and
//    resize like any other (and their pages always know they're on screen).
//  - Full screen for real: while VRK is the active app, macOS's Dock and menu
//    bar are hidden and ⌘Tab is off; other apps are hidden when VRKOS opens.
//  - VRK Browser is VRKOS's browser: the normal VRK window is one of the
//    desktop's windows while VRKOS is on.
//  - Built-in apps (Files, Terminal, Notes, Text Editor, System Monitor,
//    Settings, Calculator, Calendar, Viewer) are local pages on the private
//    vrk://os origin, in a session no web page can reach.
//  - Mac apps launch in their own windows, or show in a mirrored VRKOS window;
//    Windows programs run through Wine.

const { BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, screen, session, shell, systemPreferences } = require('electron');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const files = require('./files');
const system = require('./system');
const { Wine } = require('./wine');
const { EncryptedStore } = require('../vault');

// The macOS calls Electron doesn't have (native/vrkos.m). Without them VRKOS
// still works, just not in full screen.
let native = null;
try {
  native = require('./native/vrkos.node');
} catch (err) {
  console.error(`VRKOS: the macOS helper didn't load (${err.message}); run npm run build-native`);
}
const visibleRun = () => !process.env.VRK_SELFTEST && !process.env.VRK_SHOTS;

// System Settings panes VRKOS links to.
const MAC = process.platform === 'darwin';
const SETTINGS_PANES = {
  darwin: {
    network: 'x-apple.systempreferences:com.apple.Network-Settings.extension',
    battery: 'x-apple.systempreferences:com.apple.Battery-Settings.extension',
    sound: 'x-apple.systempreferences:com.apple.Sound-Settings.extension',
    files: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    apps: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles',
  },
  win32: { network: 'ms-settings:network', battery: 'ms-settings:batterysaver', sound: 'ms-settings:sound', files: 'ms-settings:privacy-broadfilesystemaccess', screen: 'ms-settings:privacy-graphicscaptureprogrammatic', apps: 'ms-settings:appsfeatures' },
}[process.platform] || {};

// Apps installed on this computer: .app bundles (macOS), Start menu shortcuts
// (Windows) or .desktop entries (Linux).
function installedApps() {
  const apps = [];
  const seen = new Set();
  const add = (name, file) => {
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    apps.push({ name, path: file });
  };
  const walk = (dir, depth, visit) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth > 0 && !e.name.endsWith('.app')) walk(full, depth - 1, visit);
      else visit(e.name, full);
    }
  };
  if (MAC) {
    for (const dir of ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', path.join(files.HOME, 'Applications')]) {
      walk(dir, 0, (name, full) => name.endsWith('.app') && add(name.replace(/\.app$/, ''), full));
    }
  } else if (process.platform === 'win32') {
    const roots = [path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
    for (const root of roots) walk(root, 3, (name, full) => /\.(lnk|url)$/i.test(name) && !/uninstall|readme|help|documentation|website/i.test(name) && add(name.replace(/\.(lnk|url)$/i, ''), full));
  } else {
    const roots = ['/usr/share/applications', '/usr/local/share/applications', '/var/lib/flatpak/exports/share/applications', path.join(files.HOME, '.local/share/flatpak/exports/share/applications'), path.join(files.HOME, '.local/share/applications'), '/var/lib/snapd/desktop/applications'];
    for (const root of roots) {
      walk(root, 1, (name, full) => {
        if (!name.endsWith('.desktop')) return;
        const entry = desktopEntry(full);
        if (entry.name && !entry.hidden) add(entry.name, full);
      });
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

// The [Desktop Entry] fields VRKOS uses from a Linux .desktop file.
function desktopEntry(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {}
  const main = text.split(/^\[/m).find((part) => part.startsWith('Desktop Entry]')) || '';
  const field = (key) => new RegExp(`^${key}=(.*)$`, 'm').exec(main)?.[1]?.trim() || '';
  return { name: field('Name'), icon: field('Icon'), exec: field('Exec'), hidden: /true/i.test(field('NoDisplay')) || /true/i.test(field('Hidden')) || (field('Type') && field('Type') !== 'Application') };
}

// A Linux app's icon file (from its icon theme name).
function linuxIconFile(name) {
  if (!name) return null;
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;
  const themes = ['hicolor', 'Adwaita', 'breeze', 'Papirus'];
  const sizes = ['256x256', '128x128', '512x512', '96x96', '64x64', '48x48', 'scalable'];
  const bases = [path.join(files.HOME, '.local/share/icons'), '/usr/share/icons', '/var/lib/flatpak/exports/share/icons'];
  for (const base of bases) {
    for (const theme of themes) {
      for (const size of sizes) {
        for (const ext of ['png', 'svg']) {
          const file = path.join(base, theme, size, 'apps', `${name}.${ext}`);
          if (fs.existsSync(file)) return file;
        }
      }
    }
  }
  for (const ext of ['png', 'svg', 'xpm']) if (fs.existsSync(`/usr/share/pixmaps/${name}.${ext}`)) return `/usr/share/pixmaps/${name}.${ext}`;
  return null;
}

const UI_DIR = path.join(__dirname, 'ui');
const PRELOAD = path.join(__dirname, 'preload.js');
const SHARED = { 'theme.js': path.join(__dirname, '..', 'ui', 'theme.js'), 'effects.js': path.join(__dirname, '..', 'ui', 'effects.js') };
const LIBS = {
  'xterm.js': ['@xterm/xterm', 'lib/xterm.js'],
  'xterm.css': ['@xterm/xterm', 'css/xterm.css'],
  'addon-fit.js': ['@xterm/addon-fit', 'lib/addon-fit.js'],
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.heic': 'image/heic', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};

// Finds which app owns a window (by its window number) and brings it to the
// front: JavaScript for Automation, no extra permissions needed.
const BRING_TO_FRONT = `ObjC.import('AppKit'); ObjC.import('CoreGraphics');
function run(argv) {
  const id = Number(argv[0]);
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0))) || [];
  const win = all.find((w) => w.kCGWindowNumber === id);
  if (!win) return '';
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(win.kCGWindowOwnerPID);
  app.activateWithOptions($.NSApplicationActivateAllWindows);
  return win.kCGWindowOwnerName;
}`;

const MENU_BAR = 30;
const DOCK = 92;

// The apps VRKOS has. single: only one window at a time.
const APPS = {
  browser: { name: 'VRK Browser' },
  files: { name: 'Files', width: 1000, height: 640 },
  terminal: { name: 'Terminal', width: 780, height: 500 },
  notes: { name: 'Notes', width: 860, height: 580, single: true },
  editor: { name: 'Text Editor', width: 880, height: 640 },
  monitor: { name: 'System Monitor', width: 940, height: 680, single: true },
  settings: { name: 'Settings', width: 780, height: 580, single: true },
  calculator: { name: 'Calculator', width: 320, height: 500, single: true, fixed: true },
  calendar: { name: 'Calendar', width: 820, height: 600, single: true },
  viewer: { name: 'Viewer', width: 960, height: 680 },
  windows: { name: 'Windows Apps', width: 860, height: 620, single: true },
  macapps: { name: 'Mac Apps', width: 900, height: 640, single: true },
  mirror: { name: 'Mirror', width: 960, height: 640 },
};

// Notes and calendar events, encrypted with your Mac's Keychain like passwords.
class Notes extends EncryptedStore {
  constructor(file) {
    super(file, () => ({ notes: [], events: [] }));
  }

  events() {
    return [...this.data.events].sort((a, b) => a.date.localeCompare(b.date));
  }

  saveEvent({ date, text }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Invalid date.');
    const event = { id: crypto.randomUUID(), date: String(date), text: String(text || '').slice(0, 300) };
    this.data.events.push(event);
    this.save();
    return event;
  }

  removeEvent(id) {
    this.data.events = this.data.events.filter((e) => e.id !== id);
    this.save();
  }

  list() {
    return [...this.data.notes].sort((a, b) => b.updated - a.updated);
  }

  saveNote({ id, text }) {
    const body = String(text ?? '').slice(0, 1_000_000);
    let note = id && this.data.notes.find((n) => n.id === id);
    if (!note) {
      note = { id: crypto.randomUUID(), text: '', created: Date.now(), updated: Date.now() };
      this.data.notes.push(note);
    }
    note.text = body;
    note.updated = Date.now();
    this.save();
    return note;
  }

  remove(id) {
    this.data.notes = this.data.notes.filter((n) => n.id !== id);
    this.save();
  }
}

class VrkOS {
  constructor({ browser, settings, configDir }) {
    Object.assign(this, { browser, settings, configDir });
    this.active = false;
    this.desktop = null;
    this.windows = new Map(); // id -> { id, app, win, args, maximized: bounds|null }
    this.nextId = 1;
    this.menuBar = MENU_BAR;
    this.macRunning = []; // running Mac apps, for the dock
    this.ptys = new Map(); // id -> { pty, owner }
    this.notes = new Notes(path.join(configDir, 'notes.bin'));
    this.wine = new Wine({ configDir });
    this.registerIpc();
  }

  // ── Session & pages ──────────────────────────────────────────────────────

  get session() {
    if (this.osSession) return this.osSession;
    const ses = session.fromPartition('vrk-os');
    ses.protocol.handle('vrk', (request) => this.serve(request));
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !/^(vrk|blob|data|devtools):/.test(details.url) }));
    // Only the Mirror app may capture a window (it asks macOS for Screen Recording).
    const mirrorOnly = (wc) => this.windowFor(wc)?.app === 'mirror';
    ses.setPermissionRequestHandler((wc, permission, callback) => callback(permission === 'media' && mirrorOnly(wc)));
    ses.setPermissionCheckHandler((wc, permission) => permission === 'media' && mirrorOnly(wc));
    this.osSession = ses;
    return ses;
  }

  serve(request) {
    const url = new URL(request.url);
    if (url.host === 'media') return this.browser.serveMedia(request, decodeURIComponent(url.pathname.slice(1)));
    if (url.host === 'file') return this.serveFile(request, url.searchParams.get('path') || '');
    if (url.host !== 'os') return new Response('Not found', { status: 404 });
    const name = decodeURIComponent(url.pathname.slice(1));
    let file = null;
    if (name.startsWith('shared/')) file = SHARED[name.slice(7)];
    else if (name.startsWith('lib/') && LIBS[name.slice(4)]) {
      const [pkg, rel] = LIBS[name.slice(4)];
      file = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), rel);
    } else {
      const candidate = path.normalize(path.join(UI_DIR, name));
      if (candidate.startsWith(UI_DIR + path.sep)) file = candidate;
    }
    try {
      return new Response(fs.readFileSync(file), { headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }

  // Local files for previews (Files, Viewer, desktop icons), with seeking.
  // Asynchronous, so a macOS folder-permission prompt never freezes VRK.
  async serveFile(request, file) {
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) return new Response('Not found', { status: 404 });
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : Math.min(start + 4 * 1024 * 1024 - 1, stat.size - 1);
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);
      const handle = await fsp.open(file, 'r');
      await handle.read(buffer, 0, length, start);
      await handle.close();
      return new Response(buffer, { status: 206, headers: { 'content-type': type, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': String(length) } });
    }
    if (stat.size > 64 * 1024 * 1024) return new Response('Too big', { status: 413 });
    return new Response(await fsp.readFile(file), { headers: { 'content-type': type, 'accept-ranges': 'bytes' } });
  }

  webPreferences() {
    return { preload: PRELOAD, session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true };
  }

  harden(win) {
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) this.openUrl(url); // links open in VRK Browser
      return { action: 'deny' };
    });
  }

  // ── Entering and leaving ─────────────────────────────────────────────────

  enter() {
    if (this.active) return this.focusDesktop();
    // A browser window in macOS full screen (its own Space) leaves it first.
    if (this.browser.win.isFullScreen()) {
      this.browser.win.once('leave-full-screen', () => setTimeout(() => this.enter(), 300));
      this.browser.win.setFullScreen(false);
      return true;
    }
    const display = screen.getDisplayMatching(this.browser.win.getBounds());
    this.display = display;
    // Borderless, and never resizable, minimizable or in macOS full screen, so
    // nothing ever has to change the window's style (macOS can refuse that and
    // quit the app). Without the helper, it leaves room for macOS's menu bar and Dock.
    const fullScreen = Boolean(native) && visibleRun();
    this.desktop = new BrowserWindow({
      ...(native || !MAC ? display.bounds : display.workArea),
      frame: false,
      roundedCorners: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: !MAC, // Windows and Linux: ordinary full screen (covers the taskbar)
      hasShadow: false,
      backgroundColor: '#05060a',
      title: 'VRKOS',
      webPreferences: this.webPreferences(),
    });
    this.harden(this.desktop);
    // Room for the camera notch, if the screen has one.
    this.menuBar = Math.max(MENU_BAR, Math.round(native?.safeAreaTop(this.desktop.getNativeWindowHandle()) || 0));
    this.desktop.loadURL('vrk://os/desktop.html');
    this.desktop.on('closed', () => {
      this.desktop = null;
      if (this.active) this.exit();
    });
    this.desktop.once('ready-to-show', () => {
      if (!visibleRun() || !this.desktop) return;
      if (native) {
        native.setWindowLevel(this.desktop.getNativeWindowHandle(), 'desktop'); // always at the back
        native.hideOtherApps();
      }
      if (fullScreen) native.setFullScreen(true);
      if (!MAC) this.desktop.setFullScreen(true);
      this.desktop.show();
      this.desktop.focus();
      // You arrive at the desktop; VRK Browser is one click away in the dock.
      if (!this.browser.win.isDestroyed()) this.browser.win.hide();
      this.broadcast();
    });
    // VRK Browser is an ordinary window on the desktop. (Not attached to it:
    // attached windows can leave pages thinking they're hidden, which stops
    // videos.)
    this.browserBounds = this.browser.win.getBounds();
    // Windows and Linux have no "desktop level": windows owned by the desktop stay in front of it.
    if (!MAC) this.browser.win.setParentWindow(this.desktop);
    this.browser.win.setBounds(this.cascade(Math.min(1320, this.workArea().width - 80), Math.min(860, this.workArea().height - 60), 0));
    this.active = true;
    this.settings.set('osActive', true);
    this.watchMacApps(true);
    this.broadcast();
    return true;
  }

  exit() {
    if (!this.active) return false;
    this.active = false;
    this.settings.set('osActive', false);
    this.watchMacApps(false);
    if (native && visibleRun()) {
      native.setFullScreen(false); // macOS's Dock, menu bar and ⌘Tab come back
      native.showAllApps();
    }
    for (const { win } of [...this.windows.values()]) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
    for (const id of [...this.ptys.keys()]) this.killPty(id);
    if (!this.browser.win.isDestroyed()) {
      if (!MAC) this.browser.win.setParentWindow(null);
      if (this.browserBounds) this.browser.win.setBounds(this.browserBounds);
      if (!process.env.VRK_SELFTEST && !process.env.VRK_SHOTS) this.browser.win.show();
    }
    if (this.desktop && !this.desktop.isDestroyed()) {
      const desktop = this.desktop;
      this.desktop = null;
      desktop.hide();
      desktop.destroy();
    }
    return true;
  }

  // Leaving from a menu or a button: done once the click has finished, never
  // while macOS is still closing the menu.
  leave() {
    if (!this.active) return false;
    setTimeout(() => this.exit(), 0);
    return true;
  }

  toggle() {
    return this.active ? this.leave() : this.enter();
  }

  // "Show VRKOS Desktop": the desktop, with VRK Browser tucked into the dock.
  focusDesktop() {
    if (!this.desktop || this.desktop.isDestroyed()) return false;
    if (visibleRun()) {
      if (!this.browser.win.isDestroyed()) this.browser.win.hide();
      this.desktop.show();
    }
    this.desktop.focus();
    this.broadcast();
    return true;
  }

  // The desktop minus the menu bar and the dock.
  workArea() {
    const b = this.desktop?.getBounds() || this.display?.bounds || { x: 0, y: 0, width: 1440, height: 900 };
    return { x: b.x, y: b.y + this.menuBar, width: b.width, height: b.height - this.menuBar - DOCK };
  }

  cascade(width, height, index = this.windows.size) {
    const area = this.workArea();
    const w = Math.min(width, area.width - 40);
    const h = Math.min(height, area.height - 20);
    const offset = (index % 8) * 28;
    return {
      x: Math.round(area.x + (area.width - w) / 2 - 100 + offset),
      y: Math.round(area.y + Math.max(10, (area.height - h) / 2 - 60) + offset),
      width: w,
      height: h,
    };
  }

  // ── App windows ──────────────────────────────────────────────────────────

  openApp(app, args = {}) {
    if (!this.active) this.enter();
    if (app === 'browser') return this.showBrowser();
    const def = APPS[app];
    if (!def) throw new Error(`No app called ${app}`);
    if (def.single) {
      const existing = [...this.windows.values()].find((w) => w.app === app);
      if (existing) {
        this.focusWindow(existing.id);
        if (Object.keys(args).length) existing.win.webContents.send('vrkos:event', 'args', args);
        return existing.id;
      }
    }
    const id = this.nextId++;
    const bounds = this.cascade(def.width, def.height);
    const win = new BrowserWindow({
      ...bounds,
      ...(MAC ? {} : { parent: this.desktop }),
      frame: false,
      show: false,
      resizable: !def.fixed,
      minWidth: def.fixed ? def.width : 360,
      minHeight: def.fixed ? def.height : 240,
      backgroundColor: '#14151c',
      roundedCorners: true,
      hasShadow: true,
      title: def.name,
      webPreferences: this.webPreferences(),
    });
    this.harden(win);
    const entry = { id, app, win, args, title: def.name, maximized: null };
    this.windows.set(id, entry);
    win.loadURL(`vrk://os/app.html?app=${app}&id=${id}`);
    if (visibleRun()) win.once('ready-to-show', () => win.show());
    win.on('focus', () => {
      this.focusedId = id;
      this.broadcast();
    });
    win.on('show', () => this.broadcast());
    win.on('hide', () => this.broadcast());
    win.on('closed', () => {
      this.windows.delete(id);
      for (const [ptyId, p] of this.ptys) if (p.owner === id) this.killPty(ptyId);
      if (this.focusedId === id) this.focusedId = null;
      this.broadcast();
    });
    this.broadcast();
    return id;
  }

  windowFor(wc) {
    if (!wc) return null;
    if (this.desktop && wc === this.desktop.webContents) return { id: 0, app: 'desktop', win: this.desktop };
    for (const entry of this.windows.values()) if (!entry.win.isDestroyed() && entry.win.webContents === wc) return entry;
    return null;
  }

  focusWindow(id) {
    if (id === 'browser') return this.showBrowser();
    const entry = this.windows.get(Number(id));
    if (!entry || entry.win.isDestroyed()) return false;
    if (!entry.win.isVisible() && !process.env.VRK_SELFTEST) entry.win.show();
    entry.win.focus();
    entry.win.moveTop();
    this.focusedId = entry.id;
    this.broadcast();
    return true;
  }

  windowAction(entry, action, value) {
    const { win } = entry;
    if (action === 'close') win.close();
    else if (action === 'minimize') win.hide();
    else if (action === 'title') {
      entry.title = String(value || APPS[entry.app]?.name || '').slice(0, 120);
      win.setTitle(entry.title);
      this.broadcast();
    } else if (action === 'maximize') {
      if (entry.maximized) {
        win.setBounds(entry.maximized);
        entry.maximized = null;
      } else {
        entry.maximized = win.getBounds();
        win.setBounds(this.workArea());
      }
    } else if (action === 'snap') {
      const area = this.workArea();
      const half = Math.round(area.width / 2);
      entry.maximized ||= win.getBounds();
      win.setBounds(value === 'left' ? { ...area, width: half } : { ...area, x: area.x + half, width: area.width - half });
    }
    return true;
  }

  showBrowser() {
    const win = this.browser.win;
    if (!this.browser.order.length) this.browser.createTab();
    if (visibleRun()) win.show();
    win.focus();
    this.focusedId = 'browser';
    this.broadcast();
    return 'browser';
  }

  openUrl(url) {
    if (!/^https?:\/\//i.test(String(url))) return false;
    this.browser.createTab(String(url));
    if (this.active) this.showBrowser();
    return true;
  }

  // While VRKOS is on, closing VRK Browser hides it instead of quitting VRK.
  handleBrowserClose(event) {
    if (!this.active || this.browser.quitting) return false;
    event.preventDefault();
    this.browser.win.hide();
    this.broadcast();
    return true;
  }

  // ⌘W: closes the focused VRKOS app window, if one is focused.
  closeFocusedApp() {
    const focused = BrowserWindow.getFocusedWindow();
    const entry = [...this.windows.values()].find((w) => w.win === focused);
    if (!entry) return false;
    entry.win.close();
    return true;
  }

  // App lock hides every VRKOS window too, and the lock screen covers
  // everything (Mac apps included) until you unlock.
  setLocked(locked) {
    if (!this.active) return;
    this.raiseDesktop(locked);
    for (const { win } of this.windows.values()) {
      if (win.isDestroyed()) continue;
      if (locked) {
        win.vrkWasVisible = win.isVisible();
        win.hide();
      } else if (win.vrkWasVisible && !process.env.VRK_SELFTEST) win.show();
    }
    this.broadcast();
  }

  // The desktop normally sits behind every window; Launchpad and the lock
  // screen bring it in front of them.
  raiseDesktop(on) {
    if (!this.desktop || this.desktop.isDestroyed() || !visibleRun()) return false;
    if (native) {
      native.setWindowLevel(this.desktop.getNativeWindowHandle(), on ? 'overlay' : 'desktop');
    } else if (!MAC) {
      // Windows and Linux: app windows always stay above the desktop, so step them aside.
      for (const win of [this.browser.win, ...[...this.windows.values()].map((w) => w.win)]) {
        if (win.isDestroyed()) continue;
        if (on) {
          win.vrkRaiseHidden = win.isVisible();
          if (win.vrkRaiseHidden) win.hide();
        } else if (win.vrkRaiseHidden && !this.browser.locked) {
          win.vrkRaiseHidden = false;
          win.showInactive();
        }
      }
    } else return false;
    if (on) this.desktop.focus();
    return true;
  }

  // Running Mac apps, for the dock (checked every second and a half while VRKOS is on).
  watchMacApps(on) {
    clearInterval(this.macTimer);
    this.macTimer = null;
    if (!on || !native) return void (this.macRunning = []);
    const check = () => {
      const apps = native
        .runningApps()
        .filter((a) => a.path && !(a.bundleId === 'com.apple.finder' && !a.active)) // Finder only while you use it
        .map(({ pid, name, path: appPath, active, hidden }) => ({ pid, name, path: appPath, active, hidden }));
      if (JSON.stringify(apps) === JSON.stringify(this.macRunning)) return;
      this.macRunning = apps;
      this.broadcast();
    };
    check();
    this.macTimer = setInterval(check, 1500);
  }

  macApp(pid) {
    const app = this.macRunning.find((a) => a.pid === Number(pid));
    if (!app || !native) throw new Error('That app isn’t running.');
    return app;
  }

  // A native macOS menu for a VRKOS window. items: [{ id, label, disabled?,
  // checked?, submenu? } | 'separator']. Resolves with the chosen id (or null).
  popupMenu(entry, items, x, y) {
    return new Promise((resolve) => {
      let chosen = null;
      const build = (list, depth = 0) =>
        (Array.isArray(list) ? list : []).slice(0, 80).map((item) => {
          if (item === 'separator' || item?.type === 'separator') return { type: 'separator' };
          const out = { label: String(item?.label ?? '').slice(0, 160), enabled: !item?.disabled };
          if (Array.isArray(item?.submenu) && depth < 2) out.submenu = build(item.submenu, depth + 1);
          else {
            if (typeof item?.checked === 'boolean') Object.assign(out, { type: 'checkbox', checked: item.checked });
            out.click = () => (chosen = item?.id == null ? null : String(item.id));
          }
          return out;
        });
      const menu = Menu.buildFromTemplate(build(items));
      // The chosen item's click arrives as the menu closes.
      menu.popup({ window: entry.win, x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0), callback: () => setTimeout(() => resolve(chosen), 60) });
    });
  }

  snapshot() {
    const browserWin = this.browser.win;
    return {
      active: this.active,
      menuBar: this.menuBar,
      mac: this.macRunning,
      locked: Boolean(this.browser.locked),
      focused: this.focusedId ?? null,
      browser: { visible: !browserWin.isDestroyed() && browserWin.isVisible(), tabs: this.browser.order.length, title: this.browser.activeTab?.title || 'VRK Browser' },
      windows: [...this.windows.values()]
        .filter((w) => !w.win.isDestroyed())
        .map((w) => ({ id: w.id, app: w.app, title: w.title, visible: w.win.isVisible() })),
      settings: { clock24: this.settings.get('osClock24'), wallpaper: this.settings.get('osWallpaper'), startup: this.settings.get('osStartup'), welcomed: this.settings.get('osWelcomed') },
    };
  }

  broadcast() {
    clearTimeout(this.broadcastTimer);
    this.broadcastTimer = setTimeout(() => {
      const state = this.snapshot();
      for (const wc of this.osContents()) wc.send('vrkos:event', 'state', state);
    }, 30);
  }

  osContents() {
    return [this.desktop, ...[...this.windows.values()].map((w) => w.win)].filter((w) => w && !w.isDestroyed()).map((w) => w.webContents);
  }

  sendTheme() {
    if (!this.active) return;
    for (const wc of this.osContents()) wc.send('vrkos:event', 'theme', this.themePayload());
  }

  // The wallpaper: your VRK theme, or VRKOS's default when it's VRK Classic.
  themePayload() {
    const chosen = this.settings.get('osWallpaper');
    const id = chosen && chosen !== 'auto' ? chosen : this.settings.get('themeId');
    let theme = this.browser.themes.get(id);
    if (theme.classic) theme = this.browser.themes.get('midnight-aurora');
    return { theme };
  }

  // ── Terminal ─────────────────────────────────────────────────────────────

  async createPty(owner, { cols = 80, rows = 24, cwd } = {}) {
    const pty = require('node-pty');
    const win = process.platform === 'win32';
    const shellPath = win ? (fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')) ? 'powershell.exe' : process.env.ComSpec || 'cmd.exe') : process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : MAC ? '/bin/zsh' : '/bin/bash';
    const start = cwd && (await fsp.stat(String(cwd)).then((s) => s.isDirectory(), () => false)) ? String(cwd) : files.HOME;
    const term = pty.spawn(shellPath, win ? [] : ['-l'], {
      name: 'xterm-256color',
      cols: Math.max(10, Math.min(500, Number(cols) || 80)),
      rows: Math.max(4, Math.min(300, Number(rows) || 24)),
      cwd: start,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'VRKOS', LANG: process.env.LANG || 'en_US.UTF-8' },
    });
    const id = crypto.randomUUID();
    const entry = this.windows.get(owner);
    this.ptys.set(id, { pty: term, owner });
    term.onData((data) => entry && !entry.win.isDestroyed() && entry.win.webContents.send('vrkos:event', 'pty-data', { id, data }));
    term.onExit(({ exitCode }) => {
      this.ptys.delete(id);
      if (entry && !entry.win.isDestroyed()) entry.win.webContents.send('vrkos:event', 'pty-exit', { id, exitCode });
    });
    return id;
  }

  killPty(id) {
    const entry = this.ptys.get(id);
    if (!entry) return;
    this.ptys.delete(id);
    try {
      entry.pty.kill();
    } catch {}
  }

  // ── Mac apps ─────────────────────────────────────────────────────────────

  macApps() {
    return installedApps();
  }

  // Opens an installed app the way this computer's own launcher would.
  async launchApp(file) {
    const target = String(file);
    const ok = MAC ? /\.app$/i.test(target) : process.platform === 'win32' ? /\.(lnk|url|exe)$/i.test(target) : /\.desktop$/i.test(target);
    if (!ok || !(await fsp.stat(target).catch(() => null))) throw new Error('That isn’t an app.');
    if (MAC || process.platform === 'win32') {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return true;
    }
    // Linux: gio (GNOME and most desktops), then gtk-launch, then the entry's own command.
    const tryRun = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 10000 }, (err) => resolve(!err)));
    if (await tryRun('gio', ['launch', target])) return true;
    if (await tryRun('gtk-launch', [path.basename(target, '.desktop')])) return true;
    const exec = desktopEntry(target).exec.replace(/%[fFuUdDnNickvm]/g, '').trim();
    if (!exec) throw new Error('That app can’t be opened.');
    require('node:child_process').spawn('/bin/sh', ['-c', exec], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }

  // Windows of other apps that can be mirrored (needs Screen Recording).
  // Listing them is what makes macOS ask, so that only happens when you ask.
  async mirrorSources({ ask = false } = {}) {
    // Self-tests never look at the real screen.
    if (process.env.VRK_SELFTEST || process.env.VRK_SHOTS) return { permission: 'unknown', sources: [] };
    const status = systemPreferences.getMediaAccessStatus?.('screen') || 'unknown';
    if (status !== 'granted' && !ask) return { permission: status, sources: [] };
    let sources = [];
    try {
      sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true });
    } catch {}
    const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId?.()).filter(Boolean));
    return {
      permission: status,
      sources: sources
        .filter((s) => !own.has(s.id) && s.name && !/^(VRK|VRKOS)$/.test(s.name))
        .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail?.isEmpty() ? null : s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null })),
    };
  }

  // ── IPC ──────────────────────────────────────────────────────────────────

  registerIpc() {
    const calls = {
      info: (entry) => ({ id: entry.id, app: entry.app, args: entry.args || {}, name: APPS[entry.app]?.name || 'VRKOS', menuBar: this.menuBar, apps: Object.fromEntries(Object.entries(APPS).map(([k, v]) => [k, v.name])) }),
      state: () => this.snapshot(),
      theme: () => this.themePayload(),
      'open-app': (_e, app, args) => this.openApp(String(app), args && typeof args === 'object' ? args : {}),
      window: (entry, action, value) => entry.id !== 0 && this.windowAction(entry, String(action), value),
      'focus-window': (_e, id) => this.focusWindow(id === 'browser' ? 'browser' : Number(id)),
      'show-browser': () => this.showBrowser(),
      'open-url': (_e, url) => this.openUrl(String(url)),
      exit: () => this.leave(),
      raise: (entry, on) => entry.id === 0 && (on || !this.browser.locked) && this.raiseDesktop(Boolean(on)),
      launchpad: () => {
        if (!this.desktop) return false;
        this.desktop.webContents.send('vrkos:event', 'launchpad', true);
        return true;
      },
      'popup-menu': (entry, items, x, y) => this.popupMenu(entry, items, x, y),
      'mac-activate': (_e, pid) => native.activateApp(this.macApp(pid).pid),
      'mac-hide': (_e, pid) => native.hideApp(this.macApp(pid).pid),
      'mac-quit': (_e, pid) => native.quitApp(this.macApp(pid).pid),
      'network-info': () => system.networkInfo(),
      'wifi-power': (_e, on) => system.setWifiPower(Boolean(on)),
      volume: () => system.volume(),
      'set-volume': (_e, opts) => system.setVolume(opts || {}),
      permissions: async () => ({
        fullDisk: await files.hasFullDiskAccess(),
        screen: systemPreferences.getMediaAccessStatus?.('screen') || 'unknown',
        fullScreen: Boolean(native) || !MAC,
        platform: process.platform,
      }),
      'open-system-settings': (_e, pane) => Object.hasOwn(SETTINGS_PANES, pane) && shell.openExternal(SETTINGS_PANES[pane]).then(() => true),
      lock: () => this.browser.lock(),
      unlock: () => this.browser.unlock(),
      'search-web': (_e, text) => {
        const url = this.browser.resolveText(String(text).slice(0, 2000), false);
        if (url) this.openUrl(url);
        return Boolean(url);
      },
      'browser-settings': (_e, section) => {
        this.showBrowser();
        this.browser.openSettings(section ? String(section) : null);
      },
      apps: () => ({ builtIn: Object.entries(APPS).filter(([k]) => !['mirror', 'viewer'].includes(k)).map(([id, a]) => ({ id, name: a.name })), mac: this.macApps(), windows: this.wine.programs() }),
      icon: async (_e, file, size) => {
        const target = String(file);
        // Linux apps name an icon from the icon theme.
        if (!MAC && process.platform !== 'win32' && target.endsWith('.desktop')) {
          const iconFile = linuxIconFile(desktopEntry(target).icon);
          if (iconFile) {
            const type = iconFile.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
            if (!iconFile.endsWith('.xpm')) return `data:${type};base64,${(await fsp.readFile(iconFile)).toString('base64')}`;
          }
        }
        return files.icon(target, size === 'large' ? 'large' : 'normal');
      },
      'launch-mac': (_e, file) => this.launchApp(file),
      // Files
      places: () => files.places(),
      list: (_e, dir, opts) => files.list(String(dir || files.HOME), { hidden: Boolean(opts?.hidden) }),
      'read-text': (_e, file) => files.readText(String(file)),
      'write-text': (_e, file, text) => files.writeText(String(file), String(text)),
      'make-folder': (_e, dir, name) => files.makeFolder(String(dir), name ? String(name) : undefined),
      'make-file': (_e, dir, name) => files.makeFile(String(dir), name ? String(name) : undefined),
      rename: (_e, file, name) => files.rename(String(file), String(name)),
      copy: (_e, list, dest) => files.copy(asPaths(list), String(dest)),
      move: (_e, list, dest) => files.move(asPaths(list), String(dest)),
      trash: (_e, list) => files.trash(asPaths(list)),
      'open-file': (_e, file) => shell.openPath(String(file)),
      reveal: (_e, file) => shell.showItemInFolder(String(file)),
      search: (_e, query, dir) => files.search(String(query), dir ? String(dir) : files.HOME),
      'choose-file': async (entry, opts = {}) => {
        const result = await dialog.showOpenDialog(entry.win, { properties: [opts.folder ? 'openDirectory' : 'openFile'], filters: Array.isArray(opts.filters) ? opts.filters : undefined, defaultPath: opts.defaultPath || files.HOME });
        return result.canceled ? null : result.filePaths[0];
      },
      'choose-save': async (entry, opts = {}) => {
        const result = await dialog.showSaveDialog(entry.win, { defaultPath: opts.defaultPath || path.join(files.HOME, 'Documents', opts.name || 'Untitled.txt') });
        return result.canceled ? null : result.filePath;
      },
      // Notes (encrypted with your Keychain)
      'notes-list': () => this.notes.list(),
      'notes-save': (_e, note) => this.notes.saveNote(note || {}),
      'notes-delete': (_e, id) => this.notes.remove(String(id)),
      'events-list': () => this.notes.events(),
      'events-save': (_e, event) => this.notes.saveEvent(event || {}),
      'events-delete': (_e, id) => this.notes.removeEvent(String(id)),
      // System
      stats: (_e, opts) => system.stats({ withProcesses: Boolean(opts?.processes) }),
      hardware: () => system.hardware(),
      'quit-process': (_e, pid) => {
        // One real process: never 0 or negative (those mean "every process"), never VRK itself.
        const target = Number(pid);
        if (!Number.isInteger(target) || target <= 1 || target === process.pid) throw new Error('That process can’t be quit from here.');
        process.kill(target, 'SIGTERM');
        return true;
      },
      // Terminal
      'pty-create': (entry, opts) => this.createPty(entry.id, opts || {}),
      'pty-resize': (entry, id, cols, rows) => {
        const p = this.ptys.get(String(id));
        if (p?.owner === entry.id) p.pty.resize(Math.max(10, Math.min(500, Number(cols) || 80)), Math.max(4, Math.min(300, Number(rows) || 24)));
      },
      'pty-kill': (entry, id) => this.ptys.get(String(id))?.owner === entry.id && this.killPty(String(id)),
      // Windows programs (Wine)
      'wine-status': () => this.wine.status(),
      'wine-setup': () => this.wine.setup(),
      'wine-programs': () => this.wine.programs(),
      'wine-run': (_e, file) => this.wine.run(String(file)),
      'wine-tool': (_e, name) => this.wine.tool(String(name)),
      // Mac app mirroring
      'mirror-sources': (_e, opts) => this.mirrorSources({ ask: Boolean(opts?.ask) }),
      'mirror-focus': (_e, sourceId) =>
        new Promise((resolve, reject) => {
          const windowNumber = /^window:(\d+):/.exec(String(sourceId))?.[1];
          if (!MAC) return reject(new Error('Switch to that app from the taskbar (or Alt+Tab).'));
          if (!windowNumber) return reject(new Error('Unknown window.'));
          execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', BRING_TO_FRONT, windowNumber], { timeout: 5000 }, (err, stdout) =>
            err || !String(stdout).trim() ? reject(new Error('That window isn’t open any more.')) : resolve(String(stdout).trim()),
          );
        }),
      'screen-settings': () => SETTINGS_PANES.screen && shell.openExternal(SETTINGS_PANES.screen),
      // VRKOS settings and the wallpaper
      'os-settings': () => ({ clock24: this.settings.get('osClock24'), startup: this.settings.get('osStartup'), wallpaper: this.settings.get('osWallpaper'), themes: this.browser.themes.list().map((t) => ({ id: t.id, name: t.name, classic: Boolean(t.classic) })) }),
      'set-os-setting': (_e, key, value) => ['osClock24', 'osStartup', 'osWallpaper', 'osWelcomed'].includes(key) && this.settings.set(key, value),
    };
    ipcMain.handle('vrkos:call', async (event, name, ...args) => {
      const entry = this.windowFor(event.sender); // only VRKOS's own windows
      if (!entry || !Object.hasOwn(calls, name)) throw new Error('Not allowed.');
      if (this.browser.locked && !['state', 'theme', 'info', 'unlock', 'raise'].includes(name)) throw new Error('VRK is locked.');
      return calls[name](entry, ...args);
    });
    // Typing in a terminal is frequent: a one-way message.
    ipcMain.on('vrkos:pty-write', (event, id, data) => {
      const entry = this.windowFor(event.sender);
      const pty = this.ptys.get(String(id));
      if (entry && pty && pty.owner === entry.id && typeof data === 'string') pty.pty.write(data);
    });
    this.settings.on('change', (key) => {
      if (['themeId', 'osWallpaper'].includes(key)) this.sendTheme();
      if (['osClock24', 'osWallpaper', 'osStartup'].includes(key)) this.broadcast();
    });
  }
}

function asPaths(list) {
  if (!Array.isArray(list)) throw new Error('Expected a list of files.');
  return list.slice(0, 1000).map((p) => path.resolve(String(p)));
}

module.exports = { VrkOS, APPS };
