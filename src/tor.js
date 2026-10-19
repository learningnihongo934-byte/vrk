'use strict';
// Runs VRK's own Tor client for Tor tabs. Its data directory lives in the
// throwaway profile, so every launch starts with a fresh Tor identity, and
// `__OwningControllerProcess` makes Tor exit if VRK ever dies.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const { EventEmitter } = require('node:events');
const { freePort } = require('./ports');

const BRIDGES = {
  auto: { label: 'Automatic (tries every way until one works)' },
  none: { label: 'None (connect directly)' },
  snowflake: { label: 'Snowflake', transport: 'snowflake', plugin: 'snowflake' },
  obfs4: { label: 'obfs4', transport: 'obfs4', plugin: 'lyrebird' },
  meek: { label: 'meek (Azure CDN)', transport: 'meek', plugin: 'lyrebird' },
};

// Automatic mode: connect directly first, then fall back through the bridges,
// fastest first and hardest to block last (meek looks like plain Azure traffic).
const AUTO_ORDER = ['none', 'obfs4', 'snowflake', 'meek'];
const STALL_MS = 90000; // no bootstrap progress for this long means the method is blocked

class Tor extends EventEmitter {
  constructor({ root, runtimeDir, bridge = 'none', isolateSites = true }) {
    super();
    this.isolateSites = isolateSites; // a separate circuit for every site you connect to
    this.root = root; // Tor expert bundle: tor/ (binaries) and data/ (GeoIP)
    this.runtimeDir = runtimeDir;
    this.bridge = BRIDGES[bridge] ? bridge : 'auto';
    this.active = null; // the method actually in use (resolves 'auto')
    this.autoIndex = 0;
    this.state = 'off'; // off | starting | ready | error
    this.progress = 0;
    this.summary = '';
    this.lastError = null;
    this.upstream = null; // "127.0.0.1:port" of the VPN's SOCKS proxy when the VPN is on
    this.proc = null;
  }

  static get bridges() {
    return BRIDGES;
  }

  get binary() {
    return path.join(this.root, 'tor', process.platform === 'win32' ? 'tor.exe' : 'tor');
  }

  get available() {
    return fs.existsSync(this.binary);
  }

  start() {
    if (this.proc) return Promise.resolve();
    this.starting ||= this.launch().finally(() => (this.starting = null));
    return this.starting;
  }

