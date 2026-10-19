'use strict';
// File operations for VRKOS's Files app. Deleting always moves to the Trash
// (you can put things back); nothing here erases files for good.
//
// Everything that touches your folders is asynchronous: macOS asks before an
// app reads Desktop, Documents, Downloads or iCloud Drive, and a synchronous
// read would freeze VRK until you answer.

const { app, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const HOME = process.env.VRK_OS_HOME || os.homedir(); // the self-test uses a scratch home
const MAX_TEXT = 4 * 1024 * 1024;

const KINDS = [
  ['image', /\.(png|jpe?g|gif|webp|avif|heic|bmp|svg|ico|tiff?)$/i],
  ['video', /\.(mp4|m4v|mov|webm|mkv|avi)$/i],
  ['audio', /\.(mp3|m4a|aac|wav|flac|ogg|opus|aiff?)$/i],
  ['pdf', /\.pdf$/i],
  ['code', /\.(js|mjs|cjs|ts|tsx|jsx|json|py|rb|go|rs|c|h|cc|cpp|hpp|java|kt|swift|sh|zsh|bash|css|scss|html?|xml|ya?ml|toml|ini|sql|lua|php|cs|gd)$/i],
  ['text', /\.(txt|md|markdown|log|csv|tsv|rtf|conf|env|gitignore)$/i],
  ['archive', /\.(zip|tar|gz|tgz|bz2|xz|7z|rar|dmg|pkg)$/i],
  ['app', /\.app$/i],
  ['windows', /\.(exe|msi|bat|lnk)$/i],
];
const kindOf = (name, isDir) => (isDir && !/\.app$/i.test(name) ? 'folder' : KINDS.find(([, re]) => re.test(name))?.[0] || 'file');

async function places() {
  const list = [
    ['Home', HOME, 'home'],
    ['Desktop', path.join(HOME, 'Desktop'), 'desktop'],
    ['Documents', path.join(HOME, 'Documents'), 'documents'],
    ['Downloads', path.join(HOME, 'Downloads'), 'downloads'],
    ['Pictures', path.join(HOME, 'Pictures'), 'pictures'],
    ['Music', path.join(HOME, 'Music'), 'music'],
    ['Movies', path.join(HOME, 'Movies'), 'movies'],
    ...(process.platform === 'darwin'
      ? [
          ['Applications', '/Applications', 'apps'],
          ['iCloud Drive', path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), 'cloud'],
          ['Macintosh HD', '/', 'computer'],
        ]
      : process.platform === 'win32'
        ? [['OneDrive', process.env.OneDrive || path.join(HOME, 'OneDrive'), 'cloud']]
        : [['Computer', '/', 'computer']]),
  ];
  const volumes = await drives();
  const exists = await Promise.all([...list, ...volumes].map(([, p]) => fsp.stat(p).then(() => true, () => false)));
  return [...list, ...volumes].filter((_, i) => exists[i]).map(([name, p, icon]) => ({ name, path: p, icon }));
}

// Disks: /Volumes on a Mac, drive letters on Windows, /media and /mnt on Linux.
async function drives() {
  if (process.platform === 'win32') {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const found = await Promise.all(letters.map((l) => fsp.stat(`${l}:\\`).then(() => l, () => null)));
    return found.filter(Boolean).map((l) => [`${l}: drive`, `${l}:\\`, 'drive']);
  }
  const roots = process.platform === 'darwin' ? ['/Volumes'] : [path.join('/media', os.userInfo().username), '/mnt', path.join('/run/media', os.userInfo().username)];
  const out = [];
  for (const root of roots) {
    const names = await fsp.readdir(root).catch(() => []);
    for (const v of names) if (!v.startsWith('.')) out.push([v, path.join(root, v), 'drive']);
  }
  return out;
}

async function list(dir, { hidden = false } = {}) {
  const target = path.resolve(String(dir || HOME));
  const entries = await fsp.readdir(target, { withFileTypes: true });
  const out = [];
  for (const entry of entries.slice(0, 5000)) {
    if (!hidden && entry.name.startsWith('.')) continue;
    if (entry.name === 'Icon\r') continue; // Finder's custom-icon file
    const full = path.join(target, entry.name);
    let stat = null;
    try {
      stat = await fsp.stat(full);
    } catch {}
    const isDir = Boolean(stat?.isDirectory());
    out.push({ name: entry.name, path: full, dir: isDir && !/\.app$/i.test(entry.name), size: stat?.size ?? 0, modified: stat?.mtimeMs ?? 0, kind: kindOf(entry.name, isDir), link: entry.isSymbolicLink() });
  }
  return { dir: target, parent: path.dirname(target) !== target ? path.dirname(target) : null, entries: out };
}

