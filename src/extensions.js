'use strict';
// Browser extensions for VRK's normal tabs (never Tor tabs). Install them from:
//  - Chrome Web Store: its "Add to Chrome" buttons work inside VRK.
//  - Microsoft Edge Add-ons: Edge extensions are Chromium extensions; VRK
//    downloads the signed package and verifies its signature.
//  - Firefox Add-ons (experimental): converted to Chromium's format with
//    Mozilla's browser.* compatibility layer. Simple add-ons work; ones that
//    rely on Firefox-only APIs won't.
//  - A .crx, .zip or .xpi file, or an unpacked folder.

const { BrowserWindow, session: electronSession } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const AdmZip = require('adm-zip');

const PARTITION = 'vrk-main'; // how VRK's toolbar refers to the main profile
const POLYFILL = require.resolve('webextension-polyfill/dist/browser-polyfill.min.js');
const POLYFILL_NAME = 'vrk-browser-polyfill.js';
const EDGE_CRX_URL = (id) =>
  `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&prod=chromiumcrx&prodchannel=&x=id%3D${id}%26installsource%3Dondemand%26uc`;
const EXTENSION_ID = /^[a-p]{32}$/;

// ── CRX3 packages ────────────────────────────────────────────────────────

// Reads protobuf fields (only length-delimited and varint types occur here).
function protoFields(buf) {
  const fields = [];
  let pos = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = buf[pos++];
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return value;
      shift += 7;
    }
  };
  while (pos < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const type = key & 7;
    if (type === 2) {
      const length = varint();
      fields.push({ field, value: buf.subarray(pos, pos + length) });
      pos += length;
    } else if (type === 0) varint();
    else throw new Error('Unsupported CRX header.');
  }
  return fields;
}

const idFromKey = (publicKey) =>
  [...crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16).toString('hex')]
    .map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)))
    .join('');

// Verifies a CRX3 package's signature the way Chrome does and returns its contents.
function readCrx(buffer) {
  if (buffer.toString('latin1', 0, 4) !== 'Cr24' || buffer.readUInt32LE(4) !== 3) throw new Error('Not a valid CRX3 extension package.');
  const headerSize = buffer.readUInt32LE(8);
  const header = protoFields(buffer.subarray(12, 12 + headerSize));
  const archive = buffer.subarray(12 + headerSize);
  const signedHeader = header.find((f) => f.field === 10000)?.value;
  if (!signedHeader) throw new Error('The extension package is not signed.');
  const crxId = protoFields(signedHeader).find((f) => f.field === 1)?.value;
  const signedData = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), Buffer.alloc(4), signedHeader, archive]);
  signedData.writeUInt32LE(signedHeader.length, 16);
  for (const proof of header.filter((f) => f.field === 2)) {
    const parts = protoFields(proof.value);
    const publicKey = parts.find((p) => p.field === 1)?.value;
    const signature = parts.find((p) => p.field === 2)?.value;
    // The declared ID must belong to this key, and the key must have signed the package.
    if (!publicKey || !signature || !crxId) continue;
    if (!crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16).equals(crxId)) continue;
    const key = crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
    if (crypto.verify('sha256', signedData, key, signature)) return { id: idFromKey(publicKey), publicKey, archive };
  }
  throw new Error("The extension package's signature is invalid.");
}

// ── Firefox add-on conversion ────────────────────────────────────────────

const FIREFOX_ONLY_KEYS = ['browser_specific_settings', 'applications', 'sidebar_action', 'protocol_handlers', 'developer', 'user_scripts'];

