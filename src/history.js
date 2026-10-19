'use strict';
// Browsing history (Standard mode). Every visit is encrypted with AES-256-GCM
// using a key kept in the macOS Keychain, then stored in a small SQLite
// database; the decrypted history lives only in memory, for search and
// address-bar suggestions. Tor tabs are never recorded. Without the Keychain,
// history is kept for the session only.

const { safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { EventEmitter } = require('node:events');

const DAY = 24 * 60 * 60 * 1000;
const MAX_VISITS = 200000;

class History extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.visits = []; // { id, ts, url, title }, oldest first
    this.byId = new Map();
    this.byUrl = new Map(); // url -> { url, title, count, last }
    this.persistent = false;
    this.nextMemoryId = -1; // ids for visits kept in memory only
    try {
      this.open();
    } catch (err) {
      console.error(`VRK: history is session-only (${err.message})`);
    }
  }

  open() {
    if (!this.dir || !safeStorage.isEncryptionAvailable()) return; // session-only history
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.key = this.loadKey();
    this.db = new DatabaseSync(path.join(this.dir, 'history.db'));
    this.db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, data BLOB NOT NULL)');
    for (const row of this.db.prepare('SELECT id, ts, data FROM visits ORDER BY id').all()) {
      try {
        const { url, title } = JSON.parse(this.decrypt(row.data));
        this.index({ id: row.id, ts: row.ts, url, title });
      } catch {
        // Unreadable row (e.g. the Keychain key was reset): skip it.
      }
    }
    this.statements = {
      insert: this.db.prepare('INSERT INTO visits (ts, data) VALUES (?, ?)'),
      update: this.db.prepare('UPDATE visits SET data = ? WHERE id = ?'),
      remove: this.db.prepare('DELETE FROM visits WHERE id = ?'),
    };
    this.persistent = true;
  }

  loadKey() {
    const file = path.join(this.dir, 'history.key');
    if (fs.existsSync(file)) return Buffer.from(safeStorage.decryptString(fs.readFileSync(file)), 'hex');
    const key = crypto.randomBytes(32);
    fs.writeFileSync(file, safeStorage.encryptString(key.toString('hex')), { mode: 0o600 });
    return key;
  }

  encrypt(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, body, cipher.getAuthTag()]);
  }

  decrypt(data) {
    const buf = Buffer.from(data);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString('utf8');
  }

  index(visit) {
    this.visits.push(visit);
    this.byId.set(visit.id, visit);
    const stats = this.byUrl.get(visit.url);
    if (stats) {
      stats.count += 1;
      if (visit.ts >= stats.last) {
        stats.last = visit.ts;
        if (visit.title) stats.title = visit.title;
      }
    } else {
      this.byUrl.set(visit.url, { url: visit.url, title: visit.title || '', count: 1, last: visit.ts });
    }
  }

  rebuild(visits) {
    this.visits = [];
    this.byId.clear();
    this.byUrl.clear();
    for (const visit of visits) this.index(visit);
    this.changed();
  }

  changed() {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.emit('change'), 300);
  }

  get count() {
    return this.visits.length;
  }

  // Returns the visit id (to attach the page title once it arrives).
  add(url, title = '') {
    const last = this.visits[this.visits.length - 1];
    if (last && last.url === url && Date.now() - last.ts < 5000) return last.id; // reloads and redirects
    const visit = { id: 0, ts: Date.now(), url: String(url).slice(0, 4096), title: String(title).slice(0, 500) };
    if (this.persistent) {
      visit.id = Number(this.statements.insert.run(visit.ts, this.encrypt(JSON.stringify({ url: visit.url, title: visit.title }))).lastInsertRowid);
    } else {
      visit.id = this.nextMemoryId--;
    }
    this.index(visit);
    if (this.visits.length > MAX_VISITS) this.removeIds(this.visits.slice(0, this.visits.length - MAX_VISITS).map((v) => v.id));
    this.changed();
    return visit.id;
  }

  setTitle(id, title) {
    const visit = this.byId.get(id);
    if (!visit || !title || visit.title === title) return;
    visit.title = String(title).slice(0, 500);
    const stats = this.byUrl.get(visit.url);
    if (stats && stats.last === visit.ts) stats.title = visit.title;
    if (this.persistent && id > 0) this.statements.update.run(this.encrypt(JSON.stringify({ url: visit.url, title: visit.title })), id);
    this.changed();
  }

  removeIds(ids) {
    const doomed = new Set(ids.map(Number));
    if (this.persistent) {
      this.db.exec('BEGIN');
      for (const id of doomed) if (id > 0) this.statements.remove.run(id);
      this.db.exec('COMMIT');
    }
    this.rebuild(this.visits.filter((v) => !doomed.has(v.id)));
  }

  // Everything visited since `since` (ms timestamp); 0 clears all history.
  clear(since = 0) {
    if (this.persistent) {
      this.db.prepare('DELETE FROM visits WHERE ts >= ?').run(since);
      if (!since) this.db.exec('VACUUM');
    }
    this.rebuild(this.visits.filter((v) => v.ts < since));
  }

  prune(days) {
    if (days === 'forever') return;
    const cutoff = Date.now() - Number(days) * DAY;
    const old = this.visits.filter((v) => v.ts < cutoff).map((v) => v.id);
    if (old.length) this.removeIds(old);
  }

  // Newest first, optionally filtered, for the History page.
  list({ query = '', before = Infinity, limit = 200 } = {}) {
    const q = String(query).trim().toLowerCase();
    const out = [];
    for (let i = this.visits.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const v = this.visits[i];
      if (v.ts >= before) continue;
      if (q && !v.url.toLowerCase().includes(q) && !v.title.toLowerCase().includes(q)) continue;
      out.push(v);
    }
    return out;
  }

  // Address-bar suggestions, ranked by how well they match, how often and how recently you visited.
  suggest(text, limit = 6) {
    const q = String(text).trim().toLowerCase();
    if (!q) return [];
    const now = Date.now();
    const scored = [];
    for (const entry of this.byUrl.values()) {
      const url = entry.url.toLowerCase();
      const bare = url.replace(/^https?:\/\/(www\.)?/, '');
      const title = entry.title.toLowerCase();
      let score;
      if (bare.startsWith(q)) score = 100 + Math.max(0, 40 - bare.length); // prefer short URLs like home pages
      else if (url.includes(q)) score = 40;
      else if (title.startsWith(q) || title.includes(` ${q}`)) score = 35;
      else if (title.includes(q)) score = 20;
      else continue;
      score += Math.min(entry.count, 50) * 2 + Math.max(0, 30 - (now - entry.last) / DAY);
      scored.push({ url: entry.url, title: entry.title, count: entry.count, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  close() {
    try {
      this.db?.close();
    } catch {}
  }
}

module.exports = { History };
