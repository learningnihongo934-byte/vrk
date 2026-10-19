'use strict';
// Passkeys, password health (breach alerts, reused and weak passwords) and
// the extension safety check, mixed into Browser.

const { dialog, powerMonitor, systemPreferences } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { quarantine, sha256File, isRisky } = require('./downloads');
const { parseTotp, totpCode } = require('./totp');
const { encryptBackup, decryptBackup } = require('./backup');
const passkeys = require('./passkeys');
const { siteOf } = require('./shield');

const hostOf = (origin) => new URL(origin).hostname;

// While VRK is locked, the interface may only ask for these.
const LOCKED_REQUESTS = new Set(['settings:get', 'themes:list']);

module.exports = {
  // ── App lock ─────────────────────────────────────────────────────────────
  // Touch ID to open VRK, after your Mac sleeps or locks, and after you've
  // been away for a few minutes. Everything (pages, tab titles, the History
  // menu) is hidden until you unlock.

  setupAppLock() {
    this.locked = Boolean(this.settings.get('appLock') && this.canLock());
    powerMonitor.on('lock-screen', () => this.lock());
    powerMonitor.on('suspend', () => this.lock());
    this.unlockedAt = Date.now();
    this.idleTimer = setInterval(() => {
      const seconds = Number(this.settings.get('appLockMinutes')) * 60;
      // Away long enough, counted from your last unlock too (Touch ID alone may not count as activity).
      const away = Math.min(powerMonitor.getSystemIdleTime(), (Date.now() - this.unlockedAt) / 1000);
      if (this.settings.get('appLock') && !this.locked && away >= seconds) this.lock();
    }, 15000);
    this.idleTimer.unref?.();
  },

  canLock() {
    return Boolean(this.unlockApproval) || Boolean(systemPreferences.canPromptTouchID?.());
  },

  lock() {
    if (!this.settings.get('appLock') || !this.canLock() || this.locked || this.win.isDestroyed()) return;
    this.locked = true;
    this.lockChanged();
  },

  async unlock() {
    if (!this.locked) return true;
    try {
      if (this.unlockApproval) {
        if (!(await this.unlockApproval())) return false; // the self-test answers here
      } else {
        await systemPreferences.promptTouchID('unlock VRK');
      }
    } catch {
      return false;
    }
    this.locked = false;
    this.unlockedAt = Date.now();
    this.lockChanged();
    if (this.activeTab && this.isPageShown(this.activeTab)) this.activeTab.wc.focus();
    return true;
  },

  lockChanged() {
    this.hideSuggestions();
    this.updateView();
    this.syncTitle();
    this.queueState();
    this.onLockChange?.(); // main.js rebuilds the menu (recent history)
    this.os?.setLocked(this.locked);
  },

  allowedWhileLocked(name) {
    return !this.locked || LOCKED_REQUESTS.has(name);
  },

  // ── Passkeys ─────────────────────────────────────────────────────────────

  // Requests come from the page's top frame, already checked by pageContext.
  // { fallback: true } hands the request to Chromium's own WebAuthn (security keys).
  async passkeyRequest(context, kind, request = {}) {
    if (!this.settings.get('passkeys')) return { fallback: true };
    const origin = context.origin;
    const rpId = String(request.rpId || hostOf(origin)).toLowerCase();
    if (!passkeys.validRpId(rpId, origin)) return { error: 'SecurityError' };
    if (kind === 'list') return { passkeys: this.vault.passkeysFor(rpId).map((p) => ({ id: p.id, userName: p.userName || p.displayName })) };
    if (kind === 'create') return this.createPasskey(origin, rpId, request);
    if (kind === 'get') return this.usePasskey(origin, rpId, request);
    return { fallback: true };
  },

  async createPasskey(origin, rpId, request) {
    if (request.attachment === 'cross-platform') return { fallback: true }; // the site asked for a security key
    const algorithms = Array.isArray(request.algorithms) ? request.algorithms : [];
    if (algorithms.length && !algorithms.includes(-7)) return { fallback: true };
    const exclude = new Set(Array.isArray(request.exclude) ? request.exclude : []);
    if (this.vault.passkeysFor(rpId).some((p) => exclude.has(p.id))) return { error: 'InvalidStateError' };
    const userId = String(request.userId || '');
    if (!userId || passkeys.fromB64url(userId).length > 64 || typeof request.challenge !== 'string') return { error: 'TypeError' };
    const user = { id: userId, name: String(request.userName || ''), displayName: String(request.displayName || '') };
    const verified = await this.verifyUser({
      reason: `save a passkey for ${rpId}`,
      title: `Save a passkey for ${rpId}?`,
      detail: `Account: ${user.name || user.displayName || 'unnamed'}. VRK keeps it encrypted with your Mac’s Keychain.`,
      button: 'Save Passkey',
    });
    if (verified === null) return { error: 'NotAllowedError' };
    const { passkey, response } = passkeys.register({ origin, rpId, user, challenge: request.challenge, verified });
    this.vault.addPasskey(passkey);
    this.toast(`Passkey saved for ${rpId}.`);
    return { response };
  },

  async usePasskey(origin, rpId, request) {
    let candidates = this.vault.passkeysFor(rpId);
    const allow = Array.isArray(request.allow) ? new Set(request.allow) : null;
    if (allow?.size) candidates = candidates.filter((p) => allow.has(p.id));
    if (request.pick) candidates = candidates.filter((p) => p.id === request.pick); // chosen in the autofill list
    if (!candidates.length) return { fallback: true };
    if (typeof request.challenge !== 'string') return { error: 'TypeError' };
    let chosen = candidates[0];
    if (candidates.length > 1) {
      const shown = candidates.slice(0, 8);
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'question',
        message: `Sign in to ${rpId} with a passkey`,
        detail: 'Choose an account.',
        buttons: [...shown.map((p) => p.userName || p.displayName || 'Unnamed account'), 'Cancel'],
        cancelId: shown.length,
      });
      if (response >= shown.length) return { error: 'NotAllowedError' };
      chosen = shown[response];
    }
    const name = chosen.userName || chosen.displayName || 'your account';
    const verified = await this.verifyUser({
      reason: `sign in to ${rpId} as ${name}`,
      title: `Sign in to ${rpId}?`,
      detail: `With your passkey for ${name}.`,
      button: 'Sign In',
    });
    if (verified === null) return { error: 'NotAllowedError' };
    this.vault.touchPasskey(chosen.id);
    return { response: passkeys.assert({ passkey: chosen, origin, challenge: request.challenge, verified }) };
  },

  // Touch ID when the Mac has it (that's user verification); otherwise a
  // confirmation. Returns true (verified), false (confirmed) or null (declined).
  async verifyUser(prompt) {
    if (this.passkeyApproval) return this.passkeyApproval(prompt); // the self-test answers here
    if (systemPreferences.canPromptTouchID?.()) {
      try {
        await systemPreferences.promptTouchID(prompt.reason);
        return true;
      } catch {
        return null;
      }
    }
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question',
      message: prompt.title,
      detail: prompt.detail,
      buttons: [prompt.button, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    return response === 0 ? false : null;
  },

  // ── Forget sites on close ───────────────────────────────────────────────
  // Once no tab is on a site any more (and it isn't one you stay signed in
  // to), its cookies and storage are erased: a short wait first, so a quick
  // reload or reopened tab doesn't sign you out.

  siteLeft(profile, site) {
    if (!site || !this.settings.get('forgetOnClose') || profile.kind === 'tor') return;
    this.forgetTimers ||= new Map();
    const key = `${profile.kind}|${profile.container || ''}|${site}`;
    clearTimeout(this.forgetTimers.get(key));
    this.forgetTimers.set(
      key,
      setTimeout(() => {
        this.forgetTimers.delete(key);
        this.forgetSiteNow(profile, site).catch(() => {});
      }, this.forgetDelay ?? 15000),
    );
  },

  async forgetSiteNow(profile, site) {
    const stillOpen = [...this.tabs.values()].some((t) => t.profile === profile && siteOf(t.url) === site);
    if (stillOpen || this.settings.get('keepSites').includes(site)) return false;
    const origins = [...this.sessionOrigins].filter((o) => siteOf(o) === site);
    await this.shield.clearSite(profile, site, origins);
    return true;
  },

  // ── HTTPS interception ───────────────────────────────────────────────────

  onInterception(host, issuer) {
    this.interceptions ||= new Map(); // issuer -> hosts seen
    const hosts = this.interceptions.get(issuer) || new Set();
    const first = !this.interceptions.has(issuer);
    hosts.add(host);
    this.interceptions.set(issuer, hosts);
    if (first) {
      this.toast(
        `Your HTTPS connection to ${host} is being decrypted and inspected by “${issuer}”. This is usually a school or work network filter, or security software on this Mac. They can see what you do on encrypted sites; avoid passwords and private things on this network if you didn’t expect this.`,
        null,
        { danger: true },
      );
    }
    this.queueState();
  },

  // ── Site permissions ────────────────────────────────────────────────────

  listPermissions() {
    const profiles = [this.normal, this.torProfile].filter(Boolean);
    return profiles.flatMap((profile) =>
      [...profile.grants].map(([key, allowed]) => {
        const [origin, permission] = key.split('|');
        return { key, origin, permission, allowed, tor: profile.kind === 'tor' };
      }),
    );
  },

  revokePermission(key, tor) {
    const profile = tor ? this.torProfile : this.normal;
    profile?.grants.delete(String(key));
  },

  // ── "Paste into Terminal" scam guard ────────────────────────────────────

  warnClipboardCommand(tab, host, text) {
    const now = Date.now();
    if (this.lastClipboardWarning && now - this.lastClipboardWarning.at < 8000 && this.lastClipboardWarning.tabId === tab.id) return;
    this.lastClipboardWarning = { at: now, tabId: tab.id, host, text };
    this.toast(
      `${host || 'This page'} just copied a Terminal command to your clipboard. Never paste commands from a website into Terminal unless you trust the site and know what they do: fake “verify you’re human” pages use this trick to install malware.`,
      { label: 'Clear Clipboard', clearClipboard: true },
      { danger: true },
    );
  },

  // ── Download protection ─────────────────────────────────────────────────

  // Quarantine flag (so Gatekeeper/XProtect check it) and the malware list.
  async protectDownload(file, { url, referrer }) {
    if (!this.settings.get('downloadProtection')) return {};
    try {
      await quarantine(file, { url, referrer });
    } catch (err) {
      console.error('VRK: could not quarantine a download', err.message);
    }
    try {
      if (this.shield.malware.has(await sha256File(file))) {
        fs.rmSync(file, { force: true });
        this.toast(`VRK deleted ${path.basename(file)}: it matches known malware (abuse.ch MalwareBazaar).`);
        return { malware: true };
      }
    } catch {}
    return { risky: isRisky(file) };
  },

  // ── Extension safety check ──────────────────────────────────────────────

  scheduleExtensionSafetyCheck() {
    if (process.env.VRK_SELFTEST || process.env.VRK_SHOTS) return;
    const run = () => this.runExtensionSafetyCheck().catch(() => {});
    setTimeout(run, 60 * 1000).unref?.();
    setInterval(run, 24 * 60 * 60 * 1000).unref?.();
  },

  async runExtensionSafetyCheck() {
    const turnedOff = await this.extensions.safetyCheck();
    if (turnedOff.length) {
      const names = turnedOff.map((name) => `“${name}”`).join(', ');
      this.toast(`Turned off ${names}: its store no longer lists it, which often means it was removed for malware. You can remove it in Settings → Extensions.`);
    }
    return turnedOff;
  },

  // A saved password typed into a different site: often a phishing page.
  checkPasswordReuse(context, password) {
    if (!this.settings.get('passwordReuseAlerts')) return;
    const other = this.vault.data.logins.find((l) => l.password === password && siteOf(l.origin) !== context.site);
    if (!other) return;
    const key = `${context.site}|${siteOf(other.origin)}`;
    this.reuseWarned ||= new Set();
    if (this.reuseWarned.has(key)) return;
    this.reuseWarned.add(key);
    const saved = hostOf(other.origin);
    this.toast(
      `You just typed your ${saved} password into ${hostOf(context.origin)}. If this site isn’t really ${saved}, it may be a fake: change your ${saved} password now. (Using one password on several sites is risky either way.)`,
      null,
      { danger: true },
    );
  },

  // ── Two-factor codes ────────────────────────────────────────────────────

  setLoginTotp(id, input) {
    try {
      return { ok: this.vault.setTotp(id, input ? parseTotp(input) : null) };
    } catch (err) {
      return { error: err.message };
    }
  },

  loginTotpCode(id) {
    const login = this.vault.get(id);
    return login?.totp ? totpCode(login.totp) : null;
  },

  // Finds a 2FA QR code on the page you're looking at (sites show one when you turn on 2FA).
  async scanTotpQr() {
    const tab = [...this.tabs.values()].filter((t) => !t.internal && !t.isNewTab && this.isPageShown(t) && !t.wc.isDestroyed()).pop();
    if (!tab) return { error: 'Open the page that shows the 2FA QR code in a tab, then try again.' };
    let image;
    try {
      image = await tab.wc.capturePage();
    } catch {
      return { error: 'Show the tab with the QR code on screen, then try again.' };
    }
    const data = this.decodeQr(image);
    if (!data?.startsWith('otpauth://')) return { error: `No 2FA QR code found on ${hostOf(tab.url || 'https://page')}. Scroll so the QR code is visible and try again.` };
    try {
      const totp = parseTotp(data);
      return { otpauth: data, issuer: totp.issuer, label: totp.label, site: siteOf(tab.url) };
    } catch (err) {
      return { error: err.message };
    }
  },

  // The text in a QR code in a nativeImage (or null).
  decodeQr(image) {
    const jsQR = require('jsqr');
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap(); // BGRA; a QR code is black and white, so the order doesn't matter
    const scale = Math.round(Math.sqrt(bitmap.length / 4 / (width * height))) || 1;
    return jsQR(new Uint8ClampedArray(bitmap.buffer, bitmap.byteOffset, bitmap.length), width * scale, height * scale)?.data || null;
  },

  // ── Encrypted backup ────────────────────────────────────────────────────

  backupPayload() {
    const { logins, never, passkeys } = this.vault.data;
    return { logins, never, passkeys, bookmarks: this.bookmarks.data };
  },

  async exportBackup(passphrase) {
    const verified = await this.verifyUser({
      reason: 'export your passwords and passkeys',
      title: 'Export an encrypted backup?',
      detail: 'It contains your passwords, 2FA codes, passkeys and bookmarks, locked with your passphrase.',
      button: 'Export',
    });
    if (verified === null) return { canceled: true };
    let text;
    try {
      text = await encryptBackup(this.backupPayload(), passphrase);
    } catch (err) {
      return { error: err.message };
    }
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      title: 'Save Encrypted Backup',
      defaultPath: `VRK Backup ${new Date().toISOString().slice(0, 10)}.vrkbackup`,
      filters: [{ name: 'VRK backup', extensions: ['vrkbackup'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, text, { mode: 0o600 });
    return { ok: true, file: path.basename(filePath), logins: this.vault.count, passkeys: this.vault.passkeyCount };
  },

  async restoreBackup(passphrase) {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      title: 'Restore a VRK Backup',
      filters: [{ name: 'VRK backup', extensions: ['vrkbackup'] }],
      properties: ['openFile'],
    });
    if (canceled) return { canceled: true };
    try {
      return await this.restoreBackupFrom(fs.readFileSync(filePaths[0], 'utf8'), passphrase);
    } catch (err) {
      return { error: err.message };
    }
  },

  // Merges a backup into what's already here (nothing is deleted).
  async restoreBackupFrom(text, passphrase) {
    const backup = await decryptBackup(text, passphrase);
    let logins = 0;
    for (const login of Array.isArray(backup.logins) ? backup.logins : []) {
      if (!login?.origin || !login.password) continue;
      if (this.vault.upsert({ origin: login.origin, username: login.username || '', password: login.password }, { save: false })) logins += 1;
      if (login.totp) {
        const here = this.vault.data.logins.find((l) => l.origin === login.origin && l.username === (login.username || ''));
        if (here && !here.totp) here.totp = login.totp;
      }
    }
    for (const origin of Array.isArray(backup.never) ? backup.never : []) if (!this.vault.isNever(origin)) this.vault.data.never.push(origin);
    let passkeyCount = 0;
    for (const passkey of Array.isArray(backup.passkeys) ? backup.passkeys : []) {
      if (passkey?.id && passkey.privateKey && !this.vault.data.passkeys.some((p) => p.id === passkey.id)) {
        this.vault.data.passkeys.push(passkey);
        passkeyCount += 1;
      }
    }
    this.vault.save();
    const bookmarks = backup.bookmarks ? this.bookmarks.importTree({ bar: backup.bookmarks.bar || [], other: backup.bookmarks.other || [] }, 'VRK Backup') : 0;
    return { ok: true, logins, passkeys: passkeyCount, bookmarks };
  },

  // ── Password health ─────────────────────────────────────────────────────

  // Have I Been Pwned's k-anonymity check: only the first 5 characters of the
  // password's SHA-1 hash are sent, padded so even the reply size says nothing.
  async breachCount(password) {
    const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const response = await this.shield.updateSession.fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    for (const line of (await response.text()).split('\n')) {
      const [suffix, count] = line.trim().split(':');
      if (suffix === hash.slice(5)) return Number(count) || 0; // padding lines have a count of 0
    }
    return 0;
  },

  async warnIfBreached(login) {
    if (!this.settings.get('breachAlerts')) return;
    try {
      const count = await this.breachCount(login.password);
      if (count > 0) {
        this.toast(`The password you saved for ${hostOf(login.origin)} has appeared in ${count.toLocaleString()} data breaches. Change it to something new.`);
      }
    } catch {
      // Offline: Settings → Passwords → Check Passwords can run the check later.
    }
  },

  // Settings → Passwords → Check Passwords: compromised, reused and weak.
  async checkPasswords() {
    const logins = this.vault.data.logins;
    const bySecret = new Map();
    for (const login of logins) {
      const sites = bySecret.get(login.password) || new Set();
      sites.add(siteOf(login.origin));
      bySecret.set(login.password, sites);
    }
    const result = { checked: logins.length, compromised: [], reused: [], weak: [], offline: false };
    const breached = new Map();
    for (const password of bySecret.keys()) {
      try {
        breached.set(password, await this.breachCount(password));
      } catch {
        result.offline = true;
        break;
      }
    }
    for (const login of logins) {
      if (breached.get(login.password) > 0) result.compromised.push(login.id);
      if (bySecret.get(login.password).size > 1) result.reused.push(login.id);
      if (isWeak(login.password)) result.weak.push(login.id);
    }
    return result;
  },
};

function isWeak(password) {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((re) => re.test(password)).length;
  return password.length < 8 || (password.length < 12 && classes < 3) || /^(.)\1+$/.test(password) || /^(?:0123|1234|abcd|qwer|pass)/i.test(password);
}
