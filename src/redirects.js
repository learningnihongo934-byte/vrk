'use strict';
// Tracking-redirect skipping (like Brave's "debouncing"). Many links go
// through a tracker first (google.com/url?q=…, l.facebook.com/l.php?u=…,
// affiliate networks) only so it can log the click. When the real
// destination is right there in the link, VRK goes straight to it.

// [host, path, parameter(s) holding the destination]
const RULES = [
  [/(^|\.)google\.[a-z.]+$/, /^\/url$/, ['q', 'url']],
  [/^(l|lm)\.facebook\.com$|^l\.messenger\.com$/, /^\/l\.php$/, ['u']],
  [/^l\.instagram\.com$/, /^\/$/, ['u']],
  [/^(www\.|m\.)?youtube\.com$/, /^\/redirect$/, ['q']],
  [/^out\.reddit\.com$/, /./, ['url']],
  [/^(www\.)?linkedin\.com$/, /^\/redir\/redirect/, ['url']],
  [/^slack-redir\.net$/, /^\/link$/, ['url']],
  [/^steamcommunity\.com$/, /^\/linkfilter\//, ['url', 'u']],
  [/^click\.linksynergy\.com$/, /./, ['murl', 'RD_PARM1']],
  [/^(www\.)?awin1\.com$/, /^\/cread\.php$/, ['ued']],
  [/^go\.redirectingat\.com$/, /./, ['url']],
  [/^(www\.)?(anrdoezrs\.net|jdoqocy\.com|tkqlhce\.com|dpbolvw\.net|kqzyfj\.com)$/, /./, ['url']],
  [/^t\.umblr\.com$/, /^\/redirect$/, ['z']],
  [/^(www\.)?pinterest\.[a-z.]+$/, /^\/offsite/, ['url']],
  [/^(away|www|m)\.vk\.com$/, /^\/away\.php$/, ['to']],
  [/^(www\.)?shareasale\.com$/, /^\/r\.cfm$/, ['urllink']],
  [/^(www\.)?bing\.com$/, /^\/ck\/a$/, ['u']],
  [/^disq\.us$/, /^\/url$/, ['url']],
  [/^(www\.)?viglink\.com$|^redirect\.viglink\.com$/, /./, ['u', 'out']],
];

function destination(value) {
  if (!value) return null;
  let text = value;
  // Bing wraps the address as "a1" + base64.
  if (/^a1[A-Za-z0-9_-]+={0,2}$/.test(text)) {
    try {
      text = Buffer.from(text.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } catch {}
  }
  try {
    const u = new URL(text);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

// isTracker(host): whole-domain ad/telemetry servers (HaGeZi), for click
// trackers not listed above. Login pages' "continue to" links never qualify.
function skipRedirect(u, isTracker = () => false) {
  const host = u.hostname.toLowerCase();
  const rule = RULES.find(([h, p]) => h.test(host) && p.test(u.pathname));
  const names = rule ? rule[2] : isTracker(host) ? [...u.searchParams.keys()] : [];
  for (const name of names) {
    const target = destination(u.searchParams.get(name));
    if (target && target.hostname !== host) return target.href;
  }
  return null;
}

module.exports = { skipRedirect };
