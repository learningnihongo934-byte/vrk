'use strict';
// VRK's passkey authenticator (WebAuthn). Each passkey is an ECDSA P-256 key
// pair made on this Mac; the private key is stored encrypted with the macOS
// Keychain (like passwords) and never leaves VRK. Signing in asks for Touch ID.
// Sites get "none" attestation and a standard ES256 credential, the same as
// from iCloud Keychain or Chrome's passkeys.

const crypto = require('node:crypto');
const { getDomain } = require('tldts');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (text) => Buffer.from(String(text || ''), 'base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

const FLAG_UP = 0x01; // user present
const FLAG_UV = 0x04; // user verified (Touch ID)
const FLAG_AT = 0x40; // attested credential data included
const ES256 = -7;
const AAGUID = Buffer.alloc(16); // "none" attestation

// ── Minimal CBOR (just what WebAuthn needs) ──────────────────────────────

function cborHead(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(length, 1);
  return b;
}

// Maps are [key, value] pairs, already in canonical (CTAP2) order.
function cbor(value) {
  if (Number.isInteger(value)) return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.concat([cborHead(2, value.length), Buffer.from(value)]);
  if (value instanceof Map) {
    return Buffer.concat([cborHead(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  }
  if (Array.isArray(value)) return Buffer.concat([cborHead(4, value.length), ...value.map(cbor)]);
  throw new Error('Unsupported CBOR value');
}

function coseKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return cbor(
    new Map([
      [1, 2], // kty: EC2
      [3, ES256], // alg
      [-1, 1], // crv: P-256
      [-2, fromB64url(jwk.x)],
      [-3, fromB64url(jwk.y)],
    ]),
  );
}

// ── Who may use which passkey ────────────────────────────────────────────

// The relying party ID must be the page's host or a domain it belongs to,
// and never a public suffix like "co.uk" (as in the WebAuthn spec).
function validRpId(rpId, origin) {
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  const id = String(rpId || '').toLowerCase();
  if (!id || (host !== id && !host.endsWith(`.${id}`))) return false;
  if (host === 'localhost' || id === 'localhost') return host === id;
  const registrable = getDomain(id);
  return Boolean(registrable) && (id === registrable || id.endsWith(`.${registrable}`));
}

function clientData(type, challenge, origin) {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

function authData(rpId, flags, attested = null) {
  const counter = Buffer.alloc(4); // 0: passkeys don't keep a signature counter
  const parts = [sha256(rpId), Buffer.from([flags]), counter];
  if (attested) {
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(attested.id.length);
    parts.push(AAGUID, idLength, attested.id, coseKey(attested.publicKey));
  }
  return Buffer.concat(parts);
}

// ── Registration and sign-in ─────────────────────────────────────────────

// Returns { passkey (to store), response (for the page) }.
function register({ origin, rpId, user, challenge, verified }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const id = crypto.randomBytes(32);
  const data = authData(rpId, FLAG_UP | (verified ? FLAG_UV : 0) | FLAG_AT, { id, publicKey });
  const clientDataJSON = clientData('webauthn.create', challenge, origin);
  const attestationObject = cbor(
    new Map([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', data],
    ]),
  );
  return {
    passkey: {
      id: b64url(id),
      rpId,
      userId: user.id,
      userName: String(user.name || '').slice(0, 256),
      displayName: String(user.displayName || '').slice(0, 256),
      privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      created: Date.now(),
      lastUsed: null,
    },
    response: {
      id: b64url(id),
      clientDataJSON: b64url(clientDataJSON),
      attestationObject: b64url(attestationObject),
      authenticatorData: b64url(data),
      publicKey: b64url(publicKey.export({ format: 'der', type: 'spki' })),
      publicKeyAlgorithm: ES256,
    },
  };
}

function assert({ passkey, origin, challenge, verified }) {
  const data = authData(passkey.rpId, FLAG_UP | (verified ? FLAG_UV : 0));
  const clientDataJSON = clientData('webauthn.get', challenge, origin);
  const key = crypto.createPrivateKey({ key: Buffer.from(passkey.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const signature = crypto.sign('sha256', Buffer.concat([data, sha256(clientDataJSON)]), key); // DER, as WebAuthn expects
  return {
    id: passkey.id,
    clientDataJSON: b64url(clientDataJSON),
    authenticatorData: b64url(data),
    signature: b64url(signature),
    userHandle: passkey.userId,
  };
}

module.exports = { register, assert, validRpId, cbor, b64url, fromB64url };
