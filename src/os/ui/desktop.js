'use strict';
// The VRKOS desktop: wallpaper (your VRK theme), menu bar, dock, Launchpad
// and search, desktop icons, and the lock screen.

(() => {
  const { h, call, menu, ask, confirm, toast, applyTheme, openEntry, icons } = VRKOS;
  const $ = (s) => document.querySelector(s);
  const DOCK_APPS = ['browser', 'files', 'terminal', 'notes', 'editor', 'monitor', 'macapps', 'windows', 'calculator', 'calendar', 'settings'];
  let names = {};
  let state = null;
  let desktopDir = null;
  let unmountWallpaper = () => {};
  let wallpaperKey = '';

  // ── Wallpaper ──
  function setTheme(payload) {
    applyTheme(payload);
    const key = JSON.stringify(payload?.theme?.background || null);
    if (key === wallpaperKey) return;
    wallpaperKey = key;
    unmountWallpaper();
    unmountWallpaper = payload?.theme ? VRKBackground.mount($('#app-bg'), payload.theme) : () => {};
  }

  // ── Menu bar ──
  function focusedName() {
    if (!state) return 'VRKOS';
    if (state.focused === 'browser') return 'VRK Browser';
    const win = state.windows.find((w) => w.id === state.focused);
    return win ? names[win.app] || 'VRKOS' : 'VRKOS';
  }
  function renderMenubar() {
    $('#mb-app').textContent = focusedName();
  }
  function tickClock() {
    const now = new Date();
    const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !state?.settings.clock24 });
    $('#mb-clock').textContent = `${now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}  ${time}`;
    $('#lock-clock').textContent = time;
    $('#lock-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  // ── Status items: sound, network, battery, clock ──
  const status = { battery: null, net: null, volume: null };
  const below = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left, r.bottom + 5];
  };
  const rate = (bytesPerSecond) => `${VRKOS.bytes(bytesPerSecond || 0)}/s`;
  function renderStatus() {
    const b = status.battery;
    $('#mb-battery').hidden = !b;
    if (b) {
      $('#mb-battery').innerHTML = `<span class="mb-pct">${b.percent}%</span>${icons.battery(b.percent, b.charging)}`;
      $('#mb-battery').title = `Battery ${b.percent}%${b.charging ? ', charging' : b.remaining ? `, ${b.remaining} left` : ''}`;
    }
    const online = status.net ? status.net.addresses.length > 0 : navigator.onLine;
    $('#mb-network').innerHTML = online ? icons.UI.wifi : icons.UI.offline;
    $('#mb-network').classList.toggle('dim', Boolean(status.net && !status.net.wifiPower && online));
    const v = status.volume;
    $('#mb-sound').hidden = status.volumeChecked && !v; // Windows: use the taskbar's speaker
    $('#mb-sound').innerHTML = v && (v.muted || v.level === 0) ? icons.UI.muted : icons.UI.sound;
    $('#mb-sound').title = v ? `Volume ${v.muted ? 'muted' : `${v.level}%`}` : 'Sound';
  }
  async function tickStatus() {
    const [stats, net, volume] = await Promise.all([vrkos.call('stats').catch(() => null), vrkos.call('network-info').catch(() => null), vrkos.call('volume').catch(() => null)]);
    if (stats) status.battery = stats.battery;
    if (net) status.net = net;
    status.volume = volume;
    status.volumeChecked = true;
    renderStatus();
  }

  $('#mb-battery').addEventListener('click', async (e) => {
    const b = (await vrkos.call('stats').catch(() => null))?.battery || status.battery;
    if (!b) return;
    status.battery = b;
    renderStatus();
    const power = b.charging ? (b.percent >= 100 ? 'Fully charged' : 'Charging') : b.remaining ? `${b.remaining} remaining` : 'On battery power';
    menu([{ label: `Battery: ${b.percent}%`, disabled: true }, { label: power, disabled: true }, 'separator', { label: 'Battery Settings…', action: () => call('open-system-settings', 'battery') }], ...below(e.currentTarget));
  });

  $('#mb-network').addEventListener('click', async (e) => {
    const n = (await vrkos.call('network-info').catch(() => null)) || status.net;
    if (!n) return;
    status.net = n;
    renderStatus();
    menu(
      [
        { label: `Wi-Fi: ${n.wifiPower ? (n.wifiConnected ? 'Connected' : 'On, not connected') : 'Off'}`, disabled: true },
        ...n.addresses.map((a) => ({ label: `${a.kind} (${a.name}): ${a.address}`, disabled: true })),
        !n.addresses.length && { label: 'Not connected to the internet', disabled: true },
        { label: `Download ${rate(n.rxRate)} · Upload ${rate(n.txRate)}`, disabled: true },
        'separator',
        n.canToggleWifi !== false && { label: n.wifiPower ? 'Turn Wi-Fi Off' : 'Turn Wi-Fi On', action: () => call('wifi-power', !n.wifiPower).then(() => setTimeout(tickStatus, 1500)) },
        { label: 'Network Settings…', action: () => call('open-system-settings', 'network') },
      ],
      ...below(e.currentTarget),
    );
  });

  async function setVolume(change) {
    status.volume = await vrkos.call('set-volume', change).catch(() => status.volume);
    renderStatus();
  }
  $('#mb-sound').addEventListener('click', async (e) => {
    const v = (await vrkos.call('volume').catch(() => null)) || status.volume;
    if (!v) return;
    status.volume = v;
    renderStatus();
    const nearest = v.muted ? -1 : [0, 25, 50, 75, 100].reduce((a, b) => (Math.abs(b - v.level) < Math.abs(a - v.level) ? b : a));
    menu(
      [
        { label: `Volume: ${v.muted ? 'Muted' : `${v.level}%`}`, disabled: true },
        'separator',
        ...[100, 75, 50, 25, 0].map((level) => ({ label: level ? `${level}%` : 'Silent', checked: nearest === level, action: () => setVolume({ level, muted: false }) })),
        'separator',
        { label: 'Mute', checked: v.muted, action: () => setVolume({ muted: !v.muted }) },
        { label: 'Sound Settings…', action: () => call('open-system-settings', 'sound') },
      ],
      ...below(e.currentTarget),
    );
  });
  // Scroll over the speaker to change the volume.
  let wheelTimer = null;
  $('#mb-sound').addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!status.volume) return;
    const level = Math.max(0, Math.min(100, status.volume.level + (e.deltaY < 0 ? 4 : -4)));
    status.volume = { level, muted: false };
    renderStatus();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => setVolume({ level, muted: false }), 120);
  });

  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  $('#mb-clock').addEventListener('click', async (e) => {
    const now = new Date();
    const today = isoDay(now);
    const upcoming = (await vrkos.call('events-list').catch(() => [])).filter((ev) => ev.date >= today).slice(0, 6);
    const dayLabel = (iso) => (iso === today ? 'Today' : new Date(`${iso}T12:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    menu(
      [
        { label: now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), disabled: true },
        'separator',
        ...(upcoming.length ? upcoming.map((ev) => ({ label: `${dayLabel(ev.date)}: ${ev.text || 'Event'}`, action: () => call('open-app', 'calendar') })) : [{ label: 'No upcoming events', disabled: true }]),
        'separator',
        { label: 'Open Calendar', action: () => call('open-app', 'calendar') },
        { label: 'Use 24-Hour Clock', checked: Boolean(state?.settings.clock24), action: () => call('set-os-setting', 'osClock24', !state?.settings.clock24) },
      ],
      ...below(e.currentTarget),
    );
  });

  $('#os-menu').addEventListener('click', (e) => {
    menu(
      [
        { label: 'About VRKOS', action: about },
        'separator',
        { label: 'System Monitor', action: () => call('open-app', 'monitor') },
        { label: 'VRKOS Settings…', action: () => call('open-app', 'settings') },
        { label: 'Privacy & File Access…', action: () => call('open-app', 'settings', { section: 'privacy' }) },
        { label: 'VRK Browser Settings…', action: () => call('browser-settings') },
        'separator',
        { label: 'Lock Screen', action: () => call('lock') },
        { label: 'Exit VRKOS (⌥⌘O shows the desktop)', action: () => call('exit') },
      ],
      ...below(e.currentTarget),
    );
  });

  async function about() {
    const hw = await call('hardware');
    VRKOS.modal((done) => [
      h('div', { class: 'about-logo', html: icons.appIcon('browser') }),
      h('h3', {}, 'VRKOS'),
      h('p', {}, 'The VRK desktop, running on your Mac’s own hardware.'),
      h(
        'table',
        { class: 'about-table' },
        [
          ['Chip', hw.chip],
          ['Cores', `${hw.cores}${hw.performanceCores ? ` (${hw.performanceCores} performance, ${hw.efficiencyCores} efficiency)` : ''}`],
          ['Memory', VRKOS.bytes(hw.memory)],
          ['System', hw.system],
          ['Model', hw.model],
        ].map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v || '—'))),
      ),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => done(true) }, 'OK')),
    ]);
  }

  // ── Dock ──
  function windowsOf(app) {
    return (state?.windows || []).filter((w) => w.app === app);
  }
  function isRunning(app) {
    return app === 'browser' ? Boolean(state?.browser.visible) : windowsOf(app).length > 0;
  }
  async function activate(app) {
    if (app === 'browser') return call('show-browser');
    const list = windowsOf(app);
    if (!list.length) return call('open-app', app);
    // Bring back the app's windows (the hidden ones too), most recent last.
    for (const w of list) await call('focus-window', w.id);
  }
  function dockItem(app, label, onclick, oncontext) {
    return h(
      'button',
      { class: `dock-item${isRunning(app) ? ' running' : ''}`, 'data-app': app, onclick, oncontextmenu: oncontext },
      h('span', { html: icons.appIcon(app) }),
      h('span', { class: 'tip' }, label),
    );
  }
  // A Mac app that's running: click to switch to it (⌘Tab is off in VRKOS).
  function macDockItem(app) {
    const img = h('img', { alt: '' });
    macIcon(app.path, img);
    return h(
      'button',
      {
        class: 'dock-item running mac',
        onclick: () => call('mac-activate', app.pid),
        oncontextmenu: (e) => {
          e.preventDefault();
          menu(
            [
              { label: `Show ${app.name}`, action: () => call('mac-activate', app.pid) },
              { label: 'Hide', disabled: app.hidden, action: () => call('mac-hide', app.pid) },
              'separator',
              { label: `Quit ${app.name}`, action: () => call('mac-quit', app.pid) },
            ],
            e.clientX,
            e.clientY - 10,
          );
        },
      },
      img,
      h('span', { class: 'tip' }, app.name),
    );
  }

  function renderDock() {
    const extra = (state?.windows || []).filter((w) => !DOCK_APPS.includes(w.app));
    $('#dock').replaceChildren(
      ...[
      ...DOCK_APPS.map((app) =>
        dockItem(app, names[app] || app, () => activate(app), (e) => {
          e.preventDefault();
          const list = windowsOf(app);
          menu(
            [
              { label: list.length || (app === 'browser' && isRunning(app)) ? 'Show' : 'Open', action: () => activate(app) },
              app !== 'browser' && { label: 'New Window', action: () => call('open-app', app) },
              list.length && 'separator',
              ...list.map((w) => ({ label: w.title || names[app], action: () => call('focus-window', w.id) })),
            ],
            e.clientX,
            e.clientY - 10,
          );
        }),
      ),
      extra.length ? h('span', { class: 'dock-sep' }) : null,
      ...extra.map((w) => dockItem(w.app, w.title || names[w.app], () => call('focus-window', w.id))),
      state?.mac?.length ? h('span', { class: 'dock-sep' }) : null,
      ...(state?.mac || []).map(macDockItem),
      h('span', { class: 'dock-sep' }),
      dockItem('launchpad', 'Launchpad (⌥Space)', () => toggleLaunchpad()),
      dockItem('trash', 'Trash', () => call('open-file', `${desktopDir?.replace(/\/Desktop$/, '') || ''}/.Trash`)),
      ].filter(Boolean),
    );
  }

  // ── Launchpad & search ──
  let catalog = null;
  let searchTimer = null;
  let firstAction = null;
  async function toggleLaunchpad(force) {
    const lp = $('#launchpad');
    const show = force ?? lp.hidden;
    if (show === !lp.hidden) return;
    lp.hidden = !show;
    vrkos.call('raise', show).catch(() => {}); // in front of every window while it's open
    if (!show) return;
    $('#lp-search').value = '';
    catalog = await call('apps');
    renderLaunchpad('');
    $('#lp-search').focus();
  }
  const iconCache = new Map();
  function macIcon(path, img) {
    if (iconCache.has(path)) return (img.src = iconCache.get(path) || '');
    vrkos.call('icon', path, 'large').then((url) => {
      iconCache.set(path, url);
      if (url) img.src = url;
    });
  }
  function appTile(label, iconHtml, imgPath, action) {
    const img = imgPath ? h('img', { alt: '' }) : null;
    if (img) macIcon(imgPath, img);
    return h('button', { class: 'lp-app', onclick: () => (toggleLaunchpad(false), action()) }, img || h('span', { html: iconHtml || '' }), h('span', {}, label));
  }
  function renderLaunchpad(query) {
    const q = query.trim().toLowerCase();
    const match = (name) => !q || name.toLowerCase().includes(q);
    const built = catalog.builtIn.filter((a) => match(a.name)).map((a) => appTile(a.name, icons.appIcon(a.id), null, () => activate(a.id)));
    const mac = catalog.mac.filter((a) => match(a.name)).map((a) => appTile(a.name, null, a.path, () => call('launch-mac', a.path)));
    const win = catalog.windows.filter((a) => match(a.name)).map((a) => appTile(a.name, icons.appIcon('windows'), null, () => call('wine-run', a.path)));
    const sections = [
      ['VRKOS', built],
      ['Mac Apps', mac],
      ['Windows Apps', win],
    ].filter(([, list]) => list.length);
    const rows = [];
    if (q) {
      rows.push(h('button', { class: 'lp-row', onclick: () => (toggleLaunchpad(false), call('search-web', query)) }, h('span', { html: icons.UI.search }), `Search the web for “${query}”`, h('small', {}, 'VRK Browser')));
      if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(query.trim())) rows.unshift(h('button', { class: 'lp-row', onclick: () => (toggleLaunchpad(false), call('search-web', query)) }, h('span', { html: icons.UI.forward }), `Open ${query.trim()}`));
    }
    const filesBox = h('div', { class: 'lp-section', id: 'lp-files' });
    $('#lp-results').replaceChildren(
      ...sections.map(([title, list]) => h('div', { class: 'lp-section' }, h('h3', {}, title), h('div', { class: 'lp-grid' }, list))),
      rows.length ? h('div', { class: 'lp-section' }, h('h3', {}, 'Web'), rows) : null,
      filesBox,
    );
    const first = $('#lp-results .lp-app, #lp-results .lp-row');
    first?.classList.add('first');
    firstAction = first ? () => first.click() : null;
    clearTimeout(searchTimer);
    if (q.length >= 2) {
      searchTimer = setTimeout(async () => {
        const found = await vrkos.call('search', query).catch(() => []);
        if ($('#lp-search').value !== query || !found.length) return;
        filesBox.replaceChildren(
          h('h3', {}, 'Files'),
          ...found.slice(0, 12).map((f) => h('button', { class: 'lp-row', onclick: () => (toggleLaunchpad(false), openEntry(f)) }, h('span', { html: f.dir ? icons.UI.folder : icons.UI.file }), f.name, h('small', {}, f.path))),
        );
      }, 280);
    }
  }
  $('#lp-search').addEventListener('input', (e) => renderLaunchpad(e.target.value));
  $('#lp-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') firstAction?.();
    if (e.key === 'Escape') toggleLaunchpad(false);
  });
  $('#launchpad').addEventListener('mousedown', (e) => e.target.id === 'launchpad' && toggleLaunchpad(false));
  addEventListener('blur', () => !$('#launchpad').hidden && toggleLaunchpad(false));
  vrkos.on('launchpad', () => toggleLaunchpad());
  $('#mb-search').innerHTML = icons.UI.search;
  $('#mb-search').addEventListener('click', () => toggleLaunchpad());

  // ── Desktop icons (your ~/Desktop folder) ──
  let selected = null;
  async function loadIcons() {
    if (!desktopDir) return;
    let listing;
    try {
      listing = await vrkos.call('list', desktopDir);
    } catch {
      return $('#icons').replaceChildren();
    }
    const entries = listing.entries.sort((a, b) => b.modified - a.modified).slice(0, 60);
    $('#icons').replaceChildren(
      ...entries.map((entry) => {
        const img = h('img', { alt: '' });
        if (entry.kind === 'image' && entry.size < 25e6) img.src = vrkos.fileUrl(entry.path);
        else vrkos.call('icon', entry.path, 'large').then((url) => url && (img.src = url));
        const el = h(
          'div',
          {
            class: `d-icon${selected === entry.path ? ' selected' : ''}`,
            title: entry.name,
            onmousedown: () => {
              selected = entry.path;
              document.querySelectorAll('.d-icon').forEach((d) => d.classList.toggle('selected', d === el));
            },
            ondblclick: () => openEntry(entry),
            oncontextmenu: (e) => {
              e.preventDefault();
              e.stopPropagation();
              menu(
                [
                  { label: 'Open', action: () => openEntry(entry) },
                  !entry.dir && { label: 'Open with Mac Default App', action: () => call('open-file', entry.path) },
                  { label: navigator.userAgent.includes('Windows') ? 'Show in File Explorer' : 'Show in Finder', action: () => call('reveal', entry.path) },
                  'separator',
                  { label: 'Rename…', action: () => rename(entry) },
                  { label: 'Move to Trash', action: () => call('trash', [entry.path]).then(loadIcons) },
                ],
                e.clientX,
                e.clientY,
              );
            },
          },
          img,
          h('span', {}, entry.name),
        );
        return el;
      }),
    );
  }
  async function rename(entry) {
    const name = await ask('Rename', { value: entry.name, okLabel: 'Rename' });
    if (name && name !== entry.name) await call('rename', entry.path, name).then(loadIcons).catch(() => {});
  }

  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('#dock, #menubar, #launchpad, .menu, .d-icon')) return;
    e.preventDefault();
    menu(
      [
        { label: 'New Folder', action: () => desktopDir && call('make-folder', desktopDir).then(loadIcons) },
        { label: 'New Text File', action: () => desktopDir && call('make-file', desktopDir).then(loadIcons) },
        'separator',
        { label: 'Open Terminal', action: () => call('open-app', 'terminal', { cwd: desktopDir }) },
        { label: 'Open in Files', action: () => call('open-app', 'files', { path: desktopDir }) },
        'separator',
        { label: 'Change Wallpaper…', action: () => call('open-app', 'settings', { section: 'wallpaper' }) },
      ],
      e.clientX,
      e.clientY,
    );
  });
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.d-icon')) {
      selected = null;
      document.querySelectorAll('.d-icon.selected').forEach((d) => d.classList.remove('selected'));
    }
  });

  addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'Space') {
      e.preventDefault();
      toggleLaunchpad();
    }
  });

  // ── Lock ──
  $('#lock-unlock').addEventListener('click', () => vrkos.call('unlock'));

  function render() {
    renderMenubar();
    renderDock();
    $('#lock').hidden = !state?.locked;
    tickClock();
  }

  async function start() {
    const info = await vrkos.call('info');
    names = info.apps;
    document.documentElement.style.setProperty('--mb-h', `${info.menuBar || 30}px`);
    setTheme(await vrkos.call('theme'));
    state = await vrkos.call('state');
    render();
    const places = await vrkos.call('places').catch(() => []);
    desktopDir = places.find((p) => p.icon === 'desktop')?.path || null;
    loadIcons();
    tickStatus();
    setInterval(tickClock, 1000);
    setInterval(tickStatus, 20000);
    setInterval(loadIcons, 15000);
    addEventListener('focus', loadIcons);
    addEventListener('online', tickStatus);
    addEventListener('offline', tickStatus);
    document.body.dataset.ready = '1';
    welcome();
  }

  // The first time: offer Full Disk Access, so VRKOS can open every file.
  async function welcome() {
    if (state?.settings.welcomed) return;
    const perms = await vrkos.call('permissions').catch(() => null);
    vrkos.call('set-os-setting', 'osWelcomed', true).catch(() => {});
    if (!perms || perms.fullDisk !== false) return;
    const go = await VRKOS.modal((done) => [
      h('div', { class: 'about-logo', html: icons.appIcon('files') }),
      h('h3', {}, 'Let VRKOS open all your files'),
      h('p', {}, 'macOS keeps some folders private until you allow it. To use every file on this Mac in VRKOS, turn on VRK in System Settings → Privacy & Security → Full Disk Access, then quit and reopen VRK.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Later'), h('button', { class: 'btn primary', onclick: () => done(true) }, 'Open System Settings')),
    ]);
    if (go) call('open-system-settings', 'files');
  }
  vrkos.on('state', (next) => {
    state = next;
    render();
  });
  vrkos.on('theme', setTheme);
  start();
})();
