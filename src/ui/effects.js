'use strict';
// Theme backgrounds: a base layer (solid, gradient, image, video, or an
// animated keyframe gradient) plus an optional live effect drawn on a canvas.
// Used by the new tab page, the window behind a glass toolbar, and the theme
// editor's previews. Effects pause whenever they aren't visible and draw a
// single still frame when macOS "Reduce motion" is on.

(() => {
  // Registered properties let CSS animate between gradients smoothly.
  for (const [name, syntax, initialValue] of [
    ['--kf-angle', '<angle>', '135deg'],
    ['--kf-c1', '<color>', 'black'],
    ['--kf-c2', '<color>', 'black'],
    ['--kf-c3', '<color>', 'black'],
  ]) {
    try {
      CSS.registerProperty({ name, syntax, inherits: false, initialValue });
    } catch {}
  }
  const keyframeSheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, keyframeSheet];
  let keyframeCount = 0;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  function rgba(hex, alpha) {
    const n = parseInt(hex.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function keyframes(el, { frames, duration, easing }) {
    const name = `vrk-kf-${(keyframeCount += 1)}`;
    const steps = frames.length > 1 ? frames : [frames[0], frames[0]];
    const body = steps
      .map((f, i) => `${Math.round((i / (steps.length - 1)) * 100)}% { --kf-angle: ${f.angle}deg; --kf-c1: ${f.colors[0]}; --kf-c2: ${f.colors[1]}; --kf-c3: ${f.colors[2]}; }`)
      .join(' ');
    keyframeSheet.insertRule(`@keyframes ${name} { ${body} }`, keyframeSheet.cssRules.length);
    el.style.background = 'linear-gradient(var(--kf-angle), var(--kf-c1), var(--kf-c2), var(--kf-c3))';
    el.style.animation = `${name} ${duration}s ${easing} infinite alternate`;
  }

  // ── Effects: each returns { draw(dt, t), resize?() } ────────────────────

  const EFFECTS = {
    aurora(ctx, size, cfg) {
      const blobs = Array.from({ length: Math.round(3 + cfg.density * 2) }, (_, i) => ({
        color: cfg.colors[i % cfg.colors.length],
        phase: rand(0, Math.PI * 2),
        sx: rand(0.05, 0.16),
        sy: rand(0.04, 0.12),
        r: rand(0.35, 0.6),
      }));
      return {
        draw(_dt, t) {
          const { w, h } = size();
          ctx.clearRect(0, 0, w, h);
          ctx.globalCompositeOperation = 'screen';
          for (const b of blobs) {
            const x = w * (0.5 + 0.38 * Math.sin(t * b.sx * 6 + b.phase));
            const y = h * (0.35 + 0.3 * Math.cos(t * b.sy * 6 + b.phase * 1.3));
            const r = Math.max(w, h) * b.r;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, rgba(b.color, 0.42));
            g.addColorStop(0.5, rgba(b.color, 0.12));
            g.addColorStop(1, rgba(b.color, 0));
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
          }
          ctx.globalCompositeOperation = 'source-over';
        },
      };
    },

    particles(ctx, size, cfg) {
      let points = [];
      const reset = () => {
        const { w, h } = size();
        const count = Math.round(Math.min(220, ((w * h) / 14000) * cfg.density));
        points = Array.from({ length: count }, () => ({ x: rand(0, w), y: rand(0, h), vx: rand(-20, 20), vy: rand(-20, 20), c: pick(cfg.colors) }));
      };
      return {
        resize: reset,
        draw(dt) {
          const { w, h } = size();
          ctx.clearRect(0, 0, w, h);
          for (const p of points) {
            p.x = (p.x + p.vx * dt + w) % w;
            p.y = (p.y + p.vy * dt + h) % h;
          }
          ctx.lineWidth = 1;
          for (let i = 0; i < points.length; i += 1) {
            const a = points[i];
            for (let j = i + 1; j < points.length; j += 1) {
              const b = points[j];
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              if (d < 130) {
                ctx.strokeStyle = rgba(a.c, (1 - d / 130) * 0.35);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
              }
            }
            ctx.fillStyle = rgba(a.c, 0.85);
            ctx.beginPath();
            ctx.arc(a.x, a.y, 1.8, 0, Math.PI * 2);
            ctx.fill();
          }
        },
      };
    },

    starfield(ctx, size, cfg) {
      const star = () => ({ x: rand(-1, 1), y: rand(-1, 1), z: rand(0.05, 1), c: pick(cfg.colors) });
      const stars = Array.from({ length: Math.round(380 * cfg.density) }, star);
      return {
        draw(dt) {
          const { w, h } = size();
          ctx.clearRect(0, 0, w, h);
          const cx = w / 2;
          const cy = h / 2;
          for (const s of stars) {
            const px = cx + (s.x / s.z) * cx;
            const py = cy + (s.y / s.z) * cy;
            s.z -= dt * 0.25;
            if (s.z <= 0.02) Object.assign(s, star(), { z: 1 });
            const nx = cx + (s.x / s.z) * cx;
            const ny = cy + (s.y / s.z) * cy;
            if (nx < 0 || nx > w || ny < 0 || ny > h) {
              Object.assign(s, star(), { z: 1 });
              continue;
            }
            const alpha = Math.min(1, (1 - s.z) * 1.4);
            ctx.strokeStyle = rgba(s.c, alpha);
            ctx.lineWidth = Math.max(0.6, (1 - s.z) * 2.4);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(nx, ny);
            ctx.stroke();
          }
        },
      };
    },

    waves(ctx, size, cfg) {
      const layers = Array.from({ length: 4 }, (_, i) => ({ amp: rand(18, 42), k: rand(0.004, 0.009), speed: rand(0.4, 0.9) * (i % 2 ? 1 : -1), c: cfg.colors[i % cfg.colors.length], offset: i }));
      return {
        draw(_dt, t) {
          const { w, h } = size();
          ctx.clearRect(0, 0, w, h);
          layers.forEach((l, i) => {
            const base = h * (0.55 + i * 0.09 / cfg.density);
            const g = ctx.createLinearGradient(0, base - l.amp, 0, h);
            g.addColorStop(0, rgba(l.c, 0.32 - i * 0.04));
            g.addColorStop(1, rgba(l.c, 0.02));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, base + Math.sin(x * l.k + t * l.speed * 2 + l.offset) * l.amp + Math.sin(x * l.k * 2.3 + t * l.speed) * l.amp * 0.3);
            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fill();
          });
        },
      };
    },

    matrix(ctx, size, cfg, theme) {
      const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789ABCDEFZ:・=*+-<>';
      const step = 16;
      let drops = [];
      return {
        resize() {
          const { w, h } = size();
          drops = Array.from({ length: Math.ceil(w / step) }, () => rand(-h, 0));
          ctx.fillStyle = theme.colors.bg;
          ctx.fillRect(0, 0, w, h);
        },
        draw(dt) {
          const { w, h } = size();
          ctx.fillStyle = rgba(theme.colors.bg, Math.min(1, 6 * dt));
          ctx.fillRect(0, 0, w, h);
          ctx.font = `${step - 2}px ui-monospace, Menlo, monospace`;
          drops.forEach((y, i) => {
            ctx.fillStyle = Math.random() > 0.96 ? '#ffffff' : rgba(cfg.colors[i % cfg.colors.length], 0.9);
            ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], i * step, y);
            drops[i] = y > h + rand(0, 400 / cfg.density) ? 0 : y + step * dt * 18;
          });
        },
      };
    },

    bubbles(ctx, size, cfg) {
      const make = (y) => {
        const { w, h } = size();
        return { x: rand(0, w), y: y ?? h + 40, r: rand(4, 26), vy: rand(20, 60), wobble: rand(0, 6), c: pick(cfg.colors) };
      };
      let list = [];
      return {
        resize() {
          const { h } = size();
          list = Array.from({ length: Math.round(40 * cfg.density) }, () => make(rand(0, h)));
        },
        draw(dt, t) {
          const { w, h } = size();
          ctx.clearRect(0, 0, w, h);
          for (const b of list) {
            b.y -= b.vy * dt;
            if (b.y < -40) Object.assign(b, make());
            const x = b.x + Math.sin(t * 1.5 + b.wobble) * 10;
            ctx.strokeStyle = rgba(b.c, 0.5);
            ctx.fillStyle = rgba(b.c, 0.08);
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,.5)';
            ctx.beginPath();
            ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.18, 0, Math.PI * 2);
            ctx.fill();
          }
        },
      };
    },

    snow(ctx, size, cfg) {
      const make = (y) => {
        const { w } = size();
        return { x: rand(0, w), y: y ?? -10, r: rand(1.5, 4.5), vy: rand(18, 45), sway: rand(0, 6), spin: rand(0, 6), c: pick(cfg.colors) };
      };
      let flakes = [];
      return {
        resize() {
          const { h } = size();
          flakes = Array.from({ length: Math.round(120 * cfg.density) }, () => make(rand(0, h)));
        },
        draw(dt, t) {
          const { w, h } = size();
          ctx.clearRect(0, 0, w, h);
          for (const f of flakes) {
            f.y += f.vy * dt;
            if (f.y > h + 10) Object.assign(f, make());
            const x = f.x + Math.sin(t + f.sway) * 18;
            ctx.save();
            ctx.translate(x, f.y);
            ctx.rotate(t * 0.8 + f.spin);
            ctx.fillStyle = rgba(f.c, 0.85);
            ctx.beginPath();
            ctx.ellipse(0, 0, f.r * 1.4, f.r, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        },
      };
    },

    fireflies(ctx, size, cfg) {
      let flies = [];
      return {
        resize() {
          const { w, h } = size();
          flies = Array.from({ length: Math.round(45 * cfg.density) }, () => ({ x: rand(0, w), y: rand(h * 0.2, h), a: rand(0, 6), s: rand(10, 30), blink: rand(0, 6), c: pick(cfg.colors) }));
        },
        draw(dt, t) {
          const { w, h } = size();
          ctx.clearRect(0, 0, w, h);
          for (const f of flies) {
            f.a += (Math.sin(t * 0.7 + f.blink) * 0.8) * dt;
            f.x = (f.x + Math.cos(f.a) * f.s * dt + w) % w;
            f.y = Math.min(h, Math.max(0, f.y + Math.sin(f.a) * f.s * dt));
            const glow = 0.25 + 0.75 * Math.max(0, Math.sin(t * 2 + f.blink));
            const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 14);
            g.addColorStop(0, rgba(f.c, glow));
            g.addColorStop(1, rgba(f.c, 0));
            ctx.fillStyle = g;
            ctx.fillRect(f.x - 14, f.y - 14, 28, 28);
          }
        },
      };
    },

    grid(ctx, size, cfg) {
      let offset = 0;
      return {
        draw(dt) {
          const { w, h } = size();
          ctx.clearRect(0, 0, w, h);
          const horizon = h * 0.56;
          const [c1, c2 = c1] = cfg.colors;
          // Striped sun.
          const r = Math.min(w, h) * 0.2;
          const sun = ctx.createLinearGradient(0, horizon - r * 1.6, 0, horizon);
          sun.addColorStop(0, rgba(c2, 0.95));
          sun.addColorStop(1, rgba(c1, 0.95));
          ctx.save();
          ctx.beginPath();
          ctx.arc(w / 2, horizon - r * 0.35, r, Math.PI, 0);
          ctx.clip();
          ctx.fillStyle = sun;
          ctx.fillRect(w / 2 - r, horizon - r * 1.4, r * 2, r * 1.4);
          ctx.globalCompositeOperation = 'destination-out';
          for (let i = 0; i < 6; i += 1) ctx.fillRect(w / 2 - r, horizon - r * 0.35 - i * r * 0.14 - 2, r * 2, 2 + i * 0.9);
          ctx.restore();
          // Perspective floor.
          const floor = ctx.createLinearGradient(0, horizon, 0, h);
          floor.addColorStop(0, rgba(c1, 0.0));
          floor.addColorStop(1, rgba(c1, 0.18));
          ctx.fillStyle = floor;
          ctx.fillRect(0, horizon, w, h - horizon);
          ctx.strokeStyle = rgba(c1, 0.75);
          ctx.lineWidth = 1.2;
          const lines = Math.round(14 * cfg.density);
          for (let i = -lines; i <= lines; i += 1) {
            ctx.beginPath();
            ctx.moveTo(w / 2 + i * 6, horizon);
            ctx.lineTo(w / 2 + i * (w / lines) * 1.4, h);
            ctx.stroke();
          }
          offset = (offset + dt * 0.6) % 1;
          for (let i = 0; i < 18; i += 1) {
            const z = (i + offset) / 18;
            const y = horizon + (h - horizon) * z * z;
            ctx.globalAlpha = z;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          const glow = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 10);
          glow.addColorStop(0, rgba(c2, 0));
          glow.addColorStop(1, rgba(c2, 0.35));
          ctx.fillStyle = glow;
          ctx.fillRect(0, horizon - 40, w, 50);
        },
      };
    },

    confetti(ctx, size, cfg) {
      const make = (y) => {
        const { w } = size();
        return { x: rand(0, w), y: y ?? -20, vy: rand(40, 90), vx: rand(-20, 20), r: rand(0, 6), vr: rand(-4, 4), s: rand(5, 10), c: pick(cfg.colors) };
      };
      let bits = [];
      return {
        resize() {
          const { h } = size();
          bits = Array.from({ length: Math.round(90 * cfg.density) }, () => make(rand(0, h)));
        },
        draw(dt, t) {
          const { w, h } = size();
          ctx.clearRect(0, 0, w, h);
          for (const b of bits) {
            b.y += b.vy * dt;
            b.x += b.vx * dt;
            b.r += b.vr * dt;
            if (b.y > h + 20) Object.assign(b, make());
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(b.r);
            ctx.scale(1, Math.abs(Math.sin(t * 3 + b.r)) + 0.2);
            ctx.fillStyle = b.c;
            ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
            ctx.restore();
          }
        },
      };
    },
  };

  function startEffect(canvas, cfg, theme) {
    const ctx = canvas.getContext('2d');
    let w = 0;
    let h = 0;
    const effect = EFFECTS[cfg.kind](ctx, () => ({ w, h }), cfg, theme);
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      effect.resize?.();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    let raf = 0;
    let last = performance.now();
    let elapsed = rand(0, 50);
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Skip work while hidden (another tab, or the panel isn't showing).
      if (!w || document.hidden || !canvas.checkVisibility()) return;
      elapsed += dt * cfg.speed;
      effect.draw(dt * cfg.speed, elapsed);
      if (reduceMotion.matches) cancelAnimationFrame(raf); // one still frame
    };
    resize();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }

  // Renders `theme`'s background into `container`; returns a cleanup function.
  function mount(container, theme) {
    container.replaceChildren();
    if (!theme || theme.classic) return () => {};
    const bg = theme.background;
    const base = document.createElement('div');
    base.className = 'bg-base';
    const media = bg.media ? VRKTheme.mediaUrl(bg.media) : null;
    let video = null;
    if (bg.type === 'gradient') base.style.background = `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.stops.join(', ')})`;
    else if (bg.type === 'keyframes') keyframes(base, bg.keyframes);
    else if (bg.type === 'image' && media) {
      Object.assign(base.style, {
        backgroundColor: theme.colors.bg,
        backgroundImage: `url("${media}")`,
        backgroundSize: bg.fit === 'tile' ? 'auto' : bg.fit,
        backgroundRepeat: bg.fit === 'tile' ? 'repeat' : 'no-repeat',
        backgroundPosition: 'center',
      });
    } else if (bg.type === 'video' && media) {
      base.style.background = theme.colors.bg;
      video = Object.assign(document.createElement('video'), { muted: true, loop: true, autoplay: true, playsInline: true, src: media });
      video.className = 'bg-video';
      video.style.objectFit = bg.fit === 'contain' ? 'contain' : 'cover';
      base.append(video);
      video.play().catch(() => {});
    } else base.style.background = theme.colors.bg;
    if (bg.blur) Object.assign(base.style, { filter: `blur(${bg.blur}px)`, inset: `-${bg.blur * 2}px` });
    container.append(base);
    if ((bg.type === 'image' || bg.type === 'video') && bg.dim > 0) {
      const dim = document.createElement('div');
      dim.className = 'bg-dim';
      dim.style.background = theme.base === 'light' ? `rgba(255,255,255,${bg.dim})` : `rgba(0,0,0,${bg.dim})`;
      container.append(dim);
    }
    let stop = () => {};
    if (bg.effect.kind !== 'none' && EFFECTS[bg.effect.kind]) {
      const canvas = document.createElement('canvas');
      canvas.className = 'bg-effect';
      container.append(canvas);
      stop = startEffect(canvas, bg.effect, theme);
    }
    return () => {
      stop();
      video?.pause();
      container.replaceChildren();
    };
  }

  window.VRKBackground = { mount, effects: Object.keys(EFFECTS) };
})();
