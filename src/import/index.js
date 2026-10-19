'use strict';
// Imports passwords, sign-ins (cookies) and bookmarks from other browsers on
// this Mac, plus password CSV files and bookmark HTML files from any browser.
// Browser databases are copied to a temporary folder first (browsers keep
// them locked while running), read, then deleted. Nothing is uploaded
// anywhere.
//
// Chromium-based browsers encrypt passwords and cookies with a key kept in the
// macOS Keychain, so importing them shows a Keychain prompt you approve.
//
// macOS also guards other apps' data folders. When VRK isn't allowed to read
// a browser's folder, detect() says so (blocked: true) instead of hiding the
// browser, and you can pick the profile folder yourself: choosing it in the
// macOS file picker gives VRK access to just that folder.

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { getDomain } = require('tldts');
const { masterKeys, decryptLogins, PrimaryPasswordError } = require('./firefox-crypto');

const HOME = os.homedir();
const APP_SUPPORT = path.join(HOME, 'Library', 'Application Support');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const ROAMING = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

// Where each browser keeps its profiles on this computer.
const DIRS = {
  win32: {
    chrome: [LOCAL, 'Google/Chrome/User Data'], edge: [LOCAL, 'Microsoft/Edge/User Data'], brave: [LOCAL, 'BraveSoftware/Brave-Browser/User Data'],
    opera: [ROAMING, 'Opera Software/Opera Stable'], 'opera-gx': [ROAMING, 'Opera Software/Opera GX Stable'], vivaldi: [LOCAL, 'Vivaldi/User Data'],
    arc: [LOCAL, 'Packages/TheBrowserCompany.Arc_ttt1ap7aakyb4/LocalCache/Local/Arc/User Data'], chromium: [LOCAL, 'Chromium/User Data'], firefox: [ROAMING, 'Mozilla/Firefox'],
  },
  linux: {
    chrome: [CONFIG, 'google-chrome'], edge: [CONFIG, 'microsoft-edge'], brave: [CONFIG, 'BraveSoftware/Brave-Browser'], opera: [CONFIG, 'opera'],
    vivaldi: [CONFIG, 'vivaldi'], chromium: [CONFIG, 'chromium'], firefox: [HOME, fs.existsSync(path.join(HOME, '.mozilla', 'firefox')) ? '.mozilla/firefox' : 'snap/firefox/common/.mozilla/firefox'],
  },
};
// Linux keyring names (secret-tool lookup application …).
const LINUX_KEYRING = { chrome: 'chrome', chromium: 'chromium', brave: 'brave', edge: 'microsoft-edge', opera: 'opera', vivaldi: 'vivaldi' };

function baseDir(b) {
  if (IS_MAC) return b.dir ? path.join(APP_SUPPORT, b.dir) : null;
  const entry = DIRS[process.platform]?.[b.id];
  return entry ? path.join(entry[0], entry[1]) : null;
}

const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', kind: 'chromium', dir: 'Google/Chrome', keychain: 'Chrome Safe Storage' },
  { id: 'edge', name: 'Microsoft Edge', kind: 'chromium', dir: 'Microsoft Edge', keychain: 'Microsoft Edge Safe Storage' },
  { id: 'brave', name: 'Brave', kind: 'chromium', dir: 'BraveSoftware/Brave-Browser', keychain: 'Brave Safe Storage' },
  { id: 'opera', name: 'Opera', kind: 'chromium', dir: 'com.operasoftware.Opera', keychain: 'Opera Safe Storage' },
  { id: 'opera-gx', name: 'Opera GX', kind: 'chromium', dir: 'com.operasoftware.OperaGX', keychain: 'Opera Safe Storage' },
  { id: 'vivaldi', name: 'Vivaldi', kind: 'chromium', dir: 'Vivaldi', keychain: 'Vivaldi Safe Storage' },
  { id: 'arc', name: 'Arc', kind: 'chromium', dir: 'Arc/User Data', keychain: 'Arc Safe Storage' },
  { id: 'chromium', name: 'Chromium', kind: 'chromium', dir: 'Chromium', keychain: 'Chromium Safe Storage' },
  { id: 'firefox', name: 'Firefox', kind: 'firefox', dir: 'Firefox' },
  { id: 'safari', name: 'Safari', kind: 'safari' },
];