async function readText(file) {
  const stat = await fsp.stat(file);
  if (stat.size > MAX_TEXT) throw new Error('That file is too big to open as text (over 4 MB).');
  const buffer = await fsp.readFile(file);
  if (buffer.subarray(0, 8000).includes(0)) throw new Error('That isn’t a text file.');
  return buffer.toString('utf8');
}

async function writeText(file, text) {
  await fsp.writeFile(path.resolve(file), String(text), 'utf8');
  return true;
}

// "name", "name 2", "name 3"… so nothing is ever overwritten.
// (existsSync here only ever looks inside a folder you've already opened.)
function freeName(dir, name) {
  const { name: base, ext } = path.parse(name);
  let candidate = name;
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n += 1) candidate = `${base} ${n}${ext}`;
  return path.join(dir, candidate);
}

const cleanName = (name) => {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..' || n.includes('/') || n.includes('\0')) throw new Error('That name can’t be used.');
  return n;
};

async function makeFolder(dir, name = 'untitled folder') {
  const target = freeName(dir, cleanName(name));
  await fsp.mkdir(target);
  return target;
}

async function makeFile(dir, name = 'untitled.txt') {
  const target = freeName(dir, cleanName(name));
  await fsp.writeFile(target, '', { flag: 'wx' });
  return target;
}

async function rename(file, name) {
  const target = path.join(path.dirname(file), cleanName(name));
  if (target === file) return file;
  if (fs.existsSync(target)) throw new Error(`“${name}” already exists here.`);
  await fsp.rename(file, target);
  return target;
}

async function copy(files, destination) {
  const made = [];
  for (const file of files) {
    const target = freeName(destination, path.basename(file));
    await fsp.cp(file, target, { recursive: true, errorOnExist: true, force: false });
    made.push(target);
  }
  return made;
}

async function move(files, destination) {
  const moved = [];
  for (const file of files) {
    if (path.dirname(file) === destination) continue;
    if (destination === file || destination.startsWith(file + path.sep)) throw new Error('A folder can’t go inside itself.');
    const target = freeName(destination, path.basename(file));
    try {
      await fsp.rename(file, target);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      // Another disk: copy, then remove the original (that's what a move is).
      await fsp.cp(file, target, { recursive: true, errorOnExist: true, force: false });
      await fsp.rm(file, { recursive: true });
    }
    moved.push(target);
  }
  return moved;
}

// Full Disk Access (System Settings → Privacy & Security) can't be asked for,
// only checked: without it, macOS refuses to open its own privacy database.
async function hasFullDiskAccess() {
  if (process.platform !== 'darwin') return true; // only macOS has this switch
  const probes = ['/Library/Application Support/com.apple.TCC/TCC.db', path.join(os.homedir(), 'Library', 'Safari', 'Bookmarks.plist')];
  let refused = false;
  for (const probe of probes) {
    try {
      const handle = await fsp.open(probe, 'r');
      await handle.close();
      return true;
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') refused = true;
    }
  }
  return refused ? false : null;
}

async function trash(files) {
  for (const file of files) await shell.trashItem(file);
  return true;
}

// Without Spotlight (Windows, Linux): walks the folder, skipping hidden and huge ones.
async function walkSearch(q, dir) {
  const needle = q.toLowerCase();
  const found = [];
  const queue = [[dir, 0]];
  let visited = 0;
  while (queue.length && found.length < 60 && visited < 20000) {
    const [current, depth] = queue.shift();
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      visited += 1;
      if (e.name.startsWith('.') || /^(node_modules|AppData|Library|\$Recycle\.Bin)$/.test(e.name)) continue;
      const full = path.join(current, e.name);
      if (e.name.toLowerCase().includes(needle)) {
        const stat = await fsp.stat(full).catch(() => null);
        found.push({ name: e.name, path: full, dir: Boolean(stat?.isDirectory()), kind: kindOf(e.name, stat?.isDirectory()), size: stat?.size ?? 0, modified: stat?.mtimeMs ?? 0 });
        if (found.length >= 60) break;
      }
      if (e.isDirectory() && depth < 6) queue.push([full, depth + 1]);
    }
  }
  return found;
}

