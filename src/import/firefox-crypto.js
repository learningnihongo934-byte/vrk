'use strict';
// Decrypts Firefox saved logins (logins.json + key4.db) the way Firefox's NSS
// does, using only Node's crypto. Supports both key-derivation schemes Firefox
// has used (PBE-SHA1-3DES and PBES2 with PBKDF2-SHA256 + AES-256) and both
// login ciphers (3DES-CBC and AES-256-CBC).

const crypto = require('node:crypto');

// ── Minimal DER reader ───────────────────────────────────────────────────

function readDer(buf, offset = 0) {
  const tag = buf[offset];
  let length = buf[offset + 1];
  let header = 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < bytes; i += 1) length = length * 256 + buf[offset + 2 + i];
    header += bytes;
  }
  const start = offset + header;
  const node = { tag, value: buf.subarray(start, start + length), end: start + length };
  if (tag & 0x20) {
    node.children = [];
    let cursor = start;
    while (cursor < node.end) {
      const child = readDer(buf, cursor);
      node.children.push(child);
      cursor = child.end;
    }
  }
  return node;
}

function oidString(bytes) {
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

const intOf = (node) => node.value.reduce((n, byte) => n * 256 + byte, 0);

const OID = {
  PBE_SHA1_3DES: '1.2.840.113549.1.12.5.1.3',
  PBES2: '1.2.840.113549.1.5.13',
  DES_EDE3_CBC: '1.2.840.113549.3.7',
  AES_256_CBC: '2.16.840.1.101.3.4.1.42',
};

// ── Password-based decryption of key4.db entries ─────────────────────────

function decryptPbe(der, globalSalt, primaryPassword) {
  const root = readDer(der);
  const [algorithm, cipherText] = root.children;
  const oid = oidString(algorithm.children[0].value);
  const params = algorithm.children[1];
  const password = Buffer.from(primaryPassword, 'utf8');

  if (oid === OID.PBE_SHA1_3DES) {
    const entrySalt = params.children[0].value;
    const hp = crypto.createHash('sha1').update(Buffer.concat([globalSalt, password])).digest();
    const pes = Buffer.concat([entrySalt, Buffer.alloc(20 - entrySalt.length)]);
    const chp = crypto.createHash('sha1').update(Buffer.concat([hp, entrySalt])).digest();
    const hmac = (data) => crypto.createHmac('sha1', chp).update(data).digest();
    const k1 = hmac(Buffer.concat([pes, entrySalt]));
    const tk = hmac(pes);
    const k2 = hmac(Buffer.concat([tk, entrySalt]));
    const k = Buffer.concat([k1, k2]);
    return decipher('des-ede3-cbc', k.subarray(0, 24), k.subarray(k.length - 8), cipherText.value);
  }

  if (oid === OID.PBES2) {
    const [kdf, cipher] = params.children;
    const [salt, iterations, keyLength] = kdf.children[1].children;
    const k = crypto.createHash('sha1').update(Buffer.concat([globalSalt, password])).digest();
    const key = crypto.pbkdf2Sync(k, salt.value, intOf(iterations), intOf(keyLength), 'sha256');
    // NSS stores a 14-byte IV; the real one is that, prefixed with 0x04 0x0e.
    const iv = Buffer.concat([Buffer.from([0x04, 0x0e]), cipher.children[1].value]);
    return decipher('aes-256-cbc', key, iv, cipherText.value);
  }

  throw new Error(`Unsupported Firefox key encryption (${oid}).`);
}

function decipher(algorithm, key, iv, data) {
  const d = crypto.createDecipheriv(algorithm, key, iv);
  return Buffer.concat([d.update(data), d.final()]);
}

// ── Public API ───────────────────────────────────────────────────────────

class PrimaryPasswordError extends Error {}

// db: an open node:sqlite DatabaseSync on a copy of key4.db. Returns every
// key in the database: newer profiles hold both a legacy 3DES key and an
// AES-256 key under the same ID.
function masterKeys(db, primaryPassword = '') {
  const meta = db.prepare("SELECT item1, item2 FROM metadata WHERE id = 'password'").get();
  if (!meta) throw new Error('This Firefox profile has no key database.');
  const globalSalt = Buffer.from(meta.item1);
  let check;
  try {
    check = decryptPbe(Buffer.from(meta.item2), globalSalt, primaryPassword).toString('latin1');
  } catch {
    check = '';
  }
  if (!check.startsWith('password-check')) {
    throw new PrimaryPasswordError('This Firefox profile is protected by a primary password.');
  }
  const keys = [];
  for (const row of db.prepare('SELECT a11, a102 FROM nssPrivate').all()) {
    try {
      keys.push({ id: Buffer.from(row.a102), key: decryptPbe(Buffer.from(row.a11), globalSalt, primaryPassword) });
    } catch {
      // Unreadable key: logins that need it will be skipped.
    }
  }
  if (!keys.length) throw new Error('This Firefox profile has no saved-password key.');
  return keys;
}

function decryptField(keys, base64) {
  const root = readDer(Buffer.from(base64, 'base64'));
  const [keyId, algorithm, cipherText] = root.children;
  const oid = oidString(algorithm.children[0].value);
  const iv = algorithm.children[1].value;
  const [cipher, size] =
    oid === OID.AES_256_CBC ? ['aes-256-cbc', 32] : oid === OID.DES_EDE3_CBC ? ['des-ede3-cbc', 24] : [null, 0];
  if (!cipher) throw new Error(`Unsupported Firefox login cipher (${oid}).`);
  const candidates = keys.filter(({ id, key }) => id.equals(keyId.value) && key.length >= size);
  for (const { key } of candidates.sort((a, b) => a.key.length - b.key.length)) {
    try {
      return decipher(cipher, key.subarray(0, size), iv, cipherText.value).toString('utf8');
    } catch {
      // Wrong key for this entry: try the next one.
    }
  }
  throw new Error('No key could decrypt this login.');
}

// loginsJson: parsed logins.json. Returns [{ origin, username, password }].
function decryptLogins(loginsJson, keys) {
  const results = [];
  for (const login of loginsJson.logins || []) {
    try {
      results.push({
        origin: login.hostname,
        username: decryptField(keys, login.encryptedUsername),
        password: decryptField(keys, login.encryptedPassword),
      });
    } catch {
      // A single damaged entry shouldn't stop the rest of the import.
    }
  }
  return results;
}

module.exports = { masterKeys, decryptLogins, PrimaryPasswordError };
