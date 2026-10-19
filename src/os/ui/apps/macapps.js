'use strict';
// Mac Apps: launch any app on your Mac (it opens in its own window), or show a
// live mirror of one of its windows inside VRKOS.

(() => {
  const { h, call } = VRKOS;
  const { root, tools } = VRKOS.app;

  let apps = [];
  let filter = '';
  const body = h('div', { class: 'scroll' });
  root.append(h('div', { class: 'main' }, body));
  const search = h('input', {
    class: 'field',
    placeholder: 'Search apps',
    type: 'search',
    style: { width: '200px' },
    oninput: (e) => ((filter = e.target.value.toLowerCase()), render()),
  });
  tools.append(search, h('button', { class: 'btn small', onclick: () => loadWindows() }, 'Refresh'));

  const icons = new Map();
  function appTile(app) {
    const img = h('img', { alt: '' });
    if (icons.has(app.path)) img.src = icons.get(app.path) || '';
    else vrkos.call('icon', app.path, 'large').then((url) => (icons.set(app.path, url), url && (img.src = url)));
    return h(
      'button',
      {
        class: 'app-tile',
        title: app.path,
        onclick: () => call('launch-mac', app.path),
      },
      img,
      h('span', {}, app.name),
    );
  }

  let windows = { permission: 'unknown', sources: [] };
  async function loadWindows(ask = false) {
    windows = await vrkos.call('mirror-sources', { ask }).catch(() => ({ permission: 'unknown', sources: [] }));
    render();
  }

  function render() {
    const shown = apps.filter((a) => !filter || a.name.toLowerCase().includes(filter));
    const needsPermission = windows.permission !== 'granted';
    body.replaceChildren(
      ...[
        h('h4', { class: 'section-title' }, 'Show an app’s window in VRKOS'),
        needsPermission
          ? h(
              'div',
              { class: 'notice warn' },
              'To mirror Mac app windows into VRKOS, VRK needs Screen Recording permission (macOS asks once). The mirror is a live view; click “Bring to Front” in it to use the app itself.',
              h(
                'div',
                {
                  style: { 'margin-top': '10px', display: 'flex', gap: '8px' },
                },
                h('button', { class: 'btn primary', onclick: () => loadWindows(true) }, 'Show App Windows'),
                h('button', { class: 'btn', onclick: () => call('screen-settings') }, 'Open Screen Recording Settings'),
              ),
            )
          : null,
        windows.sources.length
          ? h(
              'div',
              { class: 'win-grid' },
              windows.sources.map((s) =>
                h(
                  'button',
                  {
                    class: 'win-tile',
                    onclick: () =>
                      call('open-app', 'mirror', {
                        sourceId: s.id,
                        name: s.name,
                      }),
                  },
                  s.thumbnail ? h('img', { class: 'thumb', src: s.thumbnail, alt: '' }) : h('div', { class: 'thumb' }),
                  h('div', { class: 'who' }, s.icon && h('img', { src: s.icon, alt: '' }), s.name),
                ),
              ),
            )
          : !needsPermission && h('div', { class: 'notice' }, 'No other app windows are open. Launch an app below, then press Refresh.'),
        h('h4', { class: 'section-title' }, `Applications (${shown.length})`),
        h('div', { class: 'app-grid' }, shown.map(appTile)),
      ].filter(Boolean),
    );
  }

  (async () => {
    apps = (await call('apps')).mac;
    render();
    loadWindows();
  })();
})();
