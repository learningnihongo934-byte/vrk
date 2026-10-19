'use strict';
// VRKOS Settings: wallpaper, clock, starting in VRKOS, file and screen access,
// and about this Mac.

(() => {
  const { h, call, bytes } = VRKOS;
  const { root, args, onArgs } = VRKOS.app;

  let section = args.section || 'wallpaper';
  let data = null;
  let hardware = null;
  let perms = null;
  const nav = h('nav', { class: 'sidebar' });
  const main = h('div', { class: 'set-main' });
  root.append(nav, main);

  const SECTIONS = [
    ['wallpaper', 'Wallpaper', 'pictures'],
    ['general', 'General', 'desktop'],
    ['privacy', 'Privacy & Access', 'shield'],
    ['about', 'About', 'drive'],
  ];
  const toggle = (key, on) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => call('set-os-setting', key, e.target.checked).then(load) }), h('span'));
  const WALL_COLORS = { 'midnight-aurora': '#1b2a6b, #6a3fb5', synthwave: '#2b0f54, #ff3cac', 'deep-ocean': '#05264a, #0aa1c8', 'firefly-forest': '#0d2416, #3b6b2a', starfield: '#05060f, #2a2f6b', matrix: '#000, #0a3b12', paper: '#f2efe8, #d8d2c4', sakura: '#ffd6e5, #b06a8f' };

  function render() {
    nav.replaceChildren(...SECTIONS.map(([id, label, icon]) => h('div', { class: `side-item${section === id ? ' active' : ''}`, onclick: () => ((section = id), render()) }, h('span', { html: VRKOS.icons.UI[icon] }), label)));
    if (section === 'wallpaper') {
      const current = data.wallpaper || 'auto';
      main.replaceChildren(
        h('h2', {}, 'Wallpaper'),
        h('p', { class: 'muted' }, 'VRKOS’s wallpaper is a VRK theme, including image, video and animated ones. “Same as VRK” follows the theme you use in the browser.'),
        h(
          'div',
          { class: 'wall-grid' },
          [{ id: 'auto', name: 'Same as VRK' }, ...data.themes.filter((t) => !t.classic)].map((t) =>
            h(
              'button',
              { class: `wall${current === t.id ? ' on' : ''}`, style: { background: `linear-gradient(135deg, ${WALL_COLORS[t.id] || 'var(--accent), var(--accent-2)'})` }, onclick: () => call('set-os-setting', 'osWallpaper', t.id).then(load) },
              t.name,
            ),
          ),
        ),
        h('div', { class: 'set-row' }, h('div', { class: 'grow' }, 'Make your own', h('small', {}, 'Use any image or video, gradients and animated effects in VRK’s theme editor.')), h('button', { class: 'btn', onclick: () => call('browser-settings', 'appearance') }, 'Open Theme Settings')),
      );
    } else if (section === 'general') {
      main.replaceChildren(
        h('h2', {}, 'General'),
        h('div', { class: 'set-row' }, h('div', { class: 'grow' }, 'Start in VRKOS', h('small', {}, 'Open VRKOS when VRK starts, instead of the normal browser window.')), toggle('osStartup', data.startup)),
        h('div', { class: 'set-row' }, h('div', { class: 'grow' }, '24-hour clock', h('small', {}, 'In the menu bar and on the lock screen.')), toggle('osClock24', data.clock24)),
        h('div', { class: 'set-row' }, h('div', { class: 'grow' }, 'VRK Browser settings', h('small', {}, 'Privacy, security, passwords, extensions and more.')), h('button', { class: 'btn', onclick: () => call('browser-settings') }, 'Open')),
        h('div', { class: 'set-row' }, h('div', { class: 'grow' }, 'Exit VRKOS', h('small', {}, 'Back to the normal VRK window. Shortcut: ⌥⌘O.')), h('button', { class: 'btn', onclick: () => call('exit') }, 'Exit')),
      );
    } else if (section === 'privacy') {
      const state = (ok, yes, no) => h('span', { class: `perm ${ok ? 'ok' : ok === false ? 'off' : ''}` }, ok ? yes : ok === false ? no : 'Unknown');
      main.replaceChildren(
        h('h2', {}, 'Privacy & Access'),
        perms?.platform && perms.platform !== 'darwin'
          ? h('p', { class: 'muted' }, 'On this computer VRKOS can already open all your files. Screen sharing permissions are in your system settings.')
          : h('p', { class: 'muted' }, 'macOS asks before any app reads private folders or the screen. These switches live in System Settings → Privacy & Security; VRK can’t turn them on for you.'),
        (!perms?.platform || perms.platform === 'darwin') && h(
          'div',
          { class: 'set-row' },
          h('div', { class: 'grow' }, 'All your files (Full Disk Access)', h('small', {}, 'Lets Files, Terminal and every VRKOS app open anything on this Mac without asking. Turn on VRK, then quit and reopen VRK.')),
          state(perms?.fullDisk, 'On', 'Off'),
          h('button', { class: 'btn', onclick: () => call('open-system-settings', 'files') }, 'Open'),
        ),
        h(
          'div',
          { class: 'set-row' },
          h('div', { class: 'grow' }, 'App windows in VRKOS (Screen Recording)', h('small', {}, 'Lets Mac Apps show a live view of another app’s window.')),
          state(perms ? perms.screen === 'granted' : null, 'On', 'Off'),
          h('button', { class: 'btn', onclick: () => call('open-system-settings', 'screen') }, 'Open'),
        ),
        (!perms?.platform || perms.platform === 'darwin') && h(
          'div',
          { class: 'set-row' },
          h('div', { class: 'grow' }, 'Installing apps (App Management)', h('small', {}, 'Lets Windows installers and Mac apps you run from VRKOS update or install other apps. Turn this on if macOS says VRK “was prevented from modifying apps”.')),
          h('button', { class: 'btn', onclick: () => call('open-system-settings', 'apps') }, 'Open'),
        ),
        h(
          'div',
          { class: 'set-row' },
          h('div', { class: 'grow' }, 'Full screen', h('small', {}, 'While you’re in VRKOS, macOS’s Dock and menu bar stay hidden and ⌘Tab is off. Leave with the VRKOS menu → Exit VRKOS.')),
          state(perms?.fullScreen, 'On', 'Unavailable'),
        ),
        h('div', { class: 'set-row' }, h('div', { class: 'grow' }, 'Check again', h('small', {}, 'After changing a switch in System Settings.')), h('button', { class: 'btn', onclick: loadPerms }, 'Refresh')),
      );
    } else {
      main.replaceChildren(
        h('h2', {}, 'About'),
        h(
          'dl',
          { class: 'kv' },
          [
            ['VRKOS', 'Part of VRK: a desktop running on your Mac’s own hardware'],
            ['Chip', hardware?.chip],
            ['Cores', hardware && `${hardware.cores}`],
            ['Memory', hardware && bytes(hardware.memory)],
            ['System', hardware?.system],
          ].map(([k, v]) => [h('dt', {}, k), h('dd', {}, v || '—')]),
        ),
      );
    }
  }

  async function load() {
    data = await call('os-settings');
    render();
  }
  async function loadPerms() {
    perms = await call('permissions').catch(() => null);
    render();
  }
  onArgs((a) => a.section && ((section = a.section), render()));
  addEventListener('focus', () => section === 'privacy' && loadPerms());
  (async () => {
    hardware = await call('hardware').catch(() => null);
    perms = await call('permissions').catch(() => null);
    load();
  })();
})();
