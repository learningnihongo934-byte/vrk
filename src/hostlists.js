'use strict';
// Whole-domain blocking for ad, tracking and telemetry servers, from HaGeZi's
// Multi PRO list (the kind of list DNS blockers like NextDNS and Pi-hole use).
// It catches servers that EasyList's page-oriented rules don't, like phone
// makers' telemetry and in-app ad networks. A bundled copy covers the first
// launch; it refreshes daily.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/pro.txt';
const FILE = 'hosts-blocklist.txt';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// "||ads.example.com^" lines become "ads.example.com".
function parseHosts(text) {
  const hosts = [];
  for (const line of text.split('\n')) {
    const match = /^\|\|([a-z0-9.-]+)\^\s*$/i.exec(line.trim());
    if (match) hosts.push(match[1].toLowerCase());
  }
  return hosts;
}

async function fetchHosts(fetchFn) {
  const response = await fetchFn(SOURCE);
  if (!response.ok) throw new Error(`${SOURCE}: HTTP ${response.status}`);
  const hosts = parseHosts(await response.text());
  if (hosts.length < 10000) throw new Error(`${SOURCE}: list looks incomplete`);
  return hosts;
}

class HostBlocklist {
  constructor({ configDir, assetsDir }) {
    this.file = configDir && path.join(configDir, FILE);
    this.assetsFile = assetsDir && path.join(assetsDir, FILE);
    this.hosts = new Set();
    this.updatedAt = 0;
    this.load();
  }

  get size() {
    return this.hosts.size;
  }

  load() {
    const newest = [this.file, this.assetsFile]
      .map((file) => {
        try {
          return file && { file, mtime: fs.statSync(file).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)[0];
    if (!newest) return;
    this.hosts = new Set(fs.readFileSync(newest.file, 'utf8').split('\n').filter(Boolean));
    this.updatedAt = newest.mtime;
  }

  async refresh(fetchFn, { force = false } = {}) {
    if (!force && Date.now() - this.updatedAt < MAX_AGE_MS) return false;
    const hosts = await fetchHosts(fetchFn);
    this.hosts = new Set(hosts);
    this.updatedAt = Date.now();
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, hosts.join('\n'));
      fs.renameSync(`${this.file}.tmp`, this.file);
    }
    return true;
  }

  // Is this host, or a domain it belongs to, on the list?
  has(hostname) {
    let host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    while (host) {
      if (this.hosts.has(host)) return true;
      const dot = host.indexOf('.');
      if (dot === -1) return false;
      host = host.slice(dot + 1);
    }
    return false;
  }
}

module.exports = { HostBlocklist, fetchHosts, parseHosts, HOSTS_FILE: FILE };
