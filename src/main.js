'use strict';
// VRK — a private, ad-blocking browser on the latest Chromium, with Tor tabs
// and a built-in WireGuard VPN.

const { app, Menu, protocol } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Remote debugging would hand every tab (including Tor tabs) to any local
// program that connects, so a packaged VRK refuses to start with it.
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe'].some((name) => app.commandLine.hasSwitch(name))) {
  app.exit(1);
}

// ── 1. Throwaway profile ──────────────────────────────────────────────────
// Anything Chromium would normally keep (cookies, cache, history, GPU and code
// caches, crash dumps, Tor state) goes to a temp folder deleted on quit.
// Must run before the app is ready.
const PROFILE_PREFIX = 'vrk-profile-';
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
fs.writeFileSync(path.join(profileDir, '.owner'), String(process.pid));
// Settings, filter lists and encrypted VPN configs only. Never browsing data.
const configDir = process.env.VRK_CONFIG_DIR || path.join(app.getPath('appData'), 'VRK');
app.setPath('userData', profileDir);
app.setPath('sessionData', profileDir);
app.setPath('crashDumps', path.join(profileDir, 'crashes'));
app.setAppLogsPath(path.join(profileDir, 'logs'));

// ── 2. Settings (some decide which Chromium features start) ───────────────
const { Settings } = require('./settings');
const settings = new Settings(path.join(configDir, 'prefs.json'));

// ── 3. Chromium hardening ─────────────────────────────────────────────────
const { Shield, USER_AGENT } = require('./shield');
const { Tor } = require('./tor');
const { Vpn } = require('./vpn');
const { PasswordVault, Bookmarks } = require('./vault');
const { History } = require('./history');
const { ThemeStore } = require('./themes');
const { Importer } = require('./import');
const { Browser } = require('./browser');
const { Updater } = require('./updater');
const { VrkOS } = require('./os');

app.enableSandbox();
app.userAgentFallback = USER_AGENT;
// The browser UI is served from vrk://ui instead of file:// (see browser.js).
// `stream` lets theme videos play (with seeking) from vrk://media.
protocol.registerSchemesAsPrivileged([{ scheme: 'vrk', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
app.commandLine.appendSwitch(
  'disable-features',
  [
    // Privacy Sandbox ad APIs (Topics, Protected Audience, Attribution Reporting, Shared Storage)
    'BrowsingTopics',
    'InterestGroupStorage',
    'Fledge',
    'AdInterestGroupAPI',
    'PrivacySandboxAdsAPIsOverride',
    'ConversionMeasurement',
    'AttributionReportingCrossAppWeb',
    'SharedStorageAPI',
    'FencedFrames',
    // Background services that phone home
    'MediaRouter',
    'DialMediaRouteProvider',
    'OptimizationHints',
    'AutofillServerCommunication',
    // Electron has no FedCM account chooser; without it, "Sign in with Google"
    // buttons fall back to their reliable popup flow.
    'FedCm',
    // Lockdown mode: no WebGPU (a large, young attack surface).
    ...(settings.launched.lockdown ? ['WebGPUService'] : []),
  ].join(','),
);
// Chromium reads one list of features to turn on, so they're gathered here.
const enabledFeatures = [
  // Encrypted Client Hello: hides which site you visit from your network, where sites support it.
  'EncryptedClientHello',
];
// Block third-party cookies inside Chromium itself, so embedded trackers can't
// keep them through document.cookie either (the shield strips the headers too).
if (settings.launched.blockThirdPartyCookies) enabledFeatures.push('ForceThirdPartyCookieBlockingEnabled');
app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','));
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
// Lockdown mode (like Safari's): no JavaScript JIT compiler, the part of the
// engine most browser exploits target. That also turns off WebAssembly.
if (settings.launched.lockdown) app.commandLine.appendSwitch('js-flags', '--jitless');
app.commandLine.appendSwitch('no-pings'); // ignore <a ping> click tracking
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// ── 4. Clean up after crashed runs ────────────────────────────────────────
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function sweepStaleProfiles() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const dir = path.join(os.tmpdir(), name);
    if (dir === profileDir) continue;
    let pid = 0;
    try {
      pid = Number(fs.readFileSync(path.join(dir, '.owner'), 'utf8'));
    } catch {}
    if (!pid || !isAlive(pid)) fs.rmSync(dir, { recursive: true, force: true });
  }
}
sweepStaleProfiles();

// The profile is deleted by a tiny helper that waits until VRK has fully
// exited, since Chromium keeps writing during shutdown. Arming it at launch
// means the profile is erased even if VRK crashes or is force-quit.
if (process.platform === 'win32') {
  const ps = `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }; Remove-Item -LiteralPath $env:VRK_WIPE -Recurse -Force -ErrorAction SilentlyContinue`;
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, VRK_WIPE: profileDir } }).unref();
} else {
  spawn('/bin/sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 0.5; done; rm -rf "$2"', 'vrk-wipe', String(process.pid), profileDir], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

// ── 5. App lifecycle ──────────────────────────────────────────────────────
const resourcesDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const vendorDir = path.join(resourcesDir, 'vendor');
let browser = null;
const pendingUrls = [];

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event) => {
    if (/^(vrk|file|chrome|chrome-untrusted|devtools|view-source):/i.test(event.url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' })); // tabs install their own handler
});

// Never volunteer a client certificate (Electron would otherwise pick the first one).
app.on('select-client-certificate', (event, _contents, _url, _list, callback) => {
  event.preventDefault();
  callback();
});

// Links from other apps (VRK as the default browser). Only web pages: other
// apps can't open VRK's own pages or local files this way.
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (!/^https?:\/\//i.test(url)) return;
  if (browser) browser.openFromOtherApp(url);
  else pendingUrls.push(url);
});

