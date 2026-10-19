'use strict';
// System Monitor: your Mac's real CPU, memory, disk, battery, network and
// the busiest processes, updated live.

(() => {
  const { h, call, confirm, bytes } = VRKOS;
  const { root, tools } = VRKOS.app;

  let tab = 'overview';
  let hardware = null;
  const history = [];
  const tabs = h('div', { class: 'tabs' });
  const body = h('div', { class: 'scroll' });
  root.append(h('div', { class: 'main' }, body));
  tools.append(tabs);

  function renderTabs() {
    tabs.replaceChildren(
      ...[
        ['overview', 'Overview'],
        ['processes', 'Processes'],
        ['hardware', 'Hardware'],
      ].map(([id, label]) => h('button', { class: tab === id ? 'on' : '', onclick: () => ((tab = id), renderTabs(), update()) }, label)),
    );
  }

  const rate = (n) => `${bytes(n)}/s`;
  const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
  const bar = (value) => h('div', { class: 'bar' }, h('i', { style: { width: `${Math.max(0, Math.min(100, value))}%` } }));

  function spark(values) {
    const canvas = h('canvas', { class: 'spark', width: 600, height: 120 });
    const ctx = canvas.getContext('2d');
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#8b7bff';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.fillStyle = `${accent}33`;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / Math.max(1, 59)) * 600;
      const y = 118 - (v / 100) * 112;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineTo(((values.length - 1) / 59) * 600, 120);
    ctx.lineTo(0, 120);
    ctx.fill();
    return canvas;
  }

  function overview(s) {
    const mem = s.memory;
    const disk = s.disk;
    const b = s.battery;
    const up = Math.floor(s.uptime / 3600);
    body.replaceChildren(
      h(
        'div',
        { class: 'mon' },
        h(
          'div',
          { class: 'card wide' },
          h('h4', {}, `CPU · ${hardware?.chip || ''} · ${s.cpu.perCore.length} cores`),
          h('div', { class: 'big' }, `${s.cpu.total}%`),
          spark(history),
          h('div', { class: 'cores' }, s.cpu.perCore.map((v) => h('i', { title: `${v}%`, style: { height: `${Math.max(3, v)}%` } }))),
        ),
        h('div', { class: 'card' }, h('h4', {}, 'Memory'), h('div', { class: 'big' }, bytes(mem.used)), bar(pct(mem.used, mem.total)), h('small', { class: 'muted' }, `of ${bytes(mem.total)} (${pct(mem.used, mem.total)}% used)`)),
        disk && h('div', { class: 'card' }, h('h4', {}, 'Disk'), h('div', { class: 'big' }, `${bytes(disk.free)} free`), bar(pct(disk.used, disk.total)), h('small', { class: 'muted' }, `${bytes(disk.used)} of ${bytes(disk.total)} used`)),
        h('div', { class: 'card' }, h('h4', {}, 'Network'), h('div', { class: 'big' }, `↓ ${rate(s.network.rxRate)}`), h('small', { class: 'muted' }, `↑ ${rate(s.network.txRate)}`)),
        b && h('div', { class: 'card' }, h('h4', {}, 'Battery'), h('div', { class: 'big' }, `${b.percent}%`), bar(b.percent), h('small', { class: 'muted' }, b.charging ? 'Charging' : b.remaining ? `${b.remaining} remaining` : 'On battery')),
        h('div', { class: 'card' }, h('h4', {}, 'Uptime & load'), h('div', { class: 'big' }, up >= 24 ? `${Math.floor(up / 24)}d ${up % 24}h` : `${up}h ${Math.floor((s.uptime % 3600) / 60)}m`), h('small', { class: 'muted' }, `Load ${s.load.map((l) => l.toFixed(2)).join(', ')}`)),
      ),
    );
  }

  function processes(s) {
    body.replaceChildren(
      h(
        'div',
        { style: { padding: '12px 16px' } },
        h(
          'table',
          { class: 'ptable' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Process'), h('th', { class: 'r' }, '% CPU'), h('th', { class: 'r' }, 'Memory'), h('th', { class: 'r' }, 'PID'), h('th', {}))),
          h(
            'tbody',
            {},
            (s.processes || []).map((p) =>
              h(
                'tr',
                {},
                h('td', {}, p.name),
                h('td', { class: 'r' }, p.cpu.toFixed(1)),
                h('td', { class: 'r' }, bytes(p.memory)),
                h('td', { class: 'r muted' }, p.pid),
                h(
                  'td',
                  { class: 'r' },
                  p.mine &&
                    h(
                      'button',
                      {
                        class: 'btn small',
                        onclick: async () => {
                          if (await confirm(`Quit “${p.name}”?`, 'It will be asked to quit. Unsaved work in it may be lost.', 'Quit', true)) call('quit-process', p.pid).catch(() => {});
                        },
                      },
                      'Quit',
                    ),
                ),
              ),
            ),
          ),
        ),
        h('p', { class: 'muted', style: { 'font-size': '12px' } }, 'The 15 busiest processes. Only your own can be quit from here.'),
      ),
    );
  }

  function hardwareView() {
    const hw = hardware;
    body.replaceChildren(
      h(
        'div',
        { style: { padding: '20px' } },
        h(
          'dl',
          { class: 'kv' },
          [
            ['Chip', hw.chip],
            ['CPU cores', `${hw.cores}${hw.performanceCores ? ` (${hw.performanceCores} performance + ${hw.efficiencyCores} efficiency)` : ''}`],
            ['Memory', bytes(hw.memory)],
            ['Model', hw.model],
            ['System', hw.system],
            ['Computer name', hw.host],
            ['User', hw.user],
          ].map(([k, v]) => [h('dt', {}, k), h('dd', {}, v || '—')]),
        ),
        h('p', { class: 'muted' }, 'VRKOS runs directly on this hardware; nothing is emulated. Windows programs run through Wine on the same chip (via Rosetta).'),
      ),
    );
  }

  async function update() {
    const s = await vrkos.call('stats', { processes: tab === 'processes' }).catch(() => null);
    if (!s) return;
    history.push(s.cpu.total);
    if (history.length > 60) history.shift();
    if (tab === 'overview') overview(s);
    else if (tab === 'processes') processes(s);
    else hardwareView();
    document.body.dataset.cpuCores = String(s.cpu.perCore.length);
  }

  (async () => {
    hardware = await call('hardware');
    renderTabs();
    await vrkos.call('stats'); // prime the CPU counters
    await update();
    setInterval(update, 1500);
  })();
})();
