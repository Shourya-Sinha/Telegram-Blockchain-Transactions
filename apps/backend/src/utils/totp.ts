import { createHmac, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(value: string): Buffer {
  const clean = value.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = '';
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 MFA secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function codeAt(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}

export function verifyTotp(secretBase32: string, suppliedCode: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(suppliedCode)) return false;
  let secret: Buffer;
  try { secret = decodeBase32(secretBase32); } catch { return false; }
  const counter = Math.floor(now / 30_000);
  const supplied = Buffer.from(suppliedCode);
  for (const drift of [-1, 0, 1]) {
    const expected = Buffer.from(codeAt(secret, counter + drift));
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return true;
  }
  return false;
}
