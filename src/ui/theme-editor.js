'use strict';
// The theme editor (vrk://themes). Build themes with colors, image/video or
// animated backgrounds, live effects, interface styling and custom CSS, with
// a live preview, undo/redo, and import/export. Built-in themes are edited as
// copies. Loaded after app.js.

(() => {
  const root = document.getElementById('themepanel');
  const EFFECTS = [
    ['none', 'None'],
    ['aurora', 'Aurora'],
    ['particles', 'Constellation'],
    ['starfield', 'Starfield'],
    ['waves', 'Waves'],
    ['matrix', 'Matrix rain'],
    ['bubbles', 'Bubbles'],
    ['snow', 'Snow & petals'],
    ['fireflies', 'Fireflies'],
    ['grid', 'Synthwave grid'],
    ['confetti', 'Confetti'],
  ];
  const TABS = [
    ['colors', 'Colors'],
    ['background', 'Background'],
    ['effects', 'Effects & animation'],
    ['interface', 'Interface'],
    ['advanced', 'Advanced'],
  ];
  const COLOR_FIELDS = [
    ['accent', 'Accent', 'Buttons, highlights, the loading bar'],
    ['accent2', 'Second accent', 'Gradients and glows'],
    ['bg', 'Background', 'Behind pages and panels'],
    ['surface', 'Toolbar', 'Toolbar and active tab'],
    ['strip', 'Tab strip', 'Behind the tabs'],
    ['field', 'Fields', 'Address bar and inputs'],
    ['text', 'Text', null],
    ['muted', 'Secondary text', null],
    ['line', 'Lines', 'Borders and dividers'],
  ];
  const CLASSIC = {
    dark: { bg: '#0b0c10', strip: '#0f1015', surface: '#171920', field: '#0e0f14', text: '#e9eaf0', muted: '#8a8fa3', line: '#262935' },
    light: { bg: '#f4f5f8', strip: '#e4e6ed', surface: '#ffffff', field: '#f1f2f6', text: '#15171e', muted: '#5b6173', line: '#dde0e8' },
    accents: { violet: ['#8b7bff', '#2ee6c4'], teal: ['#1fc7aa', '#7ee8ff'], blue: ['#4c8dff', '#9b7bff'], pink: ['#ff5fa8', '#ffb36b'], orange: ['#ff8a3d', '#ffd43d'], green: ['#36c46a', '#3ddcff'], red: ['#ff5267', '#ff9a5c'], gold: ['#e3a92b', '#ff7a59'] },
  };

  let themes = [];
  let activeId = 'classic';
  let selectedId = null;
  let draft = null; // the theme being edited
  let dirty = false;
  let tab = 'colors';
  let wholeBrowser = false;
  let undo = [];
  let redo = [];
  let lastSnapshot = 0;
  let unmountPreview = () => {};
  let previewKey = '';
  let confirmDelete = false;

  // ── Helpers ────────────────────────────────────────────────────────────

  const h = (tag, props = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') el.className = value;
      else if (key === 'style') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'value') el.value = value;
      else if (key === 'checked') el.checked = value;
      else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
    }
    el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
    return el;
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const builtIn = (id) => themes.find((t) => t.id === id)?.builtIn;
  const uid = () => crypto.randomUUID();

  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l * 100];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hue * 60, s * 100, l * 100];
  }
  function hsl(hue, s, l) {
    hue = ((hue % 360) + 360) % 360;
    s /= 100;
    l /= 100;
    const k = (n) => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // A full, harmonious palette from one accent color.
  function paletteFrom(accent, base) {
    const [hue, sat] = hexToHsl(accent);
    const tint = Math.min(sat, 40) * 0.6;
    const p =
      base === 'light'
        ? { bg: hsl(hue, tint, 97), strip: hsl(hue, tint, 90), surface: hsl(hue, tint, 99.5), field: hsl(hue, tint, 94), text: hsl(hue, 25, 12), muted: hsl(hue, 12, 40), line: hsl(hue, tint, 85) }
        : { bg: hsl(hue, tint, 4.5), strip: hsl(hue, tint, 6.5), surface: hsl(hue, tint, 10), field: hsl(hue, tint, 5.5), text: hsl(hue, 20, 93), muted: hsl(hue, 12, 62), line: hsl(hue, tint, 18) };
    return { ...p, accent, accent2: hsl(hue + 150, 78, base === 'light' ? 45 : 62) };
  }

  // A theme matching VRK Classic's current look, ready to customize.
  function classicTheme() {
    const ui = state.ui;
    const mode = ui.theme === 'light' || (ui.theme === 'system' && !matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark';
    const [accent, accent2] = CLASSIC.accents[ui.accent] || CLASSIC.accents.violet;
    const template = themes.find((t) => t.id === 'midnight-aurora');
    return {
      ...clone(template),
      id: uid(),
      name: 'My theme',
      base: mode,
      builtIn: false,
      colors: { ...CLASSIC[mode], accent, accent2 },
      density: ui.density,
      glass: 0,
      background: {
        ...clone(template.background),
        type: 'gradient',
        gradient: { angle: 160, stops: [hsl(hexToHsl(accent)[0], 30, mode === 'light' ? 92 : 14), CLASSIC[mode].bg] },
        effect: { kind: 'none', speed: 1, density: 1, colors: [accent, accent2] },
      },
    };
  }

  // ── Editing ────────────────────────────────────────────────────────────

  function select(id) {
    selectedId = id;
    const theme = themes.find((t) => t.id === id);
    draft = theme && !theme.classic ? clone(theme) : null;
    dirty = false;
    undo = [];
    redo = [];
    confirmDelete = false;
    render();
  }

  // Applies a change to the draft. Built-in themes turn into an editable copy first.
  function update(mutate, { rerender = false } = {}) {
    if (!draft) return;
    const now = Date.now();
    if (now - lastSnapshot > 400) {
      undo.push(clone(draft));
      if (undo.length > 100) undo.shift();
      redo = [];
    }
    lastSnapshot = now;
    if (draft.builtIn) {
      draft = { ...draft, id: uid(), name: `${draft.name} (my copy)`, builtIn: false };
      rerender = true;
    }
    mutate(draft);
    dirty = true;
    refreshPreview();
    if (rerender) render();
    else renderTop();
  }

  function step(from, to) {
    if (!from.length) return;
    to.push(clone(draft));
    draft = from.pop();
    dirty = true;
    render();
  }

  async function reload(selectId = selectedId) {
    const result = await vrk.request('themes:list');
    themes = result.themes;
    activeId = result.activeId;
    if (selectId && themes.some((t) => t.id === selectId)) select(selectId);
    else select(activeId);
  }

  async function save() {
    if (!draft) return null;
    const { builtIn: _b, ...theme } = draft;
    const saved = await vrk.request('themes:save', theme);
    dirty = false;
    await reload(saved.id);
    return saved;
  }

  async function apply() {
    let id = selectedId;
    if (draft && (dirty || draft.id !== selectedId)) id = (await save()).id;
    await vrk.request('themes:apply', id);
    activeId = id;
    wholeBrowser = false;
    render();
  }

  // ── Preview ────────────────────────────────────────────────────────────

  function refreshPreview() {
    const preview = root.querySelector('.tp');
    if (!preview || !draft) return;
    for (const [name, value] of Object.entries(VRKTheme.vars(draft))) preview.style.setProperty(name, value);
    preview.dataset.theme = draft.base;
    preview.dataset.tabstyle = draft.tabStyle;
    preview.dataset.chromeGradient = draft.chromeGradient ? '1' : '0';
    preview.dataset.glass = draft.glass > 0 ? '1' : '0';
    const key = JSON.stringify([draft.background, draft.colors.bg, draft.base]);
    if (key !== previewKey) {
      previewKey = key;
      unmountPreview();
      unmountPreview = VRKBackground.mount(preview.querySelector('.tp-bg'), draft);
    }
    if (wholeBrowser) VRKTheme.apply(draft);
  }

  function setWholeBrowser(on) {
    wholeBrowser = on;
    if (on && draft) VRKTheme.apply(draft);
    else applyActiveTheme();
    renderTop();
  }

  // ── Controls ───────────────────────────────────────────────────────────

  const row = (label, hint, control) => h('div', { class: 'te-row' }, h('div', { class: 'te-label' }, h('b', {}, label), hint && h('small', {}, hint)), control);

  function colorInput(get, set) {
    const hex = h('input', { class: 'te-hex', value: get(), maxlength: '9', spellcheck: 'false' });
    const picker = h('input', {
      type: 'color',
      value: get().slice(0, 7),
      oninput: (e) => {
        hex.value = e.target.value;
        update((d) => set(d, e.target.value));
      },
    });
    hex.addEventListener('change', () => {
      if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex.value)) {
        picker.value = hex.value.slice(0, 7);
        update((d) => set(d, hex.value.toLowerCase()));
      } else hex.value = get();
    });
    return h('span', { class: 'te-color' }, picker, hex);
  }

  function slider(min, max, stepSize, get, set, format = (v) => v) {
    const out = h('span', { class: 'te-value' }, format(get()));
    const input = h('input', {
      type: 'range',
      min,
      max,
      step: stepSize,
      value: get(),
      oninput: (e) => {
        const v = Number(e.target.value);
        out.textContent = format(v);
        update((d) => set(d, v));
      },
    });
    return h('span', { class: 'te-slider' }, input, out);
  }

  const segmented = (options, get, set) =>
    h(
      'div',
      { class: 'segmented' },
      options.map(([value, label]) => h('button', { class: get() === value ? 'active' : '', onclick: () => update((d) => set(d, value), { rerender: true }) }, label)),
    );

  const toggle = (get, set) =>
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: get(), onchange: (e) => update((d) => set(d, e.target.checked)) }), h('span'));

  // `get(d)` returns the color array to edit in draft `d` (the current draft by default).
  function colorList(get, { min = 1, max = 6 } = {}) {
    const list = get();
    return h(
      'div',
      { class: 'te-chips' },
      list.map((c, i) =>
        h(
          'span',
          { class: 'te-chip' },
          colorInput(() => get()[i], (d, v) => (get(d)[i] = v)),
          list.length > min && h('button', { class: 'icon-btn small', title: 'Remove', onclick: () => update((d) => get(d).splice(i, 1), { rerender: true }) }, '×'),
        ),
      ),
      list.length < max && h('button', { class: 'btn small', onclick: () => update((d) => get(d).push(list[list.length - 1]), { rerender: true }) }, '+ Color'),
    );
  }

  // ── Tabs ───────────────────────────────────────────────────────────────

  const panels = {
    colors: () => [
      row('Mode', 'Light or dark interface.', segmented([['dark', 'Dark'], ['light', 'Light']], () => draft.base, (d, v) => (d.base = v))),
      h(
        'div',
        { class: 'te-actions' },
        h('button', { class: 'btn', onclick: () => update((d) => Object.assign(d.colors, paletteFrom(d.colors.accent, d.base)), { rerender: true }) }, 'Build Palette from Accent'),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              const accent = hsl(Math.random() * 360, 70 + Math.random() * 25, draft.base === 'light' ? 48 : 64);
              update((d) => {
                Object.assign(d.colors, paletteFrom(accent, d.base));
                d.background.gradient.stops = [hsl(hexToHsl(accent)[0], 35, d.base === 'light' ? 90 : 16), d.colors.bg];
                d.background.effect.colors = [accent, d.colors.accent2];
              }, { rerender: true });
            },
          },
          '🎲 Random Palette',
        ),
        draft.background.type === 'image' && draft.background.media && h('button', { class: 'btn', onclick: paletteFromImage }, 'Palette from Background Image'),
      ),
      ...COLOR_FIELDS.map(([key, label, hint]) => row(label, hint, colorInput(() => draft.colors[key], (d, v) => (d.colors[key] = v)))),
    ],

    background: () => {
      const bg = draft.background;
      const media = bg.type === 'image' || bg.type === 'video';
      return [
        row(
          'Type',
          null,
          segmented(
            [['solid', 'Solid'], ['gradient', 'Gradient'], ['image', 'Image'], ['video', 'Video'], ['keyframes', 'Animated']],
            () => bg.type,
            (d, v) => (d.background.type = v),
          ),
        ),
        bg.type === 'solid' && h('div', { class: 'te-note' }, 'Uses the Background color from the Colors tab.'),
        bg.type === 'gradient' && [
          row('Angle', null, slider(0, 360, 1, () => bg.gradient.angle, (d, v) => (d.background.gradient.angle = v), (v) => `${v}°`)),
          row('Colors', 'Two to five stops.', colorList((d = draft) => d.background.gradient.stops, { min: 2, max: 5 })),
        ],
        media && [
          row(
            bg.type === 'video' ? 'Video' : 'Image',
            bg.media ? 'Stored in VRK’s Media folder.' : 'PNG, JPEG, GIF, WebP or AVIF images; MP4, WebM or MOV videos.',
            h('button', { class: 'btn primary', onclick: chooseMedia }, bg.media ? 'Replace…' : 'Choose File…'),
          ),
          row('Fit', null, segmented([['cover', 'Fill'], ['contain', 'Fit'], ...(bg.type === 'image' ? [['tile', 'Tile']] : [])], () => bg.fit, (d, v) => (d.background.fit = v))),
          row('Dim', 'Darkens (or lightens) it so text stays readable.', slider(0, 0.9, 0.05, () => bg.dim, (d, v) => (d.background.dim = v), (v) => `${Math.round(v * 100)}%`)),
          row('Blur', null, slider(0, 40, 1, () => bg.blur, (d, v) => (d.background.blur = v), (v) => `${v}px`)),
        ],
        bg.type === 'keyframes' && keyframeEditor(),
        h('div', { class: 'te-note' }, 'Add a live effect on top in “Effects & animation”.'),
      ];
    },

    effects: () => {
      const e = draft.background.effect;
      return [
        h('div', { class: 'te-sub' }, 'Background effect'),
        h(
          'div',
          { class: 'te-effects' },
          EFFECTS.map(([kind, label]) =>
            h('button', { class: `te-effect ${e.kind === kind ? 'active' : ''}`, onclick: () => update((d) => (d.background.effect.kind = kind), { rerender: true }) }, h('span', { class: `te-effect-icon fx-${kind}` }), label),
          ),
        ),
        e.kind !== 'none' && [
          row('Speed', null, slider(0.1, 4, 0.1, () => e.speed, (d, v) => (d.background.effect.speed = v), (v) => `${v.toFixed(1)}×`)),
          row('Amount', null, slider(0.1, 4, 0.1, () => e.density, (d, v) => (d.background.effect.density = v), (v) => `${v.toFixed(1)}×`)),
          row('Colors', null, colorList((d = draft) => d.background.effect.colors, { min: 1, max: 6 })),
        ],
        h('div', { class: 'te-sub' }, 'Interface animations'),
        row('Tabs slide in', null, toggle(() => draft.animations.tabs, (d, v) => (d.animations.tabs = v))),
        row('Accent glow', 'Glowing address bar and loading bar.', toggle(() => draft.animations.glow, (d, v) => (d.animations.glow = v))),
        row('Breathing logo', 'The new tab logo gently pulses.', toggle(() => draft.animations.logoPulse, (d, v) => (d.animations.logoPulse = v))),
      ];
    },

    interface: () => [
      row(
        'Font',
        null,
        h(
          'select',
          { onchange: (e) => update((d) => (d.font = e.target.value), { rerender: true }) },
          [['system', 'System'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['mono', 'Monospace'], ['condensed', 'Condensed']].map(([v, label]) =>
            h('option', { value: v, selected: draft.font === v }, label),
          ),
        ),
      ),
      row('Corner roundness', null, slider(0, 20, 1, () => draft.radius, (d, v) => (d.radius = v), (v) => `${v}px`)),
      row('Tab style', null, segmented([['classic', 'Classic'], ['pill', 'Pill'], ['underline', 'Underline']], () => draft.tabStyle, (d, v) => (d.tabStyle = v))),
      row('Density', null, segmented([['comfortable', 'Comfortable'], ['compact', 'Compact']], () => draft.density, (d, v) => (d.density = v))),
      row('Glass toolbar', 'Lets the background show through the tabs and toolbar.', slider(0, 1, 0.05, () => draft.glass, (d, v) => (d.glass = v), (v) => `${Math.round(v * 100)}%`)),
      row('Gradient toolbar', 'Blends the accent colors into the tab strip.', toggle(() => draft.chromeGradient, (d, v) => (d.chromeGradient = v))),
    ],

    advanced: () => {
      let timer = null;
      return [
        row('Custom CSS', 'Styles VRK’s own interface (never web pages). Turn on “Preview on browser” to see it live.', h('span')),
        h('textarea', {
          class: 'te-css',
          spellcheck: 'false',
          placeholder: '/* Example */\n#toolbar { box-shadow: 0 0 30px var(--accent); }\n.tab.active { font-weight: 700; }',
          value: draft.css,
          oninput: (e) => {
            clearTimeout(timer);
            const value = e.target.value;
            timer = setTimeout(() => update((d) => (d.css = value)), 250);
          },
        }),
        h('div', { class: 'te-note mono' }, 'Variables: --bg --strip --toolbar --field --text --muted --line --accent --accent-2 --radius-ui --font-ui. Elements: #tabstrip .tab #toolbar #omnibox #bookmarksbar #ntp .big-search'),
      ];
    },
  };

  function keyframeEditor() {
    const k = draft.background.keyframes;
    const move = (i, by) => update((d) => {
      const frames = d.background.keyframes.frames;
      const [frame] = frames.splice(i, 1);
      frames.splice(i + by, 0, frame);
    }, { rerender: true });
    return [
      h('div', { class: 'te-sub' }, `Keyframes — the background flows between them`),
      ...k.frames.map((frame, i) =>
        h(
          'div',
          { class: 'te-frame' },
          h('span', { class: 'te-frame-swatch', style: { background: `linear-gradient(${frame.angle}deg, ${frame.colors.join(', ')})` } }),
          frame.colors.map((_, ci) => colorInput(() => draft.background.keyframes.frames[i].colors[ci], (d, v) => (d.background.keyframes.frames[i].colors[ci] = v))),
          slider(0, 360, 1, () => draft.background.keyframes.frames[i].angle, (d, v) => (d.background.keyframes.frames[i].angle = v), (v) => `${v}°`),
          h('button', { class: 'icon-btn small', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'icon-btn small', title: 'Move down', disabled: i === k.frames.length - 1, onclick: () => move(i, 1) }, '↓'),
          k.frames.length > 2 && h('button', { class: 'icon-btn small', title: 'Remove', onclick: () => update((d) => d.background.keyframes.frames.splice(i, 1), { rerender: true }) }, '×'),
        ),
      ),
      k.frames.length < 8 &&
        h('button', {
          class: 'btn small',
          onclick: () =>
            update((d) => {
              const last = d.background.keyframes.frames[d.background.keyframes.frames.length - 1];
              const [hue] = hexToHsl(last.colors[1]);
              d.background.keyframes.frames.push({ angle: (last.angle + 45) % 360, colors: [last.colors[0], hsl(hue + 40, 70, 55), hsl(hue + 80, 70, 60)] });
            }, { rerender: true }),
        }, '+ Keyframe'),
      row('Cycle length', null, slider(2, 120, 1, () => k.duration, (d, v) => (d.background.keyframes.duration = v), (v) => `${v}s`)),
      row(
        'Easing',
        null,
        segmented([['ease-in-out', 'Smooth'], ['linear', 'Linear'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out']], () => k.easing, (d, v) => (d.background.keyframes.easing = v)),
      ),
    ];
  }

  async function chooseMedia() {
    const media = await vrk.request('themes:choose-media').catch((err) => {
      showNotice({ text: err.message });
      return null;
    });
    if (media) update((d) => Object.assign(d.background, { type: media.kind, media: media.name }), { rerender: true });
  }

  // Samples the background image and builds a palette around its most vivid common color.
  function paletteFromImage() {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 48, height: 48 });
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 48, 48);
      const data = ctx.getImageData(0, 0, 48, 48).data;
      const buckets = new Map();
      let light = 0;
      for (let i = 0; i < data.length; i += 4) {
        const hex = `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        const [hue, s, l] = hexToHsl(hex);
        light += l;
        if (s < 25 || l < 15 || l > 90) continue;
        const key = Math.round(hue / 20);
        const bucket = buckets.get(key) || { count: 0, best: hex, score: 0 };
        bucket.count += 1;
        if (s + (50 - Math.abs(55 - l)) > bucket.score) Object.assign(bucket, { best: hex, score: s + (50 - Math.abs(55 - l)) });
        buckets.set(key, bucket);
      }
      const top = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
      const base = light / (data.length / 4) > 60 ? 'light' : 'dark';
      const accent = top ? top.best : draft.colors.accent;
      update((d) => {
        d.base = base;
        Object.assign(d.colors, paletteFrom(accent, base));
        d.background.effect.colors = [accent, d.colors.accent2];
      }, { rerender: true });
    };
    img.src = VRKTheme.mediaUrl(draft.background.media);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  function swatch(theme) {
    if (theme.classic) return h('span', { class: 'te-card-swatch', style: { background: 'linear-gradient(135deg, #171920, #8b7bff 60%, #2ee6c4)' } });
    const b = theme.background;
    let background = theme.colors.bg;
    if (b.type === 'gradient') background = `linear-gradient(${b.gradient.angle}deg, ${b.gradient.stops.join(', ')})`;
    if (b.type === 'keyframes') background = `linear-gradient(${b.keyframes.frames[0].angle}deg, ${b.keyframes.frames[0].colors.join(', ')})`;
    if (b.type === 'image' && b.media) background = `center / cover url("${VRKTheme.mediaUrl(b.media)}")`;
    return h(
      'span',
      { class: 'te-card-swatch', style: { background } },
      h('i', { style: { background: theme.colors.accent } }),
      h('i', { style: { background: theme.colors.accent2 } }),
      b.type === 'video' && h('em', {}, 'video'),
      b.effect.kind !== 'none' && h('em', {}, EFFECTS.find(([k]) => k === b.effect.kind)?.[1]),
    );
  }

  function renderTop() {
    const top = root.querySelector('.te-top');
    if (!top) return;
    const isActive = draft ? draft.id === activeId && !dirty : selectedId === activeId;
    const items = [
      draft
        ? h('input', { class: 'te-name', value: draft.name, maxlength: '60', onchange: (e) => update((d) => (d.name = e.target.value.trim() || 'Untitled theme'), { rerender: true }) })
        : h('h2', { class: 'section-title' }, 'VRK Classic'),
      draft && h('button', { class: 'icon-btn small', title: 'Undo', disabled: !undo.length, onclick: () => step(undo, redo) }, '↶'),
      draft && h('button', { class: 'icon-btn small', title: 'Redo', disabled: !redo.length, onclick: () => step(redo, undo) }, '↷'),
      h('span', { class: 'bar-spacer' }),
      draft && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: wholeBrowser, onchange: (e) => setWholeBrowser(e.target.checked) }), 'Preview on browser'),
      draft && !builtIn(draft.id) && themes.some((t) => t.id === draft.id) && h('button', { class: 'btn', onclick: () => vrk.request('themes:export', draft.id) }, 'Export'),
      draft &&
        !builtIn(draft.id) &&
        themes.some((t) => t.id === draft.id) &&
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              if (!confirmDelete) {
                confirmDelete = true;
                return renderTop();
              }
              await vrk.request('themes:delete', draft.id);
              reload('classic');
            },
          },
          confirmDelete ? 'Really delete?' : 'Delete',
        ),
      draft && h('button', { class: 'btn', disabled: !dirty, onclick: save }, dirty ? 'Save' : 'Saved'),
      h('button', { class: 'btn primary', disabled: isActive, onclick: apply }, isActive ? 'Current Theme' : dirty ? 'Save & Use' : 'Use Theme'),
    ];
    top.replaceChildren(...items.filter(Boolean)); // skipped buttons are `false`
  }

  function render() {
    if (!themes.length) return;
    const gallery = h(
      'aside',
      { class: 'te-gallery' },
      h('div', { class: 'te-gallery-head' }, h('h2', {}, 'Themes')),
      h(
        'div',
        { class: 'te-gallery-buttons' },
        h('button', { class: 'btn primary small', onclick: () => newTheme() }, '+ New Theme'),
        h('button', { class: 'btn small', onclick: importTheme }, 'Import…'),
      ),
      themes.map((theme) =>
        h(
          'button',
          { class: `te-card ${theme.id === selectedId ? 'selected' : ''}`, onclick: () => select(theme.id) },
          swatch(theme),
          h('span', { class: 'te-card-name' }, theme.name, theme.id === activeId && h('em', { class: 'te-badge' }, 'In use')),
          h('small', {}, theme.classic ? 'Follows Appearance settings' : theme.builtIn ? 'Built-in' : 'Yours'),
        ),
      ),
    );

    const main = draft
      ? h(
          'section',
          { class: 'te-main' },
          h('header', { class: 'te-top' }),
          draft.builtIn && h('div', { class: 'te-note banner-note' }, 'This is a built-in theme. Your changes are saved as a copy.'),
          h(
            'div',
            { class: 'te-body' },
            h(
              'div',
              { class: 'te-controls' },
              h('div', { class: 'te-tabs' }, TABS.map(([id, label]) => h('button', { class: tab === id ? 'active' : '', onclick: () => ((tab = id), render()) }, label))),
              h('div', { class: 'te-panel' }, panels[tab]()),
            ),
            h('div', { class: 'te-preview-wrap' }, previewMock(), h('p', { class: 'te-note' }, 'Live preview. Effects and video run here exactly as on your new tab page.')),
          ),
        )
      : h(
          'section',
          { class: 'te-main' },
          h('header', { class: 'te-top' }),
          h(
            'div',
            { class: 'empty te-classic' },
            h('p', {}, 'VRK Classic follows your Appearance settings: dark or light, accent color and density.'),
            h('button', { class: 'btn primary', onclick: () => newTheme(classicTheme()) }, 'Customize a Copy'),
          ),
        );

    unmountPreview();
    previewKey = '';
    root.replaceChildren(h('div', { class: 'te' }, gallery, main));
    renderTop();
    refreshPreview();
  }

  function previewMock() {
    return h(
      'div',
      { class: 'tp' },
      h(
        'div',
        { class: 'tp-strip' },
        h('span', { class: 'tp-lights' }, h('i'), h('i'), h('i')),
        h('span', { class: 'tp-tab on' }, 'New Tab'),
        h('span', { class: 'tp-tab' }, 'Docs'),
        h('span', { class: 'tp-plus' }, '+'),
      ),
      h('div', { class: 'tp-toolbar' }, h('span', { class: 'tp-nav' }, '‹  ›'), h('span', { class: 'tp-omni' }, 'Search privately or enter an address'), h('span', { class: 'tp-pill' }, 'VPN')),
      h('div', { class: 'tp-load' }),
      h(
        'div',
        { class: 'tp-page' },
        h('div', { class: 'tp-bg' }),
        h('div', { class: 'tp-hero' }, h('div', { class: 'tp-logo' }), h('div', { class: 'tp-word' }, 'VRK'), h('div', { class: 'tp-search' }, 'Search privately…')),
      ),
    );
  }

  function newTheme(seed) {
    const base = seed || { ...clone(themes.find((t) => t.id === 'midnight-aurora')), id: uid(), name: 'My theme', builtIn: false };
    selectedId = base.id;
    draft = base;
    dirty = true;
    undo = [];
    redo = [];
    render();
  }

  async function importTheme() {
    const theme = await vrk.request('themes:import').catch((err) => {
      showNotice({ text: `Couldn’t import that theme: ${err.message}` });
      return null;
    });
    if (theme) reload(theme.id);
  }

  // Leaving the editor drops the whole-browser preview.
  function leave() {
    unmountPreview();
    previewKey = '';
    if (wholeBrowser) {
      wholeBrowser = false;
      applyActiveTheme();
    }
  }

  window.VRKThemeEditor = { open: () => reload(), leave };
})();