// Cookies that look like they keep you signed in. Only sites with one of
// these are imported, so years of tracking cookies don't come along.
const SIGN_IN_COOKIE = /(sess|auth|token|sid|login|logged|user|remember|account|jwt|^__host-|^__secure-|sapisid|ssid|hsid|lsid)/i;

const isBlocked = (err) => err?.code === 'EPERM' || err?.code === 'EACCES';
const blockedMessage = (name) =>
  `macOS didn’t let VRK read ${name}’s data. Use “Choose Profile Folder…” to pick it, or allow VRK under System Settings → Privacy & Security → Full Disk Access.`;

function readable(dir) {
  try {
    fs.readdirSync(dir);
    return true;
  } catch (err) {
    if (isBlocked(err)) return false;
    throw err;
  }
}

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  );

const siteOfHost = (host) => {
  const h = String(host || '').replace(/^\./, '');
  return getDomain(h) || h;
};

function originOf(url) {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

// Copies a (possibly locked) SQLite database with its journal, opens the copy.
function openCopy(file, tmp) {
  const copy = path.join(tmp, `${crypto.randomUUID()}.db`);
  fs.copyFileSync(file, copy);
  for (const suffix of ['-wal', '-journal']) {
    if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, copy + suffix);
  }
  return new DatabaseSync(copy, { readOnly: true });
}

// ── Chromium family ──────────────────────────────────────────────────────

function chromiumProfiles(base) {
  if (fs.existsSync(path.join(base, 'Login Data')) || fs.existsSync(path.join(base, 'Bookmarks'))) {
    return [{ id: '.', name: 'Default' }]; // Opera keeps a single profile at the top level
  }
  let names = {};
  try {
    names = JSON.parse(fs.readFileSync(path.join(base, 'Local State'), 'utf8')).profile?.info_cache || {};
  } catch {}
  const dirs = new Set(Object.keys(names));
  try {
    for (const entry of fs.readdirSync(base)) if (entry === 'Default' || /^Profile \d+$/.test(entry)) dirs.add(entry);
  } catch {}
  return [...dirs]
    .filter((dir) => fs.existsSync(path.join(base, dir)))
    .map((dir) => ({ id: dir, name: names[dir]?.name || dir }));
}

// The key a Chromium browser encrypts passwords and cookies with:
//  - macOS: a secret in the Keychain (AES-128-CBC),
//  - Windows: a key in "Local State", locked to your Windows account with DPAPI (AES-256-GCM),
//  - Linux: a secret in the desktop keyring, or Chromium's built-in fallback (AES-128-CBC).
async function chromiumKey(b, base) {
  if (IS_WIN) {
    let wrapped;
    try {
      wrapped = Buffer.from(JSON.parse(fs.readFileSync(path.join(base, 'Local State'), 'utf8')).os_crypt.encrypted_key, 'base64');
    } catch {
      throw new Error(`VRK couldn't find ${b.name}'s encryption key.`);
    }
    if (wrapped.subarray(0, 5).toString() !== 'DPAPI') throw new Error(`${b.name} uses a key VRK can't read.`);
    const script = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:VRK_KEY), $null, 'CurrentUser'))`;
    const out = await new Promise((resolve, reject) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, VRK_KEY: wrapped.subarray(5).toString('base64') }, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
    ).catch(() => '');
    const key = Buffer.from(String(out).trim(), 'base64');
    if (key.length !== 32) throw new Error(`Windows didn't unlock ${b.name}'s key.`);
    return { gcm: key };
  }
  if (!IS_MAC) {
    let secret = '';
    try {
      secret = String(await run('secret-tool', ['lookup', 'application', LINUX_KEYRING[b.id] || b.id])).trim();
    } catch {}
    return { cbc: crypto.pbkdf2Sync(secret || 'peanuts', 'saltysalt', 1, 16, 'sha1'), fallback: crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1') };
  }
  let secret;
  try {
    secret = (await run('/usr/bin/security', ['find-generic-password', '-w', '-s', b.keychain])).trim();
  } catch {
    throw new Error(`VRK couldn't read “${b.keychain}” from your Keychain. Click Allow when macOS asks, then try again.`);
  }
  return { cbc: crypto.pbkdf2Sync(secret, 'saltysalt', 1003, 16, 'sha1') };
}

