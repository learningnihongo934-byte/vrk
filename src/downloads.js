'use strict';
// Download protection.
//  - Every finished download gets macOS's quarantine flag (and "Where from"),
//    so Gatekeeper and XProtect check apps, installers and scripts before they
//    first run, exactly as with Safari or Chrome.
//  - Files are checked against abuse.ch MalwareBazaar's newest malware: the
//    list is downloaded to this Mac (a rolling 90 days), so nobody learns what
//    you downloaded. Older, well-known malware is XProtect's job.
//  - Installers and scripts get a warning, and are refused over plain HTTP.

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RECENT = 'https://bazaar.abuse.ch/export/txt/sha256/recent/';
const FILE = 'malware-hashes.json';
const KEEP_DAYS = 90;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

// Files that can run code on a Mac when opened.
const RISKY = /\.(dmg|pkg|mpkg|app|command|sh|bash|zsh|tool|terminal|scpt|scptd|applescript|workflow|action|jar|run|bin|dylib|kext|prefPane|osax|plugin|webloc|inetloc|fileloc)$/i;

const run = (cmd, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    if (input) child.stdin.end(input);
  });

const xmlEscape = (text) => String(text).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function quarantine(file, { url, referrer }) {
  const urls = [url, referrer].filter((u) => /^https?:\/\//i.test(u || '')).slice(0, 2);
  // Windows: the "Mark of the Web" (Internet zone), which SmartScreen and Office check.
  if (process.platform === 'win32') {
    const lines = ['[ZoneTransfer]', 'ZoneId=3', urls[1] && `ReferrerUrl=${urls[1]}`, urls[0] && `HostUrl=${urls[0]}`].filter(Boolean);
    await fs.promises.writeFile(`${file}:Zone.Identifier`, `${lines.join('\r\n')}\r\n`);
    return;
  }
  // Linux: the download's address, as other browsers record it (cosmetic; Linux has no quarantine).
  if (process.platform !== 'darwin') {
    if (urls[0]) await run('setfattr', ['-n', 'user.xdg.origin.url', '-v', urls[0], file]).catch(() => {});
    return;
  }
  // flags;time;agent;event — 0083 marks a web download that hasn't been opened yet.
  const value = `0083;${Math.floor(Date.now() / 1000).toString(16)};VRK;${crypto.randomUUID().toUpperCase()}`;
  await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', value, file]);
  // "Where from" in Finder's Get Info: a binary property list of the URLs.
  if (!urls.length) return;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><array>${urls.map((u) => `<string>${xmlEscape(u)}</string>`).join('')}</array></plist>`;
  try {
    const binary = await run('/usr/bin/plutil', ['-convert', 'binary1', '-o', '-', '-'], xml);
    await run('/usr/bin/xattr', ['-wx', 'com.apple.metadata:kMDItemWhereFroms', binary.toString('hex'), file]);
  } catch {
    // Cosmetic: the quarantine flag above is what matters.
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

class MalwareHashes {
  constructor({ configDir }) {
    this.file = configDir && path.join(configDir, FILE);
    this.hashes = new Map(); // sha256 -> day first listed
    this.updatedAt = 0;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.hashes = new Map(Object.entries(data.hashes || {}));
      this.updatedAt = data.updatedAt || 0;
    } catch {}
  }

  get size() {
    return this.hashes.size;
  }

  has(sha256) {
    return this.hashes.has(String(sha256).toLowerCase());
  }

  async refresh(fetchFn, { force = false } = {}) {
    if (!force && Date.now() - this.updatedAt < MAX_AGE_MS) return false;
    const response = await fetchFn(RECENT);
    if (!response.ok) throw new Error(`MalwareBazaar: HTTP ${response.status}`);
    const today = Math.floor(Date.now() / 86400000);
    let added = 0;
    for (const line of (await response.text()).split('\n')) {
      const hash = line.trim().toLowerCase();
      if (/^[a-f0-9]{64}$/.test(hash) && !this.hashes.has(hash)) {
        this.hashes.set(hash, today);
        added += 1;
      }
    }
    for (const [hash, day] of this.hashes) if (today - day > KEEP_DAYS) this.hashes.delete(hash);
    this.updatedAt = Date.now();
    if (this.file) {
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ updatedAt: this.updatedAt, hashes: Object.fromEntries(this.hashes) }));
      fs.renameSync(`${this.file}.tmp`, this.file);
    }
    return added > 0;
  }
}

const isRisky = (name) => RISKY.test(String(name || ''));

module.exports = { MalwareHashes, quarantine, sha256File, isRisky };
