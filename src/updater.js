'use strict';
// Automatic security updates. VRK is built on this Mac from its project
// folder, so updating means rebuilding: every few hours VRK checks for a newer
// Electron release (which carries Chromium's security fixes), then in the
// background installs it, runs VRK's self-test, builds the app and, only if
// every check passed, swaps it in when you quit or restart. A failed update
// leaves the project as it was.

const { app } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 2 * 60 * 1000;
const REGISTRY = 'https://registry.npmjs.org/-/package/electron/dist-tags';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

const parse = (version) => String(version).split('.').map((n) => parseInt(n, 10) || 0);
function newer(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

class Updater extends EventEmitter {
  constructor({ settings, configDir, fetchFn }) {
    super();
    this.settings = settings;
    this.fetch = fetchFn;
    this.logFile = path.join(configDir, 'update.log');
    this.stateFile = path.join(configDir, 'update-state.json');
    this.source = Updater.sourceDir();
    this.state = { status: 'idle', checkedAt: 0, latest: null, error: null, failedVersion: null };
    try {
      Object.assign(this.state, JSON.parse(fs.readFileSync(this.stateFile, 'utf8')), { status: 'idle' });
    } catch {}
    this.ready = null; // { app, version } once a tested build is waiting
    this.timer = null;
  }

  // The project folder this copy of VRK was built from (recorded at build time).
  static sourceDir() {
    try {
      const dir = require('../package.json').vrkSource;
      return dir && fs.existsSync(path.join(dir, 'package.json')) ? dir : null;
    } catch {
      return null;
    }
  }

  get available() {
    return process.platform === 'darwin' && app.isPackaged && Boolean(this.source); // Mac only: it rebuilds from this Mac's copy of the project
  }

  summary() {
    return {
      ...this.state,
      available: this.available,
      source: this.source,
      current: process.versions.electron,
      chromium: process.versions.chrome,
      ready: this.ready && { version: this.ready.version },
    };
  }

  setState(changes) {
    Object.assign(this.state, changes);
    const { checkedAt, latest, error, failedVersion } = this.state;
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify({ checkedAt, latest, error, failedVersion }));
    } catch {}
    this.emit('change', this.summary());
  }

  start() {
    if (!this.available) return;
    const tick = () => this.settings.get('autoUpdate') && this.check().catch(() => {});
    setTimeout(tick, FIRST_CHECK_MS).unref?.();
    this.timer = setInterval(tick, CHECK_EVERY_MS);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.child?.kill();
  }

  async latestVersion() {
    const response = await this.fetch(REGISTRY);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const tags = await response.json();
    if (!/^\d+\.\d+\.\d+$/.test(tags.latest || '')) throw new Error('Unexpected version list');
    return tags.latest;
  }

  // Checks, and when there's a newer Electron, updates (unless one is running).
  async check({ manual = false } = {}) {
    if (!this.available || ['checking', 'updating'].includes(this.state.status)) return this.summary();
    this.setState({ status: 'checking', error: null });
    let latest;
    try {
      latest = await this.latestVersion();
    } catch (err) {
      this.setState({ status: 'idle', error: `Couldn’t check for updates: ${err.message}` });
      return this.summary();
    }
    this.setState({ status: 'idle', checkedAt: Date.now(), latest });
    const target = this.ready?.version || process.versions.electron;
    // A version whose tests failed is retried only when you ask.
    if (newer(latest, target) && (manual || latest !== this.state.failedVersion)) await this.update(latest);
    return this.summary();
  }

  run(command) {
    return new Promise((resolve, reject) => {
      fs.appendFileSync(this.logFile, `\n$ ${command}\n`);
      const log = fs.openSync(this.logFile, 'a');
      // A login shell finds Node.js wherever it's installed (Homebrew, nvm, …).
      this.child = spawn('/bin/zsh', ['-lc', `nice -n 10 ${command}`], {
        cwd: this.source,
        env: { HOME: process.env.HOME, USER: process.env.USER, LANG: process.env.LANG || 'en_US.UTF-8', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        stdio: ['ignore', log, log],
      });
      this.child.on('error', reject);
      this.child.on('exit', (code) => {
        fs.closeSync(log);
        this.child = null;
        if (code === 0) resolve();
        else reject(new Error(`“${command.split(' ').slice(0, 3).join(' ')}” failed (see update.log)`));
      });
    });
  }

  async update(version) {
    this.setState({ status: 'updating', error: null });
    fs.writeFileSync(this.logFile, `VRK update to Electron ${version}, ${new Date().toISOString()}\n`);
    const manifests = ['package.json', 'package-lock.json'].map((file) => path.join(this.source, file));
    const backups = manifests.map((file) => (fs.existsSync(file) ? fs.readFileSync(file) : null));
    try {
      await this.run(`npm install --save-dev electron@${version}`);
      // npm may skip install scripts it hasn't been told to trust; fetch Electron's engine explicitly.
      await this.run('node node_modules/electron/install.js');
      // The self-test runs twice before giving up, so one network hiccup doesn't block a security fix.
      await this.run('npm run selftest').catch(() => this.run('npm run selftest'));
      await this.run('npm run dist');
      this.ready = { version, app: path.join(this.source, 'dist.noindex', 'mac-arm64', 'VRK.app') };
      this.setState({ status: 'ready', failedVersion: null });
      this.emit('ready', this.summary());
    } catch (err) {
      // Put the project back the way it was.
      manifests.forEach((file, i) => backups[i] && fs.writeFileSync(file, backups[i]));
      await this.run('npm install').catch(() => {});
      this.setState({ status: 'idle', error: `Update to Electron ${version} didn’t pass its checks, so VRK kept the current version. ${err.message}`, failedVersion: version });
    }
  }

  // Swaps in the tested build once this copy of VRK has quit, then optionally reopens it.
  installOnExit({ relaunch = false } = {}) {
    if (!this.ready || !fs.existsSync(this.ready.app)) return false;
    const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
    if (!bundle.endsWith('.app')) return false;
    const q = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
    const script = [
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
      `rm -rf ${q(`${bundle}.old`)}`,
      `if mv ${q(bundle)} ${q(`${bundle}.old`)} && ditto ${q(this.ready.app)} ${q(bundle)}; then rm -rf ${q(`${bundle}.old`)}; else rm -rf ${q(bundle)}; mv ${q(`${bundle}.old`)} ${q(bundle)}; fi`,
      `${LSREGISTER} -f ${q(bundle)}`,
      relaunch ? `open ${q(bundle)}` : 'true',
    ].join('; ');
    spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
    this.ready = null;
    return true;
  }
}

module.exports = { Updater, newer };
