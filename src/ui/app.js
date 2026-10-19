'use strict';
// VRK's browser UI: tab strip, toolbar, bars, bookmarks bar, extension
// buttons, and the panels shown when no web page is on screen (new tab, Tor,
// VPN kill switch, errors). The settings page lives in settings.js. Everything
// talks to the main process only through window.vrk (src/preload.js).

const $ = (selector) => document.querySelector(selector);
const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const SHIELD_PATH = '<path d="M12 3l7.5 3v5.5c0 4.7-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.8-7.5-9.5V6L12 3z"/>';
const ICONS = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  forward: svg('<path d="M9 18l6-6-6-6"/>'),
  reload: svg('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>'),
  stop: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  close: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
  shield: svg(SHIELD_PATH),
  onion: svg(
    '<path d="M12 21c-4.1 0-7-2.7-7-6.4 0-3.5 2.6-5.7 4.9-7.3 1-.7 1.6-1.8 1.6-3.3h1c0 1.5.6 2.6 1.6 3.3 2.3 1.6 4.9 3.8 4.9 7.3 0 3.7-2.9 6.4-7 6.4z"/>' +
      '<path d="M12 21c-2.1 0-3.6-2.6-3.6-6.2 0-2.9 1.5-4.9 3.6-6.6 2.1 1.7 3.6 3.7 3.6 6.6 0 3.6-1.5 6.2-3.6 6.2z"/>' +
      '<path d="M12 21c-.7 0-1.2-2.4-1.2-5.9s.5-4.8 1.2-5.9c.7 1.1 1.2 2.4 1.2 5.9S12.7 21 12 21z"/>',
  ),
  flame: svg(
    '<path d="M12 21.5c3.9 0 6.8-2.6 6.8-6.4 0-3.1-1.9-5.3-3.5-7.1-.4 1.7-1.3 2.9-2.5 3.5.3-3.3-1-6.4-3.9-8.9.2 2.9-1.2 4.9-2.7 6.7-1.2 1.4-2 3-2 5.6 0 3.9 3.3 6.6 7.8 6.6z"/>',
  ),
  dots: svg(
    '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  ),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>'),
  warning: svg('<path d="M12 3.5l9.5 16.5h-19L12 3.5z"/><path d="M12 10v4.5M12 17.3v.2"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  globe: svg(
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5S9.7 5.8 12 3.5z"/>',
  ),
  speaker: svg('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.8 7.8 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M16 10l5 5M21 10l-5 5"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.2"/>'),
  star: svg('<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>'),
  folder: svg('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  gear: svg(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  ),
  logo:
    '<svg viewBox="0 0 64 64" fill="none"><defs><linearGradient id="vrk-g" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#c9c0ff"/><stop offset=".55" stop-color="#8b7bff"/><stop offset="1" stop-color="#2ee6c4"/></linearGradient></defs>' +
    '<path d="M32 4l22 8v18c0 14-9.5 25-22 30C19.5 55 10 44 10 30V12L32 4z" stroke="url(#vrk-g)" stroke-width="3.2" stroke-linejoin="round" fill="rgba(139,123,255,.08)"/>' +
    '<path d="M21 22l11 22 11-22" stroke="url(#vrk-g)" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

for (const el of document.querySelectorAll('[data-icon]')) el.insertAdjacentHTML('afterbegin', ICONS[el.dataset.icon]);

const els = {
  tabs: $('#tabs'),
  back: $('#back'),
  forward: $('#forward'),
  reload: $('#reload'),
  address: $('#address'),
  chip: $('#site-chip'),
  zoom: $('#zoom-badge'),
  star: $('#star'),
  extActions: $('#ext-actions'),
  shields: $('#shields'),
  blocked: $('#blocked-count'),
  vpn: $('#vpn'),
  tor: $('#tor'),
  burn: $('#burn'),
  bookmarksbar: $('#bookmarksbar'),
  loadbar: $('#loadbar'),
  findbar: $('#findbar'),
  findInput: $('#find-input'),
  findCount: $('#find-count'),
  permbar: $('#permbar'),
  pwbar: $('#pwbar'),
  noticebar: $('#noticebar'),
};

let state = null;
let lastActiveId = null;
let addressEditing = false;
const tabEls = new Map();
const permissionQueue = [];
const passwordQueue = [];

const active = () => state?.tabs.find((tab) => tab.id === state.activeId) || null;
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
const displayUrl = (tab) => (!tab || (tab.isNewTab && !tab.waiting) ? '' : tab.url || '');
const letterOf = (text) => (String(text || '?').replace(/^www\./, '').trim()[0] || '?').toUpperCase();

// ── Rendering ───────────────────────────────────────────────────────────

const systemDark = matchMedia('(prefers-color-scheme: dark)');
systemDark.addEventListener('change', () => state && applyTheme());

let activeTheme = null; // { theme, classic } from the main process
let unmountAppBackground = () => {};
let appBackgroundKey = '';
const customThemeActive = () => Boolean(activeTheme && !activeTheme.theme.classic);

// VRK Classic's look comes from the basic appearance settings.
function applyTheme() {
  if (document.body.dataset.custom) return; // a custom theme (or the editor's preview) owns the look
  const { theme, accent, density } = state.ui;
  document.body.dataset.theme = theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : theme;
  document.body.dataset.accent = accent;
  document.body.dataset.density = density;
}

// Applies the theme in use; also restores it after the editor's whole-browser preview.
function applyActiveTheme() {
  if (!activeTheme) return;
  VRKTheme.apply(activeTheme.theme, { classic: activeTheme.classic });
  if (state) applyTheme();
  const custom = customThemeActive();
  const key = custom ? JSON.stringify([activeTheme.theme.background, activeTheme.theme.colors.bg, activeTheme.theme.base]) : '';
  if (key !== appBackgroundKey) {
    appBackgroundKey = key;
    unmountAppBackground();
    unmountAppBackground = custom ? VRKBackground.mount($('#app-bg'), activeTheme.theme) : () => {};
  }
}

function render() {
  const tab = active();
  applyTheme();
  const wasLocked = !$('#lockscreen').hidden;
  $('#lockscreen').hidden = !state.locked;
  if (state.locked && !wasLocked) $('#lock-unlock').focus();
  document.body.classList.toggle('fullscreen', state.fullscreen);
  document.body.dataset.platform = state.platform || 'darwin';
  document.body.classList.toggle('tor-active', Boolean(tab?.tor));
  if (tab?.id !== lastActiveId) {
    lastActiveId = tab?.id;
    addressEditing = false;
    els.address.value = displayUrl(tab); // even if the address bar has focus
    closeFind();
    refreshExtensionActions();
  }
  renderTabs();
  renderToolbar(tab);
  renderBookmarksBar(tab);
  renderPage(tab);
  applyFocus();
}

let pendingFocus = null;
function applyFocus() {
  if (!pendingFocus || !state) return;
  const { newTab } = pendingFocus;
  pendingFocus = null;
  const tab = active();
  if (newTab && tab?.isNewTab) {
    const input = tab.tor ? $('#tor-input') : $('#ntp-input');
    if (input.offsetParent) return input.focus();
  }
  els.address.focus();
  els.address.select();
}

function renderTabs() {
  const seen = new Set();
  state.tabs.forEach((tab, index) => {
    let el = tabEls.get(tab.id);
    if (!el) {
      el = createTabEl(tab.id);
      tabEls.set(tab.id, el);
    }
    seen.add(tab.id);
    if (els.tabs.children[index] !== el) els.tabs.insertBefore(el, els.tabs.children[index] || null);
    el.classList.toggle('active', tab.id === state.activeId);
    el.classList.toggle('tor', tab.tor);
    el.classList.toggle('container', Boolean(tab.container));
    if (tab.container) el.style.setProperty('--container', tab.container.color);
    else el.style.removeProperty('--container');
    const title = tabTitle(tab);
    el.title = tab.tor ? `${title} (Tor)` : tab.container ? `${title} (${tab.container.name})` : title;
    el.querySelector('.tab-title').textContent = title;
    renderTabIcon(el.querySelector('.tab-icon'), tab);
    const audio = el.querySelector('.tab-audio');
    audio.hidden = !tab.audible && !tab.muted;
    const audioKind = tab.muted ? 'muted' : 'speaker';
    if (audio.dataset.kind !== audioKind) {
      audio.dataset.kind = audioKind;
      audio.innerHTML = ICONS[audioKind];
      audio.title = tab.muted ? 'Unmute tab' : 'Mute tab';
    }
  });
  for (const [id, el] of tabEls) {
    if (!seen.has(id)) {
      el.remove();
      tabEls.delete(id);
    }
  }
}

const INTERNAL_TITLES = { settings: 'Settings', history: 'History', themes: 'Theme Editor', features: 'Features' };
function tabTitle(tab) {
  if (tab.internal) return INTERNAL_TITLES[tab.internal] || 'VRK';
  if (tab.waiting === 'tor') return 'Connecting to Tor…';
  if (tab.waiting === 'vpn') return 'Waiting for VPN…';
  if (tab.isNewTab) return tab.tor ? 'New Tor Tab' : 'New Tab';
  if (tab.crashed) return 'Tab crashed';
  if (tab.error) return tab.error.title;
  return tab.title || hostOf(tab.url) || 'Untitled';
}

function renderTabIcon(box, tab) {
  const kind = tab.internal ? 'gear' : tab.loading ? 'spin' : tab.favicon || (tab.tor ? 'onion' : tab.error || tab.crashed ? 'warning' : 'globe');
  if (box.dataset.kind === kind) return;
  box.dataset.kind = kind;
  if (kind === 'spin') {
    box.innerHTML = '<span class="spinner"></span>';
  } else if (tab.favicon && kind === tab.favicon) {
    const img = new Image();
    img.alt = '';
    img.src = tab.favicon;
    box.replaceChildren(img);
  } else {
    box.innerHTML = ICONS[kind];
  }
}

function createTabEl(id) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.setAttribute('role', 'tab');
  el.innerHTML = `<span class="tab-icon"></span><span class="tab-title"></span><button class="tab-audio" hidden></button><button class="tab-close" title="Close tab (⌘W)">${ICONS.close}</button>`;
  el.addEventListener('mousedown', (event) => {
    if (event.button === 0 && !event.target.closest('button')) vrk.activateTab(id);
  });
  el.addEventListener('auxclick', (event) => {
    if (event.button === 1) vrk.closeTab(id);
  });
  el.querySelector('.tab-close').addEventListener('click', (event) => {
    event.stopPropagation();
    vrk.closeTab(id);
  });
  el.querySelector('.tab-audio').addEventListener('click', (event) => {
    event.stopPropagation();
    vrk.toggleMute(id);
  });
  return el;
}

