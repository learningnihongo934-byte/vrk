'use strict';
// Encrypted backups of passwords (with their 2FA secrets), passkeys and
// bookmarks. The file is locked with your passphrase: scrypt (deliberately
// slow, so guessing passphrases is expensive) turns it into a key, and
// AES-256-GCM encrypts the data and detects any tampering. Without the
// passphrase the file is useless, so it's safe to keep in the cloud.

const crypto = require('node:crypto');

const KDF = { N: 2 ** 17, r: 8, p: 1 };
const MIN_PASSPHRASE = 10;

const scrypt = (passphrase, salt, { N, r, p }) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(passphrase, salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );

async function encryptBackup(payload, passphrase) {
  if (String(passphrase || '').length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(passphrase), salt, KDF);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return JSON.stringify(
    {
      format: 'vrk-backup',
      version: 1,
      created: new Date().toISOString(),
      kdf: { name: 'scrypt', ...KDF, salt: salt.toString('base64') },
      cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
      data: data.toString('base64'),
    },
    null,
    1,
  );
}

async function decryptBackup(text, passphrase) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('That isn’t a VRK backup file.');
  }
  if (file?.format !== 'vrk-backup' || file.kdf?.name !== 'scrypt' || file.cipher?.name !== 'aes-256-gcm') throw new Error('That isn’t a VRK backup file.');
  const { N, r, p } = file.kdf;
  // Refuse absurd parameters a doctored file could use to stall VRK.
  if (![N, r, p].every(Number.isInteger) || N > 2 ** 20 || r > 16 || p > 4) throw new Error('That backup file is damaged.');
  try {
    const key = await scrypt(String(passphrase || ''), Buffer.from(file.kdf.salt, 'base64'), { N, r, p });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.cipher.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(file.cipher.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    throw new Error('Wrong passphrase, or the backup file was changed or damaged.');
  }
}

module.exports = { encryptBackup, decryptBackup, MIN_PASSPHRASE };
