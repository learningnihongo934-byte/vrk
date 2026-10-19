'use strict';
// Calendar: a month view with simple events (kept encrypted with your notes).

(() => {
  const { h, call, ask } = VRKOS;
  const { root } = VRKOS.app;

  const today = new Date();
  let month = new Date(today.getFullYear(), today.getMonth(), 1);
  let selected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let events = [];

  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const same = (a, b) => key(a) === key(b);

  const title = h('h2', {});
  const grid = h('div', { class: 'cal-grid' });
  const side = h('div', { class: 'cal-side' });
  root.append(
    h(
      'div',
      { class: 'cal' },
      h(
        'div',
        { class: 'cal-head' },
        title,
        h('button', { class: 'btn small', onclick: () => shift(-1) }, '‹'),
        h('button', { class: 'btn small', onclick: () => ((month = new Date(today.getFullYear(), today.getMonth(), 1)), (selected = new Date(today)), render()) }, 'Today'),
        h('button', { class: 'btn small', onclick: () => shift(1) }, '›'),
      ),
      grid,
    ),
    side,
  );

  function shift(n) {
    month = new Date(month.getFullYear(), month.getMonth() + n, 1);
    render();
  }

  function render() {
    title.textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const start = new Date(month);
    start.setDate(1 - start.getDay());
    const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const dow = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));
    grid.replaceChildren(
      ...dow.map((d) => h('div', { class: 'cal-dow' }, d)),
      ...days.map((d) =>
        h(
          'div',
          {
            class: `cal-day${d.getMonth() !== month.getMonth() ? ' out' : ''}${same(d, today) ? ' today' : ''}${same(d, selected) ? ' sel' : ''}`,
            onclick: () => ((selected = d), render()),
            ondblclick: () => addEvent(d),
          },
          h('span', { class: 'num' }, d.getDate()),
          events.filter((e) => e.date === key(d)).slice(0, 3).map((e) => h('span', { class: 'cal-ev' }, e.text)),
        ),
      ),
    );
    const dayEvents = events.filter((e) => e.date === key(selected));
    side.replaceChildren(
      h('h3', {}, selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })),
      ...(dayEvents.length ? dayEvents.map((e) => h('div', { class: 'ev-row' }, h('span', {}, e.text), h('button', { class: 'icon-btn', title: 'Delete', html: VRKOS.icons.UI.close, onclick: () => remove(e) }))) : [h('p', { class: 'muted' }, 'No events.')]),
      h('button', { class: 'btn', onclick: () => addEvent(selected) }, 'Add Event…'),
      h('p', { class: 'muted', style: { 'font-size': '12px', 'margin-top': 'auto' } }, 'Double-click a day to add an event. Events stay on this Mac, encrypted.'),
    );
  }

  async function addEvent(day) {
    const text = await ask(`Event on ${day.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`, { okLabel: 'Add' });
    if (!text?.trim()) return;
    events.push(await call('events-save', { date: key(day), text: text.trim() }));
    selected = day;
    render();
  }
  async function remove(event) {
    await call('events-delete', event.id);
    events = events.filter((e) => e.id !== event.id);
    render();
  }

  (async () => {
    events = await call('events-list').catch(() => []);
    render();
  })();
})();