function renderToolbar(tab) {
  const { ui } = state;
  els.back.disabled = !tab?.canGoBack;
  els.forward.disabled = !tab?.canGoForward;
  const loading = Boolean(tab?.loading);
  if (els.reload.dataset.kind !== String(loading)) {
    els.reload.dataset.kind = String(loading);
    els.reload.innerHTML = loading ? ICONS.stop : ICONS.reload;
    els.reload.title = loading ? 'Stop (⌘.)' : 'Reload (⌘R)';
  }
  els.loadbar.dataset.phase = tab && !tab.internal ? tab.loadPhase : 'idle';

  if (!addressEditing && document.activeElement !== els.address) els.address.value = displayUrl(tab);
  els.address.placeholder = tab?.tor ? 'Search DuckDuckGo over Tor, or enter an address' : `Search with ${state.searchName} or enter an address`;
  renderEngine(tab);

  const url = displayUrl(tab);
  let chip = { kind: '', icon: 'search', text: '', title: '' };
  if (url.startsWith('https:')) chip = { kind: 'secure', icon: 'lock', text: '', title: 'Connection is encrypted' };
  if (url.startsWith('http:')) chip = { kind: 'insecure', icon: 'warning', text: 'Not secure', title: 'This connection is not encrypted' };
  if (tab?.tor) {
    const onion = hostOf(url).endsWith('.onion');
    chip = { kind: 'onion', icon: 'onion', text: onion ? 'Onion' : 'Tor', title: onion ? 'End-to-end encrypted onion service' : 'Routed through Tor' };
    if (url.startsWith('http:') && !onion) chip = { kind: 'insecure', icon: 'warning', text: 'Not secure', title: 'Not encrypted, even over Tor' };
  }
  if (tab?.container && !tab.internal) chip = { ...chip, kind: `${chip.kind} container`, text: tab.container.name, title: `${chip.title}. In your ${tab.container.name} container: its own cookies and sign-ins.` };
  if (tab?.internal) chip = { kind: 'internal', icon: 'gear', text: 'VRK', title: 'A VRK page' };
  // Never show a lock for a page that didn't load.
  if (tab?.error || tab?.crashed) chip = { kind: '', icon: 'warning', text: '', title: 'This page did not load' };
  els.chip.style.setProperty('--container', tab?.container?.color || 'transparent');
  const chipKey = `${chip.kind}|${chip.icon}|${chip.text}`;
  if (els.chip.dataset.key !== chipKey) {
    els.chip.dataset.key = chipKey;
    els.chip.className = `chip ${chip.kind}`;
    els.chip.innerHTML = ICONS[chip.icon];
    if (chip.text) els.chip.append(chip.text);
  }
  els.chip.title = chip.title;

  els.zoom.hidden = !tab || tab.zoom === 1;
  if (tab) els.zoom.textContent = `${Math.round(tab.zoom * 100)}%`;
  const canBookmark = tab && !tab.isNewTab && !tab.internal && !tab.error && /^https?:/.test(tab.url || '');
  els.star.hidden = !canBookmark;
  els.star.classList.toggle('on', Boolean(state.bookmarked));
  els.star.title = state.bookmarked ? 'Remove bookmark (⌘D)' : 'Bookmark this page (⌘D)';

  const blocked = tab?.blocked || 0;
  els.blocked.hidden = blocked === 0;
  els.blocked.textContent = blocked > 999 ? '999+' : String(blocked);
  const shieldsOff = tab && !tab.isNewTab && !tab.shieldsUp;
  els.shields.classList.toggle('off', Boolean(shieldsOff));
  els.shields.title = shieldsOff ? 'Blocking is off for this site' : `${blocked} ads & trackers blocked on this page`;

  els.vpn.hidden = !ui.showVpnButton;
  els.tor.hidden = !ui.showTorButton;
  els.burn.hidden = !ui.showBurnButton;
  els.vpn.dataset.state = state.vpn.state;
  els.vpn.title = {
    off: 'VPN is off',
    connecting: 'VPN connecting…',
    on: `VPN on: ${state.vpn.name}`,
    error: 'VPN down: kill switch is blocking traffic',
  }[state.vpn.state];
  els.tor.dataset.state = state.tor.state;
  els.extActions.hidden = Boolean(tab?.tor);
}

