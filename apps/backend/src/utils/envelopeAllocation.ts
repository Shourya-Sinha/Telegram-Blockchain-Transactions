import { randomBytes } from 'node:crypto';

function randomBigInt(maxExclusive: bigint): bigint {
  if (maxExclusive <= 0n) throw new Error('random upper bound must be positive');
  const bytes = Math.ceil(maxExclusive.toString(2).length / 8);
  const excessBits = BigInt(bytes * 8) - BigInt(maxExclusive.toString(2).length);
  const mask = (1n << BigInt(bytes * 8)) - 1n;
  while (true) {
    const candidate = BigInt(`0x${randomBytes(bytes).toString('hex')}`) & mask;
    const normalized = excessBits > 0n ? candidate >> excessBits : candidate;
    if (normalized < maxExclusive) return normalized;
  }
}

/** Integer-only version of the classic double-mean envelope algorithm. */
export function randomClaimAmount(remaining: bigint, slots: number): bigint {
  if (slots <= 1) return remaining;
  const maxByMean = (remaining / BigInt(slots)) * 2n;
  const maxByRemainder = remaining - BigInt(slots - 1);
  const maximum = maxByMean < maxByRemainder ? maxByMean : maxByRemainder;
  if (maximum <= 1n) return 1n;
  return randomBigInt(maximum) + 1n;
}
