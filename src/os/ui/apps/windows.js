'use strict';
// Windows Apps: run Windows programs through Wine (no copy of Windows needed).

(() => {
  const { h, call, toast } = VRKOS;
  const { root, tools } = VRKOS.app;

  let status = null;
  let programs = [];
  let busy = false;
  const body = h('div', { class: 'scroll' });
  root.append(h('div', { class: 'main' }, body));
  tools.append(h('button', { class: 'btn small primary', onclick: runFile }, 'Run a Windows Program…'));

  async function runFile() {
    if (!status?.ready) return toast('Set up the Windows environment first.', true);
    const file = await call('choose-file', { filters: [{ name: 'Windows programs', extensions: ['exe', 'msi'] }] });
    if (!file) return;
    const run = await call('wine-run', file);
    toast(`Starting ${run.name}… It opens in its own window (the first start can take a moment).`);
    setTimeout(refresh, 8000);
  }

  async function setup() {
    busy = true;
    render();
    try {
      await call('wine-setup');
      toast('Windows environment ready.');
    } catch {}
    busy = false;
    refresh();
  }

  const TOOLS = [
    ['explorer', 'Windows Explorer'],
    ['notepad', 'Notepad'],
    ['cmd', 'Command Prompt'],
    ['tasks', 'Task Manager'],
    ['registry', 'Registry Editor'],
    ['settings', 'Wine Settings'],
  ];

  function render() {
    if (!status) return body.replaceChildren(h('div', { class: 'empty' }, 'Checking Wine…'));
    if (!status.installed) {
      return body.replaceChildren(
        h('div', { class: 'notice warn' }, h('b', {}, 'Wine isn’t installed.'), h('p', {}, 'Wine runs Windows programs on your Mac without Windows. Install it with Homebrew in Terminal:'), h('code', { class: 'mono' }, 'brew install --cask wine-stable')),
      );
    }
    body.replaceChildren(
      h('div', { class: 'notice' }, status.native ? 'Windows programs run right on this PC, in their own windows.' : `${status.version}. Windows programs run through Wine on this computer’s own hardware and open in their own windows. Many programs work; games with anti-cheat, drivers and some installers don’t.`),
      !status.ready
        ? h(
            'div',
            { class: 'notice warn' },
            h('b', {}, 'One-time setup'),
            h('p', {}, 'VRK makes its own Windows environment (a C: drive with Program Files). It takes about a minute, and Wine may show a progress window.'),
            h('button', { class: 'btn primary', disabled: busy, onclick: setup }, busy ? 'Setting up…' : 'Set Up Windows Environment'),
          )
        : [
            h('h4', { class: 'section-title' }, `Installed programs (${programs.length})`),
            programs.length
              ? h('div', { class: 'app-grid' }, programs.map((p) => h('button', { class: 'app-tile', title: p.path, onclick: () => call('wine-run', p.path).then(() => toast(`Starting ${p.name}…`)) }, h('span', { html: VRKOS.icons.appIcon('windows') }), h('span', {}, p.name))))
              : h('div', { class: 'notice' }, 'No programs yet. Use “Run a Windows Program…” to start a setup .exe or .msi; once installed, programs appear here.'),
            h('h4', { class: 'section-title' }, 'Windows tools'),
            h('div', { class: 'app-grid' }, TOOLS.map(([id, label]) => h('button', { class: 'app-tile', onclick: () => call('wine-tool', id).then(() => toast(`Starting ${label}…`)) }, h('span', { html: VRKOS.icons.appIcon('windows') }), h('span', {}, label)))),
          ],
    );
  }

  async function refresh() {
    status = await call('wine-status').catch(() => ({ installed: false }));
    programs = status.ready ? await call('wine-programs').catch(() => []) : [];
    render();
  }
  refresh();
})();
