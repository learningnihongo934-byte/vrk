'use strict';
// VRK's built-in VPN. It runs a WireGuard tunnel entirely in userspace
// (wireproxy) and gives the browser a local SOCKS5 port that exits through
// your VPN server, so no system network settings or admin rights are needed.
// Imported configs hold private keys, so they are encrypted with the macOS
// Keychain (Electron safeStorage) before they are written to disk.

const { safeStorage } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { freePort, waitForPort, httpGetLocal, sleep } = require('./ports');

const INTERFACE_KEYS = ['PrivateKey', 'Address', 'DNS', 'MTU'];
const PEER_KEYS = ['PublicKey', 'PresharedKey', 'Endpoint', 'AllowedIPs', 'PersistentKeepalive'];
const HANDSHAKE_TIMEOUT_MS = 15000;
const HEALTH_INTERVAL_MS = 5000;
const STALE_HANDSHAKE_S = 240; // keepalives force a fresh handshake about every 2 minutes

function parseWireGuard(text) {
  const sections = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, '').trim();
    if (!line) continue;
    const header = line.match(/^\[(\w+)\]$/);
    if (header) {
      current = { name: header[1].toLowerCase(), values: new Map() };
      sections.push(current);
      continue;
    }
    const pair = line.match(/^([A-Za-z]+)\s*=\s*(.+)$/);
    if (pair && current) current.values.set(pair[1].toLowerCase(), pair[2].trim());
  }
  const iface = sections.find((s) => s.name === 'interface');
  const peers = sections.filter((s) => s.name === 'peer');
  if (!iface?.values.get('privatekey') || !iface.values.get('address')) {
    throw new Error('Not a WireGuard config: the [Interface] needs a PrivateKey and an Address.');
  }
  if (!peers.length || peers.some((p) => !p.values.get('publickey') || !p.values.get('endpoint'))) {
    throw new Error('Not a WireGuard config: each [Peer] needs a PublicKey and an Endpoint.');
  }
  return { iface: iface.values, peers: peers.map((p) => p.values) };
}

function toWireproxyConfig({ iface, peers }, socksPort) {
  const emit = (values, keys) =>
    keys.filter((key) => values.has(key.toLowerCase())).map((key) => `${key} = ${values.get(key.toLowerCase())}`);
  const lines = ['[Interface]', ...emit(iface, INTERFACE_KEYS)];
  // DNS is resolved inside the tunnel, so fall back to Quad9 if the provider left it out.
  if (!iface.has('dns')) lines.push('DNS = 9.9.9.9');
  for (const peer of peers) {
    lines.push('', '[Peer]', ...emit(peer, PEER_KEYS));
    if (!peer.has('allowedips')) lines.push('AllowedIPs = 0.0.0.0/0, ::/0');
    if (!peer.has('persistentkeepalive')) lines.push('PersistentKeepalive = 25');
  }
  lines.push('', '[Socks5]', `BindAddress = 127.0.0.1:${socksPort}`, '');
  return lines.join('\n');
}

class Vpn extends EventEmitter {
  constructor({ binary, configDir, runtimeDir }) {
    super();
    this.binary = binary;
    this.runtimeDir = runtimeDir;
    this.storeFile = path.join(configDir, 'vpn.json');
    this.state = 'off'; // off | connecting | on | error  (connecting and error block all traffic)
    this.lastError = null;
    this.socksPort = null;
    this.proc = null;
    this.attempt = 0;
    this.configs = []; // { id, name, endpoint, secret? }
    this.memorySecrets = new Map(); // configs kept in RAM when the Keychain is unavailable
    this.activeId = null;
    this.load();
  }

  get available() {
    return fs.existsSync(this.binary);
  }