// ── Bookmarks bar ───────────────────────────────────────────────────────

let bookmarksKey = '';
function renderBookmarksBar(tab) {
  const mode = state.ui.bookmarksBar;
  const visible = !tab?.tor && (mode === 'always' || (mode === 'newtab' && tab?.isNewTab && !tab.waiting));
  els.bookmarksbar.hidden = !visible;
  if (!visible) return;
  const key = JSON.stringify(state.bookmarksBar);
  if (key === bookmarksKey) return;
  bookmarksKey = key;
  const items = state.bookmarksBar.map((node) => {
    const button = document.createElement('button');
    button.className = 'bm';
    button.title = node.url || node.title;
    if (node.folder) button.innerHTML = ICONS.folder;
    else if (node.icon) {
      const img = new Image();
      img.src = node.icon;
      img.alt = '';
      button.append(img);
    } else {
      const letter = document.createElement('span');
      letter.className = 'letter';
      letter.textContent = letterOf(hostOf(node.url) || node.title);
      button.append(letter);
    }
    const label = document.createElement('span');
    label.textContent = node.title;
    button.append(label);
    button.addEventListener('click', (event) => {
      if (node.folder) {
        const rect = button.getBoundingClientRect();
        vrk.bookmarkFolder(node.id, rect.left, rect.bottom + 2);
      } else vrk.openBookmark(node.id, event.metaKey ? 'background' : 'current');
    });
    button.addEventListener('auxclick', (event) => event.button === 1 && !node.folder && vrk.openBookmark(node.id, 'background'));
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      vrk.bookmarkContext(node.id, event.clientX, event.clientY);
    });
    return button;
  });
  if (!items.length) {
    const empty = document.createElement('span');
    empty.className = 'bm-empty';
    empty.textContent = 'Bookmark pages with ⌘D, or import bookmarks from another browser in Settings.';
    items.push(empty);
  }
  els.bookmarksbar.replaceChildren(...items);
}

