'use strict';
// VRK's privacy core. Every browsing profile (normal and Tor) gets a Chromium
// session with ad/tracker blocking, dangerous-site blocking, HTTPS-only upgrades, tracking-parameter
// stripping, third-party cookie blocking, Global Privacy Control, a consistent
// Chrome identity and deny-by-default permissions. A profile also has a
// "gate": while it is set, every request is cancelled, which is how the Tor
// and VPN kill switches fail closed.

const { session, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { getDomain } = require('tldts');
const { ElectronBlocker, Request } = require('@ghostery/adblocker-electron');
const { USER_AGENT, applyClientHints, parseAcceptCH } = require('./identity');
const { HostBlocklist } = require('./hostlists');
const { Safety } = require('./safety');
const { MalwareHashes } = require('./downloads');
const { lookalikeOf } = require('./lookalike');
const { skipRedirect } = require('./redirects');

const COSMETIC_PRELOAD = require.resolve('@ghostery/adblocker-electron-preload');
const CONTENT_PRELOAD = path.join(__dirname, 'content-preload.js');
const ACCEPT_LANGUAGES = 'en-US,en';

// Nothing listens on the discard port, so a session pointed here can't connect anywhere.
const DEAD_PROXY = 'socks5://127.0.0.1:9';

const ALL_URLS = { urls: ['<all_urls>'] };
const LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'li_fat_id', 'igshid', 'igsh', 'mc_cid', 'mc_eid', 'mkt_tok', '_hsenc', '_hsmi', '__hssc', '__hstc',
  '__hsfp', 'hsctatracking', 'oly_anon_id', 'oly_enc_id', 'vero_conv', 'vero_id', 'wickedid',
  'rb_clickid', 's_cid', '_openstat', 'srsltid', 'epik', 'ref_src', 'ref_url',
]);
const TRACKING_PREFIXES = ['utm_', 'mtm_', 'matomo_'];

const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const ASKABLE = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal']);
// Tor tabs never get hardware that could reveal who or where you are.
const TOR_DENIED = new Set(['media', 'geolocation', 'notifications', 'midi']);

const SITE_DATA_TYPES = ['backgroundFetch', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'];

// Aggressive blocking also stops the decoy scripts anti-adblock checks load.
const BAIT_SCRIPT = /\/(ads|pagead|advertisement|adframe|ad-provider|prebid)\.js$/i;

function parseURL(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function siteOfHost(hostname) {
  const host = String(hostname || '').replace(/^\./, '');
  return host ? getDomain(host) || host : null;
}

function siteOf(url) {
  return siteOfHost(parseURL(url)?.hostname);
}

function originOf(url) {
  const u = parseURL(url);
  return u && u.origin !== 'null' ? u.origin : null;
}

function isLocalHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h)
  );
}

const isOnion = (hostname) => hostname.endsWith('.onion');

function stripTrackingParams(u) {
  if (!u.search) return false;
  const parts = u.search.slice(1).split('&');
  const kept = parts.filter((part) => {
    let key = part.split('=')[0];
    try {
      key = decodeURIComponent(key);
    } catch {}
    key = key.toLowerCase();
    return !TRACKING_PARAMS.has(key) && !TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix));
  });
  if (kept.length === parts.length) return false;
  u.search = kept.length ? `?${kept.join('&')}` : '';
  return true;
}

function headerValue(headers, name) {
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value.join(', ') : value;
  }
  return null;
}

function deleteHeader(headers, name) {
  for (const key of Object.keys(headers)) if (key.toLowerCase() === name) delete headers[key];
}

function topUrlOf(details) {
  try {
    return details.webContents?.getURL() || '';
  } catch {
    return '';
  }
}

