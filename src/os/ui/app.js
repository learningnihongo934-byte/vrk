'use strict';
// The frame every VRKOS app window shares: title bar with close / minimize /
// zoom, theme colors, then the app itself (apps/<name>.js).

(async () => {
  const { h, applyTheme } = VRKOS;
  const params = new URLSearchParams(location.search);
  const name = params.get('app');
  const DEPS = { terminal: { css: ['lib/xterm.css'], js: ['lib/xterm.js', 'lib/addon-fit.js'] } };

  const titleEl = document.getElementById('title');
  const setTitle = (text) => {
    titleEl.textContent = text;
    document.title = text;
    vrkos.call('window', 'title', text).catch(() => {});
  };
  document.querySelector('.light.close').addEventListener('click', () => vrkos.call('window', 'close'));
  document.querySelector('.light.min').addEventListener('click', () => vrkos.call('window', 'minimize'));
  document.querySelector('.light.max').addEventListener('click', () => vrkos.call('window', 'maximize'));
  document.querySelector('.titlebar').addEventListener('dblclick', (e) => !e.target.closest('.lights, .tools') && vrkos.call('window', 'maximize'));
  for (const [cls, glyph] of [['close', '<path d="M6 6l12 12M18 6 6 18"/>'], ['min', '<path d="M5 12h14"/>'], ['max', '<path d="M7 17 17 7M9 7h8v8"/>']]) {
    document.querySelector(`.light.${cls}`).innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">${glyph}</svg>`;
  }

  const info = await vrkos.call('info');
  applyTheme(await vrkos.call('theme'));
  vrkos.on('theme', applyTheme);
  setTitle(info.name);

  const argListeners = [];
  vrkos.on('args', (args) => argListeners.forEach((cb) => cb(args)));
  VRKOS.app = {
    name,
    info,
    args: info.args || {},
    root: document.getElementById('content'),
    tools: document.getElementById('tools'),
    setTitle,
    onArgs: (cb) => argListeners.push(cb),
    // Window snapping from the keyboard: ⌃⌥← / ⌃⌥→, ⌃⌥↩ to zoom.
  };
  // ⌥Space opens Launchpad from any app, like on the desktop.
  addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.code === 'Space' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        vrkos.call('launchpad');
      }
    },
    true,
  );
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.altKey)) return;
    if (e.key === 'ArrowLeft') vrkos.call('window', 'snap', 'left');
    if (e.key === 'ArrowRight') vrkos.call('window', 'snap', 'right');
    if (e.key === 'Enter') vrkos.call('window', 'maximize');
  });

  const load = (src) =>
    new Promise((resolve, reject) => document.head.append(h('script', { src, onload: resolve, onerror: () => reject(new Error(`Couldn’t load ${src}`)) })));
  for (const href of DEPS[name]?.css || []) document.head.append(h('link', { rel: 'stylesheet', href }));
  for (const src of DEPS[name]?.js || []) await load(src);
  await load(`apps/${name}.js`);
  document.body.dataset.ready = '1';
})();
