'use strict';
// VRK's preferences. Every value is validated against SCHEMA, so a damaged or
// hand-edited prefs.json can never put the browser into an unknown state.

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SCHEMA = {
  theme: ['dark', 'light', 'system'],
  accent: ['violet', 'teal', 'blue', 'pink', 'orange', 'green', 'red', 'gold'],
  density: ['comfortable', 'compact'],
  ntpBackground: ['aurora', 'midnight', 'sunset', 'ocean', 'plain'],
  ntpShowStats: 'boolean',
  ntpShowBookmarks: 'boolean',
  bookmarksBar: ['always', 'newtab', 'never'],
  showVpnButton: 'boolean',
  showTorButton: 'boolean',
  showBurnButton: 'boolean',
  searchEngine: ['duckduckgo', 'brave', 'startpage', 'google', 'bing', 'ecosia'],
  blockAds: 'boolean',
  blockBait: 'boolean',
  blockDangerous: 'boolean',
  fingerprintProtection: 'boolean',
  passkeys: 'boolean',
  downloadProtection: 'boolean',
  clipboardGuard: 'boolean',
  lookalikeWarnings: 'boolean',
  lockdown: 'boolean',
  appLock: 'boolean',
  appLockMinutes: ['1', '5', '15', '60'],
  jsDefault: ['allow', 'block'],
  jsBlockedSites: 'sites',
  jsAllowedSites: 'sites',
  extensionBlockedSites: 'sites',
  notificationPrompts: ['ask', 'block'],
  interceptionWarnings: 'boolean',
  dnsProvider: ['quad9', 'cloudflare', 'mullvad', 'adguard', 'nextdns', 'custom'],
  nextdnsId: 'nextdns',
  dnsCustomUrl: 'https-url',
  torIsolateSites: 'boolean',
  containers: 'containers',
  skipTrackingRedirects: 'boolean',
  trimReferrers: 'boolean',
  forgetOnClose: 'boolean',
  rejectCookieBanners: 'boolean',
  autoUpdate: 'boolean',
  osActive: 'boolean',
  osStartup: 'boolean',
  osClock24: 'boolean',
  osWelcomed: 'boolean',
  osWallpaper: 'id',
  passwordReuseAlerts: 'boolean',
  breachAlerts: 'boolean',
  httpsOnly: 'boolean',
  stripTrackingParams: 'boolean',
  sendGpc: 'boolean',
  blockThirdPartyCookies: 'boolean',
  clearOnQuit: 'boolean',
  memoryOnly: 'boolean',
  keepSites: 'sites',
  offerPasswords: 'boolean',
  downloadsAsk: 'boolean',
  torSecurity: ['standard', 'safer', 'safest'],
  torBridge: ['auto', 'none', 'snowflake', 'obfs4', 'meek'],
  vpnOn: 'boolean',
  saveHistory: 'boolean',
  historyDays: ['30', '90', '365', 'forever'],
  showSplash: 'boolean',
  themeId: 'id',
  settingsVersion: 'version',
};

const DEFAULTS = {
  theme: 'dark',
  accent: 'violet',
  density: 'comfortable',
  ntpBackground: 'aurora',
  ntpShowStats: true,
  ntpShowBookmarks: true,
  bookmarksBar: 'newtab',
  showVpnButton: true,
  showTorButton: true,
  showBurnButton: true,
  searchEngine: 'google',
  blockAds: true,
  blockBait: false,
  blockDangerous: true,
  fingerprintProtection: true,
  passkeys: true,
  downloadProtection: true,
  clipboardGuard: true,
  lookalikeWarnings: true,
  lockdown: false,
  appLock: false,
  appLockMinutes: '5',
  jsDefault: 'allow',
  jsBlockedSites: [],
  jsAllowedSites: [],
  notificationPrompts: 'block',
  interceptionWarnings: true,
  dnsProvider: 'quad9',
  nextdnsId: '',
  dnsCustomUrl: '',
  torIsolateSites: true,
  skipTrackingRedirects: true,
  trimReferrers: true,
  forgetOnClose: false,
  rejectCookieBanners: true,
  autoUpdate: true,
  osActive: false,
  osStartup: false,
  osClock24: false,
  osWelcomed: false,
  osWallpaper: 'auto',
  containers: [
    { id: 'school', name: 'School', color: 'blue' },
    { id: 'shopping', name: 'Shopping', color: 'orange' },
  ],
  // Banks and money apps: extensions never run there.
  extensionBlockedSites: [
    'paypal.com', 'venmo.com', 'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'capitalone.com', 'citi.com', 'usbank.com',
    'americanexpress.com', 'discover.com', 'schwab.com', 'fidelity.com', 'vanguard.com', 'robinhood.com', 'coinbase.com',
    'navyfederal.org', 'usaa.com', 'ally.com', 'sofi.com', 'chime.com', 'pnc.com', 'tdbank.com', 'truist.com',
  ],
  passwordReuseAlerts: true,
  breachAlerts: true,
  httpsOnly: true,
  stripTrackingParams: true,
  sendGpc: true,
  blockThirdPartyCookies: true,
  clearOnQuit: false,
  memoryOnly: false,
  keepSites: [],
  offerPasswords: true,
  downloadsAsk: true,
  torSecurity: 'standard',
  torBridge: 'auto',
  vpnOn: false,
  saveHistory: true,
  historyDays: '90',
  showSplash: true,
  themeId: 'classic',
  settingsVersion: 3,
};

