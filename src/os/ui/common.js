'use strict';
// Shared by the VRKOS desktop and its apps: a DOM helper, menus, dialogs,
// formatting, theme colors, and which app opens which kind of file.

(() => {
  const h = (tag, props = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'class') el.className = value;
      else if (key === 'style') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
      else if (key === 'html') el.innerHTML = value; // only ever VRKOS's own static SVG icons
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'value') el.value = value;
      else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
    }
    el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
    return el;
  };

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const bytes = (n) => {
    let v = Number(n) || 0;
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
      v /= 1000;
      i += 1;
    }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  };
  const date = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

  // ── Menus and dialogs ──
  let openMenu = null;
  function closeMenu() {
    openMenu?.remove();
    openMenu = null;
  }
  // items: [{ label, disabled?, checked?, action?, submenu? }] or 'separator'.
  // Shown as a native macOS menu, so it's always on top of every window.
  async function menu(items, x, y) {
    closeMenu();
    const actions = new Map();
    let next = 0;
    const toNative = (list) =>
      list.filter(Boolean).map((item) => {
        if (item === 'separator') return 'separator';
        const id = `m${(next += 1)}`;
        if (item.action) actions.set(id, item.action);
        return { id, label: item.label, disabled: Boolean(item.disabled), checked: item.checked, submenu: item.submenu && toNative(item.submenu) };
      });
    try {
      const chosen = await vrkos.call('popup-menu', toNative(items), x, y);
      if (chosen) actions.get(chosen)?.();
    } catch {
      htmlMenu(items, x, y);
    }
  }

  // The same menu drawn in the page (if the native one isn't available).
  function htmlMenu(items, x, y) {
    closeMenu();
    const el = h(
      'div',
      { class: 'menu' },
      items.filter(Boolean).map((item) =>
        item === 'separator'
          ? h('hr')
          : h('button', { disabled: item.disabled, onclick: () => (closeMenu(), item.action?.()) }, item.label, item.hint && h('span', { class: 'hint' }, item.hint)),
      ),
    );
    document.body.append(el);
    const r = el.getBoundingClientRect();
    el.style.setProperty('left', `${Math.min(x, innerWidth - r.width - 6)}px`);
    el.style.setProperty('top', `${Math.min(y, innerHeight - r.height - 6)}px`);
    openMenu = el;
  }
  addEventListener('mousedown', (e) => openMenu && !openMenu.contains(e.target) && closeMenu(), true);
  addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  addEventListener('blur', closeMenu);

  function modal(build) {
    return new Promise((resolve) => {
      const back = h('div', { class: 'modal-back' });
      const done = (value) => {
        back.remove();
        resolve(value);
      };
      back.append(h('div', { class: 'modal' }, build(done)));
      back.addEventListener('mousedown', (e) => e.target === back && done(null));
      document.body.append(back);
      back.querySelector('input, button.primary')?.focus();
    });
  }
  const ask = (title, { value = '', message = '', okLabel = 'OK' } = {}) =>
    modal((done) => {
      const input = h('input', { class: 'field', value, onkeydown: (e) => (e.key === 'Enter' ? done(input.value) : e.key === 'Escape' && done(null)) });
      setTimeout(() => input.select());
      return [h('h3', {}, title), message && h('p', {}, message), input, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => done(input.value) }, okLabel))];
    });
  const confirm = (title, message, okLabel = 'OK', danger = false) =>
    modal((done) => [
      h('h3', {}, title),
      message && h('p', {}, message),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, okLabel)),
    ]);

  let toastTimer = null;
  function toast(text, error = false) {
    document.querySelector('.toast')?.remove();
    const el = h('div', { class: `toast${error ? ' err' : ''}` }, text);
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), error ? 6000 : 3000);
  }
  // Runs a VRKOS call; failures show as a message instead of breaking the app.
  async function call(name, ...args) {
    try {
      return await vrkos.call(name, ...args);
    } catch (err) {
      toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
      throw err;
    }
  }

  // ── Theme ──
  function applyTheme(payload) {
    const theme = payload?.theme;
    if (!theme || !window.VRKTheme) return;
    VRKTheme.apply(theme, {});
    document.body.dataset.theme = theme.base;
  }

  // ── Which app opens what ──
  const OPENERS = { image: 'viewer', video: 'viewer', audio: 'viewer', text: 'editor', code: 'editor' };
  async function openEntry(entry) {
    if (entry.dir) return call('open-app', 'files', { path: entry.path });
    if (entry.kind === 'app') return call('launch-mac', entry.path);
    if (entry.kind === 'windows' && /\.(exe|msi)$/i.test(entry.name)) return call('wine-run', entry.path);
    if (OPENERS[entry.kind]) return call('open-app', OPENERS[entry.kind], { path: entry.path });
    return call('open-file', entry.path); // PDFs, documents…: your Mac's default app
  }

  window.VRKOS = { h, bytes, date, menu, closeMenu, modal, ask, confirm, toast, call, applyTheme, openEntry, icons: window.VRKOS_ICONS };
})();
