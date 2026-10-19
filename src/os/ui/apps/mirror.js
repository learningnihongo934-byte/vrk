'use strict';
// Mirror: a live view of another Mac app's window inside VRKOS (macOS's
// Screen Recording permission). It's a view: to type or click in the app,
// "Bring to Front" switches to the real window.

(() => {
  const { h, call, toast } = VRKOS;
  const { root, tools, setTitle, args } = VRKOS.app;

  const stage = h('div', { class: 'mirror' });
  root.append(stage);
  setTitle(args.name ? `${args.name} (mirror)` : 'Mirror');
  tools.append(h('button', { class: 'btn small primary', onclick: () => call('mirror-focus', args.sourceId, args.name).catch(() => {}) }, 'Bring to Front'));

  (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: args.sourceId, maxFrameRate: 30 } },
      });
      const video = h('video', { autoplay: true, muted: true });
      video.srcObject = stream;
      stage.replaceChildren(video);
      stream.getVideoTracks()[0].addEventListener('ended', () => stage.replaceChildren(h('div', { class: 'empty' }, 'That window was closed.')));
    } catch (err) {
      stage.replaceChildren(h('div', { class: 'empty' }, 'Couldn’t mirror this window. Allow VRK under System Settings → Privacy & Security → Screen Recording, then try again.'));
      toast(err.message || 'Mirroring failed', true);
    }
  })();
})();
