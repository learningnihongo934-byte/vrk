'use strict';
// Terminal: your login shell (zsh) in a window, via xterm.js.

(() => {
  const { h, call } = VRKOS;
  const { root, tools, setTitle, args } = VRKOS.app;
  const css = (name, fallback) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;

  const host = h('div', { class: 'term' });
  root.append(host);
  const term = new Terminal({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.15,
    cursorBlink: true,
    allowProposedApi: false,
    macOptionIsMeta: true,
    scrollback: 10000,
    theme: {
      background: '#0d0e13',
      foreground: css('--text', '#e9eaf0'),
      cursor: css('--accent', '#8b7bff'),
      selectionBackground: 'rgba(139, 123, 255, 0.35)',
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();

  let id = null;
  const size = h('span', { class: 'muted', style: { 'font-size': '11.5px' } });
  tools.append(size, h('button', { class: 'btn small', title: 'New window (⌘N)', onclick: () => call('open-app', 'terminal') }, 'New'));

  async function start() {
    id = await call('pty-create', { cols: term.cols, rows: term.rows, cwd: args.cwd });
    document.body.dataset.pty = id;
  }
  term.onData((data) => id && vrkos.ptyWrite(id, data));
  term.onTitleChange((title) => setTitle(title || 'Terminal'));
  vrkos.on('pty-data', ({ id: from, data }) => from === id && term.write(data));
  vrkos.on('pty-exit', ({ id: from }) => {
    if (from !== id) return;
    id = null;
    term.write('\r\n\x1b[2m[Process finished]\x1b[0m\r\n');
    root.append(h('button', { class: 'btn primary term-ended', onclick: (e) => (e.target.remove(), term.reset(), start()) }, 'New Session'));
  });
  new ResizeObserver(() => {
    fit.fit();
    size.textContent = `${term.cols}×${term.rows}`;
    if (id) vrkos.call('pty-resize', id, term.cols, term.rows).catch(() => {});
  }).observe(host);
  addEventListener('keydown', (e) => e.metaKey && e.key === 'n' && call('open-app', 'terminal'));
  addEventListener('focus', () => term.focus());
  term.focus();
  start();
})();
