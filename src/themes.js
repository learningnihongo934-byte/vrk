'use strict';
// Themes: built-in ones plus yours from the theme editor. A theme sets
// colors, font, tab shape, glass toolbar, the new-tab background (gradient,
// image, video, animated keyframe gradient) with an optional live effect on
// top (aurora, particles, starfield...), and optional custom CSS for the
// browser UI. Every theme is sanitized, so an imported file can only set
// values VRK understands. Images and videos are copied into VRK's Media folder.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const AdmZip = require('adm-zip');

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/mp4', // H.264 .mov files play as MP4
};
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
const EFFECTS = ['none', 'aurora', 'particles', 'starfield', 'waves', 'matrix', 'bubbles', 'snow', 'fireflies', 'grid', 'confetti'];
const EASINGS = ['linear', 'ease-in-out', 'ease-in', 'ease-out'];

const clamp = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback);
const pick = (value, options, fallback) => (options.includes(value) ? value : fallback);
const color = (value, fallback) => (HEX.test(String(value)) ? String(value).toLowerCase() : fallback);
const colors = (list, fallback, min = 1, max = 6) => {
  const valid = Array.isArray(list) ? list.map((c) => color(c, null)).filter(Boolean).slice(0, max) : [];
  return valid.length >= min ? valid : fallback;
};

const BASE = {
  id: 'new',
  name: 'Untitled theme',
  base: 'dark',
  colors: { bg: '#0b0c10', strip: '#0f1015', surface: '#171920', field: '#0e0f14', text: '#e9eaf0', muted: '#8a8fa3', line: '#262935', accent: '#8b7bff', accent2: '#2ee6c4' },
  font: 'system',
  radius: 10,
  tabStyle: 'classic',
  density: 'comfortable',
  glass: 0,
  chromeGradient: false,
  background: {
    type: 'gradient',
    gradient: { angle: 160, stops: ['#1d1b33', '#0b0c10'] },
    media: null,
    fit: 'cover',
    dim: 0.25,
    blur: 0,
    keyframes: { duration: 20, easing: 'ease-in-out', frames: [{ angle: 135, colors: ['#3a1c71', '#d76d77', '#ffaf7b'] }, { angle: 225, colors: ['#1a2a6c', '#b21f1f', '#fdbb2d'] }] },
    effect: { kind: 'none', speed: 1, density: 1, colors: ['#8b7bff', '#2ee6c4'] },
  },
  animations: { tabs: true, glow: true, logoPulse: false },
  css: '',
};

function sanitize(input, { id } = {}) {
  const t = input && typeof input === 'object' ? input : {};
  const c = t.colors || {};
  const b = t.background || {};
  const k = b.keyframes || {};
  const e = b.effect || {};
  const g = b.gradient || {};
  const base = pick(t.base, ['dark', 'light'], 'dark');
  return {
    id: id || (typeof t.id === 'string' && /^[a-z0-9-]{1,64}$/i.test(t.id) ? t.id : crypto.randomUUID()),
    name: String(t.name || 'Untitled theme').slice(0, 60),
    base,
    colors: Object.fromEntries(Object.entries(BASE.colors).map(([key, fallback]) => [key, color(c[key], fallback)])),
    font: pick(t.font, ['system', 'rounded', 'serif', 'mono', 'condensed'], 'system'),
    radius: clamp(t.radius, 0, 20, 10),
    tabStyle: pick(t.tabStyle, ['classic', 'pill', 'underline'], 'classic'),
    density: pick(t.density, ['comfortable', 'compact'], 'comfortable'),
    glass: clamp(t.glass, 0, 1, 0),
    chromeGradient: Boolean(t.chromeGradient),
    background: {
      type: pick(b.type, ['solid', 'gradient', 'image', 'video', 'keyframes'], 'gradient'),
      gradient: { angle: clamp(g.angle, 0, 360, 160), stops: colors(g.stops, BASE.background.gradient.stops, 2, 5) },
      media: typeof b.media === 'string' && /^[a-f0-9-]{36}\.[a-z0-9]{2,4}$/.test(b.media) ? b.media : null,
      fit: pick(b.fit, ['cover', 'contain', 'tile'], 'cover'),
      dim: clamp(b.dim, 0, 0.9, 0.25),
      blur: clamp(b.blur, 0, 40, 0),
      keyframes: {
        duration: clamp(k.duration, 2, 300, 20),
        easing: pick(k.easing, EASINGS, 'ease-in-out'),
        frames: (Array.isArray(k.frames) ? k.frames : BASE.background.keyframes.frames)
          .slice(0, 8)
          .map((f) => ({ angle: clamp(f?.angle, 0, 360, 135), colors: colors(f?.colors, ['#3a1c71', '#d76d77', '#ffaf7b'], 3, 3) })),
      },
      effect: {
        kind: pick(e.kind, EFFECTS, 'none'),
        speed: clamp(e.speed, 0.1, 4, 1),
        density: clamp(e.density, 0.1, 4, 1),
        colors: colors(e.colors, BASE.background.effect.colors, 1, 6),
      },
    },
    animations: {
      tabs: t.animations?.tabs !== false,
      glow: t.animations?.glow !== false,
      logoPulse: Boolean(t.animations?.logoPulse),
    },
    css: String(t.css || '').slice(0, 20000),
  };
}