app.on('window-all-closed', () => app.quit());

// Erase site data (except kept sign-ins) before quitting; give up after 5s.
let quitReady = false;
app.on('before-quit', (event) => {
  if (browser) browser.quitting = true; // VRKOS stops keeping the browser window open
  if (quitReady || !browser) return;
  event.preventDefault();
  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  Promise.race([browser.prepareQuit().catch(() => {}), timeout]).finally(() => {
    quitReady = true;
    app.quit();
  });
});
app.on('will-quit', () => {
  browser?.updater?.installOnExit(); // a tested security update waiting? swap it in as VRK closes
  browser?.shutdown();
});

app.whenReady().then(() => {
  // Encrypted DNS for direct connections. (Tor and VPN traffic resolve names remotely.)
  configureDns(settings);

  const shield = new Shield({ configDir, assetsDir: path.join(__dirname, '..', 'assets'), settings });
  const tor = new Tor({ root: path.join(vendorDir, 'tor'), runtimeDir: profileDir, bridge: settings.get('torBridge'), isolateSites: settings.get('torIsolateSites') });
  const vpn = new Vpn({ binary: path.join(vendorDir, 'wireproxy', process.platform === 'win32' ? 'wireproxy.exe' : 'wireproxy'), configDir, runtimeDir: profileDir });
  const vault = new PasswordVault(path.join(configDir, 'passwords.bin'));
  const bookmarks = new Bookmarks(path.join(configDir, 'bookmarks.bin'));
  const importer = new Importer({ shield, vault, bookmarks, settings });
  // Memory-only mode never writes history to disk, whatever the history setting says.
  const history = new History(settings.launched.memoryOnly ? null : configDir);
  history.prune(settings.get('historyDays'));
  const themes = new ThemeStore(configDir);
  const updater = new Updater({ settings, configDir, fetchFn: (url) => shield.updateSession.fetch(url) });
  browser = new Browser({ shield, tor, vpn, settings, vault, bookmarks, importer, history, themes, updater, configDir, initialUrls: pendingUrls.splice(0) });
  updater.start();
  browser.os = new VrkOS({ browser, settings, configDir });
  if (settings.get('osStartup')) browser.win.once('ready-to-show', () => browser.os.enter());
  // The History menu lists recent visits, so rebuild the app menu when history changes.
  const refreshMenu = () => Menu.setApplicationMenu(buildAppMenu(browser));
  refreshMenu();
  let menuTimer = null;
  const queueMenu = () => {
    clearTimeout(menuTimer);
    menuTimer = setTimeout(refreshMenu, 1500);
  };
  history.on('change', queueMenu);
  browser.onLockChange = refreshMenu;
  settings.on('change', (key) => ['saveHistory', 'containers', 'osActive'].includes(key) && queueMenu());

  // If the VPN was on when VRK quit, reconnect before anything loads (the kill switch holds traffic).
  if (settings.get('vpnOn') && vpn.active) browser.vpnConnect();
  setTimeout(() => shield.refreshLists().catch(() => {}), 15000);

  // Development-only harnesses (not shipped in the packaged app).
  if (!app.isPackaged && process.env.VRK_SELFTEST) {
    require(process.env.VRK_SELFTEST_FILE || '../scripts/selftest')({ browser, shield, tor, vpn, vault, bookmarks, importer, settings, history, themes, profileDir });
  }
  if (!app.isPackaged && process.env.VRK_SHOTS) require('../scripts/screenshots')({ browser, settings, bookmarks, importer, history, themes });
});

// Encrypted DNS (DNS over HTTPS) for direct connections, from the provider
// you chose. It's "secure" mode: never falls back to unencrypted DNS.
const DNS_PROVIDERS = {
  quad9: ['https://dns.quad9.net/dns-query', 'https://security.cloudflare-dns.com/dns-query'],
  cloudflare: ['https://security.cloudflare-dns.com/dns-query'],
  mullvad: ['https://base.dns.mullvad.net/dns-query'],
  adguard: ['https://dns.adguard-dns.com/dns-query'],
};
function dnsServers(s) {
  const provider = s.get('dnsProvider');
  if (provider === 'nextdns' && s.get('nextdnsId')) return [`https://dns.nextdns.io/${s.get('nextdnsId')}`];
  if (provider === 'custom' && s.get('dnsCustomUrl')) return [s.get('dnsCustomUrl')];
  return DNS_PROVIDERS[provider] || DNS_PROVIDERS.quad9;
}
function configureDns(s) {
  app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: dnsServers(s) });
}
settings.on('change', (key) => {
  if (app.isReady() && ['dnsProvider', 'nextdnsId', 'dnsCustomUrl'].includes(key)) configureDns(settings);
});

