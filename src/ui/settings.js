'use strict';
// VRK's settings page (vrk://settings): appearance, search, privacy,
// passwords, extensions, importing from other browsers, Tor/VPN and about.
// Loaded after app.js, whose helpers ($, ICONS, state, vrk) it uses.
// Runs in its own scope; only openSettingsPage, settingsGoTo and refreshSettings
// are shared with app.js.
(() => {

const SECTIONS = ['general', 'security', 'appearance', 'search', 'privacy', 'passwords', 'extensions', 'import', 'network', 'about'];
const ACCENTS = { violet: '#8b7bff', teal: '#1fc7aa', blue: '#4c8dff', pink: '#ff5fa8', orange: '#ff8a3d', green: '#36c46a', red: '#ff5267', gold: '#e3a92b' };
const BACKGROUNDS = {
  aurora: 'radial-gradient(circle at 50% 0, rgba(139,123,255,.6), transparent 70%), #0b0c10',
  midnight: 'radial-gradient(circle at 20% 0, rgba(64,96,255,.6), transparent 70%), #0b0c10',
  sunset: 'radial-gradient(circle at 50% 0, rgba(255,110,90,.65), transparent 70%), #0b0c10',
  ocean: 'radial-gradient(circle at 30% 0, rgba(30,200,220,.6), transparent 70%), #0b0c10',
  plain: '#16171d',
};
const ENGINES = { duckduckgo: 'DuckDuckGo', brave: 'Brave Search', startpage: 'Startpage (Google results, privately)', google: 'Google', bing: 'Bing', ecosia: 'Ecosia' };

let section = 'general';
let passwordHealth = null; // the last Check Passwords result
const CONTAINER_COLORS = ['blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];
let folderError = null; // why a picked import folder didn't work

// 2FA: the login whose code (or setup form) is open, and what it shows.
let totpOpen = null; // { id, code?, secondsLeft?, error? }

async function showTotp(login) {
  if (totpOpen?.id === login.id) totpOpen = null;
  else totpOpen = { id: login.id, ...(login.hasTotp ? await vrk.request('passwords:totp-code', login.id) : {}) };
  if (totpOpen?.code) navigator.clipboard.writeText(totpOpen.code).catch(() => {});
  renderSettings(true);
}

function totpEditor(login) {
  if (totpOpen?.id !== login.id) return null;
  if (login.hasTotp) {
    return h(
      'div',
      { class: 'totp' },
      h('span', { class: 'totp-code' }, totpOpen.code ? `${totpOpen.code.slice(0, 3)} ${totpOpen.code.slice(3)}` : '…'),
      h('small', {}, `Copied · changes in ${totpOpen.secondsLeft}s`),
      h('button', { class: 'btn small', onclick: () => vrk.request('passwords:set-totp', login.id, null).then(() => ((totpOpen = null), refreshSettings())) }, 'Remove 2FA'),
    );
  }
  const input = h('input', { class: 'search-box', placeholder: 'Secret key or otpauth:// link' });
  const save = async (value) => {
    const result = await vrk.request('passwords:set-totp', login.id, value);
    if (result.error) {
      totpOpen = { id: login.id, error: result.error };
      return renderSettings(true);
    }
    totpOpen = null;
    refreshSettings();
  };
  return h(
    'div',
    { class: 'totp' },
    input,
    h('button', { class: 'btn small primary', onclick: () => save(input.value) }, 'Save'),
    h(
      'button',
      {
        class: 'btn small',
        onclick: async () => {
          const found = await vrk.request('passwords:scan-qr');
          if (found.error) {
            totpOpen = { id: login.id, error: found.error };
            return renderSettings(true);
          }
          save(found.otpauth);
        },
      },
      'Scan QR Code on Page',
    ),
    totpOpen.error && h('small', { class: 'err' }, totpOpen.error),
  );
}

let backupMessage = null;

function backupForm() {
  const pass = h('input', { type: 'password', class: 'search-box', placeholder: 'Passphrase' });
  const again = h('input', { type: 'password', class: 'search-box', placeholder: 'Passphrase again (to export)' });
  const finish = (result, done) => {
    backupMessage = result.error ? { error: result.error } : result.canceled ? null : { text: done(result) };
    refreshSettings();
  };
  return h(
    'div',
    { class: 'backup-form' },
    pass,
    again,
    h(
      'button',
      {
        class: 'btn',
        onclick: async () => {
          if (pass.value !== again.value) return finish({ error: 'The two passphrases don’t match.' });
          finish(await vrk.request('backup:export', pass.value), (r) => `Saved “${r.file}” with ${r.logins} passwords and ${r.passkeys} passkeys.`);
        },
      },
      'Export Backup…',
    ),
    h('button', { class: 'btn', onclick: async () => finish(await vrk.request('backup:restore', pass.value), (r) => `Restored ${r.logins} passwords, ${r.passkeys} passkeys and ${r.bookmarks} bookmarks.`) }, 'Restore Backup…'),
    backupMessage && h('small', { class: backupMessage.error ? 'err' : 'ok' }, backupMessage.error || backupMessage.text),
  );
}

function updateStatusText(u) {
  if (!u) return '';
  if (u.status === 'ready' || u.ready) return `Electron ${u.ready?.version || u.latest} is tested and ready: it installs when you quit VRK.`;
  if (u.status === 'updating') return `Updating to Electron ${u.latest}: building and testing in the background (a few minutes).`;
  if (u.status === 'checking') return 'Checking for updates…';
  if (u.error) return u.error;
  if (!u.checkedAt) return 'Not checked yet.';
  return `Up to date (checked ${new Date(u.checkedAt).toLocaleString()}).`;
}

// A text setting saved when you press Enter or leave the field.
function textSetting(key, placeholder) {
  const input = h('input', { class: 'search-box', placeholder, value: data.settings[key] || '' });
  const save = async () => {
    const { ok } = await vrk.request('settings:set', key, input.value.trim());
    input.classList.toggle('invalid', !ok);
  };
  input.addEventListener('change', save);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  return input;
}

// Per extension: which sites it may read and change.
function siteAccessControl(ext) {
  const save = (mode, sites) => vrk.request('extensions:set-access', ext.id, mode, sites).then(refreshSettings);
  const input = h('input', { class: 'search-box small', placeholder: 'example.com' });
  const add = () => {
    const site = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (site) save('list', [...ext.sites, site]);
  };
  return h(
    'div',
    { class: 'ext-access' },
    h('span', {}, 'Runs on'),
    h(
      'select',
      { onchange: (e) => save(e.target.value, ext.sites) },
      h('option', { value: 'all', selected: ext.siteAccess !== 'list' }, 'all sites (except protected ones)'),
      h('option', { value: 'list', selected: ext.siteAccess === 'list' }, 'only sites I choose'),
    ),
    ext.siteAccess === 'list' && [
      ...ext.sites.map((site) => h('span', { class: 'chip' }, site, h('button', { title: 'Remove', onclick: () => save('list', ext.sites.filter((s) => s !== site)) }, '×'))),
      input,
      h('button', { class: 'btn small', onclick: add }, 'Add'),
    ],
  );
}

// A setting's list of sites, each with a Remove button.
function siteList(key, label) {
  const sites = data.settings[key] || [];
  if (!sites.length) return [];
  return [
    h('div', { class: 'site-list-label' }, `${label} (${sites.length})`),
    ...sites.map((site) =>
      h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('b', {}, site)), h('button', { class: 'btn small', onclick: () => vrk.request('settings:site', key, site, false).then(refreshSettings) }, 'Remove')),
    ),
  ];
}

async function chooseImportFolder(choice) {
  folderError = null;
  const answer = await vrk.request('import:choose-folder', choice.id);
  if (answer.error) folderError = answer.error;
  else if (answer.browsers) {
    browsers = answer.browsers;
    importChoice = { ...importChoice, browserId: choice.id, profileId: answer.profiles[0].id };
  }
  renderSettings(true);
}

function healthSummary({ checked, compromised, reused, weak }) {
  const problems = [
    compromised.length && `${compromised.length} in data breaches`,
    reused.length && `${reused.length} reused`,
    weak.length && `${weak.length} weak`,
  ].filter(Boolean);
  return problems.length ? `${problems.join(', ')} (of ${checked})` : `All ${checked} passwords look good`;
}

function healthTags(id) {
  if (!passwordHealth) return [];
  return [
    passwordHealth.compromised.includes(id) && h('span', { class: 'tag bad' }, 'Breached'),
    passwordHealth.reused.includes(id) && h('span', { class: 'tag warn' }, 'Reused'),
    passwordHealth.weak.includes(id) && h('span', { class: 'tag warn' }, 'Weak'),
  ].filter(Boolean);
}
let data = null;
let extensions = [];
let browsers = null;
let importChoice = null;
let importResult = null;
let passwordFilter = '';
let themeList = null;

const h = (tag, props = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key === 'style') for (const [name, v] of Object.entries(value)) el.style.setProperty(name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), v);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
};