  get active() {
    return this.configs.find((c) => c.id === this.activeId) || null;
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.storeFile, 'utf8'));
      this.configs = Array.isArray(data.configs) ? data.configs : [];
      this.activeId = data.activeId || this.configs[0]?.id || null;
    } catch {
      // First run: nothing imported yet.
    }
  }

  save() {
    const configs = this.configs.filter((c) => c.secret);
    fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
    fs.writeFileSync(this.storeFile, JSON.stringify({ activeId: this.activeId, configs }, null, 2), { mode: 0o600 });
  }

  importConfig(file) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.length > 64 * 1024) throw new Error('That file is too large to be a WireGuard config.');
    const parsed = parseWireGuard(text);
    const entry = {
      id: crypto.randomUUID(),
      name: path.basename(file).replace(/\.conf$/i, ''),
      endpoint: parsed.peers[0].get('endpoint'),
    };
    if (safeStorage.isEncryptionAvailable()) {
      entry.secret = safeStorage.encryptString(text).toString('base64');
    } else {
      this.memorySecrets.set(entry.id, text); // never written to disk unencrypted
    }
    this.configs.push(entry);
    this.activeId ||= entry.id;
    this.save();
    this.emit('change');
    return entry;
  }

  removeConfig(id) {
    if (id === this.activeId && this.state !== 'off') this.disconnect();
    this.configs = this.configs.filter((c) => c.id !== id);
    this.memorySecrets.delete(id);
    if (this.activeId === id) this.activeId = this.configs[0]?.id || null;
    this.save();
    this.emit('change');
  }

  secretFor(entry) {
    if (entry.secret) return safeStorage.decryptString(Buffer.from(entry.secret, 'base64'));
    const text = this.memorySecrets.get(entry.id);
    if (!text) throw new Error('This config was not saved. Import it again.');
    return text;
  }

  async connect(id = this.activeId) {
    const entry = this.configs.find((c) => c.id === id);
    if (!entry) throw new Error('Import a WireGuard config first.');
    if (!this.available) throw new Error('wireproxy is not bundled with this build. Run "npm run fetch-binaries".');
    const attempt = ++this.attempt;
    this.stopHealthChecks();
    await this.stopProcess();
    this.activeId = entry.id;
    this.save();
    this.setState('connecting', null);

    try {
      const parsed = parseWireGuard(this.secretFor(entry));
      const socksPort = await freePort();
      const infoPort = await freePort();
      // wireproxy needs the config as a file: owner-only, and deleted as soon as it has started.
      const file = path.join(this.runtimeDir, `wg-${crypto.randomUUID()}.conf`);
      fs.writeFileSync(file, toWireproxyConfig(parsed, socksPort), { mode: 0o600 });
      const proc = spawn(this.binary, ['-c', file, '-i', `127.0.0.1:${infoPort}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      // Watchdog: if VRK dies without cleaning up, take the tunnel down with it.
      if (process.platform === 'win32') {
        const ps = `while ((Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) -and (Get-Process -Id ${proc.pid} -ErrorAction SilentlyContinue)) { Start-Sleep 1 }; if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { Stop-Process -Id ${proc.pid} -Force -ErrorAction SilentlyContinue }`;
        spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } else {
        spawn(
          '/bin/sh',
          ['-c', 'while kill -0 "$1" 2>/dev/null && kill -0 "$2" 2>/dev/null; do sleep 1; done; kill -0 "$1" 2>/dev/null || kill "$2" 2>/dev/null', 'vrk-vpn-watchdog', String(process.pid), String(proc.pid)],
          { detached: true, stdio: 'ignore' },
        ).unref();
      }
      let output = '';
      const collect = (chunk) => (output = (output + chunk).slice(-4000));
      proc.stdout.on('data', collect);
      proc.stderr.on('data', collect);
      proc.on('exit', (code) => {
        if (this.proc !== proc) return;
        this.proc = null;
        this.stopHealthChecks();
        const detail = output.trim().split('\n').pop();
        this.setState('error', detail || `The VPN tunnel stopped (code ${code}).`);
      });
      Object.assign(this, { proc, socksPort, infoPort });

      try {
        await waitForPort(socksPort, 8000, () => this.proc === proc);
      } finally {
        fs.rmSync(file, { force: true });
      }
      await this.waitForHandshake(attempt);
      if (attempt !== this.attempt) return;
      this.setState('on', null);
      this.startHealthChecks();
    } catch (err) {
      if (attempt !== this.attempt) return;
      await this.stopProcess();
      this.setState('error', err.message);
    }
  }

  async handshakeAge() {
    const { body } = await httpGetLocal(this.infoPort, '/metrics');
    const times = [...body.matchAll(/last_handshake_time_sec=(\d+)/g)].map((m) => Number(m[1])).filter(Boolean);
    if (!times.length) return Infinity;
    return Date.now() / 1000 - Math.max(...times);
  }

  async waitForHandshake(attempt) {
    const deadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
    while (Date.now() < deadline && attempt === this.attempt && this.proc) {
      // WireGuard only handshakes once traffic flows; the keepalive provides it.
      if ((await this.handshakeAge().catch(() => Infinity)) < STALE_HANDSHAKE_S) return;
      await sleep(500);
    }
    throw new Error('The VPN server did not respond. Check the config or pick another server.');
  }

  startHealthChecks() {
    this.health = setInterval(async () => {
      const age = await this.handshakeAge().catch(() => Infinity);
      if (age > STALE_HANDSHAKE_S && this.state === 'on') this.setState('error', 'Lost contact with the VPN server.');
      else if (age <= STALE_HANDSHAKE_S && this.state === 'error' && this.proc) this.setState('on', null);
    }, HEALTH_INTERVAL_MS);
  }

  stopHealthChecks() {
    clearInterval(this.health);
    this.health = null;
  }

  async disconnect() {
    this.attempt += 1;
    this.stopHealthChecks();
    await this.stopProcess();
    this.socksPort = null;
    this.setState('off', null);
  }

  stopProcess() {
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => proc.kill('SIGKILL'), 2000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      proc.kill('SIGTERM');
    });
  }

  shutdown() {
    this.stopHealthChecks();
    this.proc?.kill('SIGKILL');
  }

  setState(state, error) {
    this.state = state;
    this.lastError = error;
    this.emit('change');
  }
}

module.exports = { Vpn, parseWireGuard, toWireproxyConfig };
