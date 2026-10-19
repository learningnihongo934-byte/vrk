'use strict';
// Files: browse your Mac, preview, open, rename, copy, move and trash.

(() => {
  const { h, call, menu, ask, confirm, toast, openEntry, bytes, date, icons } = VRKOS;
  const { root, tools, setTitle, args, onArgs } = VRKOS.app;
  const UI = icons.UI;

  let places = [];
  let dir = null;
  let listing = null;
  let view = localStorage.getItem('vrkos.files.view') || 'list';
  let hidden = false;
  let query = '';
  let results = null;
  const back = [];
  const forward = [];
  let selection = new Set();
  let anchor = null;
  let clipboard = null; // { paths, cut }

  const sidebar = h('nav', { class: 'sidebar' });
  const crumbs = h('div', { class: 'crumbs' });
  const search = h('input', { class: 'field f-search', placeholder: 'Search', type: 'search' });
  const body = h('div', { class: 'scroll', tabindex: '0' });
  const status = h('div', { class: 'statusbar' });
  const btn = (icon, title, onclick) => h('button', { class: 'icon-btn', title, html: icon, onclick });
  const backBtn = btn(UI.back, 'Back (⌘[)', () => go(back.pop(), 'back'));
  const fwdBtn = btn(UI.forward, 'Forward (⌘])', () => go(forward.pop(), 'forward'));
  const viewBtn = btn(view === 'list' ? UI.grid : UI.list, 'Change view', () => {
    view = view === 'list' ? 'grid' : 'list';
    localStorage.setItem('vrkos.files.view', view);
    viewBtn.innerHTML = view === 'list' ? UI.grid : UI.list;
    render();
  });
  root.append(
    sidebar,
    h(
      'div',
      { class: 'main' },
      h('div', { class: 'toolbar' }, backBtn, fwdBtn, btn(UI.up, 'Enclosing folder (⌘↑)', () => listing?.parent && go(listing.parent)), crumbs, h('span', { class: 'spacer' }), btn(UI.plus, 'New folder', newFolder), viewBtn, search),
      body,
      status,
    ),
  );

  // ── Navigation ──
  async function go(target, how = 'new') {
    if (!target) return;
    try {
      const next = await call('list', target, { hidden });
      if (how === 'new' && dir && dir !== next.dir) {
        back.push(dir);
        forward.length = 0;
      } else if (how === 'back' && dir) forward.push(dir);
      else if (how === 'forward' && dir) back.push(dir);
      listing = next;
      dir = next.dir;
      results = null;
      query = '';
      search.value = '';
      selection.clear();
      anchor = null;
      render();
    } catch {
      // the error is already shown
    }
  }
  const refresh = () => go(dir, 'refresh');

  function renderSidebar() {
    sidebar.replaceChildren(
      h('h4', {}, 'Favorites'),
      ...places.map((p) =>
        h(
          'div',
          {
            class: `side-item${p.path === dir ? ' active' : ''}`,
            onclick: () => go(p.path),
            ondragover: (e) => (e.preventDefault(), e.currentTarget.classList.add('drop')),
            ondragleave: (e) => e.currentTarget.classList.remove('drop'),
            ondrop: (e) => dropOn(e, p.path),
          },
          h('span', { html: UI[p.icon] || UI.folder }),
          p.name,
        ),
      ),
      h('h4', {}, 'Other'),
      h('div', { class: 'side-item', onclick: () => call('open-file', `${places[0]?.path}/.Trash`) }, h('span', { html: UI.trash }), 'Trash'),
    );
  }

  function renderCrumbs() {
    const parts = dir.split('/').filter(Boolean);
    const items = [h('button', { onclick: () => go('/') }, 'Mac')];
    parts.forEach((part, i) => items.push(h('span', { class: 'sep' }, '›'), h('button', { onclick: () => go(`/${parts.slice(0, i + 1).join('/')}`) }, part)));
    crumbs.replaceChildren(...items);
    crumbs.scrollLeft = crumbs.scrollWidth;
  }

  const entries = () => results || listing?.entries || [];
  const sorted = () => [...entries()].sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1));
  const KIND = { folder: 'Folder', image: 'Image', video: 'Video', audio: 'Audio', pdf: 'PDF', code: 'Code', text: 'Text', archive: 'Archive', app: 'Application', windows: 'Windows program', file: 'Document' };

  function iconFor(entry, large) {
    const img = h('img', { alt: '' });
    if (large && entry.kind === 'image' && entry.size && entry.size < 25e6) {
      img.src = vrkos.fileUrl(entry.path);
      img.loading = 'lazy';
    } else vrkos.call('icon', entry.path, large ? 'large' : 'normal').then((url) => url && (img.src = url));
    return img;
  }

  function render() {
    backBtn.disabled = !back.length;
    fwdBtn.disabled = !forward.length;
    renderSidebar();
    renderCrumbs();
    setTitle(results ? `Search: ${query}` : dir === '/' ? 'Mac' : dir.split('/').pop());
    const list = sorted();
    if (!list.length) body.replaceChildren(h('div', { class: 'empty' }, results ? 'Nothing found.' : 'This folder is empty.'));
    else if (view === 'grid') {
      body.replaceChildren(
        h(
          'div',
          { class: 'f-grid' },
          list.map((entry) => item(h('div', { class: `f-tile${entry.kind === 'image' ? ' thumb' : ''}` }, iconFor(entry, true), h('span', {}, entry.name)), entry)),
        ),
      );
    } else {
      body.replaceChildren(
        h(
          'table',
          { class: 'f-list' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Date Modified'), h('th', { style: { 'text-align': 'right' } }, 'Size'), h('th', {}, 'Kind'))),
          h(
            'tbody',
            {},
            list.map((entry) =>
              item(
                h(
                  'tr',
                  {},
                  h('td', { class: 'n' }, h('div', { class: 'f-name' }, iconFor(entry, false), entry.name)),
                  h('td', { class: 'd' }, date(entry.modified)),
                  h('td', { class: 's' }, entry.dir ? '—' : bytes(entry.size)),
                  h('td', { class: 'k' }, KIND[entry.kind] || 'Document'),
                ),
                entry,
              ),
            ),
          ),
        ),
      );
    }
    paintSelection();
  }

  function item(el, entry) {
    el.dataset.path = entry.path;
    el.addEventListener('mousedown', (e) => select(entry, e));
    el.addEventListener('dblclick', () => openEntry(entry));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!selection.has(entry.path)) select(entry, {});
      itemMenu(entry, e.clientX, e.clientY);
    });
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      if (!selection.has(entry.path)) select(entry, {});
      e.dataTransfer.setData('application/x-vrkos-paths', JSON.stringify([...selection]));
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    if (entry.dir) {
      el.addEventListener('dragover', (e) => (e.preventDefault(), el.classList.add('drop')));
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', (e) => dropOn(e, entry.path));
    }
    return el;
  }

  async function dropOn(e, target) {
    e.preventDefault();
    e.currentTarget.classList?.remove('drop');
    const paths = JSON.parse(e.dataTransfer.getData('application/x-vrkos-paths') || '[]').filter((p) => p !== target);
    if (!paths.length) return;
    await call(e.altKey ? 'copy' : 'move', paths, target).catch(() => {});
    refresh();
  }

  function select(entry, e) {
    const list = sorted();
    if (e.shiftKey && anchor) {
      const a = list.findIndex((x) => x.path === anchor);
      const b = list.findIndex((x) => x.path === entry.path);
      selection = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.path));
    } else if (e.metaKey) {
      if (selection.has(entry.path)) selection.delete(entry.path);
      else selection.add(entry.path);
      anchor = entry.path;
    } else {
      selection = new Set([entry.path]);
      anchor = entry.path;
    }
    paintSelection();
  }

  function paintSelection() {
    body.querySelectorAll('[data-path]').forEach((el) => el.classList.toggle('sel', selection.has(el.dataset.path)));
    const list = entries();
    const chosen = list.filter((x) => selection.has(x.path));
    const size = chosen.filter((x) => !x.dir).reduce((n, x) => n + x.size, 0);
    status.textContent = chosen.length ? `${chosen.length} of ${list.length} selected${size ? `, ${bytes(size)}` : ''}` : `${list.length} items`;
  }

  const selectedPaths = () => [...selection];
  function itemMenu(entry, x, y) {
    const many = selection.size > 1;
    menu(
      [
        { label: 'Open', action: () => sorted().filter((e) => selection.has(e.path)).forEach(openEntry) },
        !entry.dir && { label: 'Open with Mac Default App', action: () => call('open-file', entry.path) },
        entry.dir && { label: 'Open in Terminal', action: () => call('open-app', 'terminal', { cwd: entry.path }) },
        { label: 'Show in Finder', action: () => call('reveal', entry.path) },
        'separator',
        !many && { label: 'Rename…', action: () => rename(entry) },
        { label: 'Duplicate', action: () => call('copy', selectedPaths(), dir).then(refresh) },
        { label: 'Copy', hint: '⌘C', action: () => (clipboard = { paths: selectedPaths(), cut: false }) },
        { label: 'Cut', hint: '⌘X', action: () => (clipboard = { paths: selectedPaths(), cut: true }) },
        { label: 'Paste', hint: '⌘V', disabled: !clipboard, action: paste },
        'separator',
        { label: 'Get Info', action: () => info(entry) },
        { label: 'Move to Trash', hint: '⌘⌫', action: trash },
      ],
      x,
      y,
    );
  }

  body.addEventListener('contextmenu', (e) => {
    if (e.target.closest('[data-path]')) return;
    e.preventDefault();
    menu(
      [
        { label: 'New Folder', action: newFolder },
        { label: 'New Text File', action: () => call('make-file', dir).then(refresh) },
        { label: 'Paste', disabled: !clipboard, action: paste },
        'separator',
        { label: hidden ? 'Hide Hidden Files' : 'Show Hidden Files', action: () => ((hidden = !hidden), refresh()) },
        { label: 'Open in Terminal', action: () => call('open-app', 'terminal', { cwd: dir }) },
        { label: 'Show in Finder', action: () => call('open-file', dir) },
      ],
      e.clientX,
      e.clientY,
    );
  });
  body.addEventListener('mousedown', (e) => {
    if (!e.target.closest('[data-path]')) {
      selection.clear();
      paintSelection();
    }
  });

  async function newFolder() {
    const name = await ask('New Folder', { value: 'untitled folder', okLabel: 'Create' });
    if (name) await call('make-folder', dir, name).then(refresh).catch(() => {});
  }
  async function rename(entry) {
    const name = await ask('Rename', { value: entry.name, okLabel: 'Rename' });
    if (name && name !== entry.name) await call('rename', entry.path, name).then(refresh).catch(() => {});
  }
  async function trash() {
    const paths = selectedPaths();
    if (!paths.length) return;
    await call('trash', paths).catch(() => {});
    toast(`Moved ${paths.length === 1 ? 'it' : `${paths.length} items`} to the Trash.`);
    refresh();
  }
  async function paste() {
    if (!clipboard) return;
    await call(clipboard.cut ? 'move' : 'copy', clipboard.paths, dir).catch(() => {});
    if (clipboard.cut) clipboard = null;
    refresh();
  }
  function info(entry) {
    VRKOS.modal((done) => [
      h('h3', {}, entry.name),
      h(
        'dl',
        { class: 'kv' },
        [
          ['Kind', KIND[entry.kind] || 'Document'],
          ['Where', entry.path.slice(0, entry.path.length - entry.name.length - 1) || '/'],
          ['Size', entry.dir ? '—' : `${bytes(entry.size)} (${entry.size.toLocaleString()} bytes)`],
          ['Modified', date(entry.modified)],
        ].map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'mono' }, v)]),
      ),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => done(true) }, 'OK')),
    ]);
  }

  // ── Search (Spotlight, inside the current folder) ──
  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    query = search.value.trim();
    if (!query) {
      results = null;
      return render();
    }
    searchTimer = setTimeout(async () => {
      results = await call('search', query, dir).catch(() => []);
      selection.clear();
      render();
    }, 300);
  });

  // ── Keyboard ──
  addEventListener('keydown', (e) => {
    if (e.target === search || document.querySelector('.modal-back')) return;
    const list = sorted();
    if (e.metaKey && e.key === 'Backspace') trash();
    else if (e.metaKey && e.key === 'c') clipboard = { paths: selectedPaths(), cut: false };
    else if (e.metaKey && e.key === 'x') clipboard = { paths: selectedPaths(), cut: true };
    else if (e.metaKey && e.key === 'v') paste();
    else if (e.metaKey && e.key === 'a') {
      e.preventDefault();
      selection = new Set(list.map((x) => x.path));
      paintSelection();
    } else if (e.metaKey && e.key === '[') go(back.pop(), 'back');
    else if (e.metaKey && e.key === ']') go(forward.pop(), 'forward');
    else if (e.metaKey && e.key === 'ArrowUp') listing?.parent && go(listing.parent);
    else if ((e.metaKey && e.key === 'ArrowDown') || e.key === 'Enter') list.filter((x) => selection.has(x.path)).forEach(openEntry);
    else if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'n') newFolder();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = list.findIndex((x) => x.path === anchor);
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        select(next, { shiftKey: e.shiftKey });
        body.querySelector(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    }
  });

  onArgs((a) => a.path && go(a.path));
  (async () => {
    places = await call('places').catch(() => []);
    go(args.path || places[0]?.path || '/');
  })();
})();