// ── Extension buttons ───────────────────────────────────────────────────

let extensionObserved = false;
async function refreshExtensionActions() {
  if (!state?.extensionsReady) return;
  if (!extensionObserved) {
    extensionObserved = true;
    vrk.extensionActions.observe(() => refreshExtensionActions());
  }
  let info;
  try {
    info = await vrk.extensionActions.getState();
  } catch {
    return;
  }
  const tab = active();
  const tabId = tab?.contentsId ?? -1;
  const buttons = (info?.actions || []).map((action) => {
    const perTab = action.tabs?.[tabId] || {};
    const button = document.createElement('button');
    button.className = 'ext-action';
    button.title = perTab.title || action.title || '';
    const img = new Image();
    img.alt = '';
    img.src = `crx://extension-icon/${action.id}/32/2?tabId=${tabId}&partition=vrk-main${action.iconModified ? `&t=${action.iconModified}` : ''}`;
    img.onerror = () => {
      const letter = document.createElement('span');
      letter.className = 'letter';
      letter.textContent = letterOf(action.title);
      img.replaceWith(letter);
    };
    button.append(img);
    const text = perTab.text ?? action.text;
    if (text) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = text;
      const color = perTab.color || action.color;
      badge.style.background = Array.isArray(color) ? `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(color[3] ?? 255) / 255})` : color || 'var(--accent)';
      button.append(badge);
    }
    const activate = (event) => {
      event.preventDefault();
      const rect = button.getBoundingClientRect();
      vrk.extensionActions.activate({
        eventType: event.type === 'contextmenu' ? 'contextmenu' : 'click',
        extensionId: action.id,
        tabId,
        alignment: 'bottom left',
        anchorRect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
    };
    button.addEventListener('click', activate);
    button.addEventListener('contextmenu', activate);
    return button;
  });
  els.extActions.replaceChildren(...buttons);
}

// ── Page panels ─────────────────────────────────────────────────────────

const show = (id, visible) => ($(id).hidden = !visible);
let settingsVisible = false;
let historyVisible = false;
let themesVisible = false;
let featuresVisible = false;

function renderPage(tab) {
  let panel = null;
  if (tab) {
    if (tab.internal) panel = tab.internal; // settings, history or themes
    else if (tab.waiting === 'tor' || (tab.tor && tab.isNewTab)) panel = 'tor';
    else if (tab.waiting === 'vpn') panel = 'vpn';
    else if (tab.isNewTab) panel = 'ntp';
    else if (tab.error || tab.crashed) panel = 'err';
  }
  show('#ntp', panel === 'ntp');
  show('#torpanel', panel === 'tor');
  show('#vpnpanel', panel === 'vpn');
  show('#errpanel', panel === 'err');
  show('#settingspanel', panel === 'settings');
  show('#historypanel', panel === 'history');
  show('#themepanel', panel === 'themes');
  show('#featurespanel', panel === 'features');
  document.body.dataset.panel = panel || 'page';
  if (panel === 'history' && !historyVisible) window.VRKHistory?.open();
  historyVisible = panel === 'history';
  if (panel === 'themes' && !themesVisible) window.VRKThemeEditor?.open();
  if (panel !== 'themes' && themesVisible) window.VRKThemeEditor?.leave();
  themesVisible = panel === 'themes';
  if (panel === 'features' && !featuresVisible) window.VRKFeatures?.open();
  featuresVisible = panel === 'features';
  // settings.js may still be loading; it renders itself if the page is already showing.
  if (panel === 'settings' && !settingsVisible && typeof openSettingsPage === 'function') openSettingsPage();
  settingsVisible = panel === 'settings';

  if (panel === 'ntp') renderNewTab();
  if (panel === 'tor') renderTorPanel(tab);
  if (panel === 'vpn') renderVpnPanel();
  if (panel === 'err') renderErrorPanel(tab);
}

let ntpKey = '';
function renderNewTab() {
  const { ui } = state;
  $('#ntp').dataset.bg = ui.ntpBackground;
  $('#stat-blocked').textContent = state.totalBlocked.toLocaleString();
  $('#stat-engine').textContent = state.chromium.split('.')[0];
  $('#ntp-input').placeholder = `Search ${state.searchName} privately, or enter an address`;
  show('#ntp-stats', ui.ntpShowStats);
  $('#stat-history').textContent = state.history.on ? state.history.count.toLocaleString() : '0';
  $('#stat-history-label').textContent = state.history.on ? 'pages in your history' : 'history entries saved';
  $('#ntp-foot').textContent = {
    standard: 'Standard mode: your history is saved (encrypted) and you stay signed in. Hit 🔥 to erase it all.',
    private: 'Private mode: no history is recorded, and site data is erased when you quit, except sites you stay signed in to.',
    memory: 'Memory-only mode: nothing touches the disk. Everything is gone when you quit.',
  }[state.mode] || 'VRK never sends your history anywhere. Hit 🔥 to erase browsing data now.';
  renderTopSites();
  const tiles = $('#ntp-bookmarks');
  const links = ui.ntpShowBookmarks ? state.bookmarksBar.filter((n) => n.url).slice(0, 8) : [];
  const key = JSON.stringify(links);
  if (key === ntpKey) return;
  ntpKey = key;
  tiles.replaceChildren(
    ...links.map((node) => {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.title = node.url;
      const face = document.createElement('span');
      face.className = 'face';
      if (node.icon) {
        const img = new Image();
        img.src = node.icon;
        img.alt = '';
        face.append(img);
      } else face.textContent = letterOf(hostOf(node.url));
      const label = document.createElement('span');
      label.textContent = node.title;
      tile.append(face, label);
      tile.addEventListener('click', (event) => vrk.openBookmark(node.id, event.metaKey ? 'background' : 'current'));
      return tile;
    }),
  );
}

// Most visited sites, from history (Standard mode).
let topSitesAt = 0;
async function renderTopSites() {
  const wrap = $('#ntp-top-wrap');
  if (!state.history.on || !state.ui.ntpShowBookmarks) {
    wrap.hidden = true;
    return;
  }
  if (Date.now() - topSitesAt < 5000) return;
  topSitesAt = Date.now();
  const sites = await vrk.request('history:top', 8);
  wrap.hidden = !sites.length;
  $('#ntp-top').replaceChildren(
    ...sites.map((site) => {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.title = site.url;
      const face = document.createElement('span');
      face.className = 'face';
      face.textContent = letterOf(hostOf(site.url));
      const label = document.createElement('span');
      label.textContent = site.title || hostOf(site.url);
      tile.append(face, label);
      tile.addEventListener('click', (event) => vrk.openUrl(site.url, event.metaKey ? 'background' : 'current'));
      return tile;
    }),
  );
}

function renderTorPanel(tab) {
  const { tor } = state;
  const status = {
    off: 'Starting Tor…',
    starting: `Connecting to the Tor network… ${tor.progress}%${tor.summary ? ` · ${tor.summary}` : ''}`,
    ready: tab.waiting ? 'Connected. Loading…' : 'Connected to the Tor network.',
    error: tor.error || 'Tor could not connect.',
  }[tor.state];
  $('#tor-status').textContent = tab.waiting && tor.state !== 'ready' ? `${status} Your page will open as soon as Tor is ready.` : status;
  show('#tor-progress', tor.state === 'starting' || tor.state === 'off');
  $('#tor-progress-fill').style.width = `${Math.max(4, tor.progress)}%`;
  show('#tor-form', tab.isNewTab);
  show('#tor-retry', tor.state === 'error');
  show('#tor-check', tor.state === 'ready' && tab.isNewTab);
  show('#tor-identity', tor.state === 'ready' && tab.isNewTab);
}

function renderVpnPanel() {
  const { vpn } = state;
  const connecting = vpn.state === 'connecting';
  $('#vpn-title').textContent = connecting ? 'Connecting to your VPN…' : 'VPN disconnected';
  $('#vpn-desc').textContent = connecting
    ? `Connecting to ${vpn.name || 'your VPN server'}. Your page will load once the tunnel is up. Nothing is sent outside the VPN in the meantime.`
    : `${vpn.error || 'The VPN connection dropped.'} The kill switch is blocking all traffic so nothing leaks outside the VPN.`;
  $('#vpn-icon').className = `logo ${connecting ? '' : 'danger'}`;
  show('#vpn-retry', !connecting);
}

function renderErrorPanel(tab) {
  const crashed = tab.crashed;
  $('#err-title').textContent = crashed ? 'This tab crashed' : tab.error.title;
  $('#err-desc').textContent = crashed
    ? 'The page stopped unexpectedly. Its sandbox kept the crash from affecting anything else.'
    : tab.error.insecureUrl
      ? `${hostOf(tab.error.insecureUrl)} doesn't support a secure (HTTPS) connection. VRK only loads encrypted pages unless you say otherwise; on an unencrypted page, anyone on your network can see or change what you send.`
      : tab.error.desc;
  $('#err-code').textContent = crashed ? '' : tab.error.name || '';
  $('#err-retry').textContent = crashed ? 'Reload' : 'Try again';
  const insecure = $('#err-insecure');
  insecure.hidden = !tab.error?.insecureUrl;
  if (tab.error?.insecureUrl) insecure.textContent = `Continue to ${hostOf(tab.error.insecureUrl)} (not secure)`;
  // Dangerous sites: red, “Back to safety” first, “visit anyway” behind Details.
  const danger = Boolean(!crashed && tab.error?.danger);
  $('#errpanel').classList.toggle('danger', danger);
  $('#err-icon').className = `logo ${danger ? 'danger' : 'warn'}`;
  if (danger) $('#err-retry').textContent = tab.error.target ? `Go to ${tab.error.target}` : 'Back to safety';
  const key = danger ? `${tab.id}|${tab.error.name}|${tab.error.desc}` : '';
  if ($('#errpanel').dataset.dangerKey !== key) {
    $('#errpanel').dataset.dangerKey = key;
    $('#err-more').hidden = true; // the details start closed for each new warning
  }
  $('#err-details').hidden = !danger || !$('#err-more').hidden;
  if (danger) {
    $('#err-more-text').textContent =
      tab.error.danger === 'lookalike'
        ? `VRK compares site names with popular sites and catches look-alike letters (like “1” for “l”), other alphabets and typos. If you’re sure ${hostOf(tab.url)} is the site you want, you can continue.`
        : 'VRK found this site on public lists of phishing and malware sites (OpenPhish, PhishTank and abuse.ch URLhaus), checked on your Mac. If you’re sure it’s safe, you can visit it anyway.';
  }
  if (!danger) $('#err-more').hidden = true;
}

// ── Find bar ────────────────────────────────────────────────────────────

function openFind() {
  els.findbar.hidden = false;
  els.findInput.focus();
  els.findInput.select();
  if (els.findInput.value) vrk.find(els.findInput.value, true, true);
}

function closeFind() {
  if (els.findbar.hidden) return;
  els.findbar.hidden = true;
  els.findCount.textContent = '';
  vrk.stopFind();
}

els.findInput.addEventListener('input', () => {
  els.findCount.textContent = '';
  vrk.find(els.findInput.value, true, true);
});
els.findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') vrk.find(els.findInput.value, !event.shiftKey, false);
  if (event.key === 'Escape') closeFind();
});
$('#find-prev').addEventListener('click', () => vrk.find(els.findInput.value, false, false));
$('#find-next').addEventListener('click', () => vrk.find(els.findInput.value, true, false));
$('#find-close').addEventListener('click', closeFind);