class Shield extends EventEmitter {
  constructor({ configDir, assetsDir, settings }) {
    super();
    this.configDir = configDir;
    this.assetsDir = assetsDir;
    this.settings = settings;
    this.shieldsDown = new Set(); // sites the user turned blocking off for (memory only)
    this.pendingUpgrade = new Map(); // webContents id -> { host, httpUrl } for the HTTPS-only fallback
    this.acceptCH = new Map(); // origin -> high-entropy client hints it asked for (memory only)
    this.totalBlocked = 0;
    this.askPermission = async () => false; // replaced by the browser UI
    this.updateSession = session.fromPartition('vrk-updates');
    this.updateSession.setUserAgent(USER_AGENT, ACCEPT_LANGUAGES);
    this.blocker = this.loadBlocker();
    this.watchBlocker(this.blocker);
    this.hostlist = new HostBlocklist({ configDir, assetsDir });
    this.safety = new Safety({ configDir, assetsDir });
    this.malware = new MalwareHashes({ configDir });
    this.pendingThreat = new Map(); // webContents id -> { url, kind, target? } of a blocked dangerous page
    this.isFamiliarSite = () => false; // replaced by the browser (history): sites you've used before aren't lookalikes
    this.registerCosmeticIpc();
  }

  get blocking() {
    return this.settings.get('blockAds');
  }

  // ── Profiles ────────────────────────────────────────────────────────────

  // storagePath: keep this profile on disk (cookies encrypted with the
  // Keychain). Without it, the session lives in RAM only.
  createProfile(kind, { storagePath = null } = {}) {
    if (storagePath) fs.mkdirSync(storagePath, { recursive: true, mode: 0o700 });
    const ses = storagePath
      ? session.fromPath(storagePath)
      : session.fromPartition(`vrk-${kind}-${crypto.randomUUID()}`); // no "persist:" => RAM only
    const profile = {
      kind,
      session: ses,
      persistent: Boolean(storagePath),
      gate: 'init',
      proxyKey: null,
      grants: new Map(),
      httpAllowed: new Set(),
      dangerAllowed: new Set(), // dangerous hosts the user chose to visit anyway (this session only)
    };

    ses.setUserAgent(USER_AGENT, ACCEPT_LANGUAGES);
    ses.setSpellCheckerEnabled(false);
    ses.setSSLConfig({ minVersion: 'tls1.2' });
    ses.setPermissionRequestHandler((wc, permission, callback, details) =>
      this.onPermissionRequest(profile, wc, permission, callback, details),
    );
    ses.setPermissionCheckHandler((_wc, permission, origin, details) =>
      this.onPermissionCheck(profile, permission, origin, details),
    );
    ses.setDevicePermissionHandler(() => false);
    ses.setCertificateVerifyProc((request, callback) => this.onVerifyCertificate(profile, request, callback));
    ses.on('select-hid-device', (event, _details, callback) => {
      event.preventDefault();
      callback();
    });
    ses.on('select-serial-port', (event, _ports, _wc, callback) => {
      event.preventDefault();
      callback('');
    });
    ses.on('select-usb-device', (event, _details, callback) => {
      event.preventDefault();
      callback();
    });
    ses.registerPreloadScript({ type: 'frame', filePath: CONTENT_PRELOAD });
    ses.registerPreloadScript({ type: 'frame', filePath: COSMETIC_PRELOAD });

    // Electron allows a single listener per webRequest event, so this one
    // pipeline does everything and delegates ad blocking to Ghostery's engine.
    ses.webRequest.onBeforeRequest(ALL_URLS, (details, callback) => this.onBeforeRequest(profile, details, callback));
    ses.webRequest.onBeforeSendHeaders(ALL_URLS, (details, callback) => this.onBeforeSendHeaders(details, callback));
    ses.webRequest.onHeadersReceived(ALL_URLS, (details, callback) => this.onHeadersReceived(profile, details, callback));
    return profile;
  }