function buildAppMenu(b) {
  const sep = { type: 'separator' };
  const tabItems = Array.from({ length: 8 }, (_, i) => ({
    label: `Tab ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => b.selectTab(i),
  }));
  return Menu.buildFromTemplate([
    {
      label: 'VRK',
      submenu: [
        { label: 'About VRK', click: () => b.showAbout() },
        { label: 'VRK Features & Comparison', click: () => b.openInternal('features') },
        { type: 'separator' },
        { label: b.os?.active ? 'Show VRKOS Desktop' : 'VRKOS Desktop', accelerator: 'Alt+CmdOrCtrl+O', click: () => b.os?.enter() },
        { label: 'Leave VRKOS', enabled: Boolean(b.os?.active), click: () => b.os?.leave() },
        sep,
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => b.openSettings() },
        { label: 'Make VRK Your Default Browser…', click: () => b.openSettings('general') },
        { label: 'Theme Editor…', click: () => b.openInternal('themes') },
        sep,
        { label: 'Burn Browsing Data', accelerator: 'Shift+CmdOrCtrl+Backspace', click: () => b.burn() },
        sep,
        { role: 'services' },
        sep,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => b.createTab() },
        { label: 'New Tor Tab', accelerator: 'Shift+CmdOrCtrl+N', click: () => b.createTab(null, { tor: true }) },
        { label: 'New Container Tab', submenu: [...b.containerMenuItems((container) => b.createTab(null, { container })), { type: 'separator' }, { label: 'Manage Containers…', click: () => b.openSettings('general') }] },
        { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: () => b.focusAddress() },
        sep,
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => b.os?.closeFocusedApp() || b.closeTab(b.activeId) },
        sep,
        { label: 'Import from Another Browser…', click: () => b.openSettings('import') },
        sep,
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => b.print() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        sep,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
        sep,
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => b.openFind() },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => b.findNext(true) },
        { label: 'Find Previous', accelerator: 'Shift+CmdOrCtrl+G', click: () => b.findNext(false) },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => b.reload() },
        { label: 'Force Reload', accelerator: 'Shift+CmdOrCtrl+R', click: () => b.reload(true) },
        { label: 'Stop', accelerator: 'CmdOrCtrl+.', click: () => b.stop() },
        sep,
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => b.zoom(0) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => b.zoom(1) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => b.zoom(-1) },
        sep,
        { role: 'togglefullscreen' },
        sep,
        { label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => b.toggleDevTools() },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => b.back() },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => b.forward() },
        { label: 'Reopen Closed Tab', accelerator: 'Shift+CmdOrCtrl+T', click: () => b.reopenClosedTab() },
        sep,
        { label: 'Show All History', accelerator: 'CmdOrCtrl+Y', click: () => b.openInternal('history') },
        { label: 'Clear Browsing History…', click: () => b.openInternal('history') },
        ...(b.settings.get('saveHistory')
          ? [sep, { label: 'Recently Visited', enabled: false }, ...b.recentHistoryItems(12)]
          : [sep, { label: 'History is off (Private mode)', enabled: false }]),
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => b.cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => b.cycleTab(-1) },
        { label: 'Select Next Tab', accelerator: 'Shift+CmdOrCtrl+]', click: () => b.cycleTab(1) },
        { label: 'Select Previous Tab', accelerator: 'Shift+CmdOrCtrl+[', click: () => b.cycleTab(-1) },
        sep,
        ...tabItems,
        { label: 'Last Tab', accelerator: 'CmdOrCtrl+9', click: () => b.selectTab(-1) },
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: () => b.toggleBookmark() },
        {
          label: 'Show Bookmarks Bar',
          accelerator: 'Shift+CmdOrCtrl+B',
          click: () => b.settings.set('bookmarksBar', b.settings.get('bookmarksBar') === 'always' ? 'newtab' : 'always'),
        },
        sep,
        { label: 'Passwords', click: () => b.openSettings('passwords') },
        { label: 'Extensions', click: () => b.openSettings('extensions') },
      ],
    },
    {
      label: 'Privacy',
      submenu: [
        { label: 'Turn VPN On or Off', accelerator: 'Shift+CmdOrCtrl+V', click: () => (b.vpn.state === 'off' ? b.vpnConnect() : b.vpnDisconnect()) },
        { label: 'Import WireGuard Config…', click: () => b.importVpnConfig() },
        sep,
        { label: 'New Tor Tab', click: () => b.createTab(null, { tor: true }) },
        { label: 'New Tor Identity', accelerator: 'Shift+CmdOrCtrl+U', click: () => b.newTorIdentity() },
        sep,
        { label: 'Privacy Settings…', click: () => b.openSettings('privacy') },
        { label: 'Burn Browsing Data', click: () => b.burn() },
      ],
    },
    { role: 'windowMenu' },
  ]);
}
