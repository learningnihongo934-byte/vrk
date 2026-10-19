'use strict';
// The Features page (vrk://features): everything VRK does, in detail, and a
// side-by-side comparison with other browsers. Loaded after app.js.

(() => {
  const root = document.getElementById('featurespanel');
  const h = (tag, props = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
    }
    el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
    return el;
  };

  // ── Comparison ──────────────────────────────────────────────────────────
  // Built-in features with default settings, to the best of our knowledge as
  // of mid-2026, without extensions. "y" yes, "p" partly, "n" no, "?" not
  // confirmed. Text after ":" explains the cell.

  const BROWSERS = ['VRK', 'Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung Internet', 'Opera', 'Brave', 'Vivaldi', 'Tor Browser', 'UC Browser'];

  const COMPARISON = [
    {
      group: 'Security',
      rows: [
        ['Automatic security updates', 'y:Rebuilds and tests itself; Electron gets Chrome’s fixes a few days after Chrome', 'y', 'y:With macOS updates', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'p:Has often run an outdated engine'],
        ['Warns about phishing & malware sites', 'y:Open lists checked on your Mac; nothing about your browsing is sent', 'y:Google Safe Browsing', 'y', 'y:Microsoft SmartScreen', 'y', 'y', 'y', 'y', 'y', 'n:Off, for anonymity', '?'],
        ['Warns about lookalike sites (paypa1.com)', 'y:Offers the real site', 'y', 'p:Shows the real address only', 'y:Website typo protection', 'p:Shows the real address only', '?', '?', '?', '?', 'p:Shows the real address only', '?'],
        ['Warns about “paste into Terminal” scams', 'y:When a site copies a Terminal command', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n'],
        ['Download protection', 'y:macOS quarantine + newest-malware list', 'y', 'y', 'y', 'y', '?', 'y', 'y', 'y', 'p:No malware scan', '?'],
        ['Lockdown mode (JavaScript JIT off)', 'y:Plus no WebAssembly, WebGL, WebGPU or web fonts', 'p:Per-site “V8 optimizer” setting', 'y:macOS Lockdown Mode', 'y:Enhanced security mode', 'n:Hidden settings only', 'n', 'p:Per-site setting from Chromium', 'p:Per-site setting from Chromium', 'p:Per-site setting from Chromium', 'y:“Safest” level', 'n'],
        ['App lock with Touch ID', 'y:Locks everything, including tab titles and history', 'n', 'p:Locks private windows only', 'n', 'n', 'y:Secret mode lock', 'n', 'n', 'n', 'n', '?'],
        ['HTTPS-only connections', 'y:Asks before any unencrypted page', 'p:An option', 'p:Upgrades when it can', 'p:An option', 'p:HTTPS-First; HTTPS-Only is an option', '?', 'p', 'p:Upgrades by default; strict is an option', 'p', 'y', '?'],
        ['Warns when HTTPS is being inspected', 'y:School/work filters, monitoring software', 'n', 'n', 'n', 'p:Mentioned in the site info panel', 'n', 'n', 'n', 'n', 'y:Refuses such connections', 'n'],
        ['Control which sites extensions can touch', 'y:Banks protected by default', 'y', 'y', 'y', 'y', '?', 'y', 'y', 'y', 'n', 'n'],
        ['Outside security audits & bug bounty', 'n:Not yet', 'y', 'y', 'y', 'y', 'y', 'y', 'y', '?', 'y:Independent audits', 'n:Known past security problems'],
      ],
    },
    {
      group: 'Privacy',
      rows: [
        ['Ad blocking built in', 'y:EasyList, uBlock lists + 190,000 ad & telemetry servers', 'n', 'n', 'n', 'n', 'p:Through add-on blockers', 'y', 'y', 'y', 'n', 'y'],
        ['Blocks trackers', 'y', 'p:Limited', 'y:Intelligent Tracking Prevention', 'y:Tracking prevention', 'y:Enhanced Tracking Protection', 'y:Smart anti-tracking', 'y', 'y', 'y', 'y', '?'],
        ['Fingerprint protection', 'y:Randomized per site, like Brave', 'n', 'y:Advanced Fingerprinting Protection', 'p:Strict mode', 'p:Blocks known fingerprinters', '?', 'n', 'y:Randomized per site', 'p:Blocks known scripts', 'y:Everyone looks the same (the strongest)', 'n'],
        ['Third-party cookies blocked', 'y', 'n:Allowed by default', 'y', 'p:Trackers’ cookies only', 'y:Kept separate per site', '?', '?', 'y', '?', 'y', '?'],
        ['Cleans tracking links (utm_, fbclid…)', 'y', 'n', 'p:In Private Browsing', 'n', 'p:Strict mode', '?', 'n', 'y', 'n', 'p', 'n'],
        ['Skips click-tracking redirects', 'y:google.com/url, l.facebook.com, affiliate links…', 'n', 'n', 'n', 'p:Clears bounce trackers’ data', 'n', 'n', 'y:“Debouncing”', 'n', 'n', 'n'],
        ['Rejects cookie banners', 'y:Clicks “Reject all” for you', 'n', 'n', 'n', 'p:In some regions', 'n', 'p:Hides or accepts them', 'p:Hides them', 'p:Hides them', 'n', '?'],
        ['Global Privacy Control', 'y', 'n', 'n', 'n', 'p:An option', 'n', 'n', 'y', 'n', '?', 'n'],
        ['Separate identities in tabs (containers)', 'y:Container tabs, each with its own fingerprint', 'p:Profiles in separate windows', 'p:Profiles', 'p:Profiles', 'p:Mozilla’s add-on', 'n', '?', 'p:Profiles', 'p:Profiles', 'p:New Identity', 'n'],
        ['Forget sites when you close them', 'y', 'p:A per-site setting', 'n', 'p:A per-site setting', 'p:A per-site setting', 'n', 'p:A per-site setting', 'y:“Forget me when I close this site”', 'p:A per-site setting', 'y:Forgets everything', 'n'],
        ['History encrypted on disk', 'y:Each entry, with a Keychain key', 'n', 'p:Protected by macOS permissions', 'n', 'n', 'n', 'n', 'n', 'n', 'y:Keeps no history', 'n'],
      ],
    },
    {
      group: 'Network & anonymity',
      rows: [
        ['VPN built in', 'y:Your own WireGuard (Proton’s free plan works), with a kill switch', 'n', 'p:iCloud Private Relay (paid)', 'n', 'p:Mozilla VPN (paid, separate app)', '?', 'y:Free browser VPN', 'p:Brave VPN (paid)', 'y:Proton VPN built in', 'p:Uses Tor instead', 'n'],
        ['Tor built in', 'y:Tor tabs with bridges, per-site circuits, letterboxing', 'n', 'n', 'n', 'n', 'n', 'n', 'p:Private window with Tor', 'n', 'y:The gold standard for anonymity', 'n'],
        ['Encrypted DNS', 'y:Always; Quad9, Cloudflare, Mullvad, AdGuard or NextDNS', 'y:When your provider supports it', 'p:With Private Relay', 'y', 'y', '?', 'y', 'y', 'y', 'y:Through Tor', '?'],
      ],
    },
    {
      group: 'Passwords & accounts',
      rows: [
        ['Password manager', 'y:Keychain-encrypted; Touch ID to view', 'y', 'y', 'y', 'y', 'y:Samsung Pass', 'y', 'y', 'y', 'n:Off by default', 'p'],
        ['Passkeys', 'y:Unlocked with Touch ID, kept on this Mac', 'y', 'y', 'y', 'y', 'y', '?', 'y', '?', 'n', 'n'],
        ['Breach alerts', 'y:Have I Been Pwned, privately (k-anonymity)', 'y', 'y', 'y', 'y', '?', '?', '?', '?', 'n', 'n'],
        ['2FA codes built in', 'y:Scans the QR code, fills the code', 'n', 'y:Passwords app', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n'],
        ['Encrypted password backups', 'y:A passphrase-locked file', 'p:Plain-text export', 'p:Plain-text export', 'p:Plain-text export', 'p:Plain-text export', '?', 'p:Plain-text export', 'p:Plain-text export', 'p:Plain-text export', 'n', 'n'],
      ],
    },
    {
      group: 'Everyday',
      rows: [
        ['Chrome Web Store extensions', 'y:Most work; Edge and (experimental) Firefox add-ons too', 'y', 'n', 'y', 'n', 'n', 'y', 'y', 'y', 'n', 'n'],
        ['Import from other browsers', 'y:Passwords, sign-ins, bookmarks', 'y', 'y', 'y', 'y', '?', 'y', 'y', 'y', 'n', '?'],
        ['Custom themes', 'y:Theme editor, image & video backgrounds, animated effects', 'p:Colors and a background image', 'p:Start page background', 'p:Themes', 'p:Themes', 'p', 'y:Themes and live wallpapers', 'p', 'y:Theme editor', 'n', 'p'],
        ['A desktop mode with apps', 'y:VRKOS: Files, Terminal, Notes, System Monitor, Mac & Windows apps', 'n', 'n', 'n', 'n', 'n', 'p:Sidebar apps only', 'n', 'p:Built-in notes, mail and calendar', 'n', 'n'],
        ['Sync across devices', 'n:By design: nothing leaves this Mac', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'n', 'y'],
        ['On phones', 'n:Mac only', 'y', 'y:iPhone and iPad', 'y', 'y', 'y:Android (no Mac version)', 'y', 'y', 'y', 'y:Android', 'y:Phones (no Mac version)'],
      ],
    },
  ];

  const MARK = { y: '✓', p: '◐', n: '✕', '?': '?' };
  const WORD = { y: 'Yes', p: 'Partly', n: 'No', '?': 'Not confirmed' };

  function cell(value, isVrk) {
    const [mark, ...rest] = value.split(':');
    const note = rest.join(':');
    return h(
      'td',
      { class: `fc ${mark === '?' ? 'q' : mark}${isVrk ? ' vrk' : ''}`, title: note ? `${WORD[mark]}: ${note}` : WORD[mark] },
      h('span', { class: 'fm', 'aria-label': WORD[mark] }, MARK[mark]),
      isVrk && note && h('small', {}, note),
    );
  }

  function comparison() {
    const vrkYes = COMPARISON.flatMap((g) => g.rows).filter((r) => r[1].startsWith('y')).length;
    const total = COMPARISON.flatMap((g) => g.rows).length;
    return h(
      'section',
      { class: 'f-section', id: 'f-compare' },
      h('h2', {}, 'VRK compared'),
      h(
        'p',
        { class: 'f-lead' },
        `VRK has ${vrkYes} of these ${total} out of the box. Hover over a mark for details. Based on each browser’s built-in features and default settings as of mid-2026, without extensions; browsers change often, and “?” means we couldn’t confirm it. Samsung Internet and UC Browser have no Mac version.`,
      ),
      h(
        'div',
        { class: 'f-legend' },
        Object.entries(MARK).map(([k, m]) => h('span', { class: `fc ${k === '?' ? 'q' : k}` }, h('span', { class: 'fm' }, m), ` ${WORD[k]}`)),
      ),
      h(
        'div',
        { class: 'f-table-wrap' },
        h(
          'table',
          { class: 'f-table' },
          h('thead', {}, h('tr', {}, h('th', { class: 'f-feature' }, 'Feature'), BROWSERS.map((b, i) => h('th', { class: i === 0 ? 'vrk' : '' }, b)))),
          COMPARISON.map((g) =>
            h(
              'tbody',
              {},
              h('tr', { class: 'f-group' }, h('th', { colspan: BROWSERS.length + 1 }, g.group)),
              g.rows.map(([feature, ...cells]) => h('tr', {}, h('th', { class: 'f-feature', scope: 'row' }, feature), cells.map((c, i) => cell(c, i === 0)))),
            ),
          ),
        ),
      ),
    );
  }

  // ── Everything VRK does ─────────────────────────────────────────────────
  // [name, what it does, where to find it]

  const DETAILS = [
    {
      title: 'Blocking & safety',
      items: [
        ['Ad & tracker blocking', 'Ghostery’s engine with EasyList, EasyPrivacy, uBlock Origin’s lists, annoyance and cookie-banner lists (including hiding leftover ad boxes), plus HaGeZi’s list of about 190,000 ad, tracking and phone-maker telemetry servers. Scores 98% on adblock.turtlecute.org, 100% with Aggressive blocking.', 'Settings → Privacy & security'],
        ['Aggressive blocking', 'Also blocks the decoy “ads” that “turn off your ad blocker” checks look for. Off by default, because it makes those walls more likely.', 'Settings → Privacy & security'],
        ['Dangerous-site warnings', 'About 75,000 known phishing and malware sites (OpenPhish, PhishTank, IPThreat, abuse.ch URLhaus), refreshed every 12 hours and checked on your Mac, so nobody learns where you browse. A red page lets you go back or, if you insist, continue.', 'Settings → Privacy & security'],
        ['Lookalike-site warnings', 'Catches sites dressed up as popular ones: swapped look-alike characters (paypa1, rnicrosoft), other alphabets (аpple with a Cyrillic а), typos (amazom) and brand names glued to sign-in words (apple-id-verify). Offers to take you to the real site.', 'Settings → Privacy & security'],
        ['“Paste into Terminal” scam warning', 'Fake “verify you’re human” pages copy a malware command and ask you to paste it into Terminal; it’s how most Mac malware spreads now. VRK warns the moment a site copies a Terminal command, with a button to clear the clipboard.', 'Settings → Privacy & security'],
        ['Download protection', 'Every download gets macOS’s quarantine flag, so Gatekeeper and XProtect check apps and installers before they run. Files matching newly found malware (abuse.ch MalwareBazaar, checked on your Mac) are deleted, and installers and scripts are never downloaded over plain HTTP.', 'Settings → Privacy & security → Downloads'],
        ['HTTPS-only', 'Every site is upgraded to an encrypted connection; VRK asks before loading one that can’t be encrypted.', 'Settings → Privacy & security'],
        ['HTTPS inspection warning', 'Notices when a school or work network filter, or software on your Mac, is decrypting your HTTPS traffic with its own certificate, and tells you who.', 'Settings → Security'],
        ['Password reuse alerts', 'Typing a saved password into a different site triggers a warning: that’s often a phishing page.', 'Settings → Passwords'],
        ['Extension safety check', 'Once a day VRK asks each store whether your extensions are still listed. One that was taken down (often for malware) is turned off.', 'Settings → Extensions'],
      ],
    },
    {
      title: 'Privacy',
      items: [
        ['Fingerprint randomizing', 'Canvas, WebGL and audio readings get tiny per-site changes and the CPU core count varies per site, so sites can’t recognize your device across the web. Consistent within a site and its iframes; hidden from tamper checks.', 'Settings → Privacy & security'],
        ['Third-party cookies blocked', 'Both inside Chromium and on the network, so embedded trackers can’t follow you from site to site.', 'Settings → Privacy & security'],
        ['Clean links', 'Tracking tags (utm_, fbclid, gclid…) are removed, links that pass through click trackers go straight to where they lead, and other sites only learn which site you came from, not the page.', 'Settings → Privacy & security'],
        ['Cookie banners rejected', 'VRK clicks “Reject all” on cookie banners from the big consent platforms and obvious ones elsewhere, instead of just hiding them.', 'Settings → Privacy & security'],
        ['Global Privacy Control', 'Tells sites not to sell or share your data; legally binding in some places.', 'Settings → Privacy & security'],
        ['Browsing modes', 'Standard keeps encrypted history and your sign-ins. Private records nothing and erases everything except chosen sign-ins when you quit. Memory-only writes nothing to disk at all.', 'Settings → Privacy & security'],
        ['Encrypted history', 'Every history entry is encrypted (AES-256-GCM) with a key in your Mac’s Keychain. Search it, delete entries, or clear the last hour, day or week (⌘Y).', 'History (⌘Y)'],
        ['Container tabs', 'School, Shopping, or any you make: each has its own cookies, sign-ins and fingerprint, so sites can’t connect them, and you can use two accounts at once. Right-click + or a link.', 'Settings → General'],
        ['Forget sites on close', 'Optionally erase a site’s cookies and storage when you close its last tab.', 'Settings → Privacy & security'],
        ['Burn', 'One click (🔥, ⇧⌘⌫) erases history, cookies, storage and cache, closes every tab and gives sites a new fingerprint.', 'Toolbar'],
        ['Quiet permissions', 'Camera, microphone and location are asked per site and last only until you quit; notification requests are refused unless you choose otherwise.', 'Settings → Privacy & security'],
      ],
    },
    {
      title: 'VRK itself, locked down',
      items: [
        ['Sandboxed, isolated tabs', 'Chromium’s sandbox and site isolation, context isolation, and VRK’s protections in every iframe. Web pages can’t reach VRK’s own pages, your files, Node.js or VRK’s private controls (all tested).', '—'],
        ['Lockdown mode', 'Like Safari’s: no JavaScript speed-up compiler (the target of most browser exploits), no WebAssembly, WebGL, WebGPU or web fonts.', 'Settings → Security'],
        ['App lock', 'Touch ID when VRK opens, after your Mac sleeps or locks, and after you’ve been away. Pages, tab titles and history stay hidden until you unlock.', 'Settings → Security'],
        ['JavaScript per site', 'Turn scripts off for a site from the shield menu, or block them everywhere except sites you allow (like NoScript).', 'Shield menu, Settings → Security'],
        ['Extension site access', 'Extensions never read or change protected sites (banks and money apps to start), and you can limit any extension to sites you choose.', 'Settings → Extensions, Settings → Security'],
        ['Hardened engine', 'Electron’s fuses hardened, remote debugging refused, Privacy Sandbox ad APIs off, WebRTC can’t leak your IP, shipped code with no known vulnerabilities.', '—'],
        ['Automatic security updates', 'VRK checks for new Electron/Chromium releases every few hours, rebuilds itself, runs its 100+ check self-test, and installs only if everything passes.', 'Settings → General'],
      ],
    },
    {
      title: 'Network & anonymity',
      items: [
        ['Tor tabs', 'Its own Tor client, a separate circuit per site, bridges (Snowflake, obfs4, meek) for networks that block Tor, onion search, letterboxing, UTC time and Tor Browser’s security levels (Safer, Safest). New Tor Identity in one click.', 'Toolbar onion button, ⇧⌘N'],
        ['Built-in VPN', 'WireGuard with any provider’s config (Proton VPN has a free plan), and a kill switch that stops all traffic if the VPN drops. Container tabs, updates and Tor go through it too.', 'Toolbar VPN button'],
        ['Encrypted DNS', 'Always DNS over HTTPS, never unencrypted: Quad9, Cloudflare, Mullvad, AdGuard, NextDNS or your own.', 'Settings → Tor & VPN'],
        ['Encrypted Client Hello', 'Where sites support it, your network can’t even see which site you’re visiting.', 'Always on'],
      ],
    },
    {
      title: 'Passwords & accounts',
      items: [
        ['Password manager', 'Saves logins when you sign in and fills them only when you pick one, only on the site they belong to. Encrypted with your Keychain; showing one needs Touch ID.', 'Settings → Passwords'],
        ['Passkeys', 'Sign in without a password on sites that support passkeys, unlocked with Touch ID. Standard WebAuthn, verified against a real server library.', 'Settings → Passwords'],
        ['Strong passwords', 'Sign-up forms get a suggested password like kX7qz-mP3wd-R9tLc-v2NhJ, filled into both fields.', 'Automatic'],
        ['Breach alerts & password health', 'Checks passwords against Have I Been Pwned without revealing them, and finds breached, reused and weak ones.', 'Settings → Passwords'],
        ['2FA codes', 'Scan a site’s 2FA QR code and VRK fills the 6-digit code for you, even into split digit boxes.', 'Settings → Passwords'],
        ['Encrypted backup', 'Passwords (with 2FA), passkeys and bookmarks in one passphrase-locked file (scrypt + AES-256-GCM).', 'Settings → Passwords'],
        ['Import', 'Passwords, sign-ins and bookmarks from Chrome, Edge, Brave, Opera, Vivaldi, Arc, Firefox and Safari, or from CSV and HTML files.', 'Settings → Import'],
      ],
    },
    {
      title: 'Everyday',
      items: [
        ['Extensions from three stores', 'Chrome Web Store, Microsoft Edge Add-ons and (experimental) Firefox Add-ons, with signatures checked.', 'Settings → Extensions'],
        ['Google sign-in works', 'VRK presents a consistent Chrome identity, so Google and other sites accept it.', '—'],
        ['Smart address bar', 'Suggestions from your history and bookmarks, inline completion, and your choice of search engine.', 'Settings → Search & new tab'],
        ['Themes', 'Nine built-in themes and a full editor: colors, gradients, keyframe animations, image and video backgrounds, ten animated effects, glass toolbar, fonts and your own CSS.', 'Settings → Appearance'],
        ['Opening animation', 'A two-second intro you can replay or turn off.', 'Settings → Appearance'],
        ['Default browser', 'Make VRK open the links you click in other apps.', 'Settings → General'],
        ['Bookmarks', 'Bookmarks bar, folders and new-tab tiles; encrypted with your Keychain.', '⌘D, ⇧⌘B'],
      ],
    },
    {
      title: 'VRKOS',
      items: [
        ['A desktop inside VRK', 'A real full-screen desktop: macOS’s Dock and menu bar hide and ⌘Tab is off until you leave. Menu bar with sound, Wi-Fi, battery and calendar menus, a dock, Launchpad search and your Desktop files; your VRK theme is the wallpaper. Runs on your Mac’s own hardware.', 'VRK menu → VRKOS Desktop (⌥⌘O)'],
        ['VRK Browser built in', 'VRK Browser is VRKOS’s browser: a window on the desktop, and web links from every VRKOS app open in it.', 'Dock'],
        ['Files', 'Browse, search, rename, copy, move and preview (images, video, audio); deleting moves to the Trash.', 'Dock → Files'],
        ['Terminal', 'Your real shell (zsh) with full colors and several sessions.', 'Dock → Terminal'],
        ['Notes, Text Editor & Calendar', 'Notes and events encrypted with your Keychain; an editor with line numbers and auto-indent.', 'Dock'],
        ['System Monitor', 'Your Mac’s real chip, cores, memory, disk, battery, network and processes.', 'Dock → System Monitor'],
        ['Mac apps', 'Launch any app on your Mac onto the VRKOS desktop; running apps show in the VRKOS dock to switch, hide or quit. Or show a live mirror of an app’s window.', 'Dock → Mac Apps'],
        ['All your files', 'With Full Disk Access turned on for VRK, Files, Terminal and every VRKOS app can open anything on this Mac.', 'VRKOS menu → Privacy & File Access'],
        ['Windows apps', 'Run Windows programs and installers (.exe, .msi) through Wine, in VRK’s own C: drive.', 'Dock → Windows Apps'],
        ['Locked with VRK', 'App lock covers VRKOS too: windows hide and files stay off-limits until Touch ID.', 'Settings → Security'],
      ],
    },
  ];

  const LIMITS = [
    'No outside security audit or bug bounty yet: VRK is tested by its own 168-check self-test, not by a security firm.',
    'Signed only for this Mac. That’s fine here; sharing VRK with others would need an Apple Developer ID and notarization.',
    'Electron ships Chromium’s security fixes a few days after Chrome does. VRK updates itself as soon as they’re out.',
    'Tor tabs are not Tor Browser. For anonymity your safety depends on, use Tor Browser.',
    'The dangerous-site lists catch fewer brand-new scam sites than Google Safe Browsing, in exchange for never reporting where you browse.',
    'Extension support covers the common Chrome APIs; some extensions only partly work (Dark Reader, for example, doesn’t theme pages yet).',
    'No sync and no phone version: everything stays on this Mac.',
    'VRKOS mirrors Mac app windows as a live view; to click and type in one, use “Bring to Front”.',
    'Windows programs run through Wine: many work, but games with anti-cheat, drivers and some installers don’t.',
  ];

  function details() {
    return DETAILS.map((section, i) =>
      h(
        'section',
        { class: 'f-section', id: `f-${i}` },
        h('h2', {}, section.title),
        h(
          'div',
          { class: 'f-grid' },
          section.items.map(([name, what, where]) =>
            h('article', { class: 'f-card' }, h('h3', {}, name), h('p', {}, what), where !== '—' && h('small', {}, where)),
          ),
        ),
      ),
    );
  }

  function render() {
    const count = DETAILS.reduce((n, s) => n + s.items.length, 0);
    root.replaceChildren(
      h(
        'div',
        { class: 'f-page' },
        h(
          'header',
          { class: 'f-hero' },
          h('h1', {}, 'Everything VRK does'),
          h('p', {}, `${count} features for security, privacy and everyday browsing, and how VRK compares with ten other browsers.`),
          h(
            'nav',
            { class: 'f-nav' },
            h('a', { href: '#f-compare' }, 'Comparison'),
            DETAILS.map((s, i) => h('a', { href: `#f-${i}` }, s.title)),
            h('a', { href: '#f-limits' }, 'Limits'),
          ),
        ),
        comparison(),
        details(),
        h('section', { class: 'f-section', id: 'f-limits' }, h('h2', {}, 'What VRK doesn’t do (yet)'), h('ul', { class: 'f-limits' }, LIMITS.map((text) => h('li', {}, text)))),
      ),
    );
    root.querySelectorAll('.f-nav a').forEach((a) =>
      a.addEventListener('click', (event) => {
        event.preventDefault();
        root.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
    );
  }

  window.VRKFeatures = {
    open() {
      if (!root.firstChild) render();
      document.getElementById('page').scrollTop = 0;
    },
  };
})();
