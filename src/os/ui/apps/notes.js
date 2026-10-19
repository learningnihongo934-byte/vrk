'use strict';
// Notes: quick notes, saved as you type and encrypted with your Mac's Keychain.

(() => {
  const { h, call, confirm } = VRKOS;
  const { root, tools } = VRKOS.app;

  let notes = [];
  let current = null;
  let filter = '';
  let saveTimer = null;

  const searchBox = h('input', { class: 'field', placeholder: 'Search notes', type: 'search', oninput: (e) => ((filter = e.target.value.toLowerCase()), renderList()) });
  const list = h('div', { class: 'scroll' });
  const editor = h('textarea', { class: 'note-editor', placeholder: 'Start typing…', spellcheck: 'true' });
  const meta = h('div', { class: 'note-meta' });
  root.append(
    h('div', { class: 'notes-list' }, h('div', { class: 'toolbar' }, searchBox, h('button', { class: 'btn small', title: 'New note (⌘N)', onclick: newNote }, 'New')), list),
    h('div', { class: 'main', style: { position: 'relative' } }, editor, meta),
  );
  tools.append(h('button', { class: 'btn small danger', onclick: remove }, 'Delete'));

  const titleOf = (n) => (n.text.split('\n').find((l) => l.trim()) || 'New Note').trim().slice(0, 80);
  const previewOf = (n) => n.text.split('\n').filter((l) => l.trim()).slice(1).join(' ').slice(0, 90) || 'No additional text';

  function renderList() {
    const shown = notes.filter((n) => !filter || n.text.toLowerCase().includes(filter));
    list.replaceChildren(
      ...(shown.length
        ? shown.map((n) =>
            h(
              'div',
              { class: `note-item${current?.id === n.id ? ' active' : ''}`, onclick: () => open(n) },
              h('b', {}, titleOf(n)),
              h('small', {}, `${new Date(n.updated).toLocaleDateString()}  ${previewOf(n)}`),
            ),
          )
        : [h('div', { class: 'empty' }, filter ? 'No matching notes.' : 'No notes yet.')]),
    );
  }

  function open(note) {
    flush();
    current = note;
    editor.value = note?.text || '';
    meta.textContent = note ? `Edited ${new Date(note.updated).toLocaleString()}` : '';
    renderList();
    editor.focus();
  }

  async function newNote() {
    flush();
    const note = await call('notes-save', { text: '' });
    notes.unshift(note);
    open(note);
  }

  async function remove() {
    if (!current) return;
    if (!(await confirm('Delete this note?', `“${titleOf(current)}” will be deleted.`, 'Delete', true))) return;
    await call('notes-delete', current.id);
    notes = notes.filter((n) => n.id !== current.id);
    open(notes[0] || null);
  }

  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    save();
  }
  async function save() {
    if (!current) return;
    const saved = await call('notes-save', { id: current.id, text: editor.value });
    Object.assign(current, saved);
    notes.sort((a, b) => b.updated - a.updated);
    meta.textContent = `Saved ${new Date(saved.updated).toLocaleTimeString()}`;
    renderList();
  }
  editor.addEventListener('input', async () => {
    if (!current) {
      const note = await call('notes-save', { text: editor.value });
      notes.unshift(note);
      current = note;
    }
    current.text = editor.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, 500);
  });
  addEventListener('keydown', (e) => e.metaKey && e.key === 'n' && (e.preventDefault(), newNote()));
  addEventListener('beforeunload', flush);

  (async () => {
    notes = await call('notes-list');
    open(notes[0] || null);
  })();
})();
