'use strict';
// The opening animation: particles stream in, the VRK shield draws itself,
// a shockwave bursts out and the wordmark rises, then it fades into the
// browser. Click or press any key to skip. Loaded last.

(() => {
  const splash = document.getElementById('splash');
  const canvas = document.getElementById('splash-canvas');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DURATION = reduceMotion ? 700 : 2300;
  let started = false;
  let finished = false;
  let raf = 0;

  function finish() {
    if (finished) return;
    finished = true;
    splash.classList.add('out');
    setTimeout(() => {
      cancelAnimationFrame(raf);
      splash.hidden = true;
      vrk.splashDone();
    }, 450);
  }

  // Particles converge on the logo, then burst outward when it lands.
  function particles() {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = (canvas.width = innerWidth * dpr) / dpr;
    const h = (canvas.height = innerHeight * dpr) / dpr;
    ctx.scale(dpr, dpr);
    const style = getComputedStyle(document.body);
    const colors = [style.getPropertyValue('--accent').trim() || '#8b7bff', style.getPropertyValue('--accent-2').trim() || '#2ee6c4', '#ffffff'];
    const cx = w / 2;
    const cy = h / 2 - 40;
    const dots = Array.from({ length: 140 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.max(w, h) * (0.45 + Math.random() * 0.4);
      return { angle, dist, speed: 0.55 + Math.random() * 0.6, size: 1 + Math.random() * 2.2, color: colors[Math.floor(Math.random() * colors.length)] };
    });
    const start = performance.now();
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        let r;
        let alpha;
        if (t < 0.9) {
          const p = Math.min(1, (t / 0.9) * d.speed * 1.3);
          r = d.dist * (1 - p * p * (3 - 2 * p));
          alpha = 0.25 + p * 0.75;
        } else {
          const p = Math.min(1, (t - 0.9) / 1.1);
          r = 30 + p * d.dist * 0.6 * d.speed;
          alpha = Math.max(0, 1 - p * 1.2);
        }
        if (alpha <= 0) continue;
        const x = cx + Math.cos(d.angle + t * 0.6) * r;
        const y = cy + Math.sin(d.angle + t * 0.6) * r;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = d.color;
        ctx.shadowColor = d.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, d.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (t > 2.4) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);
  }

  function play() {
    started = true;
    splash.classList.add('play');
    if (!reduceMotion) particles();
    setTimeout(finish, DURATION);
    splash.addEventListener('click', finish);
    addEventListener('keydown', finish, { once: true });
  }

  // app.js calls start() with the first state: whether the main process wants the animation.
  // replay() shows it again on demand (Settings → Appearance → Preview).
  window.VRKSplash = {
    start(show) {
      if (started || finished) return;
      if (show) return play();
      finished = true;
      splash.hidden = true;
    },
    replay() {
      cancelAnimationFrame(raf);
      splash.classList.remove('play', 'out');
      splash.hidden = false;
      void splash.offsetWidth; // restart the CSS animations
      started = false;
      finished = false;
      play();
    },
  };
  // The first state arrived before this script ran: start (or skip) now.
  if (window.vrkSplashWanted !== undefined) window.VRKSplash.start(window.vrkSplashWanted);
})();