const theme = (fields) => sanitize({ ...BASE, ...fields, background: { ...BASE.background, ...fields.background } });

const BUILT_IN = [
  { id: 'classic', name: 'VRK Classic', classic: true }, // follows Appearance → theme, accent and density
  theme({
    id: 'midnight-aurora',
    name: 'Midnight Aurora',
    colors: { ...BASE.colors, bg: '#070812', surface: '#11131d', strip: '#0b0c16', accent: '#7c6cff', accent2: '#2ee6c4' },
    glass: 0.35,
    background: { type: 'solid', gradient: { angle: 180, stops: ['#070812', '#070812'] }, effect: { kind: 'aurora', speed: 1, density: 1, colors: ['#7c6cff', '#2ee6c4', '#ff5fa8'] } },
  }),
  theme({
    id: 'synthwave',
    name: 'Neon Synthwave',
    colors: { bg: '#12021f', strip: '#1a0330', surface: '#22073d', field: '#160226', text: '#ffe9ff', muted: '#c08ad8', line: '#46186a', accent: '#ff3cac', accent2: '#2bd2ff' },
    font: 'condensed',
    tabStyle: 'pill',
    chromeGradient: true,
    background: {
      type: 'keyframes',
      keyframes: { duration: 16, easing: 'ease-in-out', frames: [{ angle: 180, colors: ['#12021f', '#5b1a7a', '#ff3cac'] }, { angle: 180, colors: ['#12021f', '#2b1a7a', '#2bd2ff'] }] },
      effect: { kind: 'grid', speed: 1, density: 1, colors: ['#ff3cac', '#2bd2ff'] },
    },
  }),
  theme({
    id: 'deep-ocean',
    name: 'Deep Ocean',
    colors: { bg: '#04121f', strip: '#061a2c', surface: '#0a2236', field: '#05182a', text: '#e2f4ff', muted: '#7fa6c2', line: '#12344f', accent: '#21b6ff', accent2: '#4fffd2' },
    glass: 0.3,
    background: { type: 'gradient', gradient: { angle: 180, stops: ['#0a3a5c', '#04121f'] }, effect: { kind: 'waves', speed: 0.8, density: 1, colors: ['#21b6ff', '#4fffd2'] } },
  }),
  theme({
    id: 'firefly-forest',
    name: 'Firefly Forest',
    colors: { bg: '#07130d', strip: '#0a1a12', surface: '#0f2419', field: '#081710', text: '#e8f6ec', muted: '#86a893', line: '#1a3a28', accent: '#7ee787', accent2: '#ffd75e' },
    font: 'rounded',
    radius: 14,
    glass: 0.4,
    background: { type: 'gradient', gradient: { angle: 200, stops: ['#16372a', '#07130d'] }, effect: { kind: 'fireflies', speed: 0.7, density: 1.2, colors: ['#ffd75e', '#b4ff8a'] } },
  }),
  theme({
    id: 'starfield',
    name: 'Starfield',
    colors: { bg: '#020306', strip: '#05070d', surface: '#0b0e17', field: '#05070d', text: '#eef2ff', muted: '#8d96b3', line: '#1b2133', accent: '#9bb7ff', accent2: '#ffffff' },
    background: { type: 'solid', gradient: { angle: 180, stops: ['#020306', '#020306'] }, effect: { kind: 'starfield', speed: 1, density: 1.4, colors: ['#ffffff', '#9bb7ff'] } },
  }),
  theme({
    id: 'matrix',
    name: 'Matrix',
    colors: { bg: '#000300', strip: '#000800', surface: '#001100', field: '#000600', text: '#b6ffb6', muted: '#4caf50', line: '#0b3d0b', accent: '#00ff66', accent2: '#00b84a' },
    font: 'mono',
    radius: 2,
    tabStyle: 'underline',
    background: { type: 'solid', gradient: { angle: 180, stops: ['#000300', '#000300'] }, effect: { kind: 'matrix', speed: 1, density: 1, colors: ['#00ff66'] } },
  }),
  theme({
    id: 'paper',
    name: 'Paper',
    base: 'light',
    colors: { bg: '#f6f1e7', strip: '#ebe3d3', surface: '#fbf8f2', field: '#f1ebdf', text: '#2b2620', muted: '#7b6f60', line: '#ddd3c1', accent: '#c2410c', accent2: '#0f766e' },
    font: 'serif',
    radius: 6,
    animations: { tabs: true, glow: false },
    background: { type: 'solid', gradient: { angle: 180, stops: ['#f6f1e7', '#f6f1e7'] } },
  }),
  theme({
    id: 'sakura',
    name: 'Sakura',
    base: 'light',
    colors: { bg: '#fff5f8', strip: '#fde4ec', surface: '#fffafc', field: '#fdeef3', text: '#3a1f2b', muted: '#9a6b7f', line: '#f4cfdc', accent: '#e8558f', accent2: '#ff9eb8' },
    font: 'rounded',
    radius: 16,
    tabStyle: 'pill',
    background: { type: 'gradient', gradient: { angle: 160, stops: ['#ffe3ee', '#fff5f8'] }, effect: { kind: 'snow', speed: 0.6, density: 0.8, colors: ['#ffb7cf', '#ffd6e5'] } },
  }),
].map((t) => ({ ...t, builtIn: true }));