function search(query, dir = HOME) {
  const q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  if (process.platform !== 'darwin') return walkSearch(q, dir);
  return new Promise((resolve) =>
    execFile('/usr/bin/mdfind', ['-onlyin', dir, '-name', q], { timeout: 6000, maxBuffer: 8 * 1024 * 1024 }, async (_err, stdout) => {
      const paths = String(stdout || '').split('\n').filter(Boolean).slice(0, 60);
      resolve(
        await Promise.all(
          paths.map(async (p) => {
            const stat = await fsp.stat(p).catch(() => null);
            const isDir = Boolean(stat?.isDirectory());
            return { name: path.basename(p), path: p, dir: isDir && !/\.app$/i.test(p), kind: kindOf(p, isDir), size: stat?.size ?? 0, modified: stat?.mtimeMs ?? 0 };
          }),
        ),
      );
    }),
  );
}

// Icons, as Finder shows them. Large ones come straight from macOS (batched,
// one small script for many files): Electron's own large-icon call crashes on
// macOS, so it's only used for the small size.
const FINDER_ICONS = `ObjC.import('AppKit');
function run(argv) {
  const size = Number(argv[0]);
  const out = {};
  for (const p of argv.slice(1)) {
    try {
      const icon = $.NSWorkspace.sharedWorkspace.iconForFile(p);
      const reps = ObjC.unwrap($.NSBitmapImageRep.imageRepsWithData(icon.TIFFRepresentation));
      let best = null;
      let bestW = 0;
      for (const r of reps) {
        const w = Number(r.pixelsWide);
        if (!best || (bestW < size ? w > bestW : w >= size && w < bestW)) { best = r; bestW = w; }
      }
      out[p] = best.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).base64EncodedStringWithOptions(0).js;
    } catch (e) { out[p] = null; }
  }
  return JSON.stringify(out);
}`;

const iconCache = new Map();
let pending = new Map(); // path -> [resolve]
let batchTimer = null;

function flushLargeIcons() {
  batchTimer = null;
  const batch = [...pending.entries()].slice(0, 40);
  for (const [p] of batch) pending.delete(p);
  if (pending.size) batchTimer = setTimeout(flushLargeIcons, 0);
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FINDER_ICONS, '128', ...batch.map(([p]) => p)], { timeout: 20000, maxBuffer: 64 * 1024 * 1024 }, (_err, stdout) => {
    let result = {};
    try {
      result = JSON.parse(String(stdout || '{}'));
    } catch {}
    for (const [p, resolvers] of batch) {
      const url = result[p] ? `data:image/png;base64,${result[p]}` : null;
      resolvers.forEach((resolve) => resolve(url));
    }
  });
}

function largeIcon(file) {
  return new Promise((resolve) => {
    if (!pending.has(file)) pending.set(file, []);
    pending.get(file).push(resolve);
    batchTimer ||= setTimeout(flushLargeIcons, 25);
  });
}

// VRKOS's macOS helper draws icons in-process, in a few milliseconds each.
let native = null;
try {
  native = require('./native/vrkos.node');
} catch {}

async function icon(file, size = 'normal') {
  const ext = path.extname(file).toLowerCase();
  // Apps (and extension-less things like folders) have their own icons; documents share one per type.
  const key = ext === '.app' || !ext ? `${file}|${size}` : `${ext}|${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  let url = null;
  try {
    const png = native?.fileIcon(file, size === 'large' ? 128 : 32);
    if (png) url = `data:image/png;base64,${png.toString('base64')}`;
    else if (process.platform !== 'darwin') url = (await app.getFileIcon(file, { size: size === 'large' ? 'large' : 'normal' })).toDataURL(); // only macOS crashes on 'large'
    else url = size === 'large' ? await largeIcon(file) : (await app.getFileIcon(file, { size: 'normal' })).toDataURL();
  } catch {}
  if (iconCache.size > 800) iconCache.clear();
  iconCache.set(key, url);
  return url;
}

module.exports = { HOME, places, list, readText, writeText, makeFolder, makeFile, rename, copy, move, trash, search, icon, kindOf, hasFullDiskAccess };
