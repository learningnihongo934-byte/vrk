'use strict';
// Windows programs in VRKOS, through Wine (no copy of Windows needed). VRK
// keeps its own Wine "C: drive" so it doesn't mix with other Wine setups.
// Programs open in their own windows, like Mac apps. Wine runs many Windows
// programs, but not all; games with anti-cheat and some installers won't work.

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// On Windows, Windows programs simply run; everywhere else they go through Wine.
const NATIVE = process.platform === 'win32';
const CANDIDATES = ['/usr/bin/wine', '/usr/bin/wine64', '/opt/homebrew/bin/wine', '/usr/local/bin/wine', '/opt/homebrew/bin/wine64', '/usr/local/bin/wine64', '/Applications/Wine Stable.app/Contents/Resources/wine/bin/wine'];
const SKIP = /^(unins|uninstall|setup|install|update|crash|helper|vc_?redist|dotnet|directx)/i;

class Wine {
  constructor({ configDir }) {
    this.prefix = NATIVE ? `${process.env.SystemDrive || 'C:'}\\` : path.join(configDir, 'Wine');
    this.binary = NATIVE ? null : CANDIDATES.find((p) => fs.existsSync(p)) || null;
    this.running = new Map(); // pid -> { name, process }
  }

  env() {
    // winemenubuilder makes Mac launcher apps for Windows programs; macOS blocks
    // that ("VRK was prevented from modifying apps"), and VRKOS lists them itself.
    return { ...process.env, WINEPREFIX: this.prefix, WINEDEBUG: '-all', WINEDLLOVERRIDES: 'winemenubuilder.exe=d', PATH: `${path.dirname(this.binary || '/usr/bin/wine')}:/usr/bin:/bin:/usr/sbin:/sbin` };
  }

  get driveC() {
    return NATIVE ? this.prefix : path.join(this.prefix, 'drive_c');
  }

  get ready() {
    if (NATIVE) return true;
    return fs.existsSync(path.join(this.prefix, 'drive_c'));
  }

  status() {
    if (NATIVE) return Promise.resolve({ installed: true, native: true, version: 'Windows', ready: true, prefix: this.prefix });
    return new Promise((resolve) => {
      if (!this.binary) return resolve({ installed: false, ready: false });
      execFile(this.binary, ['--version'], { env: this.env(), timeout: 8000 }, (_err, stdout) =>
        resolve({ installed: true, version: String(stdout || '').trim(), ready: this.ready, prefix: this.prefix }),
      );
    });
  }

  // Creates the Windows environment (a C: drive with Program Files, the
  // registry…). Takes a minute the first time.
  setup() {
    if (NATIVE) return Promise.resolve(true);
    if (!this.binary) return Promise.reject(new Error('Wine isn’t installed. Install it with: brew install --cask wine-stable'));
    fs.mkdirSync(this.prefix, { recursive: true });
    return new Promise((resolve, reject) =>
      execFile(path.join(path.dirname(this.binary), 'wineboot'), ['-u'], { env: this.env(), timeout: 5 * 60 * 1000 }, (err) =>
        err && !this.ready ? reject(new Error('Wine couldn’t set up its Windows environment.')) : resolve(true),
      ),
    );
  }

  // Programs installed in VRK's Windows environment.
  programs() {
    if (!this.ready) return [];
    const roots = ['Program Files', 'Program Files (x86)'].map((d) => path.join(this.driveC, d));
    const found = [];
    const walk = (dir, depth) => {
      if (depth > 3 || found.length > 200) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!/^(Common Files|Internet Explorer|Windows (NT|Media Player)|WindowsPowerShell)$/i.test(entry.name)) walk(full, depth + 1);
        } else if (/\.exe$/i.test(entry.name) && !SKIP.test(entry.name)) {
          found.push({ name: entry.name.replace(/\.exe$/i, ''), path: full, folder: path.basename(dir) });
        }
      }
    };
    roots.forEach((root) => walk(root, 0));
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Runs a Windows program (.exe), installer (.msi) or one of Wine's tools.
  run(target, args = []) {
    if (NATIVE) {
      const file = String(target);
      const [cmd, rest] = /\.msi$/i.test(file) ? ['msiexec.exe', ['/i', file]] : [file, args];
      const child = spawn(cmd, rest, { cwd: fs.existsSync(file) ? path.dirname(file) : undefined, detached: true, stdio: 'ignore', shell: false });
      child.on('error', () => {});
      child.unref();
      return { pid: child.pid, name: path.basename(file).replace(/\.(exe|msi)$/i, '') };
    }
    if (!this.binary) throw new Error('Wine isn’t installed. Install it with: brew install --cask wine-stable');
    const file = String(target);
    const command = /\.msi$/i.test(file) ? ['msiexec', '/i', file] : [file, ...args];
    const child = spawn(this.binary, command, { env: this.env(), cwd: fs.existsSync(file) ? path.dirname(file) : this.prefix, detached: true, stdio: 'ignore' });
    child.unref();
    const name = path.basename(file).replace(/\.(exe|msi)$/i, '');
    this.running.set(child.pid, { name, process: child });
    child.on('exit', () => this.running.delete(child.pid));
    return { pid: child.pid, name };
  }

  // Wine's own Windows tools.
  tool(name) {
    if (NATIVE) {
      const win = { settings: ['control.exe'], explorer: ['explorer.exe'], notepad: ['notepad.exe'], registry: ['regedit.exe'], tasks: ['taskmgr.exe'], cmd: ['cmd.exe'] }[name];
      if (!win) throw new Error('Unknown tool.');
      return this.run(win[0], win.slice(1));
    }
    const tools = { settings: ['winecfg'], explorer: ['explorer'], notepad: ['notepad'], registry: ['regedit'], tasks: ['taskmgr'], cmd: ['wineconsole', 'cmd'] };
    if (!tools[name]) throw new Error('Unknown Wine tool.');
    const [first, ...rest] = tools[name];
    return this.run(first, rest);
  }
}

module.exports = { Wine };
