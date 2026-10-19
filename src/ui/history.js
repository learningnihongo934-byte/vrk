'use strict';
// The History page (vrk://history): search, browse by day, delete entries,
// and clear history by time range. Loaded after app.js.

(() => {
  const PAGE = 250;
  let entries = [];
  let query = '';
  let exhausted = false;
  let searchTimer = null;

  const root = document.getElementById('historypanel');
  const h = (tag, props = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') el.className = value;
      else if (key === 'style') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v); // CSSOM: allowed by the UI's CSP
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
    }
    el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
    return el;
  };
  const host = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };
  const hue = (text) => [...text].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 360, 7);
  const dayLabel = (ts) => {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  };

  async function load(reset) {
    if (reset) {
      entries = [];
      exhausted = false;
    }
    const before = entries.length ? entries[entries.length - 1].ts : undefined;
    const batch = await vrk.request('history:list', { query, before, limit: PAGE });
    entries.push(...batch);
    exhausted = batch.length < PAGE;
    render();
  }

  function render() {
    const on = state?.history?.on;
    const status = on
      ? h(
          'p',
          { class: 'section-sub' },
          state.history.persistent ? 'VRK saves your history encrypted with a key in your Mac’s Keychain. Tor tabs are never saved.' : 'History is kept for this session only.',
        )
      : h(
          'div',
          { class: 'banner' },
          h('span', {}, 'History is off, so new visits aren’t saved.'),
          h('button', { class: 'btn primary', onclick: () => vrk.request('settings:set', 'saveHistory', true).then(() => load(true)) }, 'Turn History On'),
        );

    const groups = [];
    for (const entry of entries) {
      const label = dayLabel(entry.ts);
      if (groups[groups.length - 1]?.label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(entry);
    }

    const search = h('input', {
      class: 'search-box history-search',
      placeholder: 'Search history',
      value: query,
      oninput: (e) => {
        query = e.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => load(true), 150);
      },
    });
    const range = h(
      'select',
      { class: 'history-range' },
      [
        ['hour', 'Last hour'],
        ['day', 'Last 24 hours'],
        ['week', 'Last 7 days'],
        ['month', 'Last 4 weeks'],
        ['all', 'All time'],
      ].map(([value, label]) => h('option', { value }, label)),
    );
    const clear = h(
      'button',
      {
        class: 'btn danger',
        onclick: async () => {
          clear.disabled = true;
          await vrk.request('history:clear', range.value);
          load(true);
        },
      },
      'Clear',
    );

    const list = groups.length
      ? groups.map((group) =>
          h(
            'div',
            { class: 'card history-day' },
            h('h3', {}, group.label),
            group.items.map((entry) => {
              const site = host(entry.url);
              const open = (how) => vrk.openUrl(entry.url, how);
              return h(
                'div',
                { class: 'history-row', title: entry.url, onclick: (e) => open(e.metaKey ? 'background' : 'current'), onauxclick: (e) => e.button === 1 && open('background') },
                h('span', { class: 'history-time' }, new Date(entry.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })),
                h('span', { class: 'history-icon', style: { '--h': hue(site) } }, (site[0] || '?').toUpperCase()),
                h('span', { class: 'history-title' }, entry.title || entry.url),
                h('span', { class: 'history-host' }, site),
                h(
                  'button',
                  {
                    class: 'icon-btn small history-remove',
                    title: 'Remove from history',
                    onclick: async (e) => {
                      e.stopPropagation();
                      await vrk.request('history:remove', [entry.id]);
                      entries = entries.filter((x) => x.id !== entry.id);
                      render();
                    },
                  },
                  '×',
                ),
              );
            }),
          ),
        )
      : [h('div', { class: 'empty history-empty' }, query ? 'No matches.' : on ? 'Pages you visit will appear here.' : 'No saved history.')];

    root.replaceChildren(
      h(
        'div',
        { class: 'history-page' },
        h('div', { class: 'history-head' }, h('h2', { class: 'section-title' }, 'History'), h('span', { class: 'bar-spacer' }), range, clear),
        status,
        search,
        ...list,
        !exhausted && entries.length && h('div', { class: 'store-buttons' }, h('button', { class: 'btn', onclick: () => load(false) }, 'Load More')),
      ),
    );
    if (document.activeElement?.tagName !== 'INPUT' && query) root.querySelector('.history-search').focus();
  }

  window.VRKHistory = { open: () => load(true), refresh: () => load(true) };
})();