function decryptChromium(value, key, { stripDomainHash = false } = {}) {
  const buf = Buffer.from(value || []);
  if (!buf.length) return '';
  const prefix = buf.subarray(0, 3).toString('latin1');
  if (prefix === 'v20') throw new Error('This browser locks its passwords to itself (app-bound encryption). Export them from the browser as a CSV and import that instead.');
  if (prefix !== 'v10' && prefix !== 'v11') return buf.toString('utf8');
  let plain;
  if (key.gcm) {
    const nonce = buf.subarray(3, 15);
    const tag = buf.subarray(buf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key.gcm, nonce);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(buf.subarray(15, buf.length - 16)), decipher.final()]);
  } else {
    const cbc = (k) => {
      const decipher = crypto.createDecipheriv('aes-128-cbc', k, Buffer.alloc(16, 0x20));
      return Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]);
    };
    // Linux: v10 always uses Chromium's built-in key, v11 the keyring's.
    plain = prefix === 'v10' && key.fallback ? cbc(key.fallback) : cbc(key.cbc);
  }
  if (stripDomainHash) plain = plain.subarray(32); // newer databases prefix a SHA-256 of the domain
  return plain.toString('utf8');
}

function chromiumPasswords(dir, key, tmp) {
  const logins = [];
  for (const file of ['Login Data', 'Login Data For Account']) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    const db = openCopy(full, tmp);
    try {
      for (const row of db.prepare('SELECT origin_url, username_value, password_value, blacklisted_by_user FROM logins').all()) {
        if (row.blacklisted_by_user) continue;
        try {
          const password = decryptChromium(row.password_value, key);
          const origin = originOf(row.origin_url);
          if (origin && password) logins.push({ origin, username: row.username_value || '', password });
        } catch {}
      }
    } finally {
      db.close();
    }
  }
  return logins;
}

function chromiumCookies(dir, key, tmp) {
  const file = [path.join(dir, 'Network', 'Cookies'), path.join(dir, 'Cookies')].find((f) => fs.existsSync(f));
  if (!file) return [];
  const db = openCopy(file, tmp);
  try {
    const version = Number(db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value || 0);
    const columns = new Set(db.prepare('PRAGMA table_info(cookies)').all().map((c) => c.name));
    const partitioned = columns.has('top_frame_site_key') ? " AND (top_frame_site_key IS NULL OR top_frame_site_key = '')" : '';
    const cookies = [];
    const query = db.prepare(
      `SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies WHERE 1=1${partitioned}`,
    );
    // Expiry times (microseconds since 1601) are too big for a JS number.
    query.setReadBigInts(true);
    for (const row of query.all()) {
      try {
        const value = row.value || decryptChromium(row.encrypted_value, key, { stripDomainHash: version >= 24 });
        // 0 means a session cookie.
        const expires = row.expires_utc ? Number(row.expires_utc / 1000000n) - 11644473600 : 0;
        cookies.push({
          host: row.host_key,
          name: row.name,
          value,
          path: row.path || '/',
          secure: Boolean(row.is_secure),
          httpOnly: Boolean(row.is_httponly),
          expires,
          sameSite: { 0: 'no_restriction', 1: 'lax', 2: 'strict' }[Number(row.samesite)] || 'unspecified',
        });
      } catch {}
    }
    return cookies;
  } finally {
    db.close();
  }
}

function chromiumBookmarks(dir) {
  const file = path.join(dir, 'Bookmarks');
  if (!fs.existsSync(file)) return { bar: [], other: [] };
  const roots = JSON.parse(fs.readFileSync(file, 'utf8')).roots || {};
  const convert = (nodes = []) =>
    nodes.map((n) => (n.type === 'folder' ? { title: n.name, children: convert(n.children) } : { title: n.name, url: n.url }));
  return { bar: convert(roots.bookmark_bar?.children), other: convert([...(roots.other?.children || []), ...(roots.synced?.children || [])]) };
}

