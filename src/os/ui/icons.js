'use strict';
// VRKOS's icons: illustrated app icons (a rounded square with depth, a glossy
// top and a drawing of what the app does) and small line icons for toolbars,
// sidebars and the menu bar.

(() => {
  const line = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

  let n = 0;
  const lin = (id, stops, x2 = 0, y2 = 1) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
  const rad = (id, stops, cx = 0.4, cy = 0.3, r = 0.9) =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;

  // A gear outline with `teeth` teeth (for Settings).
  function gear(cx, cy, outer, inner, teeth) {
    const pts = [];
    const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i += 1) {
      const a = i * step - Math.PI / 2;
      for (const [da, r] of [[-0.3, inner], [-0.18, outer], [0.18, outer], [0.3, inner]]) {
        pts.push(`${(cx + Math.cos(a + da * step * 1.6) * r).toFixed(2)},${(cy + Math.sin(a + da * step * 1.6) * r).toFixed(2)}`);
      }
    }
    return `M${pts.join('L')}Z`;
  }

  // Each drawing gets unique ids (p) so many icons can share one page.
  const ART = {
    browser: (p) => ({
      bg: rad(`${p}bg`, [[0, '#9b8cff'], [0.55, '#4b37d6'], [1, '#150f45']], 0.35, 0.25, 1),
      defs:
        lin(`${p}sh`, [[0, '#ffffff'], [1, '#d4ccff']]) +
        lin(`${p}v`, [[0, '#2ee6c4'], [1, '#8b5cff']], 1, 1) +
        lin(`${p}ring`, [[0, '#2ee6c4', 0.9], [1, '#c084fc', 0.2]], 1, 0),
      art: `<ellipse cx="64" cy="66" rx="50" ry="17" fill="none" stroke="url(#${p}ring)" stroke-width="4" transform="rotate(-22 64 66)"/>
        <path d="M64 20 98 33v29c0 23-14 40-34 47-20-7-34-24-34-47V33z" fill="url(#${p}sh)" filter="url(#${p}drop)"/>
        <path d="M64 27 91 37.5V62c0 19-11 33-27 39-16-6-27-20-27-39V37.5z" fill="#ffffff" opacity=".55"/>
        <path d="M48 49 64 82 80 49" fill="none" stroke="url(#${p}v)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="108" cy="47" r="5.5" fill="#2ee6c4"/><circle cx="108" cy="47" r="10" fill="#2ee6c4" opacity=".25"/>`,
    }),
    files: (p) => ({
      bg: lin(`${p}bg`, [[0, '#fbfcff'], [1, '#d9e2f2']]),
      defs: lin(`${p}front`, [[0, '#7cc8ff'], [1, '#2a7ff3']]) + lin(`${p}back`, [[0, '#2f6fe0'], [1, '#1d4fb8']]),
      art: `<path d="M20 40a8 8 0 0 1 8-8h22l9 8h41a8 8 0 0 1 8 8v12H20z" fill="url(#${p}back)"/>
        <rect x="30" y="40" width="68" height="46" rx="4" fill="#fff" transform="rotate(-5 64 63)" filter="url(#${p}drop)"/>
        <path d="M38 52h40M38 60h48M38 68h30" stroke="#c8d3e6" stroke-width="3" stroke-linecap="round" transform="rotate(-5 64 63)"/>
        <path d="M16 58a8 8 0 0 1 8-8h80a8 8 0 0 1 8 8v38a10 10 0 0 1-10 10H26a10 10 0 0 1-10-10z" fill="url(#${p}front)" filter="url(#${p}drop)"/>
        <path d="M20 58a6 6 0 0 1 6-6h76a6 6 0 0 1 6 6" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2.5"/>
        <rect x="52" y="74" width="24" height="5" rx="2.5" fill="#ffffff" opacity=".5"/>`,
    }),
    terminal: (p) => ({
      bg: lin(`${p}bg`, [[0, '#3a4152'], [1, '#0c0f16']]),
      defs: `<filter id="${p}glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
      art: `<rect x="18" y="22" width="92" height="84" rx="13" fill="#090c12" stroke="#ffffff" stroke-opacity=".1" stroke-width="1.5"/>
        <circle cx="31" cy="34" r="3.6" fill="#ff5f57"/><circle cx="43" cy="34" r="3.6" fill="#febc2e"/><circle cx="55" cy="34" r="3.6" fill="#28c840"/>
        <path d="M18 44h92" stroke="#ffffff" stroke-opacity=".08" stroke-width="1.5"/>
        <g filter="url(#${p}glow)"><path d="m32 58 13 9-13 9" fill="none" stroke="#3dffa5" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="52" y="73" width="22" height="6" rx="3" fill="#3dffa5"/></g>
        <rect x="32" y="88" width="46" height="4" rx="2" fill="#3dffa5" opacity=".28"/><rect x="32" y="96" width="30" height="4" rx="2" fill="#3dffa5" opacity=".18"/>`,
    }),
    notes: (p) => ({
      bg: lin(`${p}bg`, [[0, '#fffef8'], [1, '#efe8d2']]),
      defs: lin(`${p}top`, [[0, '#ffe066'], [1, '#ffb21c']]) + lin(`${p}pen`, [[0, '#ffd54a'], [1, '#f59e0b']], 1, 0),
      art: `<rect x="8" y="8" width="112" height="32" fill="url(#${p}top)" clip-path="url(#${p}clip)"/>
        <path d="M8 40h112" stroke="#000" stroke-opacity=".12" stroke-width="2"/>
        ${[30, 50, 70, 90].map((x) => `<circle cx="${x}" cy="24" r="4" fill="#fff8e1" stroke="#c98a00" stroke-opacity=".35"/>`).join('')}
        ${[56, 70, 84, 98].map((y) => `<path d="M22 ${y}h84" stroke="#d8d0b8" stroke-width="2"/>`).join('')}
        <path d="M24 52h44M24 66h56M24 80h34" stroke="#3b3b3b" stroke-width="4" stroke-linecap="round" opacity=".75"/>
        <g transform="rotate(42 92 88)" filter="url(#${p}drop)"><rect x="86" y="58" width="13" height="46" rx="2" fill="url(#${p}pen)"/>
        <rect x="86" y="52" width="13" height="8" rx="2" fill="#f472b6"/><rect x="86" y="58" width="13" height="4" fill="#d1d5db"/>
        <path d="M86 104h13l-6.5 13z" fill="#f3d3a8"/><path d="M90.3 112.5h4.4l-2.2 4.5z" fill="#374151"/></g>`,
    }),
    editor: (p) => ({
      bg: lin(`${p}bg`, [[0, '#f6f7ff'], [1, '#d6dcf7']]),
      defs: lin(`${p}badge`, [[0, '#a78bfa'], [1, '#4f46e5']], 1, 1),
      art: `<path d="M26 22a8 8 0 0 1 8-8h40l18 18v72a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8z" fill="#fff" filter="url(#${p}drop)"/>
        <path d="M74 14v14a4 4 0 0 0 4 4h14" fill="#e6e9f5"/>
        <rect x="34" y="40" width="14" height="5" rx="2.5" fill="#c678dd"/><rect x="52" y="40" width="24" height="5" rx="2.5" fill="#61afef"/>
        <rect x="40" y="51" width="20" height="5" rx="2.5" fill="#98c379"/><rect x="64" y="51" width="14" height="5" rx="2.5" fill="#e5c07b"/>
        <rect x="40" y="62" width="32" height="5" rx="2.5" fill="#61afef"/><rect x="46" y="73" width="18" height="5" rx="2.5" fill="#e06c75"/>
        <rect x="34" y="84" width="10" height="5" rx="2.5" fill="#c678dd"/>
        <circle cx="92" cy="92" r="23" fill="url(#${p}badge)" filter="url(#${p}drop)"/>
        <path d="m84 84-8 8 8 8M100 84l8 8-8 8M95 80l-6 24" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    }),
    monitor: (p) => ({
      bg: lin(`${p}bg`, [[0, '#17263d'], [1, '#070d18']]),
      defs:
        lin(`${p}area`, [[0, '#34d399', 0.55], [1, '#34d399', 0]]) +
        `<filter id="${p}glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
      art: `${[36, 56, 76, 96].map((y) => `<path d="M18 ${y}h92" stroke="#ffffff" stroke-opacity=".07" stroke-width="1.5"/>`).join('')}
        <path d="M18 88 32 80 44 85 57 60 70 69 83 44 95 53 110 34V108H18z" fill="url(#${p}area)"/>
        <path d="M18 88 32 80 44 85 57 60 70 69 83 44 95 53 110 34" fill="none" stroke="#34d399" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#${p}glow)"/>
        <circle cx="110" cy="34" r="9" fill="#34d399" opacity=".25"/><circle cx="110" cy="34" r="4.5" fill="#ecfdf5"/>
        <rect x="22" y="98" width="8" height="10" rx="2" fill="#60a5fa"/><rect x="34" y="94" width="8" height="14" rx="2" fill="#60a5fa" opacity=".8"/><rect x="46" y="100" width="8" height="8" rx="2" fill="#60a5fa" opacity=".6"/>`,
    }),
    settings: (p) => ({
      bg: lin(`${p}bg`, [[0, '#e3e6ec'], [1, '#8a93a3']]),
      defs: lin(`${p}gear`, [[0, '#fdfdfe'], [1, '#a3abb8']], 0.6, 1) + lin(`${p}hub`, [[0, '#6b7280'], [1, '#1f2937']]),
      art: `<path d="${gear(64, 64, 46, 37, 12)}" fill="url(#${p}gear)" stroke="#4b5563" stroke-opacity=".35" stroke-width="1.5" stroke-linejoin="round" filter="url(#${p}drop)"/>
        <circle cx="64" cy="64" r="27" fill="url(#${p}hub)"/>
        <circle cx="64" cy="64" r="27" fill="none" stroke="#ffffff" stroke-opacity=".25" stroke-width="2"/>
        <path d="${gear(64, 64, 20, 15, 8)}" fill="#d1d5db"/>
        <circle cx="64" cy="64" r="7" fill="#374151"/>`,
    }),
    calculator: (p) => ({
      bg: lin(`${p}bg`, [[0, '#45454d'], [1, '#141417']]),
      art: `<rect x="20" y="18" width="88" height="26" rx="7" fill="#0b0b0d"/>
        <text x="100" y="39" text-anchor="end" font-family="-apple-system, 'SF Pro Display', sans-serif" font-size="20" font-weight="300" fill="#fff">42</text>
        ${[62, 84, 106]
          .flatMap((cy, row) =>
            [31, 53, 75, 97].map((cx, col) => {
              const fill = col === 3 ? '#ff9f0a' : row === 0 ? '#a5a5ab' : '#55555c';
              return `<circle cx="${cx}" cy="${cy}" r="9.5" fill="${fill}"/><circle cx="${cx}" cy="${cy - 3}" r="6" fill="#fff" opacity=".12"/>`;
            }),
          )
          .join('')}`,
    }),
    calendar: (p) => {
      const now = new Date();
      const month = now.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const weekday = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      return {
        bg: lin(`${p}bg`, [[0, '#ffffff'], [1, '#ececf1']]),
        defs: lin(`${p}top`, [[0, '#ff6b6b'], [1, '#e5304c']]),
        art: `<rect x="8" y="8" width="112" height="34" fill="url(#${p}top)" clip-path="url(#${p}clip)"/>
          <text x="64" y="32" text-anchor="middle" font-family="-apple-system, 'SF Pro Display', sans-serif" font-size="17" font-weight="700" letter-spacing="1.5" fill="#fff">${month}</text>
          <text x="64" y="94" text-anchor="middle" font-family="-apple-system, 'SF Pro Display', sans-serif" font-size="52" font-weight="500" fill="#1f2937">${now.getDate()}</text>
          <text x="64" y="111" text-anchor="middle" font-family="-apple-system, 'SF Pro Text', sans-serif" font-size="10" font-weight="600" letter-spacing="1.5" fill="#9ca3af">${weekday}</text>`,
      };
    },
    viewer: (p) => ({
      bg: lin(`${p}bg`, [[0, '#ffffff'], [1, '#e7e9f1']]),
      defs: lin(`${p}sky`, [[0, '#7dd3fc'], [1, '#c4b5fd']]) + `<clipPath id="${p}photo"><rect x="30" y="38" width="66" height="50" rx="5"/></clipPath>`,
      art: `<rect x="34" y="26" width="74" height="70" rx="7" fill="#fff" transform="rotate(10 71 61)" filter="url(#${p}drop)"/>
        <rect x="22" y="30" width="82" height="76" rx="7" fill="#fff" filter="url(#${p}drop)"/>
        <g clip-path="url(#${p}photo)"><rect x="30" y="38" width="66" height="50" fill="url(#${p}sky)"/>
        <circle cx="80" cy="52" r="7" fill="#fde047"/>
        <path d="M30 80 48 60l12 12 10-9 26 25H30z" fill="#10b981"/><path d="M30 88 52 70l16 18z" fill="#047857"/></g>
        <rect x="30" y="94" width="34" height="4" rx="2" fill="#d1d5db"/>`,
    }),
    windows: (p) => ({
      bg: lin(`${p}bg`, [[0, '#38bdf8'], [1, '#1e3a8a']], 1, 1),
      defs: lin(`${p}glass`, [[0, '#f0abfc'], [1, '#7e22ce']]) + lin(`${p}wine`, [[0, '#e11d48'], [1, '#881337']]),
      art: `<rect x="18" y="24" width="78" height="62" rx="9" fill="#fff" filter="url(#${p}drop)"/>
        <path d="M18 33a9 9 0 0 1 9-9h60a9 9 0 0 1 9 9v5H18z" fill="#dbeafe"/>
        <circle cx="27" cy="31" r="2.5" fill="#60a5fa"/><circle cx="35" cy="31" r="2.5" fill="#93c5fd"/>
        <rect x="27" y="45" width="27" height="15" rx="2.5" fill="#3b82f6"/><rect x="58" y="45" width="29" height="15" rx="2.5" fill="#22d3ee"/>
        <rect x="27" y="64" width="27" height="15" rx="2.5" fill="#22d3ee"/><rect x="58" y="64" width="29" height="15" rx="2.5" fill="#3b82f6"/>
        <g filter="url(#${p}drop)"><path d="M84 62h30c0 15-6 25-15 25s-15-10-15-25z" fill="url(#${p}glass)" opacity=".92"/>
        <path d="M86.5 72h25c-1.5 8-6 13-12.5 13s-11-5-12.5-13z" fill="url(#${p}wine)"/>
        <rect x="97.5" y="86" width="3" height="16" fill="#e9d5ff"/><ellipse cx="99" cy="104" rx="11" ry="3.5" fill="#e9d5ff"/>
        <path d="M89 65c1 6 3 9 5 11" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" stroke-linecap="round" fill="none"/></g>`,
    }),
    macapps: (p) => {
      const colors = [['#a78bfa', '#6d28d9'], ['#7dd3fc', '#0284c7'], ['#86efac', '#16a34a'], ['#fcd34d', '#d97706'], ['#f9a8d4', '#db2777'], ['#5eead4', '#0d9488'], ['#fca5a5', '#dc2626'], ['#a5b4fc', '#4338ca'], ['#bef264', '#65a30d']];
      return {
        bg: lin(`${p}bg`, [[0, '#f8fafc'], [1, '#d2dbe8']]),
        defs: colors.map(([a, b], i) => lin(`${p}t${i}`, [[0, a], [1, b]], 1, 1)).join(''),
        art: colors
          .map((_, i) => `<rect x="${22 + (i % 3) * 30}" y="${22 + Math.floor(i / 3) * 30}" width="24" height="24" rx="7" fill="url(#${p}t${i})" filter="url(#${p}drop)"/>`)
          .join(''),
      };
    },
    mirror: (p) => ({
      bg: lin(`${p}bg`, [[0, '#22d3ee'], [1, '#4f46e5']], 1, 1),
      art: `<rect x="20" y="24" width="62" height="46" rx="7" fill="#fff" opacity=".35"/>
        <rect x="42" y="50" width="66" height="50" rx="7" fill="#fff" filter="url(#${p}drop)"/>
        <path d="M42 57a7 7 0 0 1 7-7h52a7 7 0 0 1 7 7v4H42z" fill="#e0e7ff"/>
        <rect x="50" y="68" width="30" height="22" rx="3" fill="#818cf8"/><rect x="84" y="68" width="16" height="9" rx="2" fill="#c7d2fe"/><rect x="84" y="81" width="16" height="9" rx="2" fill="#c7d2fe"/>
        <path d="M22 86a14 14 0 0 1 14 14M22 76a24 24 0 0 1 24 24" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="23" cy="99" r="3.5" fill="#fff"/>`,
    }),
    launchpad: (p) => {
      const colors = ['#f472b6', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#c084fc', '#f87171', '#2dd4bf'];
      return {
        bg: rad(`${p}bg`, [[0, '#4338ca'], [0.6, '#1e1b4b'], [1, '#0b0a1f']], 0.5, 0.45, 0.8),
        art: colors.map((c, i) => `<rect x="${26 + (i % 3) * 28}" y="${26 + Math.floor(i / 3) * 28}" width="20" height="20" rx="6" fill="${c}"/><rect x="${26 + (i % 3) * 28}" y="${26 + Math.floor(i / 3) * 28}" width="20" height="9" rx="5" fill="#fff" opacity=".25"/>`).join(''),
      };
    },
  };

  // The trash is a glass bin, not a tile.
  function trashIcon(p) {
    return `<svg viewBox="0 0 128 128" class="app-icon-svg"><defs>${lin(`${p}body`, [[0, '#f4f7fb', 0.95], [1, '#9aa4b4', 0.9]], 1, 0.4)}${lin(`${p}lid`, [[0, '#f3f4f6'], [1, '#9ca3af']])}<filter id="${p}drop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".35"/></filter></defs>
      <g filter="url(#${p}drop)"><path d="M33 34h62l-6.5 76a7 7 0 0 1-7 6.5H46.5a7 7 0 0 1-7-6.5z" fill="url(#${p}body)" stroke="#ffffff" stroke-opacity=".7" stroke-width="1.5"/>
      ${[48, 58, 69, 79].map((x) => `<path d="M${x} 44 ${x + (x - 64) * 0.08} 106" stroke="#64748b" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>`).join('')}
      <rect x="27" y="23" width="74" height="12" rx="6" fill="url(#${p}lid)" stroke="#ffffff" stroke-opacity=".6"/>
      <rect x="54" y="16" width="20" height="9" rx="4" fill="none" stroke="#9ca3af" stroke-width="3"/></g></svg>`;
  }

  // A full-color app icon (dock, Launchpad, About).
  function appIcon(app) {
    const p = `vi${(n += 1)}_`;
    if (app === 'trash') return trashIcon(p);
    const draw = (ART[app] || ART.settings)(p);
    return `<svg viewBox="0 0 128 128" class="app-icon-svg"><defs>${draw.bg}${draw.defs || ''}
      ${lin(`${p}gloss`, [[0, '#ffffff', 0.38], [0.5, '#ffffff', 0.04], [1, '#ffffff', 0]])}
      <clipPath id="${p}clip"><rect x="8" y="8" width="112" height="112" rx="26"/></clipPath>
      <filter id="${p}drop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-opacity=".3"/></filter></defs>
      <rect x="8" y="8" width="112" height="112" rx="26" fill="url(#${p}bg)"/>
      <g clip-path="url(#${p}clip)">${draw.art}</g>
      <rect x="8" y="8" width="112" height="60" rx="26" fill="url(#${p}gloss)" clip-path="url(#${p}clip)" pointer-events="none"/>
      <rect x="8.75" y="8.75" width="110.5" height="110.5" rx="25.3" fill="none" stroke="#ffffff" stroke-opacity=".28" stroke-width="1.5"/>
      <rect x="8" y="8" width="112" height="112" rx="26" fill="none" stroke="#000000" stroke-opacity=".18" stroke-width="1"/></svg>`;
  }

  // The menu bar battery: fills to the charge, green while charging.
  function battery(percent, charging) {
    const level = Math.max(0, Math.min(100, Number(percent) || 0));
    const width = Math.max(1.5, (level / 100) * 17);
    const color = charging ? '#34c759' : level <= 20 ? '#ff453a' : 'currentColor';
    return `<svg viewBox="0 0 28 14" class="battery-icon"><rect x=".75" y=".75" width="23" height="12.5" rx="3.6" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1.3"/>
      <rect x="25" y="4.5" width="2" height="5" rx="1" fill="currentColor" fill-opacity=".5"/>
      <rect x="3" y="3" width="${width.toFixed(1)}" height="8" rx="1.8" fill="${color}"/>
      ${charging ? '<path d="M13.4 1.6 8.6 7.6h3.3l-1.3 4.8 4.9-6.2h-3.4z" fill="#fff" stroke="#000" stroke-opacity=".35" stroke-width=".6"/>' : ''}</svg>`;
  }

  const UI = {
    home: line('<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>'),
    desktop: line('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>'),
    documents: line('<path d="M6 3.5h9l3.5 3.5v13.5h-12.5z"/><path d="M9 11h6M9 14.5h6"/>'),
    downloads: line('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
    pictures: line('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8 8.5"/>'),
    music: line('<path d="M9 17.5V5.5l11-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/>'),
    movies: line('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M17 9.5h4M3 14.5h4M17 14.5h4"/>'),
    apps: line('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>'),
    cloud: line('<path d="M7 18.5h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 18.5z"/>'),
    drive: line('<rect x="3" y="7" width="18" height="10" rx="2.5"/><path d="M16.5 12h.01"/>'),
    computer: line('<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M8 20h8M12 16v4"/>'),
    back: line('<path d="m15 5-7 7 7 7"/>'),
    forward: line('<path d="m9 5 7 7-7 7"/>'),
    up: line('<path d="m6 15 6-6 6 6"/>'),
    plus: line('<path d="M12 5v14M5 12h14"/>'),
    search: line('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>'),
    grid: line('<rect x="4" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4"/>'),
    list: line('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
    trash: line('<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 13h9l1-13"/>'),
    folder: line('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
    file: line('<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>'),
    wifi: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 19.6a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8z"/><path d="M7.4 13.7a6.6 6.6 0 0 1 9.2 0l-1.5 1.6a4.4 4.4 0 0 0-6.2 0z"/><path d="M4.3 10.6a11 11 0 0 1 15.4 0l-1.5 1.6a8.8 8.8 0 0 0-12.4 0z"/><path d="M1.2 7.5a15.4 15.4 0 0 1 21.6 0l-1.5 1.5a13.2 13.2 0 0 0-18.6 0z"/></svg>',
    offline: line('<path d="M3 3l18 18M8.6 16a5 5 0 0 1 6.8 0M12 19.5h.01M5.5 12.5a9.5 9.5 0 0 1 4.3-2.4M2.5 9a14 14 0 0 1 4.6-2.8M14.6 10.3a9.5 9.5 0 0 1 3.9 2.2M17.4 6.4A14 14 0 0 1 21.5 9"/>'),
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
    lock: line('<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
    shield: line('<path d="M12 3 19 6v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z"/><path d="m9 11.5 2 2 4-4"/>'),
    power: line('<path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0"/>'),
    refresh: line('<path d="M20 11a8 8 0 1 0-2.3 6.1M20 4v7h-7"/>'),
    close: line('<path d="M6 6l12 12M18 6 6 18"/>'),
    eye: line('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  };

  window.VRKOS_ICONS = { appIcon, battery, UI };
})();
