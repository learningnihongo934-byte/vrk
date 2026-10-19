'use strict';
// Runs sandboxed in every web page's isolated world (the page and its
// iframes) before page scripts.
//  - Makes the page see the same Chrome identity as VRK's request headers.
//  - Fingerprinting protection: canvas, WebGL and audio readings get tiny
//    per-site random changes (like Brave's "farbling"), and the CPU core count
//    varies per site, so scripts can't recognise your device across sites.
//  - Tor tabs at the Safer and Safest security levels: no WebGL.
//  - Aggressive blocking: hides the decoy "ad" boxes anti-adblock checks use.
//  - Cookie banners: clicks "Reject all" for you.
//  - Advertises Global Privacy Control (the Sec-GPC header is added by the shield).
//  - Blocks popups that weren't triggered by a click or key press.
//  - VRK's password manager: offers saved logins on sign-in fields (filled only
//    when you pick one), offers to save new ones when you sign in, and
//    suggests a strong password on sign-up forms.
//  - Passkeys: answers the page's WebAuthn requests with VRK's passkeys
//    (Touch ID to use them), and offers them in the autofill list.
//  - "Paste into Terminal" scam guard: tells VRK when a page copies a Terminal
//    command to your clipboard (the trick fake "verify you're human" pages use).

const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Web pages and the blank/srcdoc frames they create. Extensions' own pages
// (chrome-extension://) are left alone.
const isWebPage = /^https?:$/.test(location.protocol) || (location.protocol === 'about:' && window !== top);

let config = { gpc: true, passwords: false, passkeys: false, uv: false, bait: false, seed: null, noWebgl: false, rejectBanners: false };
try {
  if (isWebPage) config = ipcRenderer.sendSync('vrk-page:config') || config;
} catch {}