// ── Firefox ──────────────────────────────────────────────────────────────

const isFirefoxProfile = (dir) => ['places.sqlite', 'logins.json', 'key4.db', 'cookies.sqlite'].some((f) => fs.existsSync(path.join(dir, f)));

function firefoxProfiles(base) {
  const profiles = [];
  let ini = '';
  try {
    ini = fs.readFileSync(path.join(base, 'profiles.ini'), 'utf8');
  } catch (err) {
    if (isBlocked(err)) throw err;
  }
  for (const block of ini.split(/^\[/m)) {
    if (!/^Profile\d+\]/.test(block)) continue;
    const field = (name) => block.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
    const rel = field('Path');
    if (!rel) continue;
    const dir = field('IsRelative') === '0' ? rel : path.join(base, rel);
    if (fs.existsSync(dir)) profiles.push({ id: dir, name: field('Name') || path.basename(dir) });
  }
  // Newer Firefox (profile groups) can keep profiles that profiles.ini doesn't list.
  const folder = path.join(base, 'Profiles');
  try {
    for (const entry of fs.readdirSync(folder)) {
      const dir = path.join(folder, entry);
      if (!profiles.some((p) => p.id === dir) && isFirefoxProfile(dir)) profiles.push({ id: dir, name: entry.replace(/^[a-z0-9]{8}\./, '') });
    }
  } catch {}
  // The profile Firefox uses most (most recently changed places.sqlite) first.
  const touched = (p) => {
    try {
      return fs.statSync(path.join(p.id, 'places.sqlite')).mtimeMs;
    } catch {
      return 0;
    }
  };
  return profiles.sort((a, b) => touched(b) - touched(a));
}

function firefoxPasswords(dir, tmp) {
  const loginsFile = path.join(dir, 'logins.json');
  if (!fs.existsSync(loginsFile)) return [];
  const db = openCopy(path.join(dir, 'key4.db'), tmp);
  try {
    const keys = masterKeys(db);
    return decryptLogins(JSON.parse(fs.readFileSync(loginsFile, 'utf8')), keys)
      .map((l) => ({ ...l, origin: originOf(l.origin) }))
      .filter((l) => l.origin && l.password);
  } catch (err) {
    if (err instanceof PrimaryPasswordError) {
      throw new Error('Firefox passwords are locked with a primary password. In Firefox, export them (Passwords → ⋯ → Export) and import the CSV file instead.');
    }
    throw err;
  } finally {
    db.close();
  }
}

function firefoxCookies(dir, tmp) {
  const file = path.join(dir, 'cookies.sqlite');
  if (!fs.existsSync(file)) return [];
  const db = openCopy(file, tmp);
  try {
    return db
      .prepare("SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE originAttributes = ''")
      .all()
      .map((row) => {
        const expiry = Number(row.expiry);
        return {
          host: row.host,
          name: row.name,
          value: row.value,
          path: row.path || '/',
          secure: Boolean(row.isSecure),
          httpOnly: Boolean(row.isHttpOnly),
          expires: expiry > 1e11 ? expiry / 1000 : expiry, // newer Firefox stores milliseconds
          sameSite: { 1: 'lax', 2: 'strict' }[row.sameSite] || (row.isSecure ? 'no_restriction' : 'unspecified'),
        };
      });
  } finally {
    db.close();
  }
}

function firefoxBookmarks(dir, tmp) {
  const file = path.join(dir, 'places.sqlite');
  if (!fs.existsSync(file)) return { bar: [], other: [] };
  const db = openCopy(file, tmp);
  try {
    const rows = db
      .prepare('SELECT b.id, b.type, b.parent, b.title, b.guid, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id ORDER BY b.parent, b.position')
      .all();
    const children = new Map();
    for (const row of rows) {
      if (!children.has(row.parent)) children.set(row.parent, []);
      children.get(row.parent).push(row);
    }
    const build = (id) =>
      (children.get(id) || [])
        .filter((r) => r.type === 1 || r.type === 2)
        .map((r) => (r.type === 2 ? { title: r.title, children: build(r.id) } : { title: r.title, url: r.url }));
    const root = (guid) => rows.find((r) => r.guid === guid)?.id;
    return {
      bar: build(root('toolbar_____')),
      other: ['menu________', 'unfiled_____', 'mobile______'].flatMap((guid) => build(root(guid))),
    };
  } finally {
    db.close();
  }
}

