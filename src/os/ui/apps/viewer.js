'use strict';
// Viewer: photos, videos and music. ← / → go through the folder.

(() => {
  const { h, call } = VRKOS;
  const { root, tools, setTitle, args, onArgs } = VRKOS.app;

  let siblings = [];
  let index = 0;
  let actual = false;
  const stage = h('div', { class: 'viewer' });
  root.append(stage);
  tools.append(
    h('button', { class: 'btn small', onclick: () => step(-1) }, '‹'),
    h('button', { class: 'btn small', onclick: () => step(1) }, '›'),
    h('button', { class: 'btn small', onclick: () => ((actual = !actual), show()) }, 'Actual Size'),
    h('button', { class: 'btn small', onclick: () => siblings[index] && call('open-file', siblings[index].path) }, 'Open in Mac App'),
  );

  function show() {
    const entry = siblings[index];
    if (!entry) return stage.replaceChildren(h('div', { class: 'empty' }, 'Nothing to show.'));
    setTitle(`${entry.name}${siblings.length > 1 ? `  (${index + 1} of ${siblings.length})` : ''}`);
    const src = vrkos.fileUrl(entry.path);
    if (entry.kind === 'image') stage.replaceChildren(h('img', { src, alt: entry.name, class: actual ? 'actual' : '' }));
    else if (entry.kind === 'video') stage.replaceChildren(h('video', { src, controls: true, autoplay: true }));
    else if (entry.kind === 'audio') stage.replaceChildren(h('audio', { src, controls: true, autoplay: true }));
    else stage.replaceChildren(h('div', { class: 'empty' }, 'VRKOS can’t show this file. Use “Open in Mac App”.'));
  }
  function step(n) {
    if (!siblings.length) return;
    index = (index + n + siblings.length) % siblings.length;
    show();
  }

  async function open(path) {
    const folder = path.slice(0, path.lastIndexOf('/')) || '/';
    const listing = await call('list', folder).catch(() => null);
    siblings = (listing?.entries || []).filter((e) => ['image', 'video', 'audio'].includes(e.kind)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    index = Math.max(0, siblings.findIndex((e) => e.path === path));
    if (!siblings.length) siblings = [{ path, name: path.split('/').pop(), kind: 'image' }];
    show();
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  onArgs((a) => a.path && open(a.path));
  if (args.path) open(args.path);
  else show();
})();