  // Erases everything a profile holds except the sites the user stays signed in
  // to and the data of installed extensions. There is no history to erase:
  // VRK never records one.
  async clearSiteData(profile, { keepSites = [], keepOrigins = [] } = {}) {
    const ses = profile.session;
    const keep = new Set(keepSites);
    const keptHosts = new Set();
    const cookies = await ses.cookies.get({});
    await Promise.all(
      cookies.map((cookie) => {
        const host = cookie.domain.replace(/^\./, '');
        if (keep.has(siteOfHost(host))) {
          keptHosts.add(host);
          return null;
        }
        const url = `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`;
        return ses.cookies.remove(url, cookie.name).catch(() => {});
      }),
    );
    const isIp = (host) => /^[\d.]+$/.test(host) || host.includes(':');
    const webOrigins = [...keptHosts].map((host) => `https://${host}`);
    for (const site of keep) webOrigins.push(`https://${site}`, ...(isIp(site) ? [] : [`https://www.${site}`]));
    // keepOrigins are extension origins (chrome-extension://…), which URL can't validate.
    const excludeOrigins = [...new Set([...keepOrigins, ...webOrigins.filter((origin) => originOf(origin) === origin)])];
    await Promise.allSettled([
      (async () =>
        ses.clearData({
          dataTypes: SITE_DATA_TYPES,
          ...(excludeOrigins.length ? { excludeOrigins } : {}),
          avoidClosingConnections: true,
        }))(),
      ses.clearCache(),
      ses.clearAuthCache(),
      ses.clearHostResolverCache(),
      ses.clearCodeCaches({}),
    ]);
    await ses.cookies.flushStore().catch(() => {});
  }

  async destroyProfile(profile) {
    profile.gate = 'destroyed';
    const ses = profile.session;
    await Promise.allSettled([
      ses.closeAllConnections(),
      ses.clearData(),
      ses.clearStorageData(),
      ses.clearCache(),
      ses.clearAuthCache(),
      ses.clearHostResolverCache(),
      ses.clearCodeCaches({}),
    ]);
  }

  resetSessionState() {
    this.shieldsDown.clear();
    this.pendingUpgrade.clear();
    this.pendingThreat.clear();
    this.acceptCH.clear();
    this.totalBlocked = 0;
  }

  // ── Request pipeline ─────────────────────────────────────────────────────

  onBeforeRequest(profile, details, callback) {
    if (profile.gate) return callback({ cancel: true });
    const danger = this.dangerOf(profile, details.url, details.resourceType === 'mainFrame');
    if (danger) {
      if (details.resourceType === 'mainFrame') this.pendingThreat.set(details.webContentsId, { url: details.url, ...danger });
      this.countBlocked(details.webContentsId);
      return callback({ cancel: true });
    }
    if (details.resourceType === 'mainFrame') {
      const redirectURL = this.rewriteNavigation(profile, details);
      return callback(redirectURL ? { redirectURL } : {});
    }
    // Lockdown mode skips web fonts (font parsers are a classic exploit target), as Safari's does.
    if (this.settings.launched.lockdown && details.resourceType === 'font') return callback({ cancel: true });
    if (!this.blocking || this.isSiteShieldsDown(topUrlOf(details))) return callback({});
    const u = parseURL(details.url);
    if (
      u &&
      (this.hostlist.has(u.hostname) ||
        (this.settings.get('blockBait') && details.resourceType === 'script' && BAIT_SCRIPT.test(u.pathname)))
    ) {
      this.countBlocked(details.webContentsId);
      return callback({ cancel: true });
    }
    this.blocker.onBeforeRequest(details, callback);
  }

  countBlocked(webContentsId) {
    this.totalBlocked += 1;
    this.emit('blocked', webContentsId);
  }

  // ── Dangerous sites (phishing & malware) ────────────────────────────────

  // { kind: 'phishing' | 'malware' | 'lookalike', target? } or null.
  dangerOf(profile, url, topLevel = false) {
    const host = parseURL(url)?.hostname;
    if (!host || profile.dangerAllowed.has(host)) return null;
    if (this.settings.get('blockDangerous')) {
      const kind = this.safety.check(url);
      if (kind) return { kind };
    }
    // Lookalikes only matter for pages you open, not what they load.
    if (topLevel && this.settings.get('lookalikeWarnings') && /^https?:$/.test(parseURL(url).protocol)) {
      const target = lookalikeOf(host);
      if (target && !this.isFamiliarSite(siteOf(url))) return { kind: 'lookalike', target };
    }
    return null;
  }