async function openSettingsPage() {
  await refreshSettings();
}

function settingsGoTo(name) {
  if (SECTIONS.includes(name)) section = name;
  refreshSettings();
}

async function refreshSettings() {
  data = await vrk.request('settings:get');
  if (section === 'appearance') themeList = await vrk.request('themes:list');
  if (section === 'extensions') extensions = await vrk.request('extensions:list');
  if (section === 'import' && !browsers) browsers = await vrk.request('import:detect');
  renderSettings();
}

async function setSetting(key, value) {
  const { pendingRestart } = await vrk.request('settings:set', key, value);
  data.settings[key] = value;
  data.pendingRestart = pendingRestart;
  renderSettings();
}

// ── Controls ─────────────────────────────────────────────────────────────

const row = (title, description, control) =>
  h('div', { class: 'row' }, h('div', { class: 'label' }, h('b', {}, title), description && h('small', {}, description)), control);

const toggle = (key, { restart = false } = {}) =>
  h(
    'label',
    { class: 'switch', title: restart ? 'Takes effect after a restart' : '' },
    h('input', { type: 'checkbox', checked: data.settings[key], onchange: (e) => setSetting(key, e.target.checked) }),
    h('span'),
  );

const segmented = (key, options) =>
  h(
    'div',
    { class: 'segmented' },
    Object.entries(options).map(([value, label]) =>
      h('button', { class: data.settings[key] === value ? 'active' : '', onclick: () => setSetting(key, value) }, label),
    ),
  );

const select = (key, options) =>
  h(
    'select',
    { onchange: (e) => setSetting(key, e.target.value) },
    Object.entries(options).map(([value, label]) => h('option', { value, selected: data.settings[key] === value }, label)),
  );

const card = (title, ...rows) => h('div', { class: 'card' }, title && h('h3', {}, title), ...rows);
const header = (title, sub) => [h('h2', { class: 'section-title' }, title), sub && h('p', { class: 'section-sub' }, sub)].filter(Boolean);

// ── Sections ─────────────────────────────────────────────────────────────

