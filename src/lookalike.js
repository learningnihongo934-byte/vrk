'use strict';
// Lookalike-domain detection: sites dressed up as popular ones, the way
// phishing works. Catches swapped look-alike characters (paypa1, rnicrosoft,
// g00gle), other alphabets that look Latin (аpple with a Cyrillic "а"),
// one-letter typos of well-known names (amazom), and brand names glued to
// sign-in words (apple-id-verify.com).

const { domainToUnicode } = require('node:url');
const { parse } = require('tldts');

// Popular and often-impersonated sites (registrable domains).
const POPULAR = `
google.com youtube.com gmail.com apple.com icloud.com microsoft.com live.com outlook.com office.com microsoftonline.com
bing.com amazon.com paypal.com venmo.com cash.app chase.com bankofamerica.com wellsfargo.com citi.com capitalone.com
usbank.com americanexpress.com discover.com schwab.com fidelity.com vanguard.com robinhood.com coinbase.com binance.com
kraken.com crypto.com metamask.io blockchain.com facebook.com instagram.com whatsapp.com messenger.com twitter.com x.com
tiktok.com snapchat.com linkedin.com reddit.com discord.com twitch.tv steamcommunity.com steampowered.com epicgames.com
roblox.com minecraft.net xbox.com playstation.com nintendo.com netflix.com spotify.com hulu.com disneyplus.com dropbox.com
github.com gitlab.com adobe.com zoom.us docusign.com docusign.net fedex.com ups.com usps.com dhl.com irs.gov ssa.gov ebay.com
walmart.com target.com bestbuy.com costco.com etsy.com shopify.com booking.com airbnb.com expedia.com yahoo.com aol.com
proton.me protonmail.com wikipedia.org openai.com chatgpt.com claude.ai anthropic.com duckduckgo.com mozilla.org
telegram.org signal.org stripe.com squareup.com intuit.com turbotax.com salesforce.com slack.com notion.so canva.com
wise.com revolut.com hsbc.com barclays.co.uk lloydsbank.com santander.com ing.com zelle.com navyfederal.org usaa.com
ally.com sofi.com chime.com tdbank.com pnc.com truist.com att.com verizon.com t-mobile.com comcast.net xfinity.com
`.split(/\s+/).filter(Boolean);

const POPULAR_SET = new Set(POPULAR);
const LABELS = new Map(POPULAR.map((domain) => [parse(domain).domainWithoutSuffix, domain]));

// Characters from other alphabets (and digits) that look like Latin letters.
const CONFUSABLE = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ɡ: 'g', ո: 'n', ս: 'u',
  α: 'a', ο: 'o', ρ: 'p', ν: 'v', τ: 't', κ: 'k', ι: 'i', ε: 'e', υ: 'u', χ: 'x', ω: 'w', ɑ: 'a', ı: 'i', ǀ: 'l',
  '0': 'o', '1': 'l', '3': 'e', '5': 's', '7': 't', '$': 's', i: 'l', '|': 'l',
};
// Turns a label into its "skeleton": what it looks like, not what it is.
function skeleton(label) {
  let out = '';
  for (const ch of label.normalize('NFKC').toLowerCase()) out += CONFUSABLE[ch] ?? ch;
  return out.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd').replace(/-/g, '');
}

// Damerau–Levenshtein distance, capped (we only care whether it's 1).
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const SIGN_IN_WORDS = /(^|-)(login|log-in|signin|sign-in|secure|security|verify|verification|account|accounts|support|update|billing|wallet|auth|id|recovery|unlock|confirm|service|help)(-|$)/;

// Returns the popular domain this host imitates, or null.
function lookalikeOf(hostname) {
  const ascii = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const info = parse(ascii);
  if (!info.domain || !info.isIcann || POPULAR_SET.has(info.domain)) return null;
  const label = info.domainWithoutSuffix;
  const unicode = label.startsWith('xn--') ? domainToUnicode(info.domain).split('.')[0] : label;
  const shape = skeleton(unicode);

  for (const [popular, domain] of LABELS) {
    if (popular.length < 3) continue;
    // Looks the same once look-alike characters are undone (paypa1, аpple, rnicrosoft).
    if (shape === skeleton(popular) && unicode !== popular) return domain;
    // One typo away from a longer, well-known name (amazom, gooogle).
    if (popular.length >= 6 && label.length >= 6 && !label.startsWith('xn--') && label !== `${popular}s` && distance(label, popular) === 1) return domain;
    // A brand glued to sign-in words (apple-id-verify, secure-paypal-login).
    if (popular.length >= 4 && label.includes('-') && label.split('-').includes(popular) && SIGN_IN_WORDS.test(label.replace(popular, ''))) return domain;
  }
  return null;
}

module.exports = { lookalikeOf, skeleton };