// ── Permission, password & notice bars ──────────────────────────────────

function showPermission() {
  const request = permissionQueue[0];
  els.permbar.hidden = !request;
  if (!request) return;
  const host = document.createElement('b');
  host.textContent = request.host;
  $('#perm-text').replaceChildren(host, ` wants to ${request.what}${request.tor ? ' (Tor tab)' : ''}`);
}

function answerPermission(allow) {
  const request = permissionQueue.shift();
  if (request) vrk.answerPermission(request.id, allow);
  showPermission();
}
$('#perm-allow').addEventListener('click', () => answerPermission(true));
$('#perm-block').addEventListener('click', () => answerPermission(false));

function showPasswordOffer() {
  const offer = passwordQueue[0];
  els.pwbar.hidden = !offer;
  if (!offer) return;
  const host = document.createElement('b');
  host.textContent = offer.host;
  const who = offer.username ? ` for ${offer.username}` : '';
  $('#pw-text').replaceChildren(offer.updating ? 'Update the saved password' : 'Save this password', who, ' on ', host, '?');
  $('#pw-keep-label').hidden = !offer.canKeep;
  $('#pw-keep').checked = true;
  $('#pw-keep-text').textContent = `Stay signed in to ${offer.site}`;
  $('#pw-save').textContent = offer.updating ? 'Update' : 'Save';
}