const views = {
  general: () => [
    ...header('General'),
    card(
      'VRKOS',
      row(
        'VRKOS desktop',
        'A full-screen desktop inside VRK: Files, Terminal, Notes, Text Editor, System Monitor and more, your Mac apps, and Windows programs through Wine. VRK Browser is its browser. ⌥⌘O switches in and out.',
        h('button', { class: 'btn primary', onclick: () => vrk.request('os:enter') }, 'Open VRKOS'),
      ),
      row('Start in VRKOS', 'Open VRKOS when VRK starts.', toggle('osStartup')),
    ),
    card(
      'Security updates',
      row(
        'Update VRK automatically',
        data.updates?.available
          ? `Every few hours VRK checks for a new Electron (it carries Chromium’s security fixes), rebuilds itself from ${data.updates.source}, runs its ${'self-test'} and installs only if everything passes, when you quit or restart.`
          : 'Works in the installed app built from its project folder (this copy can’t update itself).',
        toggle('autoUpdate'),
      ),
      row(
        `Chromium ${data.updates?.chromium || data.versions.chromium} · Electron ${data.updates?.current || data.versions.electron}`,
        updateStatusText(data.updates),
        h(
          'button',
          {
            class: 'btn',
            disabled: !data.updates?.available || ['checking', 'updating'].includes(data.updates?.status),
            onclick: (e) => {
              e.target.disabled = true;
              e.target.textContent = 'Checking…';
              vrk.request('update:check').finally(refreshSettings);
            },
          },
          data.updates?.status === 'updating' ? 'Updating…' : 'Check Now',
        ),
      ),
    ),
    card(
      'Containers',
      row('Container tabs', 'Each container keeps its own cookies and sign-ins, so sites can’t connect them, and you can use two accounts at once. Right-click + or a link to open one. Extensions run in normal tabs only.', h('span')),
      ...data.settings.containers.map((c) =>
        h(
          'div',
          { class: 'list-row' },
          h('span', { class: `container-dot c-${c.color}` }),
          h('input', { class: 'search-box small', value: c.name, maxlength: 30, onchange: (e) => vrk.request('containers:update', c.id, { name: e.target.value }).then(refreshSettings) }),
          h('select', { onchange: (e) => vrk.request('containers:update', c.id, { color: e.target.value }).then(refreshSettings) }, CONTAINER_COLORS.map((color) => h('option', { value: color, selected: color === c.color }, color))),
          h('span', { class: 'bar-spacer' }),
          h('button', { class: 'btn small', onclick: () => vrk.newContainerTab(c.id) }, 'New Tab'),
          h('button', { class: 'btn small danger', onclick: () => confirm(`Delete the ${c.name} container? Its tabs close and its cookies and sign-ins are erased.`) && vrk.request('containers:remove', c.id).then(refreshSettings) }, 'Delete'),
        ),
      ),
      data.settings.containers.length < 12 &&
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => vrk.request('containers:add', 'New Container', CONTAINER_COLORS[data.settings.containers.length % CONTAINER_COLORS.length]).then(refreshSettings) }, 'Add Container')),
    ),
    card(
      'Default browser',
      row(
        data.defaultBrowser.isDefault ? 'VRK is your default browser' : 'Make VRK your default browser',
        data.defaultBrowser.isDefault
          ? 'Links you open in other apps, like Mail and Messages, open in VRK.'
          : data.defaultBrowser.canSet
            ? 'Links you open in other apps, like Mail and Messages, will open in VRK. macOS asks you to confirm.'
            : 'Available in the installed app (this is a development copy).',
        data.defaultBrowser.isDefault
          ? h('span', { class: 'pill ok' }, '✓ Default')
          : h(
              'button',
              {
                class: 'btn primary',
                disabled: !data.defaultBrowser.canSet,
                onclick: (e) => {
                  e.target.disabled = true;
                  e.target.textContent = 'Confirm in the macOS dialog…';
                  vrk.request('settings:make-default').finally(refreshSettings);
                },
              },
              'Make Default',
            ),
      ),
    ),
  ],

  // (Containers live in General.)
  security: () => [
    ...header('Security', 'Extra protection for VRK itself.'),
    card(
      'App lock',
      data.canLock
        ? row('Lock VRK with Touch ID', 'When VRK opens, when your Mac sleeps or locks, and after you’ve been away. Pages, tab titles and history stay hidden until you unlock.', toggle('appLock'))
        : row('Lock VRK with Touch ID', 'This Mac has no Touch ID, so App Lock isn’t available.', h('span')),
      data.canLock && row('Lock after', 'Time away from your Mac before VRK locks.', select('appLockMinutes', { 1: '1 minute', 5: '5 minutes', 15: '15 minutes', 60: '1 hour' })),
    ),
    card(
      'Lockdown mode',
      row(
        'Lockdown mode',
        'Like Safari’s: turns off the JavaScript speed-up compiler (the target of most browser exploits), WebAssembly, WebGL, WebGPU and web fonts. Pages get slower and some won’t work. Takes effect after a restart.',
        toggle('lockdown', { restart: true }),
      ),
    ),
    card(
      'HTTPS inspection',
      row(
        'Warn when HTTPS is being inspected',
        'Tells you when a school or work network filter, or software on this Mac, decrypts your HTTPS traffic with its own certificate.',
        toggle('interceptionWarnings'),
      ),
      ...(data.interceptions.length
        ? data.interceptions.map((i) => row(`Inspected by “${i.issuer}”`, `Seen on ${i.hosts.join(', ')}`, h('span', { class: 'tag bad' }, 'This session')))
        : [h('div', { class: 'empty' }, 'No inspection seen since VRK started.')]),
    ),
    card(
      'Extensions',
      row('Protected sites', 'Extensions never read or change these sites (banks and money apps to start). Add the site you’re on from the shield menu.', h('span')),
      ...siteList('extensionBlockedSites', 'Extensions never run on'),
    ),
    card(
      'JavaScript',
      row(
        'JavaScript on sites',
        'Choose per site from the shield menu. “Blocked unless allowed” runs scripts only on sites you allow (like NoScript).',
        select('jsDefault', { allow: 'Allowed unless blocked', block: 'Blocked unless allowed' }),
      ),
      ...siteList(data.settings.jsDefault === 'block' ? 'jsAllowedSites' : 'jsBlockedSites', data.settings.jsDefault === 'block' ? 'Allowed on' : 'Blocked on'),
    ),
  ],

  appearance: () => [
    ...header('Appearance', 'Make VRK yours.'),
    card(
      'Theme',
      h(
        'div',
        { class: 'theme-grid' },
        (themeList?.themes || []).map((theme) =>
          h(
            'button',
            {
              class: `theme-pick ${theme.id === themeList.activeId ? 'active' : ''}`,
              onclick: async () => {
                await vrk.request('themes:apply', theme.id);
                refreshSettings();
              },
            },
            h('span', { class: 'theme-pick-swatch', style: { background: themeSwatch(theme) } }),
            h('span', {}, theme.name),
          ),
        ),
      ),
      h(
        'div',
        { class: 'store-buttons' },
        h('button', { class: 'btn primary', onclick: () => vrk.openInternal('themes') }, 'Open Theme Editor'),
        h('button', { class: 'btn', onclick: useMediaBackground }, 'Use an Image or Video as Background…'),
      ),
    ),
    card(
      'VRK Classic',
      themeList && themeList.activeId !== 'classic' && h('div', { class: 'empty' }, 'These apply when the VRK Classic theme is in use.'),
      row('Mode', 'System follows your Mac’s light or dark mode.', segmented('theme', { dark: 'Dark', light: 'Light', system: 'System' })),
      row(
        'Accent color',
        null,
        h(
          'div',
          { class: 'swatches' },
          Object.entries(ACCENTS).map(([name, color]) =>
            h('button', { class: `swatch ${data.settings.accent === name ? 'active' : ''}`, title: name, style: { background: color }, onclick: () => setSetting('accent', name) }),
          ),
        ),
      ),
      row('Density', 'Compact makes tabs and the toolbar smaller.', segmented('density', { comfortable: 'Comfortable', compact: 'Compact' })),
    ),
    card(
      'Toolbar',
      row('Bookmarks bar', null, select('bookmarksBar', { always: 'Always show', newtab: 'Show on new tabs', never: 'Never show' })),
      row('VPN button', null, toggle('showVpnButton')),
      row('Tor button', null, toggle('showTorButton')),
      row('Burn button', null, toggle('showBurnButton')),
    ),
    card(
      'Startup',
      row(
        'Opening animation',
        'Plays a short VRK animation when the browser opens. Click to skip it.',
        h('span', { class: 'te-actions' }, h('button', { class: 'btn small', onclick: () => window.VRKSplash?.replay() }, 'Preview'), toggle('showSplash')),
      ),
    ),
  ],

  search: () => [
    ...header('Search & new tab'),
    card('Search', row('Search engine', 'Used by the address bar. Tor tabs always search DuckDuckGo’s onion service.', select('searchEngine', ENGINES))),
    card(
      'New tab',
      row(
        'Background',
        null,
        h(
          'div',
          { class: 'bg-choices' },
          Object.entries(BACKGROUNDS).map(([name, background]) =>
            h('button', { class: `bg-choice ${data.settings.ntpBackground === name ? 'active' : ''}`, title: name, style: { background }, onclick: () => setSetting('ntpBackground', name) }),
          ),
        ),
      ),
      row('Show bookmarks', 'Your bookmarks bar as tiles.', toggle('ntpShowBookmarks')),
      row('Show privacy stats', null, toggle('ntpShowStats')),
    ),
  ],

  privacy: () => {
    const sites = data.settings.keepSites;
    const modes = [
      ['standard', 'Standard', 'Saves your history (encrypted) and keeps you signed in. Every protection stays on.'],
      ['private', 'Private', 'No history. Site data is erased when you quit, except sites you choose to stay signed in to.'],
      ['memory', 'Memory-only', 'Nothing ever touches the disk. Sign-ins and extension settings reset each launch.'],
    ];
    return [
      ...header('Privacy & security', 'Choose how much VRK remembers. Tor tabs never remember anything.'),
      card(
        'Browsing mode',
        h(
          'div',
          { class: 'mode-grid' },
          modes.map(([mode, title, text]) =>
            h(
              'button',
              {
                class: `mode-card ${data.mode === mode ? 'active' : ''}`,
                onclick: async () => {
                  const result = await vrk.request('settings:set-mode', mode);
                  data.pendingRestart = result.pendingRestart;
                  refreshSettings();
                },
              },
              h('b', {}, title, mode === 'standard' && h('em', { class: 'tag' }, 'Default')),
              h('small', {}, text),
            ),
          ),
        ),
        data.mode === 'custom' && h('div', { class: 'empty' }, 'You’ve customized the settings below, so no single mode applies.'),
      ),
      card(
        `History (${data.historyCount.toLocaleString()} visits)`,
        row(
          'Save browsing history',
          data.historyPersistent ? 'Encrypted with a key in your Mac’s Keychain, and never sent anywhere.' : 'Kept for this session only.',
          toggle('saveHistory'),
        ),
        row('Keep history for', null, select('historyDays', { 30: '30 days', 90: '90 days', 365: 'A year', forever: 'Forever' })),
        h(
          'div',
          { class: 'store-buttons' },
          h('button', { class: 'btn', onclick: () => vrk.openInternal('history') }, 'Show History'),
          h('button', { class: 'btn danger', onclick: () => vrk.request('history:clear', 'all').then(refreshSettings) }, 'Clear All History'),
        ),
      ),
      card(
        'Protection',
        row('Block ads, trackers & cookie banners', 'Uses EasyList, EasyPrivacy and uBlock Origin’s lists, plus HaGeZi’s list of ad, tracking and telemetry servers.', toggle('blockAds')),
        row(
          'Aggressive blocking',
          'Also blocks the decoy ads that “turn off your ad blocker” checks look for. Scores 100% on ad-block tests, but more sites may notice your blocker.',
          toggle('blockBait'),
        ),
        row(
          'Randomize fingerprints',
          'Canvas, WebGL and audio readings get tiny per-site changes (like Brave), so sites can’t recognize your device across the web. Always on in Tor tabs.',
          toggle('fingerprintProtection'),
        ),
        row(
          'Warn about “paste into Terminal” scams',
          'Warns when a site copies a Terminal command to your clipboard, the trick fake “verify you’re human” pages use to install Mac malware.',
          toggle('clipboardGuard'),
        ),
        row(
          'Warn about lookalike sites',
          'Stops sites dressed up as popular ones (paypa1.com, аpple.com in another alphabet, amazom.com) and offers the real site.',
          toggle('lookalikeWarnings'),
        ),
        row(
          'Block dangerous sites',
          'Stops known phishing and malware sites, with a warning page. The lists are checked on your Mac, so the sites you visit are never sent anywhere.',
          toggle('blockDangerous'),
        ),
        row('HTTPS-only', 'Upgrades every site to an encrypted connection and asks before loading one without.', toggle('httpsOnly')),
        row('Block third-party cookies', 'Stops embedded trackers from following you across sites. Takes effect after a restart.', toggle('blockThirdPartyCookies', { restart: true })),
        row('Strip tracking parameters', 'Removes utm_, fbclid, gclid and similar tags from links.', toggle('stripTrackingParams')),
        row('Skip tracking redirects', 'Links that pass through a click tracker (google.com/url, l.facebook.com, affiliate networks) go straight to where they lead.', toggle('skipTrackingRedirects')),
        row('Trim referrers', 'Other sites only learn which site you came from, never the exact page.', toggle('trimReferrers')),
        row('Reject cookie banners', 'Clicks “Reject all” on cookie banners for you, instead of just hiding them.', toggle('rejectCookieBanners')),
        row('Forget sites when you close them', 'A site’s cookies and storage are erased when you close its last tab (unless you stay signed in to it).', toggle('forgetOnClose')),
        row('Send Global Privacy Control', 'Tells sites not to sell or share your data; legally binding in some places.', toggle('sendGpc')),
      ),
      card(
        'When VRK quits',
        row(
          'Erase site data',
          'Cookies, storage and cache are erased when you quit, except for sites you stay signed in to below.',
          toggle('clearOnQuit'),
        ),
        row('Memory-only mode', 'Keep nothing on disk at all. Sign-ins and extension settings reset every launch. Takes effect after a restart.', toggle('memoryOnly', { restart: true })),
      ),
      card(
        `Stay signed in (${sites.length})`,
        ...(sites.length
          ? sites.map((site) =>
              h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('b', {}, site)), h('button', { class: 'btn small', onclick: () => vrk.request('settings:keep-site', site, false).then(refreshSettings) }, 'Remove')),
            )
          : [h('div', { class: 'empty' }, 'No sites yet. When you save a password, or from the shield menu, VRK can keep you signed in to that site.')]),
        sites.length && h('div', { class: 'store-buttons' }, h('button', { class: 'btn danger', onclick: forgetSignIns }, 'Sign out of everything')),
      ),
      card(
        'Site permissions',
        row('Notification requests', 'Sites asking to send notifications is mostly spam, so VRK says no for you unless you choose Ask.', select('notificationPrompts', { block: 'Block', ask: 'Ask' })),
        ...(data.permissions.length
          ? data.permissions.map((p) =>
              h(
                'div',
                { class: 'list-row' },
                h('div', { class: 'grow' }, h('b', {}, new URL(p.origin).hostname), h('small', {}, `${p.allowed ? 'Allowed' : 'Blocked'}: ${p.permission.replace('media:', '')}${p.tor ? ' · Tor' : ''}`)),
                h('button', { class: 'btn small', onclick: () => vrk.request('permissions:revoke', p.key, p.tor).then(refreshSettings) }, 'Reset'),
              ),
            )
          : [h('div', { class: 'empty' }, 'No site permissions. Anything you allow lasts only until you quit VRK.')]),
      ),
      card(
        'Downloads',
        row('Ask where to save each file', 'Off saves to your Downloads folder.', toggle('downloadsAsk')),
        row(
          'Download protection',
          'Marks downloads so macOS checks apps and installers before they run, deletes files that match newly found malware (abuse.ch, checked on this Mac), and only downloads installers and scripts over HTTPS.',
          toggle('downloadProtection'),
        ),
      ),
    ];
  },

  passwords: () => {
    const query = passwordFilter.toLowerCase();
    const list = data.passwords.filter((p) => !query || p.origin.toLowerCase().includes(query) || p.username.toLowerCase().includes(query));
    return [
      ...header(
        'Passwords',
        data.passwordsEncrypted ? 'Saved passwords are encrypted with a key in your Mac’s Keychain.' : 'Your Keychain isn’t available, so passwords are kept for this session only.',
      ),
      card(
        null,
        row('Offer to save passwords', 'VRK fills them only when you choose, and only on the site they were saved for. On sign-up forms it suggests a strong password.', toggle('offerPasswords')),
        row('Passkeys', 'Sign in without a password on sites that support passkeys. Each one is unlocked with Touch ID and kept encrypted on this Mac.', toggle('passkeys')),
        row(
          'Password reuse alerts',
          'Warns if you type a saved password into a different site, which often means a phishing page.',
          toggle('passwordReuseAlerts'),
        ),
        row(
          'Breach alerts',
          'Warns you if a password you save has appeared in a known data breach. Only the first 5 characters of a scrambled (hashed) version of the password are sent to Have I Been Pwned, never the password.',
          toggle('breachAlerts'),
        ),
        row('Import passwords', 'From Chrome, Edge, Brave, Opera, Firefox or a CSV file.', h('button', { class: 'btn', onclick: () => settingsGoTo('import') }, 'Import…')),
      ),
      card(
        'Encrypted backup',
        row(
          'Back up passwords, passkeys and bookmarks',
          'One file, locked with a passphrase only you know (at least 10 characters). Safe to keep in iCloud Drive or on a USB stick. Restoring adds to what’s here; nothing is deleted.',
          h('span'),
        ),
        backupForm(),
      ),
      card(
        'Password health',
        row(
          passwordHealth ? healthSummary(passwordHealth) : 'Check your passwords',
          passwordHealth?.offline ? 'Couldn’t reach the breach database, so only reused and weak passwords were checked.' : 'Finds passwords that were in data breaches, used on more than one site, or easy to guess.',
          h(
            'button',
            {
              class: 'btn',
              disabled: !data.passwords.length,
              onclick: async (e) => {
                e.target.disabled = true;
                e.target.textContent = 'Checking…';
                passwordHealth = await vrk.request('passwords:check');
                renderSettings(true);
              },
            },
            passwordHealth ? 'Check Again' : 'Check Passwords',
          ),
        ),
      ),
      data.passkeys.length > 0 &&
        card(
          `Passkeys (${data.passkeys.length})`,
          ...data.passkeys.map((p) =>
            h(
              'div',
              { class: 'list-row' },
              h('div', { class: 'grow' }, h('b', {}, p.rpId), h('small', {}, `${p.userName || p.displayName || 'Unnamed account'} · ${p.lastUsed ? `last used ${new Date(p.lastUsed).toLocaleDateString()}` : 'not used yet'}`)),
              h('button', { class: 'btn small danger', onclick: () => confirm(`Delete the passkey for ${p.rpId}? You won’t be able to sign in with it again.`) && vrk.request('passkeys:remove', p.id).then(refreshSettings) }, 'Delete'),
            ),
          ),
        ),
      card(
        `Saved passwords (${data.passwords.length})`,
        data.passwords.length > 6 &&
          h('div', { class: 'row' }, h('input', { class: 'search-box', placeholder: 'Search passwords', value: passwordFilter, oninput: (e) => { passwordFilter = e.target.value; renderSettings(true); } })),
        ...(list.length
          ? list.map((p) => {
              const secret = h('span', { class: 'mono' }, '••••••••');
              return h(
                'div',
                { class: 'list-row' },
                h(
                  'div',
                  { class: 'grow' },
                  h('b', {}, new URL(p.origin).hostname, ...healthTags(p.id), p.hasTotp && h('span', { class: 'tag' }, '2FA')),
                  h('small', {}, p.username || '(no username)'),
                  totpEditor(p),
                ),
                secret,
                h('button', {
                  class: 'btn small',
                  onclick: async (e) => {
                    const password = await vrk.request('passwords:reveal', p.id);
                    if (password == null) return;
                    secret.textContent = password;
                    e.target.textContent = 'Copy';
                    e.target.onclick = () => navigator.clipboard.writeText(password);
                  },
                }, 'Show'),
                h('button', { class: 'btn small', onclick: () => showTotp(p) }, p.hasTotp ? '2FA Code' : 'Add 2FA'),
                h('button', { class: 'btn small danger', onclick: () => vrk.request('passwords:remove', p.id).then(refreshSettings) }, 'Delete'),
              );
            })
          : [h('div', { class: 'empty' }, data.passwords.length ? 'No matches.' : 'No saved passwords yet.')]),
      ),
    ];
  },

  extensions: () => [
    ...header('Extensions', 'Extensions run in normal tabs only, never in Tor tabs.'),
    card(
      'Get extensions',
      h(
        'div',
        { class: 'store-buttons' },
        h('button', { class: 'btn primary', onclick: () => vrk.navigate('https://chromewebstore.google.com/') }, 'Chrome Web Store'),
        h('button', { class: 'btn', onclick: () => vrk.navigate('https://microsoftedge.microsoft.com/addons/') }, 'Edge Add-ons'),
        h('button', { class: 'btn', onclick: () => vrk.navigate('https://addons.mozilla.org/firefox/extensions/') }, 'Firefox Add-ons (experimental)'),
        h('button', { class: 'btn', onclick: () => vrk.request('extensions:install-file').then(refreshSettings) }, 'Add from file…'),
      ),
      h(
        'div',
        { class: 'empty' },
        'Chrome Web Store “Add to Chrome” buttons work in VRK. On Edge and Firefox add-on pages, VRK offers “Add to VRK”. Firefox add-ons are converted automatically; simple ones work, and ones built on Firefox-only features won’t.',
      ),
    ),
    card(
      `Installed (${extensions.length})`,
      ...(extensions.length
        ? extensions.map((ext) =>
            h(
              'div',
              { class: 'list-row' },
              h('span', { class: 'ext-icon' }, (ext.name[0] || '?').toUpperCase()),
              h(
                'div',
                { class: 'grow' },
                h('b', {}, ext.name, ext.delisted && h('span', { class: 'tag bad', title: 'Its store no longer lists it, which often means it was removed for malware or a policy violation.' }, 'Removed from store')),
                h('small', {}, `${ext.version} · ${ext.description}`),
                ext.enabled && siteAccessControl(ext),
              ),
              h('span', { class: 'tag' }, { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', file: 'File' }[ext.source] || ext.source),
              ext.hasOptions && h('button', { class: 'btn small', onclick: () => vrk.request('extensions:options', ext.id) }, 'Options'),
              h(
                'label',
                { class: 'switch', title: ext.enabled ? 'Turn off' : 'Turn on' },
                h('input', { type: 'checkbox', checked: ext.enabled, onchange: (e) => vrk.request('extensions:set-enabled', ext.id, e.target.checked).then(refreshSettings) }),
                h('span'),
              ),
              h('button', { class: 'btn small danger', onclick: () => vrk.request('extensions:remove', ext.id).then(refreshSettings) }, 'Remove'),
            ),
          )
        : [h('div', { class: 'empty' }, state.extensionsReady ? 'No extensions yet.' : 'Loading extensions…')]),
    ),
  ],

  import: () => {
    const choice = browsers?.find((b) => b.id === importChoice?.browserId);
    return [
      ...header('Import', 'Bring your passwords, sign-ins and bookmarks from another browser. Nothing leaves your Mac.'),
      card(
        'From a browser on this Mac',
        browsers?.length
          ? h(
              'div',
              { class: 'import-grid' },
              browsers.map((b) =>
                h(
                  'button',
                  {
                    class: `import-choice ${importChoice?.browserId === b.id ? 'active' : ''}`,
                    onclick: () => {
                      importChoice = { browserId: b.id, profileId: b.profiles[0]?.id, what: { passwords: b.supports.passwords, cookies: b.supports.cookies, bookmarks: true } };
                      importResult = null;
                      renderSettings();
                    },
                  },
                  h('b', {}, b.name),
                  h('small', {}, b.blocked ? 'Needs permission' : b.profiles.length > 1 ? `${b.profiles.length} profiles` : b.profiles[0].name),
                ),
              ),
            )
          : h('div', { class: 'empty' }, browsers ? 'No other browsers found.' : 'Looking for browsers…'),
        choice &&
          (choice.blocked || !choice.profiles.length) &&
          h(
            'div',
            { class: 'import-blocked' },
            h('p', {}, `macOS protects ${choice.name}’s data from other apps, so VRK needs your OK to read it. The easiest way: pick the profile folder yourself, which gives VRK access to just that folder.`),
            choice.id === 'firefox' && h('p', { class: 'hint' }, 'Not sure which one? In Firefox, open about:support and click “Show in Finder” next to Profile Folder.'),
            folderError && h('p', { class: 'err' }, folderError),
            h(
              'div',
              { class: 'te-actions' },
              h('button', { class: 'btn primary', onclick: () => chooseImportFolder(choice) }, 'Choose Profile Folder…'),
              h('button', { class: 'btn', onclick: () => vrk.request('import:privacy-settings') }, 'Open Privacy Settings'),
            ),
          ),
        choice &&
          choice.profiles.length > 0 &&
          h(
            'div',
            { class: 'import-options' },
            choice.profiles.length > 1 &&
              h(
                'select',
                { onchange: (e) => (importChoice.profileId = e.target.value) },
                choice.profiles.map((p) => h('option', { value: p.id, selected: p.id === importChoice.profileId }, p.name)),
              ),
            ...[
              ['passwords', 'Passwords'],
              ['cookies', 'Sign-ins'],
              ['bookmarks', 'Bookmarks'],
            ]
              .filter(([key]) => key === 'bookmarks' || choice.supports[key])
              .map(([key, label]) =>
                h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: importChoice.what[key], onchange: (e) => (importChoice.what[key] = e.target.checked) }), label),
              ),
            h('span', { class: 'bar-spacer' }),
            h('button', { class: 'btn primary', id: 'import-go', onclick: runImport }, `Import from ${choice.name}`),
          ),
        choice &&
          choice.profiles.length > 0 &&
          h('button', { class: 'btn small', onclick: () => chooseImportFolder(choice) }, 'Choose a Different Profile Folder…'),
        choice &&
          choice.profiles.length > 0 &&
          !['firefox', 'safari'].includes(choice.id) &&
          h('div', { class: 'empty' }, `${choice.name} keeps passwords and sign-ins encrypted with your Keychain, so macOS will ask you to allow VRK to read “${choice.name} Safe Storage”. Sign-ins import only sites you’re actually signed in to, and VRK keeps you signed in to them.`),
        importResult && importResultView(importResult),
      ),
      card(
        'From a file',
        row('Password CSV or bookmarks HTML', 'Exports from any browser, Safari’s Passwords app, Bitwarden or 1Password.', h('button', { class: 'btn', onclick: importFile }, 'Choose File…')),
      ),
    ];
  },

  network: () => [
    ...header('Tor & VPN'),
    card(
      'Encrypted DNS',
      row(
        'DNS provider',
        'Looks up sites over encrypted DNS (never unencrypted). Quad9, Cloudflare and Mullvad also block known malware domains; AdGuard and Mullvad block ads.',
        select('dnsProvider', { quad9: 'Quad9', cloudflare: 'Cloudflare', mullvad: 'Mullvad', adguard: 'AdGuard', nextdns: 'NextDNS', custom: 'Custom' }),
      ),
      data.settings.dnsProvider === 'nextdns' && row('NextDNS ID', 'From my.nextdns.io, like “abc123”.', textSetting('nextdnsId', 'abc123')),
      data.settings.dnsProvider === 'custom' && row('DNS-over-HTTPS address', 'An https:// address, like https://dns.example/dns-query.', textSetting('dnsCustomUrl', 'https://…')),
      row('Encrypted Client Hello', 'On: where sites support it, your network can’t see which site you’re visiting, only that you use HTTPS.', h('span', { class: 'pill ok' }, '✓ On')),
    ),
    card(
      'Tor',
      row(
        'Bridges',
        'Use one if your network blocks Tor. Snowflake works almost everywhere.',
        select('torBridge', { none: 'None (connect directly)', snowflake: 'Snowflake', obfs4: 'obfs4', meek: 'meek (Azure CDN)' }),
      ),
      row(
        'Separate circuit per site',
        'Connections to different sites never share a Tor circuit, so one exit relay can’t link what you do on different sites. Pages may load a little slower.',
        toggle('torIsolateSites'),
      ),
      row(
        'Security level',
        'As in Tor Browser. Safer turns off JavaScript on sites without HTTPS, and WebGL. Safest turns off JavaScript everywhere (many sites won’t work).',
        select('torSecurity', { standard: 'Standard', safer: 'Safer', safest: 'Safest' }),
      ),
      row('New Tor tab', 'Press ⇧⌘N anytime. Tor tabs are letterboxed and report UTC time, like Tor Browser.', h('button', { class: 'btn', onclick: () => vrk.newTab(true) }, 'Open Tor Tab')),
    ),
    card(
      'VPN',
      row(
        'WireGuard VPN',
        'Bring a WireGuard config from any provider (Proton VPN has a free plan). The kill switch blocks traffic whenever the VPN is down.',
        h('button', { class: 'btn', onclick: (e) => { const r = e.target.getBoundingClientRect(); vrk.menu('vpn', r.left, r.bottom + 4); } }, 'VPN Menu…'),
      ),
    ),
  ],

  about: () => [
    ...header('About VRK'),
    card(
      null,
      row('VRK', `Version ${data.versions.app}`, h('button', { class: 'btn', onclick: () => vrk.openInternal('features') }, 'All Features & Comparison')),
      row('Engine', `Chromium ${data.versions.chromium} · Electron ${data.versions.electron}`, h('span')),
      row(
        'Filter lists',
        `Updated ${data.listsUpdatedAt ? new Date(data.listsUpdatedAt).toLocaleString() : 'never'}. They refresh daily.`,
        h('button', { class: 'btn', onclick: (e) => { e.target.disabled = true; e.target.textContent = 'Updating…'; vrk.request('settings:update-lists').finally(refreshSettings); } }, 'Update Now'),
      ),
      row(
        'Your data',
        `Settings, encrypted passwords, bookmarks, extensions${data.persistentProfile ? ' and kept sign-ins' : ''} live in ~/Library/Application Support/${data.configDir}. VRK keeps no history.`,
        h('span'),
      ),
    ),
    card('Open source', h('div', { class: 'empty' }, 'Built on Chromium (BSD), Electron (MIT), Ghostery’s adblocker (MPL-2.0), Tor (BSD), wireproxy (ISC) and electron-chrome-extensions (GPL-3.0).')),
  ],
};

