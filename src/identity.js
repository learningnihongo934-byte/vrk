'use strict';
// VRK presents one consistent identity, desktop Google Chrome of the same
// version as its Chromium engine, in the User-Agent string, the client-hint
// headers and navigator.userAgentData alike. Disagreement between those
// channels is a fingerprinting signal, and it's why Google's sign-in rejects
// many Chromium-based browsers as "not secure".

const FULL_VERSION = process.versions.chrome;
const MAJOR = FULL_VERSION.split('.')[0];
const PLATFORM = { darwin: 'macOS', win32: 'Windows' }[process.platform] || 'Linux';
const UA_PLATFORM =
  { darwin: 'Macintosh; Intel Mac OS X 10_15_7', win32: 'Windows NT 10.0; Win64; x64' }[process.platform] || 'X11; Linux x86_64';
const USER_AGENT = `Mozilla/5.0 (${UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR}.0.0.0 Safari/537.36`;
const ARCHITECTURE = process.arch.startsWith('arm') ? 'arm' : 'x86';

function platformVersion() {
  const parts = String(process.getSystemVersion?.() || '0').split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).join('.');
}

// Chromium's GREASE brand list (components/embedder_support/user_agent_utils.cc),
// seeded by the major version, with "Google Chrome" in the slot real Chrome uses.
function brandList({ full = false } = {}) {
  const seed = Number(MAJOR);
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const greaseVersion = ['8', '99', '24'][seed % 3];
  const grease = {
    brand: `Not${chars[seed % chars.length]}A${chars[(seed + 1) % chars.length]}Brand`,
    version: full ? `${greaseVersion}.0.0.0` : greaseVersion,
  };
  const order = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]][seed % 6];
  const version = full ? FULL_VERSION : MAJOR;
  const list = [];
  list[order[0]] = grease;
  list[order[1]] = { brand: 'Chromium', version };
  list[order[2]] = { brand: 'Google Chrome', version };
  return list;
}

const structured = (list) => list.map(({ brand, version }) => `"${brand}";v="${version}"`).join(', ');

// Sent on every request to a secure origin, exactly like Chrome.
const LOW_ENTROPY_HINTS = {
  'sec-ch-ua': structured(brandList()),
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': `"${PLATFORM}"`,
};

// Sent only to origins that ask for them with an Accept-CH response header.
const HIGH_ENTROPY_HINTS = {
  'sec-ch-ua-full-version-list': structured(brandList({ full: true })),
  'sec-ch-ua-full-version': `"${FULL_VERSION}"`,
  'sec-ch-ua-platform-version': `"${platformVersion()}"`,
  'sec-ch-ua-arch': `"${ARCHITECTURE}"`,
  'sec-ch-ua-bitness': '"64"',
  'sec-ch-ua-model': '""',
  'sec-ch-ua-wow64': '?0',
  'sec-ch-ua-form-factors': '"Desktop"',
};

function isSecureUrl(url) {
  return /^(https|wss):/i.test(url) || /^(http|ws):\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
}

function parseAcceptCH(value) {
  return new Set(
    String(value)
      .split(',')
      .map((hint) => hint.trim().toLowerCase())
      .filter((hint) => hint in HIGH_ENTROPY_HINTS),
  );
}

// Replaces whatever client hints Chromium generated with Chrome's.
function applyClientHints(headers, url, requested) {
  for (const key of Object.keys(headers)) if (key.toLowerCase().startsWith('sec-ch-ua')) delete headers[key];
  if (!isSecureUrl(url)) return;
  Object.assign(headers, LOW_ENTROPY_HINTS);
  if (requested) for (const hint of requested) headers[hint] = HIGH_ENTROPY_HINTS[hint];
}

module.exports = { USER_AGENT, FULL_VERSION, applyClientHints, parseAcceptCH, brandList };
