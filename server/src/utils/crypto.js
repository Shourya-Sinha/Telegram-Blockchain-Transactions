const crypto = require('crypto');
const env = require('../config/env');

function getKey() {
  const hex = env.WALLET_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  // Dev fallback: derive a key from JWT secret (NOT for production)
  return crypto.createHash('sha256').update('tbt-dev-key:' + env.JWT_SECRET).digest();
}

function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(payload) {
  const key = getKey();
  const [ivH, tagH, encH] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encH, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

function txHash() {
  return '0x' + crypto.randomBytes(32).toString('hex');
}

function linkCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars
}

module.exports = { encrypt, decrypt, txHash, linkCode };