// ── Safari ───────────────────────────────────────────────────────────────

async function safariBookmarks() {
  const file = path.join(HOME, 'Library', 'Safari', 'Bookmarks.plist');
  let json;
  try {
    json = JSON.parse(await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]));
  } catch {
    throw new Error('macOS keeps Safari bookmarks private. In Safari, choose File → Export → Bookmarks, then import that file into VRK.');
  }
  const convert = (nodes = []) =>
    nodes
      .filter((n) => n.WebBookmarkType === 'WebBookmarkTypeLeaf' || (n.WebBookmarkType === 'WebBookmarkTypeList' && n.Title !== 'com.apple.ReadingList'))
      .map((n) =>
        n.WebBookmarkType === 'WebBookmarkTypeList'
          ? { title: n.Title, children: convert(n.Children) }
          : { title: n.URIDictionary?.title || n.URLString, url: n.URLString },
      );
  const roots = json.Children || [];
  const bar = roots.find((n) => n.Title === 'BookmarksBar');
  return { bar: convert(bar?.Children), other: convert(roots.filter((n) => n !== bar)).filter((n) => n.url || n.children?.length) };
}

// ── Files (any browser) ──────────────────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

// Chrome, Edge, Firefox, Safari/Passwords, Bitwarden and 1Password CSV exports.
function passwordsFromCsv(text) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  if (!header) return [];
  const names = header.map((h) => h.trim().toLowerCase());
  const col = (...options) => names.findIndex((n) => options.includes(n));
  const url = col('url', 'login_uri', 'website', 'origin', 'hostname', 'login url', 'web site');
  const user = col('username', 'login_username', 'login', 'user', 'email', 'login name');
  const pass = col('password', 'login_password');
  if (url < 0 || pass < 0) throw new Error("That CSV doesn't look like a password export (it needs URL and password columns).");
  return rows
    .map((r) => ({ origin: originOf(r[url] || ''), username: user >= 0 ? r[user] || '' : '', password: r[pass] || '' }))
    .filter((l) => l.origin && l.password);
}

const decodeEntities = (s) =>
  s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" })[m]);

// The Netscape bookmark file format every browser can export.
function bookmarksFromHtml(html) {
  const root = { children: [] };
  const stack = [root];
  let pendingFolder = null;
  let bar = null;
  const token = /<DT><H3([^>]*)>([\s\S]*?)<\/H3>|<DT><A\s+([^>]*)>([\s\S]*?)<\/A>|<DL>|<\/DL>/gi;
  for (let m = token.exec(html); m; m = token.exec(html)) {
    const top = stack[stack.length - 1];
    if (m[2] !== undefined) {
      pendingFolder = { title: decodeEntities(m[2].trim()), children: [] };
      top.children.push(pendingFolder);
      if (/PERSONAL_TOOLBAR_FOLDER="true"/i.test(m[1]) || /^(bookmarks ?bar|favorites|bookmarks toolbar)$/i.test(pendingFolder.title)) {
        bar ||= pendingFolder;
      }
    } else if (m[3] !== undefined) {
      const href = m[3].match(/HREF="([^"]*)"/i)?.[1];
      if (href) top.children.push({ title: decodeEntities(m[4].trim()), url: decodeEntities(href) });
    } else if (/^<DL>$/i.test(m[0])) {
      stack.push(pendingFolder || top);
      pendingFolder = null;
    } else if (stack.length > 1) {
      stack.pop();
    }
  }
  const nodes = root.children.length === 1 && root.children[0].children ? root.children[0].children : root.children;
  return { bar: bar ? bar.children : [], other: nodes.filter((n) => n !== bar) };
}