function answerPassword(action) {
  const offer = passwordQueue.shift();
  if (offer) vrk.answerPassword(offer.id, action, offer.canKeep && $('#pw-keep').checked);
  showPasswordOffer();
}
$('#pw-save').addEventListener('click', () => answerPassword('save'));
$('#pw-never').addEventListener('click', () => answerPassword('never'));
$('#pw-dismiss').addEventListener('click', () => answerPassword('dismiss'));

let noticeTimer = null;
function showNotice({ text, action, danger }) {
  $('#notice-text').textContent = text;
  els.noticebar.classList.toggle('danger', Boolean(danger));
  const icon = els.noticebar.querySelector('.bar-icon');
  const kind = danger ? 'warning' : 'info';
  if (icon.dataset.icon !== kind) {
    icon.dataset.icon = kind;
    icon.innerHTML = ICONS[kind];
  }
  const button = $('#notice-action');
  button.hidden = !action;
  if (action) {
    button.textContent = action.label;
    button.onclick = () => {
      if (action.download) vrk.revealDownload(action.download);
      if (action.store) vrk.storeInstall(action.store, action.id);
      if (action.clearClipboard) vrk.request('clipboard:clear');
      if (action.restartToUpdate) vrk.request('update:restart');
      hideNotice();
    };
  }
  els.noticebar.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(hideNotice, danger ? 25000 : action ? 9000 : 4500);
}
function hideNotice() {
  els.noticebar.hidden = true;
}
$('#notice-close').addEventListener('click', hideNotice);