function themeSwatch(theme) {
  if (theme.classic) return 'linear-gradient(135deg, #171920, #8b7bff 60%, #2ee6c4)';
  const b = theme.background;
  if (b.type === 'image' && b.media) return `center / cover url("${VRKTheme.mediaUrl(b.media)}")`;
  if (b.type === 'gradient') return `linear-gradient(${b.gradient.angle}deg, ${b.gradient.stops.join(', ')})`;
  if (b.type === 'keyframes') return `linear-gradient(${b.keyframes.frames[0].angle}deg, ${b.keyframes.frames[0].colors.join(', ')})`;
  return `linear-gradient(135deg, ${theme.colors.bg} 40%, ${theme.colors.accent})`;
}

// One click: pick an image or video and make it your background (as a new theme).
async function useMediaBackground() {
  const media = await vrk.request('themes:choose-media').catch((err) => {
    showNotice({ text: err.message });
    return null;
  });
  if (!media) return;
  const list = themeList || (await vrk.request('themes:list'));
  const current = list.themes.find((t) => t.id === list.activeId);
  const template = current && !current.classic ? current : list.themes.find((t) => t.id === 'midnight-aurora');
  const theme = JSON.parse(JSON.stringify(template));
  if (current?.builtIn || current?.classic || !current) {
    theme.id = crypto.randomUUID();
    theme.name = 'My background';
    if (current?.classic) theme.colors.accent = ACCENTS[data.settings.accent] || theme.colors.accent;
  }
  delete theme.builtIn;
  theme.glass = Math.max(theme.glass, 0.35);
  Object.assign(theme.background, { type: media.kind, media: media.name, fit: 'cover', dim: 0.3, blur: 0 });
  theme.background.effect.kind = 'none';
  const saved = await vrk.request('themes:save', theme);
  await vrk.request('themes:apply', saved.id);
  refreshSettings();
}