function convertFirefoxAddon(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.theme) throw new Error('Firefox themes can’t be used in VRK.');
  for (const key of FIREFOX_ONLY_KEYS) delete manifest[key];
  if (Array.isArray(manifest.permissions)) {
    manifest.permissions = manifest.permissions.map((p) => (p === 'menus' ? 'contextMenus' : p));
  }
  fs.writeFileSync(path.join(dir, POLYFILL_NAME), fs.readFileSync(POLYFILL)); // readable from inside the app archive
  // Firefox background scripts become a Chromium service worker.
  if (manifest.manifest_version === 3 && manifest.background?.scripts) {
    const scripts = [POLYFILL_NAME, ...manifest.background.scripts].map((s) => JSON.stringify(`/${s.replace(/^\//, '')}`));
    fs.writeFileSync(path.join(dir, 'vrk-background.js'), `importScripts(${scripts.join(', ')});\n`);
    manifest.background = { service_worker: 'vrk-background.js' };
  } else if (manifest.background?.scripts) {
    manifest.background.scripts = [POLYFILL_NAME, ...manifest.background.scripts];
  }
  for (const entry of manifest.content_scripts || []) if (entry.js) entry.js = [POLYFILL_NAME, ...entry.js];
  // Extension pages (popups, options) get the polyfill before their own scripts.
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.html?$/i.test(entry.name)) {
        const html = fs.readFileSync(full, 'utf8');
        const tag = `<script src="/${POLYFILL_NAME}"></script>`;
        fs.writeFileSync(full, /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`) : tag + html);
      }
    }
  };
  walk(dir);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

// ── Site access ──────────────────────────────────────────────────────────
// Extensions read and change pages through their content scripts. VRK keeps
// those off protected sites (banks and the like, which you can add to), and
// can limit an extension to sites you choose, by adjusting the rules in its
// manifest. The extension's own rules are kept so they can be restored.

const SITE_ACCESS = 'vrk_site_access';
const sitePatterns = (sites) => sites.flatMap((site) => [`*://${site}/*`, `*://*.${site}/*`]);

// ── Manager ──────────────────────────────────────────────────────────────

class Extensions extends EventEmitter {
  constructor({ session, dir, metaFile, fetchSession, uiSession, hooks }) {
    super();
    Object.assign(this, { session, dir, metaFile, fetchSession, uiSession, hooks });
    this.meta = {};
    try {
      this.meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    } catch {}
    this.ready = false;
  }

  async init() {
    // The Web Store library downloads with Node's fetch, which would bypass
    // VRK's VPN and encrypted DNS; send it through VRK's network stack instead.
    globalThis.fetch = (input, init) => this.fetchSession.fetch(input, init);
    const { ElectronChromeExtensions, setSessionPartitionResolver } = require('electron-chrome-extensions');
    const webStore = require('electron-chrome-web-store');
    this.webStore = webStore;

    setSessionPartitionResolver((partition) => (partition === PARTITION ? this.session : electronSession.fromPartition(partition)));
    // VRK's toolbar loads extension icons from crx:// URLs.
    ElectronChromeExtensions.handleCRXProtocol(this.uiSession);
    this.api = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: this.session,
      createTab: (details) => this.hooks.createTab(details),
      selectTab: (wc) => this.hooks.selectTab(wc),
      removeTab: (wc) => this.hooks.removeTab(wc),
      createWindow: (details) => this.createWindow(details),
      removeWindow: (win) => win.destroy(),
    });
    this.api.on('browser-action-popup-created', () => this.emit('change'));
    this.session.extensions.on('extension-loaded', (_event, ext) => {
      this.emit('change');
      // Store updates replace the manifest: put the site rules back.
      if (this.ready) setImmediate(() => this.enforceSiteAccess(ext).catch(() => {}));
    });
    this.session.extensions.on('extension-unloaded', () => this.emit('change'));

    await webStore.installChromeWebStore({
      session: this.session,
      extensionsPath: this.dir,
      autoUpdate: true,
      loadExtensions: true,
      allowUnpackedExtensions: true,
      beforeInstall: async (details) => {
        const allow = await this.hooks.confirmInstall({ name: details.localizedName, source: 'Chrome Web Store', manifest: details.manifest });
        if (allow) this.setMeta(details.id, { source: 'chrome' });
        return { action: allow ? 'allow' : 'deny' };
      },
    });
    for (const [id, info] of Object.entries(this.meta)) {
      if (info.disabled && this.session.extensions.getExtension(id)) this.session.extensions.removeExtension(id);
    }
    await this.enforceAllSiteAccess();
    this.ready = true;
    this.emit('change');
  }

  // Windows extensions open (e.g. a password manager's pop-out).
  async createWindow(details) {
    const win = new BrowserWindow({
      width: details.width || 420,
      height: details.height || 640,
      ...(details.left != null ? { x: details.left, y: details.top } : {}),
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const url = Array.isArray(details.url) ? details.url[0] : details.url;
    if (url) win.loadURL(url);
    this.api.addTab(win.webContents, win);
    return win;
  }

  setMeta(id, info) {
    this.meta[id] = { ...(this.meta[id] || {}), ...info };
    this.saveMeta();
  }

  saveMeta() {
    fs.mkdirSync(path.dirname(this.metaFile), { recursive: true });
    fs.writeFileSync(this.metaFile, JSON.stringify(this.meta, null, 2));
  }

  list() {
    const loaded = this.session.extensions.getAllExtensions();
    const items = loaded.map((ext) => ({
      id: ext.id,
      name: ext.name,
      version: ext.version,
      description: ext.manifest.description || '',
      enabled: true,
      source: this.meta[ext.id]?.source || 'chrome',
      hasOptions: Boolean(ext.manifest.options_page || ext.manifest.options_ui?.page),
      path: ext.path,
    }));
    for (const [id, info] of Object.entries(this.meta)) {
      if (info.disabled && info.path && !items.some((i) => i.id === id)) {
        items.push({ id, name: info.name || id, version: info.version || '', description: '', enabled: false, source: info.source, hasOptions: false, path: info.path });
      }
    }
    for (const item of items) {
      item.delisted = this.meta[item.id]?.delisted || null;
      item.siteAccess = this.meta[item.id]?.siteAccess || 'all';
      item.sites = this.meta[item.id]?.sites || [];
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  optionsUrl(id) {
    const ext = this.session.extensions.getExtension(id);
    const page = ext?.manifest.options_page || ext?.manifest.options_ui?.page;
    return page ? `${ext.url}${page.replace(/^\//, '')}` : null;
  }

  async load(dir) {
    // New extensions get the protected-site rules before their first load.
    try {
      if (!JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))[SITE_ACCESS]) this.applySiteAccess(dir);
    } catch {}
    const ext = await this.session.extensions.loadExtension(dir);
    if (ext.manifest.manifest_version === 3 && ext.manifest.background?.service_worker) {
      await this.session.serviceWorkers.startWorkerForScope(ext.url.replace(/\/$/, '')).catch(() => {});
    }
    return ext;
  }

  async setEnabled(id, enabled) {
    const loaded = this.session.extensions.getExtension(id);
    if (!enabled && loaded) {
      this.setMeta(id, { disabled: true, path: loaded.path, name: loaded.name, version: loaded.version });
      this.session.extensions.removeExtension(id);
    } else if (enabled && !loaded && this.meta[id]?.path) {
      this.setMeta(id, { disabled: false });
      await this.load(this.meta[id].path);
    }
    this.emit('change');
  }

  async remove(id) {
    const ext = this.session.extensions.getExtension(id);
    const extPath = ext?.path || this.meta[id]?.path;
    if (ext) this.session.extensions.removeExtension(id);
    if (extPath && path.resolve(extPath).startsWith(path.resolve(this.dir) + path.sep)) {
      // Remove the extension's whole folder (store installs keep one per version).
      const top = path.join(this.dir, path.relative(this.dir, extPath).split(path.sep)[0]);
      const folder = this.meta[id]?.source === 'firefox' || this.meta[id]?.source === 'file' ? extPath : top;
      fs.rmSync(folder, { recursive: true, force: true });
    }
    delete this.meta[id];
    this.saveMeta();
    this.emit('change');
  }

  async download(url) {
    const res = await this.fetchSession.fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Signed Chromium package (Edge Add-ons, or a .crx file) → store layout.
  async installCrx(buffer, { source, confirm = true }) {
    const crx = readCrx(buffer);
    const zip = new AdmZip(crx.archive);
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    if (confirm && !(await this.hooks.confirmInstall({ name: manifest.name, source, manifest }))) return null;
    const target = path.join(this.dir, crx.id, `${manifest.version}_0`);
    fs.rmSync(path.join(this.dir, crx.id), { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    zip.extractAllTo(target, true);
    manifest.key = crx.publicKey.toString('base64'); // keeps the extension's real ID
    fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (this.session.extensions.getExtension(crx.id)) this.session.extensions.removeExtension(crx.id);
    const ext = await this.load(target);
    this.setMeta(ext.id, { source, disabled: false });
    return ext;
  }

  async installFromEdge(id) {
    if (!EXTENSION_ID.test(id)) throw new Error('That isn’t a valid Edge add-on ID.');
    return this.installCrx(await this.download(EDGE_CRX_URL(id)), { source: 'edge' });
  }

  async installFromFirefox(slug) {
    if (!/^[\w.@{}-]{1,200}$/.test(slug)) throw new Error('That isn’t a valid Firefox add-on.');
    const res = await this.fetchSession.fetch(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(slug)}/`);
    if (!res.ok) throw new Error('Firefox Add-ons didn’t recognise that add-on.');
    const info = await res.json();
    const file = info.current_version?.file;
    if (!file?.url) throw new Error('That add-on has no downloadable version.');
    const xpi = await this.download(file.url);
    const [algorithm, expected] = String(file.hash || '').split(':');
    if (algorithm !== 'sha256' || crypto.createHash('sha256').update(xpi).digest('hex') !== expected) {
      throw new Error('The downloaded add-on didn’t match its published checksum.');
    }
    const name = info.name?.['en-US'] || Object.values(info.name || {})[0] || slug;
    return this.installArchive(xpi, { source: 'firefox', folder: `firefox-${info.slug || slug}`, name, amo: info.slug || slug });
  }

  // A .zip/.xpi archive (Firefox add-on or unpacked Chromium extension).
  async installArchive(buffer, { source, folder, name, amo = null }) {
    const zip = new AdmZip(buffer);
    const manifest = JSON.parse(zip.readAsText('manifest.json') || 'null');
    if (!manifest) throw new Error('That archive has no extension manifest.');
    const firefox = source === 'firefox' || Boolean(manifest.browser_specific_settings || manifest.applications);
    if (!(await this.hooks.confirmInstall({ name: name || manifest.name, source: firefox ? 'Firefox Add-ons (experimental)' : 'a file', manifest }))) return null;
    const target = path.join(this.dir, 'unpacked', folder.replace(/[^\w.-]/g, '_'));
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    zip.extractAllTo(target, true);
    if (firefox) convertFirefoxAddon(target);
    const ext = await this.load(target);
    this.setMeta(ext.id, { source: firefox ? 'firefox' : 'file', disabled: false, ...(amo ? { amo } : {}) });
    return ext;
  }

  // ── Site access ──

  // Rewrites an extension's content-script rules (in its folder) if they
  // don't match yours. Returns true when the manifest changed, so a loaded
  // extension must reload. id is null for an extension not loaded yet.
  applySiteAccess(dir, id = null) {
    const file = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const original = manifest[SITE_ACCESS] ? manifest[SITE_ACCESS].original : manifest.content_scripts || null;
    if (!original?.length) return false;
    const info = (id && this.meta[id]) || {};
    const rules = {
      blocked: [...(this.hooks.blockedSites?.() || [])].sort(),
      only: info.siteAccess === 'list' ? [...(info.sites || [])].sort() : null,
    };
    const fingerprint = JSON.stringify(rules);
    if (manifest[SITE_ACCESS]?.rules === fingerprint) return false;
    const broad = (pattern) => pattern === '<all_urls>' || /^(\*|https?):\/\/\*\//.test(pattern);
    const within = (pattern, sites) => {
      const host = /^[^:]+:\/\/([^/]+)\//.exec(pattern)?.[1]?.replace(/^\*\./, '');
      return Boolean(host) && sites.some((site) => host === site || host.endsWith(`.${site}`));
    };
    manifest.content_scripts = original
      .map((script) => ({
        ...script,
        // Only on your sites: broad patterns become your sites; specific ones stay if they're among them.
        matches: rules.only ? [...new Set((script.matches || []).flatMap((p) => (broad(p) ? sitePatterns(rules.only) : within(p, rules.only) ? [p] : [])))] : script.matches,
        ...(rules.blocked.length ? { exclude_matches: [...(script.exclude_matches || []), ...sitePatterns(rules.blocked)] } : {}),
      }))
      .filter((script) => script.matches?.length);
    manifest[SITE_ACCESS] = { original, rules: fingerprint };
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    return true;
  }

  async enforceSiteAccess(ext) {
    if (!ext?.path || !this.applySiteAccess(ext.path, ext.id)) return false;
    this.session.extensions.removeExtension(ext.id);
    await this.load(ext.path);
    return true;
  }

  async enforceAllSiteAccess() {
    for (const ext of this.session.extensions.getAllExtensions()) {
      try {
        await this.enforceSiteAccess(ext);
      } catch (err) {
        console.error(`VRK: couldn’t apply site access to ${ext.name}:`, err.message);
      }
    }
    this.emit('change');
  }

  // mode: 'all' or 'list' (only the given sites).
  async setSiteAccess(id, mode, sites = []) {
    const clean = [...new Set(sites.map((s) => String(s).trim().toLowerCase()).filter((s) => /^[a-z0-9.-]{1,253}$/.test(s)))];
    this.setMeta(id, { siteAccess: mode === 'list' ? 'list' : 'all', sites: clean });
    const ext = this.session.extensions.getExtension(id);
    if (ext) await this.enforceSiteAccess(ext);
    this.emit('change');
  }

  // ── Safety check ──
  // As in Chrome's Safety Check: an extension its store no longer lists
  // (taken down for malware or a policy violation, or pulled by its
  // developer) is turned off, and you're told. Returns the names turned off.
  async safetyCheck() {
    const turnedOff = [];
    for (const ext of this.list()) {
      if (!ext.enabled) continue;
      let listed;
      try {
        listed = await this.isListed(ext.id, this.meta[ext.id] || { source: ext.source });
      } catch {
        continue; // offline or the store hiccuped: check again next time
      }
      if (listed !== false) continue;
      await this.setEnabled(ext.id, false);
      this.setMeta(ext.id, { delisted: Date.now() });
      turnedOff.push(ext.name);
    }
    return turnedOff;
  }

  // true (listed), false (no longer listed) or null (installed from a file: nothing to check).
  async isListed(id, { source = 'chrome', amo = null } = {}) {
    if (source === 'chrome') {
      const query = encodeURIComponent(`id=${id}&uc`);
      const res = await this.fetchSession.fetch(
        `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=${process.versions.chrome}&x=${query}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const status = /<app [^>]*status="([^"]+)"/.exec(await res.text())?.[1];
      if (status === 'ok') return true;
      if (status === 'error-unknownApplication') return false;
      throw new Error(`Unexpected store status ${status}`);
    }
    const url =
      source === 'edge'
        ? `https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/${id}`
        : source === 'firefox' && amo
          ? `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(amo)}/`
          : null;
    if (!url) return null;
    const res = await this.fetchSession.fetch(url);
    if (res.status === 404) return false;
    if (res.ok) return true;
    throw new Error(`HTTP ${res.status}`);
  }

  async installFile(file) {
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      const zip = new AdmZip();
      zip.addLocalFolder(file);
      return this.installArchive(zip.toBuffer(), { source: 'file', folder: path.basename(file) });
    }
    const buffer = fs.readFileSync(file);
    if (/\.crx$/i.test(file)) return this.installCrx(buffer, { source: 'file' });
    return this.installArchive(buffer, { source: 'file', folder: path.basename(file).replace(/\.(zip|xpi)$/i, '') });
  }

  // Recognises add-on detail pages in other stores so VRK can offer to install.
  static storeTarget(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.hostname === 'microsoftedge.microsoft.com') {
      const id = u.pathname.match(/\/addons\/detail\/(?:[^/]+\/)?([a-p]{32})/)?.[1];
      if (id) return { store: 'edge', id };
    }
    if (u.hostname === 'addons.mozilla.org') {
      const slug = u.pathname.match(/\/(?:firefox|android)\/addon\/([^/]+)/)?.[1];
      if (slug) return { store: 'firefox', id: decodeURIComponent(slug) };
    }
    return null;
  }
}

module.exports = { Extensions, PARTITION, readCrx, convertFirefoxAddon };