// ── Toolbar & panel wiring ──────────────────────────────────────────────

const menuAt = (name, button) => {
  const rect = button.getBoundingClientRect();
  vrk.menu(name, rect.left, rect.bottom + 4);
};

$('#new-tab').addEventListener('click', () => vrk.newTab(false));
$('#new-tab').addEventListener('contextmenu', (event) => {
  event.preventDefault();
  menuAt('new-tab', $('#new-tab'));
});
els.back.addEventListener('click', () => vrk.back());
els.forward.addEventListener('click', () => vrk.forward());
els.reload.addEventListener('click', () => (active()?.loading ? vrk.stop() : vrk.reload()));
els.star.addEventListener('click', () => vrk.toggleBookmark());
els.shields.addEventListener('click', () => menuAt('shields', els.shields));
els.vpn.addEventListener('click', () => menuAt('vpn', els.vpn));
els.tor.addEventListener('click', () => menuAt('tor', els.tor));
els.burn.addEventListener('click', () => vrk.burn());
$('#menu').addEventListener('click', () => menuAt('main', $('#menu')));

els.address.addEventListener('mousedown', (event) => {
  if (document.activeElement !== els.address) {
    event.preventDefault();
    els.address.focus();
  }
});
els.address.addEventListener('focus', () => els.address.select());

// ── Address-bar suggestions (history, bookmarks, search) ──
let suggestions = { items: [], index: 0 };
let suggestSeq = 0;
function hideSuggestions() {
  if (!suggestions.items.length) return;
  suggestions = { items: [], index: 0 };
  vrk.suggestHide();
}
async function updateSuggestions(inputType) {
  const typed = els.address.value;
  const seq = ++suggestSeq;
  if (!typed.trim()) return hideSuggestions();
  const rect = $('#omnibox').getBoundingClientRect();
  const result = await vrk.request('suggest', typed, { x: rect.left, y: rect.bottom + 4, width: rect.width });
  if (seq !== suggestSeq || document.activeElement !== els.address) return;
  suggestions = { items: result.items, index: 0 };
  // Inline completion: finish the address you're typing (not while deleting).
  const completion = result.completion;
  const caretAtEnd = els.address.selectionStart === typed.length;
  if (completion && !inputType?.startsWith('delete') && caretAtEnd && completion.toLowerCase().startsWith(typed.toLowerCase()) && completion.length > typed.length) {
    els.address.value = typed + completion.slice(typed.length);
    els.address.setSelectionRange(typed.length, els.address.value.length);
  }
}
els.address.addEventListener('input', (event) => {
  addressEditing = true;
  updateSuggestions(event.inputType);
});
els.address.addEventListener('keydown', (event) => {
  const { items } = suggestions;
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
    event.preventDefault();
    suggestions.index = (suggestions.index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    vrk.suggestHighlight(suggestions.index);
    return;
  }
  if (event.key === 'Enter' && items.length && suggestions.index > 0) {
    event.preventDefault();
    const item = items[suggestions.index];
    hideSuggestions();
    addressEditing = false;
    els.address.blur();
    vrk.navigate(item.url);
    return;
  }
  if (event.key !== 'Escape') return;
  if (items.length) return hideSuggestions();
  addressEditing = false;
  els.address.value = displayUrl(active());
  els.address.blur();
});
els.address.addEventListener('blur', () => {
  setTimeout(hideSuggestions, 200); // a click in the suggestion list arrives first
  if (!addressEditing) els.address.value = displayUrl(active());
});

function submit(form, input) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    addressEditing = false;
    hideSuggestions();
    input.value = '';
    input.blur();
    vrk.navigate(value);
  });
}
submit($('#omnibox'), els.address);
submit($('#ntp-form'), $('#ntp-input'));
submit($('#tor-form'), $('#tor-input'));

