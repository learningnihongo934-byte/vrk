'use strict';
// Encrypted JSON files for VRK's saved passwords, passkeys and bookmarks. Contents are
// sealed with a key held in the macOS Keychain (Electron safeStorage); when
// the Keychain isn't available, data stays in memory and is never written in
// plain text.

const { safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { getDomain } = require('tldts');

class EncryptedStore extends EventEmitter {
  constructor(file, empty) {
    super();
    this.file = file;
    this.data = empty();
    try {
      if (fs.existsSync(file) && safeStorage.isEncryptionAvailable()) {
        this.data = { ...empty(), ...JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) };
      }
    } catch (err) {
      console.error(`VRK: could not read ${path.basename(file)}: ${err.message}`);
    }
  }

  get persistent() {
    return safeStorage.isEncryptionAvailable();
  }

  save() {
    this.emit('change');
    if (!this.persistent) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(this.data)), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

const siteOfOrigin = (origin) => {
  try {
    const { hostname } = new URL(origin);
    return getDomain(hostname) || hostname;
  } catch {
    return null;
  }
};

class PasswordVault extends EncryptedStore {
  constructor(file) {
    super(file, () => ({ logins: [], never: [], passkeys: [] }));
  }

  get count() {
    return this.data.logins.length;
  }

  // ── Passkeys (private keys are only ever read by passkeys.js) ──

  get passkeyCount() {
    return this.data.passkeys.length;
  }

  passkeysFor(rpId) {
    return this.data.passkeys.filter((p) => p.rpId === rpId);
  }

  addPasskey(passkey) {
    // A new passkey for the same account replaces the old one, as on other platforms.
    this.data.passkeys = this.data.passkeys.filter((p) => !(p.rpId === passkey.rpId && p.userId === passkey.userId));
    this.data.passkeys.push(passkey);
    this.save();
  }

  touchPasskey(id) {
    const passkey = this.data.passkeys.find((p) => p.id === id);
    if (passkey) passkey.lastUsed = Date.now();
    this.save();
  }

  removePasskey(id) {
    this.data.passkeys = this.data.passkeys.filter((p) => p.id !== id);
    this.save();
  }

  passkeySummary() {
    return this.data.passkeys
      .map(({ id, rpId, userName, displayName, created, lastUsed }) => ({ id, rpId, userName, displayName, created, lastUsed }))
      .sort((a, b) => a.rpId.localeCompare(b.rpId));
  }

  // Logins for this exact origin first, then the same site's other subdomains.
  forOrigin(origin) {
    const site = siteOfOrigin(origin);
    const exact = this.data.logins.filter((l) => l.origin === origin);
    const sameSite = this.data.logins.filter((l) => l.origin !== origin && siteOfOrigin(l.origin) === site);
    return [...exact, ...sameSite];
  }

  get(id) {
    return this.data.logins.find((l) => l.id === id) || null;
  }

  has(origin, username, password) {
    return this.data.logins.some((l) => l.origin === origin && l.username === username && l.password === password);
  }

  isNever(origin) {
    return this.data.never.includes(origin);
  }

  never(origin) {
    if (!this.isNever(origin)) this.data.never.push(origin);
    this.save();
  }

  upsert({ origin, username, password }, { save = true } = {}) {
    const existing = this.data.logins.find((l) => l.origin === origin && l.username === username);
    if (existing) {
      if (existing.password === password) return false;
      existing.password = password;
      existing.updated = Date.now();
    } else {
      this.data.logins.push({ id: crypto.randomUUID(), origin, username, password, created: Date.now(), updated: Date.now() });
    }
    if (save) this.save();
    return true;
  }

  importMany(logins) {
    let added = 0;
    for (const login of logins) {
      if (!login.origin || !login.password) continue;
      if (this.upsert(login, { save: false })) added += 1;
    }
    this.save();
    return added;
  }

  remove(id) {
    this.data.logins = this.data.logins.filter((l) => l.id !== id);
    this.save();
  }

  // A 2FA (TOTP) secret kept with a login; null removes it.
  setTotp(id, totp) {
    const login = this.get(id);
    if (!login) return false;
    if (totp) login.totp = totp;
    else delete login.totp;
    this.save();
    return true;
  }

  // Listing for the settings page: never includes the passwords (or 2FA secrets) themselves.
  summary() {
    return this.data.logins
      .map(({ id, origin, username, updated, totp }) => ({ id, origin, username, updated, hasTotp: Boolean(totp), totpIssuer: totp?.issuer || '' }))
      .sort((a, b) => a.origin.localeCompare(b.origin));
  }
}

class Bookmarks extends EncryptedStore {
  constructor(file) {
    super(file, () => ({ bar: [], other: [] }));
  }

  get isEmpty() {
    return !this.data.bar.length && !this.data.other.length;
  }

  *walk(nodes = [...this.data.bar, ...this.data.other]) {
    for (const node of nodes) {
      yield node;
      if (node.children) yield* this.walk(node.children);
    }
  }

  findByUrl(url) {
    for (const node of this.walk()) if (node.url === url) return node;
    return null;
  }

  add({ url, title, icon = null }) {
    const node = { id: crypto.randomUUID(), title: String(title || url).slice(0, 300), url, icon };
    this.data.bar.push(node);
    this.save();
    return node;
  }

  remove(id) {
    const prune = (nodes) =>
      nodes.filter((node) => node.id !== id).map((node) => (node.children ? { ...node, children: prune(node.children) } : node));
    this.data.bar = prune(this.data.bar);
    this.data.other = prune(this.data.other);
    this.save();
  }

  rename(id, title) {
    for (const node of this.walk()) if (node.id === id) node.title = String(title).slice(0, 300);
    this.save();
  }

  // Imported trees land in the bar directly if it's empty, else in a folder.
  importTree({ bar = [], other = [] }, sourceName) {
    const withIds = (nodes) =>
      nodes
        .filter((n) => n.children || /^(https?|ftp):/i.test(n.url || ''))
        .map((n) => (n.children ? { id: crypto.randomUUID(), title: n.title || 'Folder', children: withIds(n.children) } : { id: crypto.randomUUID(), title: n.title || n.url, url: n.url }));
    const imported = withIds(bar);
    const others = withIds(other);
    let count = 0;
    for (const _ of this.walk([...imported, ...others])) count += 1;
    if (!this.data.bar.length) this.data.bar = imported;
    else if (imported.length) this.data.bar.push({ id: crypto.randomUUID(), title: `Imported from ${sourceName}`, children: imported });
    if (others.length) this.data.other.push({ id: crypto.randomUUID(), title: `${sourceName} — other bookmarks`, children: others });
    this.save();
    return count;
  }
}

module.exports = { PasswordVault, Bookmarks, EncryptedStore };
