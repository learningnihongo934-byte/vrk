'use strict';
// vrkweb.web.app: OS-aware install commands, the "ads disappear" demo window,
// a background of trackers bouncing off your cursor, and scroll reveals.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SITE = 'https://vrkweb.web.app';
const RELEASE = 'https://github.com/learningnihongo934-byte/vrk/releases/latest/download';
const OS = {
  mac: {
    prompt: '$',
    cmd: `curl -fsSL ${SITE}/install | bash`,
    hint: 'Paste into Terminal. Installs VRK in Applications and opens it. Needs a Mac with an Apple chip (M1 or newer).',
    direct: [],
  },
  win: {
    prompt: 'PS>',
    cmd: `irm ${SITE}/install-windows | iex`,
    hint: 'Paste into PowerShell. Installs VRK for you (no admin needed) and adds it to the Start menu. Or download the installer: if SmartScreen warns, click More info → Run anyway.',
    direct: [
      ['Installer (.exe)', `${RELEASE}/VRK-Setup-windows-x64.exe`, 'x64'],
      ['Portable (.zip)', `${RELEASE}/VRK-windows-x64.zip`, 'x64'],
    ],
  },
  linux: {
    prompt: '',
    cmd: 'Linux version coming soon',
    hint: 'VRK for Linux (AppImage and .deb) is on its way. macOS and Windows are ready now.',
    direct: [],
    soon: true,
  },
};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

// ── nav ──
const nav = $('#nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 30), { passive: true });

// ── installer: picks your OS, types the command ──
const ua = navigator.userAgent;
let os = /Windows/.test(ua) ? 'win' : /Linux|X11/.test(ua) && !/Android/.test(ua) ? 'linux' : 'mac';
let typing;
function setOS(o, animate = true) {
  os = o;
  $$('.os-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.os === o));
  const c = OS[o];
  const code = $('#cmd');
  $('#prompt').textContent = c.prompt;
  $('#os-hint').textContent = c.hint;
  $('#direct').replaceChildren(
    ...c.direct.map(([label, href, arch]) => {
      const a = document.createElement('a');
      a.href = href;
      a.innerHTML = `↓ ${label}<small>${arch}</small>`;
      return a;
    }),
  );
  $('#direct').hidden = !c.direct.length;
  clearInterval(typing);
  code.classList.remove('typed');
  if (!animate || reduced) {
    code.textContent = c.cmd;
    code.classList.add('typed');
    return;
  }
  let i = 0;
  code.textContent = '';
  typing = setInterval(() => {
    code.textContent = c.cmd.slice(0, ++i);
    if (i >= c.cmd.length) {
      clearInterval(typing);
      setTimeout(() => code.classList.add('typed'), 900);
    }
  }, 18);
}
$$('.os-tabs button').forEach((b) => (b.onclick = () => setOS(b.dataset.os)));
setTimeout(() => setOS(os), 700);

// The clipboard API, or (inside frames and older browsers) the classic way:
// select hidden text and run the copy command, which works on a click.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  area.remove();
  if (!ok) {
    // Last resort: leave the command selected so ⌘C / Ctrl+C copies it.
    const code = $('#cmd');
    const range = document.createRange();
    range.selectNodeContents(code);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }
  return ok;
}

async function copyCmd(btn) {
  if (OS[os].soon) return toast('The Linux version is coming soon.');
  if (!(await copyText(OS[os].cmd))) return toast('Couldn’t reach the clipboard. Press ⌘C / Ctrl+C now to copy.');
  const s = btn.querySelector('span') || btn;
  const t = s.textContent;
  s.textContent = 'Copied ✓';
  btn.classList.add('done');
  setTimeout(() => {
    s.textContent = t;
    btn.classList.remove('done');
  }, 1600);
  toast(`Install command copied. Paste it into ${os === 'win' ? 'PowerShell' : 'Terminal'}.`);
}
$('#copy').onclick = () => copyCmd($('#copy'));
$('#cta-install').onclick = () => copyCmd($('#cta-install'));

// ── the demo window: ads, a tracker and a cookie banner get blocked ──
const blocked = $('#blocked');
let count = 0;
function bump(n) {
  const target = count + n;
  const step = () => {
    count += 1;
    blocked.textContent = count;
    if (count < target) setTimeout(step, 40);
  };
  step();
}
function runDemo() {
  const items = [...$$('.ad'), $('#cookie')];
  items.forEach((el) => el.classList.remove('gone'));
  count = 0;
  blocked.textContent = '0';
  items.forEach((el, i) =>
    setTimeout(() => {
      el.classList.add('gone');
      bump(el.id === 'cookie' ? 1 : 3 + i * 2);
    }, 1400 + i * 900),
  );
}
const demo = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && runDemo()), { threshold: 0.5 });
demo.observe($('.window'));