  async launch() {
    if (!this.available) {
      this.setState('error', 'Tor is not bundled with this build. Run "npm run fetch-binaries".');
      return;
    }
    const socksPort = await freePort();
    const controlPort = await freePort();
    const dataDir = fs.mkdtempSync(path.join(this.runtimeDir, 'tor-'));
    const torrc = path.join(dataDir, 'torrc');
    const defaults = path.join(dataDir, 'torrc-defaults');
    fs.writeFileSync(defaults, '');
    fs.writeFileSync(torrc, this.buildTorrc({ socksPort, controlPort, dataDir }), { mode: 0o600 });
    this.active = this.bridge === 'auto' ? AUTO_ORDER[this.autoIndex] : this.bridge;
    const via = this.active === 'none' ? '' : ` via ${BRIDGES[this.active].label}`;
    Object.assign(this, { socksPort, controlPort, dataDir, progress: 0, summary: `Starting Tor${via}` });
    this.setState('starting', null);

    // Run from the binary's folder so relative pluggable-transport paths resolve.
    const proc = spawn(this.binary, ['-f', torrc, '--defaults-torrc', defaults], {
      cwd: path.join(this.root, 'tor'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;
    this.watchStall(proc);
    let lastWarning = '';
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      const boot = line.match(/Bootstrapped (\d+)%[^:]*: (.*)$/);
      if (boot) {
        this.progress = Number(boot[1]);
        this.summary = this.active === 'none' ? boot[2] : `${boot[2]} (via ${BRIDGES[this.active].label})`;
        this.watchStall(proc);
        if (this.progress >= 100) this.setState('ready', null);
        else this.emit('change');
      } else if (/\[(warn|err)\]/.test(line)) {
        lastWarning = line.replace(/^.*\[(warn|err)\]\s*/, '');
      }
    });
    proc.stderr.on('data', (chunk) => (lastWarning = String(chunk).trim().split('\n').pop()));
    proc.on('error', (err) => this.onExit(proc, err.message));
    proc.on('exit', (code) => this.onExit(proc, lastWarning || `Tor exited (code ${code}).`));
  }

  // In automatic mode, a method that stops making progress is given up on.
  watchStall(proc) {
    clearTimeout(this.stallTimer);
    if (this.bridge !== 'auto' || this.progress >= 100) return;
    this.stallTimer = setTimeout(() => this.proc === proc && this.fallBack(proc, 'stalled'), STALL_MS);
  }

  // Kill the current attempt and try the next method; true if there was one.
  fallBack(proc, reason) {
    if (this.bridge !== 'auto' || this.autoIndex >= AUTO_ORDER.length - 1) return false;
    this.autoIndex += 1;
    this.proc = null;
    clearTimeout(this.stallTimer);
    proc.removeAllListeners('exit');
    proc.kill('SIGKILL');
    this.cleanupDataDir();
    this.emit('fallback', { from: AUTO_ORDER[this.autoIndex - 1], to: AUTO_ORDER[this.autoIndex], reason });
    this.launch();
    return true;
  }

  onExit(proc, message) {
    if (this.proc !== proc) return;
    clearTimeout(this.stallTimer);
    if (!this.stopping && this.fallBack(proc, message)) return;
    this.proc = null;
    this.cleanupDataDir();
    if (this.stopping) this.setState('off', null);
    else this.setState('error', this.bridge === 'auto' ? `Tor could not connect by any method. Last error: ${message}` : message);
  }

  buildTorrc({ socksPort, controlPort, dataDir }) {
    const quote = (value) => JSON.stringify(value); // torrc accepts C-style quoted strings
    const lines = [
      `DataDirectory ${quote(dataDir)}`,
      // IsolateDestAddr: connections to different sites never share a circuit,
      // so one exit relay can't link what you do on different sites.
      `SocksPort 127.0.0.1:${socksPort}${this.isolateSites ? ' IsolateDestAddr' : ''}`,
      `ControlPort 127.0.0.1:${controlPort}`,
      'CookieAuthentication 1',
      `GeoIPFile ${quote(path.join(this.root, 'data', 'geoip'))}`,
      `GeoIPv6File ${quote(path.join(this.root, 'data', 'geoip6'))}`,
      'ClientOnly 1',
      'AvoidDiskWrites 1',
      'DormantCanceledByStartup 1',
      'Log notice stdout',
      `__OwningControllerProcess ${process.pid}`,
    ];
    if (this.upstream) lines.push(`Socks5Proxy ${this.upstream}`);
    const bridge = BRIDGES[this.active || this.bridge];
    if (bridge.transport) {
      const config = JSON.parse(fs.readFileSync(path.join(this.root, 'tor', 'pluggable_transports', 'pt_config.json'), 'utf8'));
      const plugin = config.pluggableTransports[bridge.plugin].replace('${pt_path}', 'pluggable_transports/');
      lines.push('UseBridges 1', plugin, ...config.bridges[bridge.transport].map((line) => `Bridge ${line}`));
    }
    return `${lines.join('\n')}\n`;
  }

  // Sends commands over the authenticated control port.
  control(commands) {
    const cookie = fs.readFileSync(path.join(this.dataDir, 'control_auth_cookie')).toString('hex');
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.controlPort, '127.0.0.1');
      let reply = '';
      socket.setTimeout(5000, () => socket.destroy(new Error('Tor control port timed out.')));
      socket.on('connect', () => socket.write([`AUTHENTICATE ${cookie}`, ...commands, 'QUIT', ''].join('\r\n')));
      socket.on('data', (chunk) => (reply += chunk));
      socket.on('error', reject);
      socket.on('close', () => {
        const failed = reply.split('\r\n').find((line) => /^[45]\d\d/.test(line));
        if (failed) reject(new Error(failed));
        else resolve(reply);
      });
    });
  }

  async newIdentity() {
    if (this.state === 'ready') await this.control(['SIGNAL NEWNYM']);
  }

  // Route Tor's own connections through the VPN (Tor over VPN) when it is on.
  setUpstreamProxy(hostPort) {
    if (hostPort === this.upstream) return;
    this.upstream = hostPort;
    if (!this.proc || !this.dataDir) return;
    const command = hostPort ? `SETCONF Socks5Proxy=${hostPort}` : 'RESETCONF Socks5Proxy';
    this.control([command]).catch(() => this.restart());
  }

  setIsolation(on) {
    if (on === this.isolateSites) return;
    this.isolateSites = on;
    if (this.proc || this.state === 'error') this.restart();
  }

  setBridge(bridge) {
    if (!BRIDGES[bridge] || bridge === this.bridge) return;
    this.bridge = bridge;
    this.autoIndex = 0;
    if (this.proc || this.state === 'error') this.restart();
  }

  async restart() {
    await this.stop();
    // Automatic mode starts again from the last method that worked.
    if (this.bridge === 'auto' && this.state !== 'error') this.autoIndex = Math.max(0, AUTO_ORDER.indexOf(this.lastWorking));
    else if (this.bridge === 'auto') this.autoIndex = 0;
    await this.start();
  }

  stop() {
    clearTimeout(this.stallTimer);
    const proc = this.proc;
    if (!proc) {
      this.setState('off', null);
      return Promise.resolve();
    }
    this.stopping = true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => proc.kill('SIGKILL'), 3000);
      proc.once('exit', () => {
        clearTimeout(timer);
        this.stopping = false;
        resolve();
      });
      proc.kill('SIGTERM');
    });
  }

  shutdown() {
    this.stopping = true;
    this.proc?.kill('SIGKILL');
    this.cleanupDataDir();
  }

  cleanupDataDir() {
    if (this.dataDir) fs.rmSync(this.dataDir, { recursive: true, force: true });
    this.dataDir = null;
  }

  setState(state, error) {
    this.state = state;
    this.lastError = error;
    if (state === 'ready') this.lastWorking = this.active;
    if (state !== 'starting' && state !== 'ready') this.progress = 0;
    this.emit('change');
  }
}

module.exports = { Tor };