class ThemeStore extends EventEmitter {
  constructor(configDir) {
    super();
    this.file = path.join(configDir, 'themes.json');
    this.mediaDir = path.join(configDir, 'Media');
    this.custom = [];
    try {
      this.custom = JSON.parse(fs.readFileSync(this.file, 'utf8')).themes.map((t) => sanitize(t, { id: t.id }));
    } catch {}
  }

  list() {
    return [...BUILT_IN, ...this.custom];
  }

  get(id) {
    return this.list().find((t) => t.id === id) || BUILT_IN[0];
  }

  save(input) {
    const existing = this.custom.findIndex((t) => t.id === input?.id);
    const clean = sanitize(input, existing >= 0 ? { id: input.id } : {});
    if (existing >= 0) this.custom[existing] = clean;
    else this.custom.push(clean);
    this.persist();
    return clean;
  }

  remove(id) {
    this.custom = this.custom.filter((t) => t.id !== id);
    this.persist();
    this.sweepMedia();
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ themes: this.custom }, null, 2));
    this.emit('change');
  }

  // Copies an image or video into VRK's Media folder; returns its new name.
  importMedia(file) {
    const ext = path.extname(file).toLowerCase();
    if (!MEDIA_TYPES[ext]) throw new Error('Use a PNG, JPEG, GIF, WebP, AVIF, MP4, WebM or MOV file.');
    if (fs.statSync(file).size > MAX_MEDIA_BYTES) throw new Error('That file is larger than 1 GB.');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    const name = `${crypto.randomUUID()}${ext === '.jpeg' ? '.jpg' : ext}`;
    fs.copyFileSync(file, path.join(this.mediaDir, name));
    return { name, kind: MEDIA_TYPES[ext].startsWith('video/') ? 'video' : 'image' };
  }

  // Deletes media no saved theme uses any more.
  sweepMedia(keep = []) {
    const used = new Set([...this.custom.map((t) => t.background.media), ...keep].filter(Boolean));
    let files = [];
    try {
      files = fs.readdirSync(this.mediaDir);
    } catch {}
    for (const file of files) if (!used.has(file)) fs.rmSync(path.join(this.mediaDir, file), { force: true });
  }

  mediaPath(name) {
    if (!/^[a-f0-9-]{36}\.[a-z0-9]{2,4}$/.test(name)) return null;
    const file = path.join(this.mediaDir, name);
    return fs.existsSync(file) ? { file, type: MEDIA_TYPES[path.extname(name)] || 'application/octet-stream' } : null;
  }

  // A .vrktheme file is a zip with theme.json and its background media.
  exportTheme(id, target) {
    const t = this.get(id);
    const zip = new AdmZip();
    zip.addFile('theme.json', Buffer.from(JSON.stringify({ ...t, builtIn: undefined }, null, 2)));
    const media = t.background?.media && this.mediaPath(t.background.media);
    if (media) zip.addLocalFile(media.file, 'media');
    zip.writeZip(target);
  }

  importTheme(file) {
    const zip = new AdmZip(file);
    const raw = JSON.parse(zip.readAsText('theme.json') || 'null');
    if (!raw) throw new Error('That isn’t a VRK theme file.');
    const t = sanitize(raw);
    t.id = crypto.randomUUID();
    t.background.media = null;
    const entry = zip.getEntries().find((e) => e.entryName.startsWith('media/') && !e.isDirectory);
    const ext = entry && path.extname(entry.entryName).toLowerCase();
    if (entry && MEDIA_TYPES[ext] && entry.header.size <= MAX_MEDIA_BYTES) {
      fs.mkdirSync(this.mediaDir, { recursive: true });
      const name = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(this.mediaDir, name), entry.getData());
      t.background.media = name;
    }
    return this.save(t);
  }
}

module.exports = { ThemeStore, sanitize, BASE, EFFECTS };