// Browsing modes are presets over three settings.
const MODES = {
  standard: { saveHistory: true, clearOnQuit: false, memoryOnly: false }, // the default: like a normal browser
  private: { saveHistory: false, clearOnQuit: true, memoryOnly: false }, // no history, erase on quit
  memory: { saveHistory: false, clearOnQuit: true, memoryOnly: true }, // nothing ever touches the disk
};

// Settings Chromium reads once at startup.
const RESTART_KEYS = new Set(['blockThirdPartyCookies', 'memoryOnly', 'lockdown']);

function valid(key, value) {
  const rule = SCHEMA[key];
  if (Array.isArray(rule)) return rule.includes(value);
  if (rule === 'boolean') return typeof value === 'boolean';
  if (rule === 'id') return typeof value === 'string' && /^[a-z0-9-]{1,64}$/i.test(value);
  if (rule === 'version') return Number.isInteger(value) && value >= 1;
  if (rule === 'containers') {
    const colors = ['blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];
    return (
      Array.isArray(value) &&
      value.length <= 12 &&
      new Set(value.map((c) => c?.id)).size === value.length &&
      value.every((c) => c && /^[a-z0-9-]{1,32}$/.test(c.id) && typeof c.name === 'string' && c.name.length >= 1 && c.name.length <= 30 && colors.includes(c.color))
    );
  }
  if (rule === 'nextdns') return typeof value === 'string' && /^[a-z0-9]{0,32}$/i.test(value);
  if (rule === 'https-url') {
    if (value === '') return true;
    try {
      const u = new URL(value);
      return typeof value === 'string' && value.length <= 300 && u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }
  if (rule === 'sites') {
    return Array.isArray(value) && value.length <= 5000 && value.every((s) => typeof s === 'string' && /^[a-z0-9.-]{1,253}$/i.test(s));
  }
  return false;
}

class Settings extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.values = { ...DEFAULTS };
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [key, value] of Object.entries(saved)) if (valid(key, value)) this.values[key] = value;
    } catch {
      // First run, or an unreadable file: defaults.
    }
    // Version 2 made Standard mode (history on, sign-ins kept) the default.
    if (saved && !(saved.settingsVersion >= 2)) {
      Object.assign(this.values, MODES.standard, { settingsVersion: 2 });
      this.migrated = true;
    }
    // Version 3 made Google the default search engine (switch it in the address bar).
    if (saved && !(saved.settingsVersion >= 3)) {
      Object.assign(this.values, { searchEngine: 'google', settingsVersion: 3 });
      this.migrated = true;
    }
    // Snapshot of restart-only settings as they were when VRK launched.
    this.launched = Object.fromEntries([...RESTART_KEYS].map((key) => [key, this.values[key]]));
    if (this.migrated) this.save();
  }

  get(key) {
    return this.values[key];
  }

  all() {
    return { ...this.values, keepSites: [...this.values.keepSites] };
  }

  set(key, value) {
    if (!valid(key, value)) return false;
    if (JSON.stringify(this.values[key]) === JSON.stringify(value)) return true;
    this.values[key] = value;
    this.save();
    this.emit('change', key, value);
    return true;
  }

  mode() {
    return Object.keys(MODES).find((name) => Object.entries(MODES[name]).every(([k, v]) => this.values[k] === v)) || 'custom';
  }

  setMode(name) {
    if (!MODES[name]) return false;
    for (const [key, value] of Object.entries(MODES[name])) this.set(key, value);
    return true;
  }

  pendingRestart() {
    return [...RESTART_KEYS].filter((key) => this.values[key] !== this.launched[key]);
  }

  keepSite(site, keep) {
    return this.setSite('keepSites', site, keep);
  }

  // Adds a site to (or removes it from) one of the site lists.
  setSite(key, site, on) {
    const sites = new Set(this.values[key]);
    if (on) sites.add(site);
    else sites.delete(site);
    return this.set(key, [...sites].sort());
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
  }
}

module.exports = { Settings, DEFAULTS, MODES };