// ── Importer ─────────────────────────────────────────────────────────────

class Importer {
  constructor({ shield, vault, bookmarks, settings }) {
    Object.assign(this, { shield, vault, bookmarks, settings });
    this.picked = new Map(); // browser id -> profile folders you chose (this session)
  }

  // Which browsers are installed, and their profiles. Reads no browsing data.
  detect() {
    const found = [];
    for (const b of BROWSERS) {
      if (b.kind === 'safari') {
        if (IS_MAC && fs.existsSync(path.join(HOME, 'Library', 'Safari'))) {
          found.push({ id: b.id, name: b.name, profiles: [{ id: '.', name: 'Safari' }], supports: { passwords: false, cookies: false, bookmarks: true } });
        }
        continue;
      }
      const base = baseDir(b) || path.join(HOME, '.vrk-none');
      const picked = this.picked.get(b.id) || [];
      if (!fs.existsSync(base) && !picked.length) continue;
      let profiles = [];
      let blocked = false;
      try {
        if (fs.existsSync(base) && readable(base)) profiles = b.kind === 'firefox' ? firefoxProfiles(base) : chromiumProfiles(base);
        else blocked = fs.existsSync(base);
      } catch (err) {
        if (!isBlocked(err)) throw err;
        blocked = true;
      }
      for (const p of picked) if (!profiles.some((x) => x.id === p.id)) profiles.push(p);
      if (profiles.length || blocked) {
        found.push({ id: b.id, name: b.name, profiles, blocked: blocked && !profiles.length, supports: { passwords: true, cookies: true, bookmarks: true } });
      }
    }
    return found;
  }

  // A profile folder you picked in the macOS file picker (which also gives
  // VRK permission to read it). The browser's main folder works too.
  addProfileFolder(browserId, dir) {
    const b = BROWSERS.find((x) => x.id === browserId && x.kind !== 'safari');
    if (!b) throw new Error('Unknown browser.');
    let profiles;
    try {
      if (b.kind === 'firefox') {
        profiles = isFirefoxProfile(dir) ? [{ id: dir, name: path.basename(dir).replace(/^[a-z0-9]{8}\./, '') }] : firefoxProfiles(dir);
      } else if (['Login Data', 'Bookmarks', 'Cookies'].some((f) => fs.existsSync(path.join(dir, f)))) {
        profiles = [{ id: dir, name: path.basename(dir) }];
      } else {
        profiles = chromiumProfiles(dir).map((p) => ({ id: path.join(dir, p.id), name: p.name }));
      }
    } catch (err) {
      if (isBlocked(err)) throw new Error(blockedMessage(b.name));
      throw err;
    }
    if (!profiles.length) throw new Error(`That folder doesn’t look like a ${b.name} profile. In ${b.name}, ${b.kind === 'firefox' ? 'open about:support and click “Show in Finder” next to Profile Folder' : 'open chrome://version and look for “Profile Path”'} to find it.`);
    const list = this.picked.get(b.id) || [];
    for (const p of profiles) if (!list.some((x) => x.id === p.id)) list.push(p);
    this.picked.set(b.id, list);
    return profiles;
  }

  // Where the file picker should start for a browser.
  profileFolderHint(browserId) {
    const b = BROWSERS.find((x) => x.id === browserId);
    const base = b && baseDir(b);
    if (!base) return HOME;
    return b.kind === 'firefox' ? path.join(base, 'Profiles') : base;
  }