function mainWorld({ gpc, seed, noWebgl, passkeys, uv }, bridge) {
  const passkeyBridge = (kind, request) => bridge(kind, request);
  // Patched functions keep looking native: toString reports the original.
  const originals = new WeakMap();
  const disguise = (fake, real) => {
    originals.set(fake, real);
    return fake;
  };
  const wrapMethod = (proto, name, apply) => {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') return;
    Object.defineProperty(proto, name, { ...desc, value: disguise(new Proxy(desc.value, { apply }), desc.value) });
  };
  const wrapGetter = (proto, name, apply) => {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.get !== 'function') return;
    Object.defineProperty(proto, name, { ...desc, get: disguise(new Proxy(desc.get, { apply }), desc.get) });
  };

  // ── Fingerprint randomizing ──
  // Seeded per site and per session: a site sees the same values until you
  // quit, Burn or get a new Tor identity; other sites see different ones.
  const random = (state) => () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // The noise also depends on the image, so reading the same image twice gives the same answer.
  const contentSeed = (bytes) => {
    let h = seed | 0;
    const step = Math.max(1, Math.floor(bytes.length / 4096));
    for (let i = 0; i < bytes.length; i += step) h = Math.imul(h ^ bytes[i], 0x01000193);
    return h;
  };
  const MAX_PIXELS = 1 << 20; // big canvases (games, photo editors) are left untouched
  // Flips the lowest bit of one color channel in ~5% of visible pixels: invisible, but it changes the hash.
  const noisePixels = (data) => {
    if (!data || data.length > MAX_PIXELS * 4) return;
    const rand = random(contentSeed(data));
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 0 && rand() < 0.05) data[i + ((rand() * 3) | 0)] ^= 1;
    }
  };
  const audioFudge = 1 - random(seed ^ 0x2f6b1c3d)() * 1e-4; // a -80 dB change: inaudible
  const cores = 2 + (Math.abs(seed | 0) % 7); // 2–8

  function farble(win) {
    const { HTMLCanvasElement: Canvas, CanvasRenderingContext2D: Context2D, OffscreenCanvas, OffscreenCanvasRenderingContext2D: OffscreenContext2D } = win;
    const doc = win.document;
    const createElement = win.Document.prototype.createElement;
    const getContext = Canvas.prototype.getContext;
    const { getImageData, putImageData, drawImage } = Context2D.prototype;
    const sizeOf = (proto, target) => [
      Reflect.apply(Object.getOwnPropertyDescriptor(proto, 'width').get, target, []),
      Reflect.apply(Object.getOwnPropertyDescriptor(proto, 'height').get, target, []),
    ];
    // Exports read from a noisy copy, so the page's own canvas is never changed.
    const noisyCopy = (canvas) => {
      const [w, h] = sizeOf(Canvas.prototype, canvas);
      if (!w || !h || w * h > MAX_PIXELS) return canvas;
      const copy = Reflect.apply(createElement, doc, ['canvas']);
      copy.width = w;
      copy.height = h;
      const context = Reflect.apply(getContext, copy, ['2d']);
      Reflect.apply(drawImage, context, [canvas, 0, 0]);
      const image = Reflect.apply(getImageData, context, [0, 0, w, h]);
      noisePixels(image.data);
      Reflect.apply(putImageData, context, [image, 0, 0]);
      return copy;
    };
    const noisyExport = (copier) => (target, self, args) => {
      let source = self;
      try {
        source = copier(self);
      } catch {
        // A tainted canvas: let the original method report the error.
      }
      return Reflect.apply(target, source, args);
    };
    const noisyRead = (target, self, args) => {
      const image = Reflect.apply(target, self, args);
      noisePixels(image?.data);
      return image;
    };
    wrapMethod(Canvas.prototype, 'toDataURL', noisyExport(noisyCopy));
    wrapMethod(Canvas.prototype, 'toBlob', noisyExport(noisyCopy));
    wrapMethod(Context2D.prototype, 'getImageData', noisyRead);

    if (OffscreenCanvas && OffscreenContext2D) {
      const offGetContext = OffscreenCanvas.prototype.getContext;
      const off = OffscreenContext2D.prototype;
      const offGet = off.getImageData;
      const offPut = off.putImageData;
      const offDraw = off.drawImage;
      const noisyOffscreenCopy = (canvas) => {
        const [w, h] = sizeOf(OffscreenCanvas.prototype, canvas);
        if (!w || !h || w * h > MAX_PIXELS) return canvas;
        const copy = new OffscreenCanvas(w, h);
        const context = Reflect.apply(offGetContext, copy, ['2d']);
        Reflect.apply(offDraw, context, [canvas, 0, 0]);
        const image = Reflect.apply(offGet, context, [0, 0, w, h]);
        noisePixels(image.data);
        Reflect.apply(offPut, context, [image, 0, 0]);
        return copy;
      };
      wrapMethod(OffscreenCanvas.prototype, 'convertToBlob', noisyExport(noisyOffscreenCopy));
      wrapMethod(off, 'getImageData', noisyRead);
    }

    for (const GL of [win.WebGLRenderingContext, win.WebGL2RenderingContext]) {
      wrapMethod(GL?.prototype, 'readPixels', (target, self, args) => {
        const result = Reflect.apply(target, self, args);
        const pixels = args[6];
        if (ArrayBuffer.isView(pixels) && pixels.BYTES_PER_ELEMENT === 1) noisePixels(pixels);
        return result;
      });
    }

    if (win.AudioBuffer) {
      const adjusted = new WeakMap(); // buffer -> channels already adjusted (getChannelData returns live data)
      const channelsOf = (buffer) => adjusted.get(buffer) || adjusted.set(buffer, new Set()).get(buffer);
      wrapMethod(win.AudioBuffer.prototype, 'getChannelData', (target, self, args) => {
        const data = Reflect.apply(target, self, args);
        const channels = channelsOf(self);
        const channel = Number(args[0]);
        if (!channels.has(channel)) {
          channels.add(channel);
          for (let i = 0; i < data.length; i += 1) data[i] *= audioFudge;
        }
        return data;
      });
      wrapMethod(win.AudioBuffer.prototype, 'copyFromChannel', (target, self, args) => {
        const result = Reflect.apply(target, self, args);
        const destination = args[0];
        if (destination && !channelsOf(self).has(Number(args[1]))) for (let i = 0; i < destination.length; i += 1) destination[i] *= audioFudge;
        return result;
      });
    }
    for (const name of ['getFloatFrequencyData', 'getFloatTimeDomainData']) {
      wrapMethod(win.AnalyserNode?.prototype, name, (target, self, args) => {
        const result = Reflect.apply(target, self, args);
        const array = args[0];
        if (array) for (let i = 0; i < array.length; i += 1) array[i] *= audioFudge;
        return result;
      });
    }

    wrapGetter(win.Navigator.prototype, 'hardwareConcurrency', (target, self, args) => Math.min(Reflect.apply(target, self, args), cores));
  }

  // Everything VRK changes in one window (the page, or a blank iframe it made).
  const protectedDocuments = new WeakSet();
  function protect(win) {
    protectedDocuments.add(win.document);

    const nativeToString = win.Function.prototype.toString;
    win.Function.prototype.toString = disguise(
      new Proxy(nativeToString, { apply: (target, self, args) => Reflect.apply(target, originals.get(self) || self, args) }),
      nativeToString,
    );

    if (gpc) {
      Object.defineProperty(win.Navigator.prototype, 'globalPrivacyControl', { get: new Proxy(function () {}, { apply: () => true }), configurable: true, enumerable: true });
    }

    // Popups need a click or key press.
    const open = win.open;
    win.open = disguise(
      new Proxy(open, {
        apply(target, self, args) {
          return win.navigator.userActivation.isActive ? Reflect.apply(target, self, args) : null;
        },
      }),
      open,
    );

    if (seed !== null) farble(win);

    if (noWebgl) {
      const webgl = /^(experimental-)?webgl2?$/i;
      const noWebglContext = (target, self, args) => (webgl.test(String(args[0])) ? null : Reflect.apply(target, self, args));
      wrapMethod(win.HTMLCanvasElement.prototype, 'getContext', noWebglContext);
      wrapMethod(win.OffscreenCanvas?.prototype, 'getContext', noWebglContext);
    }

    chromeIdentity(win);
    clipboardGuard(win);

    // A blank iframe never runs VRK's preload, so protect it when the page first
    // reaches into it. Frames that loaded a page protect themselves.
    const blankChild = (child) => {
      try {
        if (child && child.location.href === 'about:blank' && !protectedDocuments.has(child.document)) protect(child);
      } catch {
        // Cross-origin: that frame's own preload protects it.
      }
    };
    for (const Frame of [win.HTMLIFrameElement, win.HTMLFrameElement, win.HTMLObjectElement]) {
      wrapGetter(Frame?.prototype, 'contentWindow', (target, self, args) => {
        const child = Reflect.apply(target, self, args);
        blankChild(child);
        return child;
      });
      wrapGetter(Frame?.prototype, 'contentDocument', (target, self, args) => {
        const childDoc = Reflect.apply(target, self, args);
        blankChild(childDoc?.defaultView);
        return childDoc;
      });
    }
  }

  // Commands a site copies for you to paste into Terminal. Real install
  // instructions (like Homebrew's) match too; VRK only warns, it never blocks.
  const TERMINAL = [
    /\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i,
    /\$\(\s*(curl|wget)\b/i,
    /\b(ba|z)?sh\s+-c\s/i,
    /\bosascript\b/i,
    /\bbase64\s+(-d|-D|--decode)\b/i,
    /\bpython3?\s+-c\s/i,
    /\bxattr\s+-[a-z]*[cdr]/i,
    /\bspctl\s+--master-disable/i,
    /\/dev\/tcp\//i,
    /\bchmod\s+\+x\b[^\n]*(&&|;)/i,
    /\b(powershell|pwsh|mshta|rundll32|certutil)\b/i,
    /\beval\s*["'$(]/,
  ];
  const looksLikeCommand = (text) => typeof text === 'string' && text.length >= 8 && text.length <= 20000 && TERMINAL.some((re) => re.test(text));
  const reportCopy = (text) => {
    if (looksLikeCommand(text)) bridge('clipboard', { text: text.slice(0, 2000) });
  };

  function clipboardGuard(win) {
    wrapMethod(win.Clipboard?.prototype, 'writeText', (target, self, args) => {
      reportCopy(String(args[0]));
      return Reflect.apply(target, self, args);
    });
    wrapMethod(win.Clipboard?.prototype, 'write', (target, self, args) => {
      try {
        for (const item of args[0] || []) {
          if (item.types?.includes('text/plain')) Promise.resolve(item.getType('text/plain')).then((blob) => blob.text()).then(reportCopy, () => {});
        }
      } catch {}
      return Reflect.apply(target, self, args);
    });
    wrapMethod(win.DataTransfer?.prototype, 'setData', (target, self, args) => {
      if (/^text(\/plain)?$/i.test(String(args[0]))) reportCopy(String(args[1]));
      return Reflect.apply(target, self, args);
    });
    wrapMethod(win.Document.prototype, 'execCommand', (target, self, args) => {
      if (/^(copy|cut)$/i.test(String(args[0]))) {
        try {
          const active = self.activeElement;
          const text =
            active && typeof active.selectionStart === 'number' && /^(TEXTAREA|INPUT)$/.test(active.tagName)
              ? active.value.slice(active.selectionStart, active.selectionEnd)
              : String(self.defaultView?.getSelection() || '');
          reportCopy(text);
        } catch {}
      }
      return Reflect.apply(target, self, args);
    });
  }

  function chromeIdentity(win) {
    // Chrome reports three brands (Chromium, Google Chrome and a GREASE entry) in
    // an order seeded by the major version; Electron leaves "Google Chrome" out.
    const UAData = win.NavigatorUAData;
    if (UAData) {
      const proto = UAData.prototype;
      const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
      const withChrome = (list) => {
        if (!Array.isArray(list) || list.some((b) => b.brand === 'Google Chrome')) return list;
        const chromium = list.find((b) => b.brand === 'Chromium');
        const grease = list.find((b) => b.brand !== 'Chromium');
        if (!chromium || !grease) return list;
        const order = orders[parseInt(chromium.version, 10) % 6];
        const out = [];
        out[order[0]] = grease;
        out[order[1]] = chromium;
        out[order[2]] = { brand: 'Google Chrome', version: chromium.version };
        return out;
      };
      const cache = new WeakMap();
      const brands = Object.getOwnPropertyDescriptor(proto, 'brands');
      Object.defineProperty(proto, 'brands', {
        ...brands,
        get: new Proxy(brands.get, {
          apply(target, self, args) {
            if (!cache.has(self)) cache.set(self, Object.freeze(withChrome(Reflect.apply(target, self, args))));
            return cache.get(self);
          },
        }),
      });
      proto.getHighEntropyValues = new Proxy(proto.getHighEntropyValues, {
        apply(target, self, args) {
          return Reflect.apply(target, self, args).then((values) => {
            if (values.brands) values.brands = withChrome(values.brands);
            if (values.fullVersionList) values.fullVersionList = withChrome(values.fullVersionList);
            return values;
          });
        },
      });
      proto.toJSON = new Proxy(proto.toJSON, {
        apply(target, self, args) {
          const values = Reflect.apply(target, self, args);
          values.brands = withChrome(values.brands);
          return values;
        },
      });
    }

    // Chrome's window.chrome (Electron leaves it empty, which is a giveaway).
    const chrome = win.chrome || (win.chrome = {});
    if (!chrome.app) {
      const native = (fn) => new Proxy(fn, {});
      const nav = () => win.performance.getEntriesByType('navigation')[0] || {};
      const at = (ms) => (win.performance.timeOrigin + (ms || 0)) / 1000;
      chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: native(() => null),
        getIsInstalled: native(() => false),
        runningState: native(() => 'cannot_run'),
      };
      chrome.csi = native(() => ({
        startE: Math.round(win.performance.timeOrigin),
        onloadT: Math.round(win.performance.timeOrigin + (nav().domContentLoadedEventEnd || 0)),
        pageT: win.performance.now(),
        tran: 15,
      }));
      chrome.loadTimes = native(() => {
        const t = nav();
        const protocol = t.nextHopProtocol || 'http/1.1';
        const multiplexed = protocol === 'h2' || protocol === 'h3';
        return {
          requestTime: at(t.startTime),
          startLoadTime: at(t.startTime),
          commitLoadTime: at(t.responseStart),
          finishDocumentLoadTime: at(t.domContentLoadedEventEnd),
          finishLoadTime: at(t.loadEventEnd),
          firstPaintTime: at(win.performance.getEntriesByName('first-paint')[0]?.startTime),
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: multiplexed,
          wasNpnNegotiated: multiplexed,
          npnNegotiatedProtocol: protocol,
          wasAlternateProtocolAvailable: false,
          connectionInfo: protocol,
        };
      });
    }
  }

  // ── Passkeys (WebAuthn) ──
  // Requests go to VRK's authenticator through passkeyBridge; ones VRK can't
  // answer (like a hardware security key) go to Chromium's own WebAuthn.
  function installPasskeys() {
    const { CredentialsContainer, PublicKeyCredential, AuthenticatorAttestationResponse, AuthenticatorAssertionResponse } = window;
    const toB64 = (source) => {
      const view = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
      let text = '';
      for (let i = 0; i < view.length; i += 1) text += String.fromCharCode(view[i]);
      return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const toBuffer = (b64) => {
      const text = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
      const out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
      return out.buffer;
    };
    const MESSAGES = {
      NotAllowedError: 'The operation either timed out or was not allowed.',
      InvalidStateError: 'The authenticator was previously registered.',
      SecurityError: 'The relying party ID is not a registrable domain suffix of, nor equal to the current domain.',
      AbortError: 'The operation was aborted.',
    };
    const failure = (name) => (name === 'TypeError' ? new TypeError('Invalid WebAuthn options.') : new DOMException(MESSAGES[name] || 'The operation failed.', name in MESSAGES ? name : 'NotAllowedError'));

    const credential = (r, registering, wantsCredProps) => {
      const transports = ['hybrid', 'internal'];
      const extensions = registering && wantsCredProps ? { credProps: { rk: true } } : {};
      const response = registering
        ? {
            clientDataJSON: toBuffer(r.clientDataJSON),
            attestationObject: toBuffer(r.attestationObject),
            getTransports: () => [...transports],
            getAuthenticatorData: () => toBuffer(r.authenticatorData),
            getPublicKey: () => toBuffer(r.publicKey),
            getPublicKeyAlgorithm: () => r.publicKeyAlgorithm,
          }
        : {
            clientDataJSON: toBuffer(r.clientDataJSON),
            authenticatorData: toBuffer(r.authenticatorData),
            signature: toBuffer(r.signature),
            userHandle: r.userHandle ? toBuffer(r.userHandle) : null,
          };
      Object.setPrototypeOf(response, (registering ? AuthenticatorAttestationResponse : AuthenticatorAssertionResponse).prototype);
      const json = registering
        ? { clientDataJSON: r.clientDataJSON, attestationObject: r.attestationObject, authenticatorData: r.authenticatorData, transports, publicKey: r.publicKey, publicKeyAlgorithm: r.publicKeyAlgorithm }
        : { clientDataJSON: r.clientDataJSON, authenticatorData: r.authenticatorData, signature: r.signature, userHandle: r.userHandle || undefined };
      const result = {
        id: r.id,
        rawId: toBuffer(r.id),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response,
        getClientExtensionResults: () => ({ ...extensions }),
        toJSON: () => ({ id: r.id, rawId: r.id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: { ...extensions }, response: json }),
      };
      Object.setPrototypeOf(result, PublicKeyCredential.prototype);
      return result;
    };

    const run = (kind, request, signal, registering, wantsCredProps, native) =>
      new Promise((resolve, reject) => {
        const aborted = () => signal.reason ?? new DOMException(MESSAGES.AbortError, 'AbortError');
        if (signal?.aborted) return reject(aborted());
        const onAbort = () => {
          passkeyBridge('abort');
          reject(aborted());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(passkeyBridge(kind, request)).then(
          (answer) => {
            signal?.removeEventListener('abort', onAbort);
            if (answer?.fallback) return native().then(resolve, reject);
            if (answer?.error) return reject(failure(answer.error));
            resolve(credential(answer.response, registering, wantsCredProps));
          },
          () => reject(failure('NotAllowedError')),
        );
      });

    wrapMethod(CredentialsContainer.prototype, 'create', (target, self, args) => {
      const options = args[0];
      const pk = options?.publicKey;
      if (!pk) return Reflect.apply(target, self, args);
      let request;
      try {
        request = {
          rpId: pk.rp?.id,
          challenge: toB64(pk.challenge),
          userId: toB64(pk.user.id),
          userName: String(pk.user.name ?? ''),
          displayName: String(pk.user.displayName ?? ''),
          algorithms: [...(pk.pubKeyCredParams || [])].filter((p) => p.type === 'public-key').map((p) => p.alg),
          exclude: [...(pk.excludeCredentials || [])].map((c) => toB64(c.id)),
          attachment: pk.authenticatorSelection?.authenticatorAttachment || null,
        };
      } catch {
        return Reflect.apply(target, self, args); // malformed: Chromium reports the right error
      }
      return run('create', request, options.signal, true, Boolean(pk.extensions?.credProps), () => Reflect.apply(target, self, args));
    });
    wrapMethod(CredentialsContainer.prototype, 'get', (target, self, args) => {
      const options = args[0];
      const pk = options?.publicKey;
      if (!pk) return Reflect.apply(target, self, args);
      let request;
      try {
        request = { rpId: pk.rpId, challenge: toB64(pk.challenge), allow: [...(pk.allowCredentials || [])].map((c) => toB64(c.id)) };
      } catch {
        return Reflect.apply(target, self, args);
      }
      const kind = options.mediation === 'conditional' ? 'conditional' : 'get';
      return run(kind, request, options.signal, false, false, () => Reflect.apply(target, self, args));
    });
    const answer = (value) => () => Promise.resolve(value);
    wrapMethod(PublicKeyCredential, 'isUserVerifyingPlatformAuthenticatorAvailable', answer(Boolean(uv)));
    wrapMethod(PublicKeyCredential, 'isConditionalMediationAvailable', answer(true));
    wrapMethod(PublicKeyCredential, 'getClientCapabilities', (target, self, args) =>
      Promise.resolve(Reflect.apply(target, self, args))
        .catch(() => ({}))
        .then((capabilities) => ({ ...capabilities, conditionalGet: true, passkeyPlatformAuthenticator: true, userVerifyingPlatformAuthenticator: Boolean(uv) })),
    );
  }

  protect(window);
  if (passkeys && window === window.top && window.PublicKeyCredential) installPasskeys();
}

// The page's passkey requests (and copied Terminal commands) arrive here from
// the main world. A "conditional" passkey sign-in (offered in autofill) waits
// until you pick a passkey from the list.
let conditional = null;
function pageBridge(kind, request) {
  if (kind === 'clipboard') {
    ipcRenderer.send('vrk-page:clipboard-command', String(request?.text || '').slice(0, 2000));
    return null;
  }
  if (!config.passkeys) return { fallback: true };
  if (kind === 'abort') {
    conditional?.resolve({ error: 'AbortError' });
    conditional = null;
    return null;
  }
  if (kind === 'conditional') {
    return ipcRenderer.invoke('vrk-page:passkey', 'list', request).then((answer) => {
      if (answer?.error) return answer;
      return new Promise((resolve) => {
        conditional?.resolve({ error: 'AbortError' });
        conditional = { request, passkeys: answer?.passkeys || [], resolve };
      });
    });
  }
  return ipcRenderer.invoke('vrk-page:passkey', kind, request);
}

try {
  if (isWebPage) {
    contextBridge.executeInMainWorld({
      func: mainWorld,
      args: [
        {
          gpc: Boolean(config.gpc),
          seed: Number.isInteger(config.seed) ? config.seed : null,
          noWebgl: Boolean(config.noWebgl),
          passkeys: Boolean(config.passkeys),
          uv: Boolean(config.uv),
        },
        pageBridge,
      ],
    });
  }
} catch {
  // Frames without a main world (e.g. during teardown) need nothing.
}

// Decoy elements that anti-adblock scripts (and ad-block tests) check for.
const BAIT_CSS = `
  .adsbox, .ad-box, .adbox, .textads, .textAd, .text-ad, .text_ad, .text-ads, .text_ads, .text-ad-links,
  .banner-ads, .banner_ads, .banner-ad, .banner_ad, .ad-unit, .ad-zone, .ad-space, .afs_ads, .ad-placement,
  .pub_300x250, .pub_300x250m, .pub_728x90, .adBanner, .ad-banner, #ad-banner, #ad_banner, #adBanner
  { display: none !important; }`;
if (isWebPage && config.bait) {
  try {
    webFrame.insertCSS(BAIT_CSS);
  } catch {}
}

// ── Cookie banners: click "Reject all" ──────────────────────────────────
// Known consent platforms first; otherwise a reject-style button, but only
// inside something that's clearly a cookie/consent banner. Runs for the
// first 20 seconds of a page (banners often appear late), then stops.

const REJECT_SELECTORS = [
  '#onetrust-reject-all-handler',
  '#CybotCookiebotDialogBodyButtonDecline',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
  '#didomi-notice-disagree-button',
  '.cky-btn-reject',
  '.cmplz-btn.cmplz-deny',
  '.osano-cm-denyAll',
  '#truste-consent-required',
  'button.sp_choice_type_REJECT_ALL',
  '#axeptio_btn_dismiss',
  '.iubenda-cs-reject-btn',
  '.cc-window .cc-deny',
  '#shopify-pc__banner__btn-decline',
  '[data-tid="banner-decline"]',
  '.fc-cta-do-not-consent',
  '#cmpwelcomebtnno',
  '.cmpboxbtnno',
  '#tarteaucitronAllDenied2',
  '.ch2-deny-all-btn',
  'a[data-cookie-refuse]',
  '#_evidon-decline-button',
];
const REJECT_TEXT =
  /^(reject|decline|deny|refuse)( all)?( cookies| non-essential( cookies)?| optional( cookies)?)?$|^(use |accept )?(only )?(necessary|essential|required|strictly necessary)( cookies)?( only)?$|^continue without (accepting|agreeing)$|^(do not|don['’]t) (accept|consent|agree)$|^disagree( and close)?$/i;
const BANNER_HINT = /cookie|consent|gdpr|cmp|onetrust|didomi|usercentrics|quantcast|truste|cookiebot|privacy-?banner/i;

function rejectCookieBanners() {
  let done = false;
  let queued = false;
  const press = (button) => {
    button.click();
    done = true;
  };
  const attempt = () => {
    queued = false;
    if (done) return;
    for (const selector of REJECT_SELECTORS) {
      const button = document.querySelector(selector);
      if (button) return press(button);
    }
    const shadowButton = document.querySelector('#usercentrics-root, #usercentrics-cmp-ui')?.shadowRoot?.querySelector('[data-testid="uc-deny-all-button"]');
    if (shadowButton) return press(shadowButton);
    if (/^consent\.(google|youtube)\./.test(location.hostname)) {
      const google = document.querySelector('button[aria-label="Reject all"], form[action*="consent"] button[jsname]');
      if (google && /reject/i.test(google.getAttribute('aria-label') || google.textContent)) return press(google);
    }
    for (const button of document.querySelectorAll('button, [role="button"], input[type="button"], a[role="link"], a[href="#"]')) {
      const text = String(button.innerText || button.value || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 40 || !REJECT_TEXT.test(text)) continue;
      for (let el = button, i = 0; el && i < 8; el = el.parentElement, i += 1) {
        if (BANNER_HINT.test(`${el.id || ''} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute?.('aria-label') || ''}`)) return press(button);
      }
    }
  };
  const observer = new MutationObserver(() => {
    if (done) return observer.disconnect();
    if (!queued) {
      queued = true;
      setTimeout(attempt, 400); // at most a couple of checks a second
    }
  });
  const start = () => {
    attempt();
    if (done) return;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 20000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

if (isWebPage && config.rejectBanners) rejectCookieBanners();

// ── Password manager ─────────────────────────────────────────────────────

const PANEL_CSS = `
  :host { all: initial; }
  .box { font: 13px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; background: #15161d; color: #e9eaf0;
         border: 1px solid #2e3140; border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.45); overflow: hidden; min-width: 240px; }
  .head { padding: 8px 12px 6px; color: #8a8fa3; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
  button { all: unset; box-sizing: border-box; display: flex; flex-direction: column; gap: 1px; width: 100%; padding: 8px 12px; cursor: default; }
  button:hover, button:focus, button.on { background: rgba(139,123,255,.18); }
  .user { font-weight: 600; } .site { color: #8a8fa3; font-size: 11.5px; }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .02em; }
`;

// A strong password like "kX7qz-mP3wd-R9tLc-v2NhJ" (about 115 bits): four groups
// of five letters and digits, without look-alikes, always mixing all three kinds.
function strongPassword() {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => {
    const limit = 4294967296 - (4294967296 % chars.length); // no modulo bias
    const value = new Uint32Array(1);
    do crypto.getRandomValues(value);
    while (value[0] >= limit);
    return chars[value[0] % chars.length];
  };
  for (;;) {
    const password = Array.from({ length: 4 }, () => Array.from({ length: 5 }, pick).join('')).join('-');
    if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)) return password;
  }
}

function setupPasswords() {
  const visible = (el) => el.offsetWidth > 0 && el.offsetHeight > 0 && getComputedStyle(el).visibility !== 'hidden';
  const usable = (el) => el instanceof HTMLInputElement && !el.disabled && !el.readOnly;
  const isPassword = (el) => usable(el) && el.type === 'password';
  const isUsername = (el) =>
    usable(el) &&
    ['text', 'email', 'tel'].includes(el.type) &&
    (el.type === 'email' ||
      /user|e-?mail|login|identifier|account|phone/i.test(
        `${el.name} ${el.id} ${el.autocomplete} ${el.getAttribute('aria-label') || ''} ${el.placeholder}`,
      ));
  const scopeOf = (el) => el.form || el.closest?.('form') || document;
  const passwordIn = (root) => [...root.querySelectorAll('input[type=password]')].find((el) => usable(el) && visible(el));
  const usernameIn = (root, password) => {
    const fields = [...root.querySelectorAll('input')].filter((el) => isUsername(el) && visible(el));
    if (!password) return fields[0];
    // Prefer the last username-like field before the password field.
    const before = fields.filter((el) => el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before[before.length - 1] || fields[0];
  };

  let saved = null;
  const savedLogins = () => (saved ||= ipcRenderer.invoke('vrk-page:pw-list').catch(() => []));

  // Verification-code fields (2FA), including codes split over single-digit boxes.
  const isCodeField = (el) =>
    usable(el) &&
    ['text', 'tel', 'number'].includes(el.type) &&
    (/one-time-code/i.test(el.autocomplete) ||
      /(^|[^a-z])(otp|totp|2fa|mfa|one.?time|verification.?code|verify|security.?code|auth(entication)?.?code|passcode|two.?factor)/i.test(
        `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`,
      ) ||
      (el.inputMode === 'numeric' && el.maxLength >= 6 && el.maxLength <= 8) ||
      // A row of one-character boxes (one per digit).
      (el.maxLength === 1 && [...scopeOf(el).querySelectorAll('input')].filter((i) => i.maxLength === 1 && visible(i)).length >= 4));
  async function fillCode(id, input) {
    const code = await ipcRenderer.invoke('vrk-page:totp-code', id).catch(() => null);
    if (!code) return;
    const boxes = input.maxLength === 1 ? [...scopeOf(input).querySelectorAll('input')].filter((i) => usable(i) && visible(i) && i.maxLength === 1) : [];
    if (boxes.length >= code.length) code.split('').forEach((digit, i) => setValue(boxes[i], digit));
    else setValue(input, code);
  }

  // Sign-up and change-password forms get a strong password suggestion.
  const wantsNewPassword = (el) => {
    if (!isPassword(el)) return false;
    if (/new-password/i.test(el.autocomplete)) return true;
    if (/current-password/i.test(el.autocomplete)) return false;
    const label = `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`;
    if (/new|confirm|create|register|sign.?up|repeat|again|verify/i.test(label)) return true;
    return [...scopeOf(el).querySelectorAll('input[type=password]')].filter((p) => usable(p) && visible(p)).length >= 2;
  };
  function useStrongPassword(input, password) {
    const root = scopeOf(input);
    const fields = [...root.querySelectorAll('input[type=password]')].filter((p) => usable(p) && visible(p) && wantsNewPassword(p));
    for (const field of fields.length ? fields : [input]) setValue(field, password);
    input.focus();
  }

  function usePasskey(id) {
    const pending = conditional;
    if (!pending) return;
    ipcRenderer.invoke('vrk-page:passkey', 'get', { ...pending.request, pick: id }).then((answer) => {
      if (answer?.error === 'NotAllowedError') return; // Touch ID cancelled: keep offering it
      if (conditional === pending) conditional = null;
      pending.resolve(answer);
    });
  }

  let host = null;
  let rows = [];
  let highlighted = -1;
  const hide = () => {
    host?.remove();
    host = null;
    rows = [];
    highlighted = -1;
  };
  const highlight = (index) => {
    highlighted = (index + rows.length) % rows.length;
    rows.forEach((row, i) => row.classList.toggle('on', i === highlighted));
  };

  // items: [{ title, subtitle, mono?, pick }]
  function show(input, items) {
    hide();
    host = document.createElement('vrk-autofill');
    // Only VRK's isolated world can see this property, never the page; the
    // self-test uses it to pick an item the way the keyboard does.
    host.vrkSelect = (index) => items[index].pick();
    host.vrkItems = items.map((item) => item.title);
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PANEL_CSS);
    shadow.adoptedStyleSheets = [sheet];
    const box = document.createElement('div');
    box.className = 'box';
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = 'VRK';
    box.append(head);
    for (const item of items) {
      const row = document.createElement('button');
      const title = document.createElement('span');
      title.className = 'user';
      title.textContent = item.title;
      const subtitle = document.createElement('span');
      subtitle.className = item.mono ? 'site mono' : 'site';
      subtitle.textContent = item.subtitle;
      row.append(title, subtitle);
      row.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the field
      row.addEventListener('click', () => {
        hide();
        item.pick();
      });
      box.append(row);
      rows.push(row);
    }
    shadow.append(box);
    const rect = input.getBoundingClientRect();
    Object.assign(host.style, {
      position: 'fixed',
      zIndex: '2147483647',
      top: `${Math.min(rect.bottom + 4, innerHeight - 40)}px`,
      left: `${Math.max(4, rect.left)}px`,
      width: `${Math.max(rect.width, 240)}px`,
    });
    document.documentElement.append(host);
  }

  function setValue(el, value) {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fill(id, input) {
    hide();
    const login = await ipcRenderer.invoke('vrk-page:pw-fill', id).catch(() => null);
    if (!login) return;
    const root = scopeOf(input);
    const password = isPassword(input) ? input : passwordIn(root);
    const username = isUsername(input) ? input : usernameIn(root, password);
    if (username && login.username) setValue(username, login.username);
    if (password) setValue(password, login.password);
  }

  document.addEventListener(
    'focusin',
    async (event) => {
      const el = event.target;
      if (isCodeField(el) && !isPassword(el)) {
        const codes = await ipcRenderer.invoke('vrk-page:totp-list').catch(() => []);
        const items = codes.map((c) => ({ title: `2FA code${c.username ? ` for ${c.username}` : ''}`, subtitle: c.issuer || location.hostname, pick: () => fillCode(c.id, el) }));
        if (items.length && document.activeElement === el) show(el, items);
        return;
      }
      if (!isPassword(el) && !isUsername(el)) return;
      const items = (conditional?.passkeys || []).map((p) => ({ title: p.userName || 'Passkey', subtitle: `Passkey · ${location.hostname}`, pick: () => usePasskey(p.id) }));
      if (!wantsNewPassword(el)) {
        for (const login of await savedLogins()) {
          items.push({ title: login.username || '(no username)', subtitle: `${'•'.repeat(8)}  ${login.site}`, pick: () => fill(login.id, el) });
        }
      } else {
        const password = strongPassword();
        items.push({ title: 'Use a strong password', subtitle: password, mono: true, pick: () => useStrongPassword(el, password) });
      }
      if (items.length && document.activeElement === el) show(el, items);
    },
    true,
  );
  document.addEventListener('focusout', () => setTimeout(() => host && !host.matches(':hover') && hide(), 150), true);
  // ↓/↑ choose a saved login, Enter fills it, Escape closes the list.
  document.addEventListener(
    'keydown',
    (event) => {
      if (!host) return;
      if (event.key === 'Escape') hide();
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        highlight(highlighted + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Enter' && highlighted >= 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        rows[highlighted].click();
      }
    },
    true,
  );
  addEventListener('scroll', hide, true);
  addEventListener('resize', hide);

  // Offer to save when a sign-in is submitted (by button, Enter or form submit).
  let lastOffer = '';
  let lastHint = '';
  function capture(root) {
    const password = passwordIn(root) || (root !== document ? passwordIn(document) : null);
    if (!password?.value) {
      // Multi-step sign-ins (like Google's) ask for the username on a page of its own.
      const username = usernameIn(root);
      if (username?.value && username.value !== lastHint) {
        lastHint = username.value;
        ipcRenderer.send('vrk-page:pw-hint', username.value.slice(0, 256));
      }
      return;
    }
    const username = usernameIn(scopeOf(password), password);
    const key = `${username?.value || ''}\u0000${password.value}`;
    if (key === lastOffer) return;
    lastOffer = key;
    ipcRenderer.send('vrk-page:pw-offer', { username: (username?.value || '').slice(0, 256), password: password.value.slice(0, 1024) });
  }
  document.addEventListener('submit', (event) => capture(event.target), true);
  document.addEventListener('keydown', (event) => event.key === 'Enter' && usable(event.target) && capture(scopeOf(event.target)), true);
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('button, input[type=submit], [role=button]');
      if (button) capture(button.form || button.closest('form') || document);
    },
    true,
  );
}

if (isWebPage && config.passwords) setupPasswords();