  takeThreat(webContentsId, url) {
    const threat = this.pendingThreat.get(webContentsId);
    if (!threat) return null;
    this.pendingThreat.delete(webContentsId);
    return threat.url === url || parseURL(threat.url)?.hostname === parseURL(url)?.hostname ? threat : null;
  }

  rewriteNavigation(profile, { url, webContentsId }) {
    const u = parseURL(url);
    if (!u) return null;
    let changed = false;
    if (
      this.settings.get('httpsOnly') &&
      u.protocol === 'http:' &&
      !isLocalHost(u.hostname) &&
      !isOnion(u.hostname) &&
      !profile.httpAllowed.has(siteOf(url))
    ) {
      this.pendingUpgrade.set(webContentsId, { host: u.hostname, httpUrl: url });
      u.protocol = 'https:';
      changed = true;
    }
    if (this.settings.get('stripTrackingParams') && stripTrackingParams(u)) changed = true;
    // Straight to the destination when a link only passes through a click tracker.
    if (this.settings.get('skipTrackingRedirects')) {
      const target = skipRedirect(u, (host) => this.hostlist.has(host));
      if (target) return target;
    }
    return changed ? u.href : null;
  }

  isThirdParty(details) {
    if (details.resourceType === 'mainFrame') return false;
    const top = siteOf(topUrlOf(details));
    const request = siteOf(details.url);
    return Boolean(top && request && top !== request);
  }

  onBeforeSendHeaders(details, callback) {
    const headers = details.requestHeaders;
    applyClientHints(headers, details.url, this.acceptCH.get(originOf(details.url)));
    if (this.settings.get('sendGpc')) headers['Sec-GPC'] = '1';
    if (this.settings.get('blockThirdPartyCookies') && this.isThirdParty(details)) deleteHeader(headers, 'cookie');
    // Other sites learn only which site you came from, never the page (even if a page asks for more).
    const referrer = this.settings.get('trimReferrers') && headerValue(headers, 'referer');
    if (referrer && siteOf(referrer) !== siteOf(details.url)) {
      const origin = originOf(referrer);
      deleteHeader(headers, 'referer');
      if (origin) headers.Referer = `${origin}/`;
    }
    callback({ requestHeaders: headers });
  }