$('#tor-retry').addEventListener('click', () => vrk.torRetry());
$('#tor-check').addEventListener('click', () => vrk.navigate('https://check.torproject.org/'));
$('#tor-identity').addEventListener('click', () => vrk.torIdentity());
$('#vpn-retry').addEventListener('click', () => vrk.vpnRetry());
$('#vpn-off').addEventListener('click', () => vrk.vpnOff());
$('#err-retry').addEventListener('click', () => (active()?.error?.danger ? vrk.dangerBack() : vrk.retry()));
$('#err-details').addEventListener('click', () => {
  $('#err-more').hidden = false;
  $('#err-details').hidden = true;
});
$('#err-visit').addEventListener('click', () => vrk.dangerVisit());
$('#lock-unlock').addEventListener('click', () => vrk.unlock());
$('#err-insecure').addEventListener('click', () => vrk.loadInsecure());

// The web page view sits below the chrome, so tell the main process how tall it is.
new ResizeObserver(() => vrk.setChromeHeight(Math.ceil($('#chrome').getBoundingClientRect().height))).observe($('#chrome'));

// ── Events from the main process ────────────────────────────────────────

const handlers = {
  'focus-address': (options = {}) => {
    // The state that shows a new tab arrives just after this event, so focus on the next render.
    pendingFocus = options;
    setTimeout(applyFocus, 50);
  },
  'find-open': openFind,
  'find-next': (forward) => {
    if (els.findbar.hidden || !els.findInput.value) openFind();
    else vrk.find(els.findInput.value, forward !== false, false);
  },
  'find-result': ({ active: current, total }) => {
    els.findCount.textContent = els.findInput.value ? (total ? `${current} of ${total}` : 'No matches') : '';
  },
  permission: (request) => {
    permissionQueue.push(request);
    showPermission();
  },
  'permission-done': (id) => {
    const index = permissionQueue.findIndex((request) => request.id === id);
    if (index >= 0) permissionQueue.splice(index, 1);
    showPermission();
  },
  'password-offer': (offer) => {
    passwordQueue.push(offer);
    showPasswordOffer();
  },
  toast: showNotice,
  burned: ({ kept } = {}) => {
    const flash = $('#burn-flash');
    flash.hidden = true;
    void flash.offsetWidth; // restart the animation
    flash.hidden = false;
    setTimeout(() => (flash.hidden = true), 950);
    showNotice({ text: kept ? `Burned. Everything is gone except the ${kept} site${kept === 1 ? '' : 's'} you stay signed in to.` : 'Burned. Every tab, cookie, cache entry and permission is gone.' });
  },
  'settings-section': (section) => typeof settingsGoTo === 'function' && settingsGoTo(section),
  theme: (payload) => {
    activeTheme = payload;
    applyActiveTheme();
  },
  'suggest-picked': () => {
    suggestions = { items: [], index: 0 };
    addressEditing = false;
    els.address.blur();
  },
  'update-status': () => {
    if (settingsVisible && typeof refreshSettings === 'function') refreshSettings();
  },
  'extensions-changed': () => {
    refreshExtensionActions();
    if (settingsVisible && typeof refreshSettings === 'function') refreshSettings();
  },
};

vrk.onState((next) => {
  const firstExtensions = next.extensionsReady && !state?.extensionsReady;
  const first = !state;
  state = next;
  // splash.js loads last; if the first state beats it here, it picks this up when it runs.
  if (first) {
    if (window.VRKSplash) window.VRKSplash.start(next.splash);
    else window.vrkSplashWanted = next.splash;
  }
  render();
  if (firstExtensions) refreshExtensionActions();
});
vrk.onEvent((name, payload) => handlers[name]?.(payload));
// settings.js loads after this script; announce readiness once both have run.
document.addEventListener('DOMContentLoaded', () => vrk.ready());

// ── "Search with" switcher in the address bar (like Firefox's) ──
const ENGINE_ICONS = {
  google: '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>',
  bing: '<svg viewBox="0 0 24 24"><defs><linearGradient id="bing-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#37bdff"/><stop offset="1" stop-color="#1a5fd6"/></linearGradient></defs><path fill="url(#bing-g)" d="M5 2.5 9 4v13.6l5.6-3.3-2.8-1.3-1.7-4.3 9 3.2v4.5L9 22.5 5 20z"/></svg>',
};
// (var/lookups, not const: render() can run before this part of the file has.)
var shownEngine = null;
function renderEngine(tab) {
  const engineBtn = document.getElementById('engine');
  if (!engineBtn) return;
  engineBtn.hidden = Boolean(tab?.tor);
  const id = state.searchEngine;
  if (id === shownEngine) return;
  shownEngine = id;
  engineBtn.innerHTML = `${ENGINE_ICONS[id] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/></svg>'}<svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  engineBtn.title = `Search with ${state.searchName} (click to change)`;
}
document.getElementById('engine')?.addEventListener('mousedown', (e) => e.preventDefault()); // keep the address bar's focus
document.getElementById('engine')?.addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  vrk.menu('search', rect.left, rect.bottom + 6);
});