  // what: { passwords, cookies, bookmarks }. session: where sign-ins go.
  async importBrowser({ browserId, profileId, what, session }) {
    const b = BROWSERS.find((x) => x.id === browserId);
    if (!b) throw new Error('Unknown browser.');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrk-import-'));
    const result = { passwords: 0, sites: 0, bookmarks: 0, errors: [] };
    const attempt = async (label, fn) => {
      try {
        await fn();
      } catch (err) {
        result.errors.push(`${label}: ${isBlocked(err) ? blockedMessage(b.name) : err.message}`);
      }
    };
    try {
      if (b.kind === 'safari') {
        if (what.bookmarks) await attempt('Bookmarks', async () => (result.bookmarks = this.bookmarks.importTree(await safariBookmarks(), b.name)));
        if (what.passwords) result.errors.push('Passwords: Safari keeps them in iCloud Keychain. Export them from the Passwords app (File → Export) and import the CSV.');
        return result;
      }
      // Only profiles detect() found, never an arbitrary path from the UI.
      const known = this.detect().find((x) => x.id === b.id)?.profiles.some((p) => p.id === profileId);
      if (!known) throw new Error('That profile no longer exists.');
      // Firefox profiles and folders you picked are full paths; Chromium's are relative to the browser's folder.
      const dir = b.kind === 'firefox' || path.isAbsolute(profileId) ? profileId : path.join(baseDir(b), profileId);

      let key = null;
      const needKey = b.kind === 'chromium' && (what.passwords || what.cookies);
      if (needKey) await attempt(IS_MAC ? 'Keychain' : 'Encryption key', async () => (key = await chromiumKey(b, path.isAbsolute(profileId) ? path.dirname(profileId) : baseDir(b))));

      if (what.passwords && (key || b.kind === 'firefox')) {
        await attempt('Passwords', async () => {
          const logins = b.kind === 'firefox' ? firefoxPasswords(dir, tmp) : chromiumPasswords(dir, key, tmp);
          result.passwords = this.vault.importMany(logins);
        });
      }
      if (what.cookies && (key || b.kind === 'firefox')) {
        await attempt('Sign-ins', async () => {
          const cookies = b.kind === 'firefox' ? firefoxCookies(dir, tmp) : chromiumCookies(dir, key, tmp);
          result.sites = await this.importSignIns(cookies, session);
        });
      }
      if (what.bookmarks) {
        await attempt('Bookmarks', async () => {
          const tree = b.kind === 'firefox' ? firefoxBookmarks(dir, tmp) : chromiumBookmarks(dir);
          result.bookmarks = this.bookmarks.importTree(tree, b.name);
        });
      }
      return result;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // Imports cookies only for sites you're signed in to, skips trackers, and
  // marks those sites "stay signed in" so VRK keeps them when it quits.
  async importSignIns(cookies, session) {
    const now = Date.now() / 1000;
    const signedIn = new Set();
    for (const c of cookies) {
      const host = c.host.replace(/^\./, '');
      if (SIGN_IN_COOKIE.test(c.name) && (c.expires === 0 || c.expires > now) && !this.shield.isTrackerHost(host)) {
        signedIn.add(siteOfHost(host));
      }
    }
    for (const c of cookies) {
      const host = c.host.replace(/^\./, '');
      if (!signedIn.has(siteOfHost(host)) || (c.expires && c.expires <= now)) continue;
      const details = {
        url: `${c.secure ? 'https' : 'http'}://${host}${c.path}`,
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
      };
      if (c.host.startsWith('.')) details.domain = c.host;
      if (c.expires) details.expirationDate = c.expires;
      await session.cookies.set(details).catch(() => {});
    }
    await session.cookies.flushStore().catch(() => {});
    if (signedIn.size) this.settings.set('keepSites', [...new Set([...this.settings.get('keepSites'), ...signedIn])].sort());
    return signedIn.size;
  }

  async importFile(file) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\.csv$/i.test(file)) return { passwords: this.vault.importMany(passwordsFromCsv(text)), sites: 0, bookmarks: 0, errors: [] };
    if (/<!DOCTYPE NETSCAPE-Bookmark-file-1>|<DT><A /i.test(text)) {
      return { passwords: 0, sites: 0, bookmarks: this.bookmarks.importTree(bookmarksFromHtml(text), path.basename(file)), errors: [] };
    }
    throw new Error('VRK can import password CSV files and bookmark HTML files.');
  }
}

module.exports = {
  Importer,
  // Exposed for the self-test, which runs them against synthetic profiles.
  internals: { passwordsFromCsv, bookmarksFromHtml, chromiumPasswords, chromiumCookies, chromiumBookmarks, firefoxPasswords, firefoxCookies, firefoxBookmarks },
};