  onHeadersReceived(profile, details, callback) {
    const isDocument = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
    const pageUrl = details.resourceType === 'mainFrame' ? details.url : topUrlOf(details);
    const noScript = isDocument && ((profile.kind === 'tor' && this.torScriptsBlocked(details.url)) || this.scriptsBlockedOn(siteOf(pageUrl)));
    if (isDocument) this.rememberAcceptCH(details);
    const stripCookies =
      this.settings.get('blockThirdPartyCookies') && this.isThirdParty(details) && headerValue(details.responseHeaders, 'set-cookie');
    const finish = (result = {}) => {
      if (!stripCookies && !isDocument) return callback(result);
      const responseHeaders = result.responseHeaders || { ...details.responseHeaders };
      if (stripCookies) deleteHeader(responseHeaders, 'set-cookie');
      // Each policy is enforced on its own, so adding one only ever tightens the
      // page's: this switches its scripts off whatever the site sends.
      if (noScript) {
        const key = Object.keys(responseHeaders).find((k) => k.toLowerCase() === 'content-security-policy') || 'Content-Security-Policy';
        const existing = responseHeaders[key];
        responseHeaders[key] = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), "script-src 'none'; object-src 'none'"];
      }
      // Stop pages from making DNS lookups outside the proxy (Tor/VPN) via dns-prefetch.
      if (isDocument) responseHeaders['X-DNS-Prefetch-Control'] = ['off'];
      callback({ ...result, responseHeaders });
    };
    if (!this.blocking || this.isSiteShieldsDown(topUrlOf(details))) return finish();
    this.blocker.onHeadersReceived(details, finish);
  }

  // Tor security levels, as in Tor Browser: Safer switches JavaScript off on
  // sites without HTTPS (onion sites count as secure), Safest everywhere.
  torScriptsBlocked(url) {
    const level = this.settings.get('torSecurity');
    if (level === 'safest') return true;
    if (level !== 'safer') return false;
    const u = parseURL(url);
    return Boolean(u) && u.protocol === 'http:' && !isOnion(u.hostname);
  }

  // Per-site JavaScript: blocked on listed sites, or everywhere except allowed ones.
  scriptsBlockedOn(site) {
    if (!site) return false;
    return this.settings.get('jsDefault') === 'block' ? !this.settings.get('jsAllowedSites').includes(site) : this.settings.get('jsBlockedSites').includes(site);
  }

  setScripts(site, allowed) {
    if (this.settings.get('jsDefault') === 'block') this.settings.setSite('jsAllowedSites', site, allowed);
    else this.settings.setSite('jsBlockedSites', site, !allowed);
  }

  // Sites opt in to detailed client hints with Accept-CH, as in Chrome.
  rememberAcceptCH(details) {
    const value = headerValue(details.responseHeaders, 'accept-ch');
    const origin = originOf(details.url);
    if (!value || !origin) return;
    if (this.acceptCH.size > 500) this.acceptCH.delete(this.acceptCH.keys().next().value);
    this.acceptCH.set(origin, parseAcceptCH(value));
  }

  // ── HTTPS-only bookkeeping ───────────────────────────────────────────────

  takePendingUpgrade(webContentsId, failedUrl, errorCode) {
    const pending = this.pendingUpgrade.get(webContentsId);
    if (!pending) return null;
    if (parseURL(failedUrl)?.hostname !== pending.host && errorCode !== -310) return null;
    this.pendingUpgrade.delete(webContentsId);
    return pending;
  }

  navigationCommitted(webContentsId) {
    this.pendingUpgrade.delete(webContentsId);
    this.pendingThreat.delete(webContentsId);
  }

  // ── Shields (per-site blocking toggle) ───────────────────────────────────

  isSiteShieldsDown(url) {
    const site = siteOf(url);
    return Boolean(site && this.shieldsDown.has(site));
  }

  setShields(site, up) {
    if (up) this.shieldsDown.delete(site);
    else this.shieldsDown.add(site);
  }

  // Would the filter lists treat this host as a tracker when embedded elsewhere?
  isTrackerHost(host) {
    const { match } = this.blocker.match(
      Request.fromRawDetails({ url: `https://${host}/`, type: 'script', sourceUrl: 'https://vrk-import-check.example/' }),
    );
    return Boolean(match);
  }

  // ── Ad & tracker blocking engine ────────────────────────────────────────

  registerCosmeticIpc() {
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
      if (!this.blocking || this.isSiteShieldsDown(event.sender.getURL())) return undefined;
      return this.blocker.onInjectCosmeticFilters(event, url, msg);
    });
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) =>
      this.blocker.onIsMutationObserverEnabled(event),
    );
  }

  watchBlocker(blocker) {
    const onBlocked = (request) => this.countBlocked(request.tabId);
    blocker.on('request-blocked', onBlocked);
    blocker.on('request-redirected', onBlocked);
  }

  loadBlocker() {
    const candidates = [path.join(this.configDir, 'adblock-engine.bin'), path.join(this.assetsDir, 'adblock-engine.bin')]
      .map((file) => {
        try {
          return { file, mtime: fs.statSync(file).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    for (const { file, mtime } of candidates) {
      try {
        const blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(file)));
        this.listsUpdatedAt = mtime;
        return blocker;
      } catch {
        // Stale format from another engine version: try the next copy.
      }
    }
    this.listsUpdatedAt = 0;
    return ElectronBlocker.empty();
  }

  // Refreshes every list that's due (or all of them with force). One failing
  // download doesn't stop the others.
  async refreshLists({ force = false } = {}) {
    const fetchFn = (url, init) => this.updateSession.fetch(url, init);
    const results = await Promise.allSettled([
      this.refreshAdblockEngine({ force }),
      this.hostlist.refresh(fetchFn, { force }),
      this.safety.refresh(fetchFn, { force }),
      this.malware.refresh(fetchFn, { force }),
    ]);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed && force) throw failed.reason;
    return results.some((r) => r.value === true);
  }

  async refreshAdblockEngine({ force = false } = {}) {
    if (!force && Date.now() - this.listsUpdatedAt < LIST_MAX_AGE_MS) return false;
    const fresh = await ElectronBlocker.fromPrebuiltFull((url, init) => this.updateSession.fetch(url, init));
    const file = path.join(this.configDir, 'adblock-engine.bin');
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, fresh.serialize());
    fs.renameSync(`${file}.tmp`, file);
    this.watchBlocker(fresh);
    this.blocker = fresh;
    this.listsUpdatedAt = Date.now();
    return true;
  }

  // Erases one site's cookies and storage from a profile (forget on close).
  async clearSite(profile, site, origins = []) {
    const ses = profile.session;
    const cookies = await ses.cookies.get({});
    await Promise.all(
      cookies
        .filter((c) => siteOfHost(c.domain) === site)
        .map((c) => ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path || '/'}`, c.name).catch(() => {})),
    );
    const all = [...new Set([...origins, `https://${site}`, `https://www.${site}`].filter((o) => originOf(o) === o))];
    await ses.clearData({ dataTypes: SITE_DATA_TYPES, origins: all }).catch(() => {});
  }

  // ── HTTPS interception ───────────────────────────────────────────────────
  // A valid certificate from a root Chromium doesn't know means someone added
  // their own root to this Mac: usually a school or work network filter, or
  // security/monitoring software, decrypting your HTTPS. Chromium still
  // decides validity; VRK only notices and tells you.

  onVerifyCertificate(profile, request, callback) {
    try {
      if (request.errorCode === 0 && request.isIssuedByKnownRoot === false && !isLocalHost(request.hostname) && this.settings.get('interceptionWarnings')) {
        let cert = request.validatedCertificate || request.certificate;
        for (let i = 0; cert?.issuerCert && i < 10; i += 1) cert = cert.issuerCert;
        const issuer = cert?.subject?.organizations?.[0] || cert?.subject?.commonName || cert?.issuerName || 'an unknown certificate';
        this.emit('interception', { host: request.hostname, issuer, profile: profile.kind });
      }
    } catch {}
    callback(-3); // use Chromium's own verdict
  }

  // ── Permissions ──────────────────────────────────────────────────────────

  async onPermissionRequest(profile, wc, permission, callback, details) {
    if (ALWAYS_ALLOWED.has(permission)) return callback(true);
    if (!ASKABLE.has(permission)) return callback(false);
    if (profile.kind === 'tor' && TOR_DENIED.has(permission)) return callback(false);
    // Notification prompts are blocked unless you turn them back on.
    if (permission === 'notifications' && this.settings.get('notificationPrompts') === 'block') return callback(false);
    const origin = originOf(details.requestingUrl);
    if (!origin) return callback(false);

    const keys =
      permission === 'media'
        ? (details.mediaTypes?.length ? details.mediaTypes : ['audio', 'video']).map((t) => `${origin}|media:${t}`)
        : [`${origin}|${permission}`];
    const remember = permission !== 'openExternal';
    if (remember && keys.every((key) => profile.grants.get(key) === true)) return callback(true);
    if (remember && keys.some((key) => profile.grants.get(key) === false)) return callback(false);

    let allow = false;
    try {
      allow = await this.askPermission({ webContents: wc, origin, permission, details, profile });
    } catch {}
    if (remember) for (const key of keys) profile.grants.set(key, allow);
    callback(allow);
  }

  onPermissionCheck(profile, permission, requestingOrigin, details) {
    if (ALWAYS_ALLOWED.has(permission)) return true;
    const origin = originOf(details?.requestingUrl) || originOf(requestingOrigin);
    if (!origin) return false;
    const key = permission === 'media' ? `${origin}|media:${details?.mediaType}` : `${origin}|${permission}`;
    return profile.grants.get(key) === true;
  }
}

module.exports = { Shield, USER_AGENT, DEAD_PROXY, siteOf, siteOfHost, parseURL, originOf, isLocalHost, isOnion };
