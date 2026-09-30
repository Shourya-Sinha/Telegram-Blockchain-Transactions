import assert from 'node:assert/strict';
import test from 'node:test';
import { randomClaimAmount } from './envelopeAllocation';
import { verifyTotp } from './totp';

test('random envelope allocations are positive and sum exactly to the total', () => {
  for (let run = 0; run < 500; run += 1) {
    let remaining = BigInt(1 + Math.floor(Math.random() * 1_000_000_000));
    const total = remaining;
    const requestedSlots = 1 + Math.floor(Math.random() * 500);
    let slots = Number(remaining < BigInt(requestedSlots) ? remaining : BigInt(requestedSlots));
    const allocations: bigint[] = [];
    while (slots > 0) {
      const amount = randomClaimAmount(remaining, slots);
      assert(amount > 0n);
      assert(amount <= remaining - BigInt(slots - 1));
      allocations.push(amount);
      remaining -= amount;
      slots -= 1;
    }
    assert.equal(remaining, 0n);
    assert.equal(allocations.reduce((sum, value) => sum + value, 0n), total);
  }
});

test('last random envelope slot receives the exact remainder', () => {
  assert.equal(randomClaimAmount(123456n, 1), 123456n);
});

test('TOTP verification checks the actual RFC code and rejects arbitrary codes', () => {
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(verifyTotp(rfcSecret, '287082', 59_000), true);
  assert.equal(verifyTotp(rfcSecret, '000000', 59_000), false);
  assert.equal(verifyTotp(rfcSecret, 'anything', 59_000), false);
});
