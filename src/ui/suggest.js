'use strict';
// The address-bar suggestion list. It lives in its own transparent view so it
// can float above web pages; the toolbar drives it (typing, ↑/↓, Enter) and a
// click here picks a suggestion.

(() => {
  const list = document.getElementById('list');
  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ICONS = {
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    history: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    bookmark: svg('<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>'),
    url: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5S9.7 5.8 12 3.5z"/>'),
  };
  let rows = [];

  function highlight(index) {
    rows.forEach((row, i) => row.classList.toggle('on', i === index));
  }

  function render({ items, tor }) {
    document.body.classList.toggle('tor', Boolean(tor));
    rows = items.map((item, index) => {
      const row = document.createElement('div');
      row.className = `row ${item.kind}`;
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.innerHTML = ICONS[item.kind] || ICONS.url;
      const text = document.createElement('span');
      text.className = 'text';
      const title = document.createElement('b');
      title.textContent = item.title;
      const detail = document.createElement('small');
      detail.textContent = item.kind === 'history' || item.kind === 'bookmark' ? `${item.url.replace(/^https?:\/\/(www\.)?/, '')} · ${item.detail}` : item.detail;
      text.append(title, detail);
      row.append(icon, text);
      row.addEventListener('mousemove', () => highlight(index));
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        vrk.suggestPick(index);
      });
      return row;
    });
    list.replaceChildren(...rows);
    highlight(0);
  }

  vrk.onEvent((name, payload) => {
    if (name === 'suggestions') render(payload);
    if (name === 'suggest-highlight') highlight(payload);
    if (name === 'theme') VRKTheme.apply(payload.theme, { classic: payload.classic });
  });
})();
