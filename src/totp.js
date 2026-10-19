'use strict';
// Two-factor codes (TOTP, RFC 6238): the 6-digit codes authenticator apps
// show. A site gives you a secret once (usually as a QR code); VRK stores it
// with the login, encrypted like the password, and computes the codes.

const crypto = require('node:crypto');

const ALGORITHMS = { SHA1: 'sha1', SHA256: 'sha256', SHA512: 'sha512' };

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error('That isn’t a valid 2FA secret.');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// Accepts an otpauth://totp/… link (what QR codes contain) or a bare secret.
function parseTotp(input) {
  const text = String(input || '').trim();
  if (/^otpauth:/i.test(text)) {
    const u = new URL(text);
    if (u.host.toLowerCase() !== 'totp') throw new Error('Only time-based (TOTP) codes are supported.');
    const secret = u.searchParams.get('secret') || '';
    base32Decode(secret); // validates
    const algorithm = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    const digits = Number(u.searchParams.get('digits') || 6);
    const period = Number(u.searchParams.get('period') || 30);
    if (!ALGORITHMS[algorithm] || ![6, 7, 8].includes(digits) || !(period >= 10 && period <= 120)) throw new Error('That 2FA link has settings VRK doesn’t support.');
    const label = decodeURIComponent(u.pathname.replace(/^\//, ''));
    return { secret: secret.toUpperCase().replace(/\s/g, ''), algorithm, digits, period, issuer: u.searchParams.get('issuer') || label.split(':')[0] || '', label };
  }
  base32Decode(text);
  return { secret: text.toUpperCase().replace(/[\s-]/g, ''), algorithm: 'SHA1', digits: 6, period: 30, issuer: '', label: '' };
}

function totpCode({ secret, algorithm = 'SHA1', digits = 6, period = 30 }, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const hmac = crypto.createHmac(ALGORITHMS[algorithm] || 'sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return {
    code: String(binary % 10 ** digits).padStart(digits, '0'),
    secondsLeft: period - (Math.floor(now / 1000) % period),
  };
}

module.exports = { parseTotp, totpCode, base32Decode };
