'use strict';
// Dangerous-site protection: known phishing and malware sites, from open
// blocklists (OpenPhish, PhishTank and IPThreat for phishing; abuse.ch's
// URLhaus for malware), checked on this Mac. Unlike Google Safe Browsing,
// nothing about the pages you visit is sent anywhere. Lists refresh every
// 12 hours; a copy bundled with the app covers the first launch.

const fs = require('node:fs');
const path = require('node:path');

const SOURCES = [
  { kind: 'phishing', url: 'https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt' },
  { kind: 'malware', url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt' },
];
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const FILE = 'safety-lists.json';

// Parses the lists' uBlock syntax: a bare host blocks that host and its
// subdomains; "||host/path^" blocks URLs that start with that path.
function parseList(text) {
  const hosts = [];
  const urls = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('!') || line.startsWith('#')) continue;
    line = line.replace(/^\|\|/, '').replace(/\$.*$/, '').replace(/\^$/, '').replace(/&amp;/g, '&');
    const slash = line.indexOf('/');
    if (slash === -1) {
      if (/^[a-z0-9.-]+$/i.test(line) || /^[\d.]+$/.test(line)) hosts.push(line.toLowerCase());
    } else if (slash > 0) {
      urls.push(line.slice(0, slash).toLowerCase() + line.slice(slash));
    }
  }
  return { hosts, urls };
}

async function fetchLists(fetchFn) {
  const lists = {};
  for (const { kind, url } of SOURCES) {
    const response = await fetchFn(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const parsed = parseList(await response.text());
    if (parsed.hosts.length + parsed.urls.length < 100) throw new Error(`${url}: list looks empty`);
    lists[kind] = parsed;
  }
  return { updatedAt: Date.now(), lists };
}

class Safety {
  constructor({ configDir, assetsDir }) {
    this.file = configDir && path.join(configDir, FILE);
    this.assetsFile = assetsDir && path.join(assetsDir, FILE);
    this.updatedAt = 0;
    this.hosts = new Map(); // host -> kind
    this.urls = new Map(); // host -> [{ prefix, kind }]
    this.load();
  }

  get count() {
    let urls = 0;
    for (const list of this.urls.values()) urls += list.length;
    return this.hosts.size + urls;
  }

  load() {
    const candidates = [this.file, this.assetsFile]
      .filter((file) => file && fs.existsSync(file))
      .map((file) => {
        try {
          return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
          return null;
        }
      })
      .filter((data) => data?.lists)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (candidates[0]) this.use(candidates[0]);
  }

  use({ updatedAt, lists }) {
    const hosts = new Map();
    const urls = new Map();
    for (const [kind, { hosts: hostList = [], urls: urlList = [] }] of Object.entries(lists)) {
      for (const host of hostList) if (!hosts.has(host)) hosts.set(host, kind);
      for (const entry of urlList) {
        const slash = entry.indexOf('/');
        const host = entry.slice(0, slash);
        if (!urls.has(host)) urls.set(host, []);
        urls.get(host).push({ prefix: entry.slice(slash), kind });
      }
    }
    this.hosts = hosts;
    this.urls = urls;
    this.updatedAt = updatedAt || 0;
  }

  async refresh(fetchFn, { force = false } = {}) {
    if (!force && Date.now() - this.updatedAt < MAX_AGE_MS) return false;
    const data = await fetchLists(fetchFn);
    this.use(data);
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(data));
      fs.renameSync(`${this.file}.tmp`, this.file);
    }
    return true;
  }

  // 'phishing', 'malware' or null.
  check(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (!/^(https?|wss?|ftp):$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    const rest = `${u.pathname}${u.search}`;
    // The host itself, then each parent domain (a.b.example.com → b.example.com → example.com).
    for (let h = host; h; h = h.slice(h.indexOf('.') + 1)) {
      const kind = this.hosts.get(h);
      if (kind) return kind;
      for (const { prefix, kind: urlKind } of this.urls.get(h) || []) {
        if (rest.startsWith(prefix) && (rest.length === prefix.length || !/[\w.%-]/.test(rest[prefix.length]))) return urlKind;
      }
      if (!h.includes('.')) break;
    }
    return null;
  }
}

module.exports = { Safety, fetchLists, parseList, SAFETY_FILE: FILE };