async function runImport() {
  const button = document.getElementById('import-go');
  button.disabled = true;
  button.textContent = 'Importing…';
  importResult = await vrk.request('import:browser', importChoice).catch((err) => ({ passwords: 0, sites: 0, bookmarks: 0, errors: [err.message] }));
  refreshSettings();
}

async function importFile() {
  const result = await vrk.request('import:file');
  if (result) {
    importResult = result;
    refreshSettings();
  }
}

async function forgetSignIns() {
  await vrk.request('settings:forget-sign-ins');
  refreshSettings();
}

function importResultView(result) {
  const parts = [];
  if (result.passwords) parts.push(`${result.passwords} password${result.passwords === 1 ? '' : 's'}`);
  if (result.sites) parts.push(`sign-ins for ${result.sites} site${result.sites === 1 ? '' : 's'}`);
  if (result.bookmarks) parts.push(`${result.bookmarks} bookmark${result.bookmarks === 1 ? '' : 's'}`);
  return h(
    'div',
    { class: 'result' },
    h('b', {}, parts.length ? `Imported ${parts.join(', ')}.` : 'Nothing new to import.'),
    ...result.errors.map((err) => h('div', { class: 'err' }, err)),
  );
}

function renderSettings(keepFocus = false) {
  if (!data) return;
  for (const button of document.querySelectorAll('.settings-nav button')) button.classList.toggle('active', button.dataset.section === section);
  document.getElementById('restart-banner').hidden = !data.pendingRestart.length;
  const content = document.getElementById('settings-content');
  const focused = keepFocus && document.activeElement?.classList.contains('search-box');
  content.replaceChildren(...views[section]());
  if (focused) {
    const box = content.querySelector('.search-box');
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
}

for (const button of document.querySelectorAll('.settings-nav button')) {
  button.addEventListener('click', () => {
    section = button.dataset.section;
    importResult = null;
    refreshSettings();
  });
}
document.getElementById('restart-now').addEventListener('click', () => vrk.request('settings:restart'));

Object.assign(window, { openSettingsPage, settingsGoTo, refreshSettings });
if (!document.getElementById('settingspanel').hidden) refreshSettings();
})();