// ── background: trackers drifting in, bouncing off a shield around your cursor ──
const cv = $('#field');
const ctx = cv.getContext('2d');
let W, H, DPR;
let dots = [];
const mouse = { x: -1e4, y: -1e4 };
function resize() {
  DPR = Math.min(2, devicePixelRatio || 1);
  W = cv.width = innerWidth * DPR;
  H = cv.height = innerHeight * DPR;
  const target = Math.round(Math.min(140, (innerWidth * innerHeight) / 10000));
  while (dots.length < target) dots.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, r: Math.random() * 1.6 + 0.6, hit: 0 });
  dots.length = target;
}
addEventListener('resize', resize);
resize();
addEventListener('pointermove', (e) => ((mouse.x = e.clientX * DPR), (mouse.y = e.clientY * DPR)), { passive: true });
addEventListener('pointerleave', () => (mouse.x = mouse.y = -1e4));
function frame() {
  ctx.clearRect(0, 0, W, H);
  const R = 150 * DPR;
  // The shield.
  if (mouse.x > -1e3) {
    const g = ctx.createRadialGradient(mouse.x, mouse.y, R * 0.6, mouse.x, mouse.y, R);
    g.addColorStop(0, 'rgba(212,255,58,0)');
    g.addColorStop(1, 'rgba(212,255,58,.07)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, R, 0, 7);
    ctx.fill();
  }
  for (const d of dots) {
    const dx = d.x - mouse.x;
    const dy = d.y - mouse.y;
    const dist = Math.hypot(dx, dy);
    if (dist < R) {
      d.vx += (dx / (dist + 1)) * 0.5;
      d.vy += (dy / (dist + 1)) * 0.5;
      d.hit = 1;
    }
    d.vx *= 0.98;
    d.vy *= 0.98;
    d.x += d.vx + (Math.random() - 0.5) * 0.06;
    d.y += d.vy + (Math.random() - 0.5) * 0.06;
    if (d.x < 0 || d.x > W) d.vx *= -1;
    if (d.y < 0 || d.y > H) d.vy *= -1;
    d.hit *= 0.96;
    ctx.fillStyle = d.hit > 0.05 ? `rgba(255,77,109,${0.4 + d.hit * 0.6})` : 'rgba(242,239,230,.45)';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * DPR * (1 + d.hit), 0, 7);
    ctx.fill();
  }
  // Faint links between nearby trackers (they talk to each other).
  const link = 110 * DPR;
  for (let i = 0; i < dots.length; i++)
    for (let j = i + 1; j < dots.length; j++) {
      const a = dots[i];
      const b = dots[j];
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      if (dd < link) {
        ctx.strokeStyle = `rgba(242,239,230,${(1 - dd / link) * 0.1})`;
        ctx.lineWidth = DPR * 0.7;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  if (!reduced) requestAnimationFrame(frame);
}
frame();

// ── reveals and card spotlights ──
const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { threshold: 0.12 });
$$('.reveal').forEach((el, i) => {
  el.style.setProperty('--d', `${(i % 4) * 0.06}s`);
  io.observe(el);
});
$$('[data-spot]').forEach((el) =>
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }),
);
// The marquee loops seamlessly with a second copy.
const track = $('#track');
track.innerHTML += track.innerHTML;

// The "why a command" notice: hide it once you've read it.
try {
  if (localStorage.getItem('vrk-notice-hidden') === '1') $('#notice').hidden = true;
} catch {}
$('#notice-close').onclick = () => {
  $('#notice').hidden = true;
  try {
    localStorage.setItem('vrk-notice-hidden', '1');
  } catch {}
};
