'use strict';
// Text Editor: open, edit and save text and code files.

(() => {
  const { h, call, confirm, toast } = VRKOS;
  const { root, tools, setTitle, args, onArgs } = VRKOS.app;

  let file = args.path || null;
  let saved = '';
  let wrap = false;

  const gutter = h('div', { class: 'gutter' });
  const code = h('textarea', { class: 'code', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
  const status = h('div', { class: 'statusbar' });
  root.append(h('div', { class: 'main' }, h('div', { class: 'editor' }, gutter, code), status));
  tools.append(
    h('button', { class: 'btn small', title: '⌘O', onclick: openFile }, 'Open'),
    h('button', { class: 'btn small', title: 'Wrap long lines', onclick: () => ((wrap = !wrap), code.classList.toggle('wrap', wrap), lines()) }, 'Wrap'),
    h('button', { class: 'btn small primary', title: '⌘S', onclick: () => save() }, 'Save'),
  );

  const dirty = () => code.value !== saved;
  const name = () => (file ? file.split('/').pop() : 'Untitled');
  function title() {
    setTitle(`${dirty() ? '• ' : ''}${name()}`);
  }
  function lines() {
    const count = code.value.split('\n').length;
    gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
    gutter.scrollTop = code.scrollTop;
  }
  function caret() {
    const before = code.value.slice(0, code.selectionStart).split('\n');
    status.textContent = `Line ${before.length}, Column ${before[before.length - 1].length + 1} · ${code.value.length.toLocaleString()} characters${file ? ` · ${file}` : ''}`;
  }

  async function load(path) {
    if (dirty() && !(await confirm('Discard unsaved changes?', `Your changes to ${name()} haven’t been saved.`, 'Discard', true))) return;
    try {
      const text = await call('read-text', path);
      file = path;
      saved = text;
      code.value = text;
      code.scrollTop = 0;
      lines();
      caret();
      title();
    } catch {}
  }
  async function openFile() {
    const path = await call('choose-file', {});
    if (path) load(path);
  }
  async function save(as = false) {
    let target = file;
    if (!target || as) target = await call('choose-save', { name: name() === 'Untitled' ? 'Untitled.txt' : name() });
    if (!target) return;
    await call('write-text', target, code.value);
    file = target;
    saved = code.value;
    title();
    caret();
    toast(`Saved ${name()}.`);
  }

  code.addEventListener('input', () => (lines(), caret(), title()));
  code.addEventListener('scroll', () => (gutter.scrollTop = code.scrollTop));
  code.addEventListener('click', caret);
  code.addEventListener('keyup', caret);
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = code;
      code.setRangeText('  ', s, end, 'end');
      code.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') {
      // Keep the current line's indentation.
      const line = code.value.slice(0, code.selectionStart).split('\n').pop();
      const indent = /^\s*/.exec(line)[0];
      if (indent) {
        e.preventDefault();
        code.setRangeText(`\n${indent}`, code.selectionStart, code.selectionEnd, 'end');
        code.dispatchEvent(new Event('input'));
      }
    }
  });
  addEventListener('keydown', (e) => {
    if (!e.metaKey) return;
    if (e.key === 's') (e.preventDefault(), save(e.shiftKey));
    else if (e.key === 'o') (e.preventDefault(), openFile());
    else if (e.key === 'n') (e.preventDefault(), call('open-app', 'editor'));
  });
  onArgs((a) => a.path && load(a.path));

  lines();
  caret();
  title();
  if (file) load(file);
  code.focus();
})();
