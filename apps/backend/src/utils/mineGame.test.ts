import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEnvelopeSchema } from '@red-envelope/shared';
import { mineHit, randomMinePortion, lastDisplayedCentDigit, USDT_CENT_MINOR, isMineGamePortionCount } from './mineGame';

test('mine envelope validation fixes portion count, cents, and target precision', () => {
  const base = { total: '10.00', count: 5, mode: 'RANDOM' as const, gameType: 'MINE' as const, mineDigit: 6, groupId: '-1001234567890', expiresInMinutes: 60 };
  assert.equal(createEnvelopeSchema.safeParse(base).success, true);
  assert.equal(createEnvelopeSchema.safeParse({ ...base, count: 7 }).success, false);
  assert.equal(createEnvelopeSchema.safeParse({ ...base, total: '1.005' }).success, false);
  assert.equal(createEnvelopeSchema.safeParse({ ...base, total: '0.04' }).success, false);
  assert.equal(createEnvelopeSchema.safeParse({ ...base, mineDigit: undefined }).success, false);
  assert.equal(createEnvelopeSchema.safeParse({ ...base, mode: 'EQUAL' }).success, false);
});

test('mine digits use the last displayed cent digit', () => {
  assert.equal(lastDisplayedCentDigit(12_360_000n), 6); // 12.36 USDT
  assert.equal(mineHit(12_360_000n, 6), true);
  assert.equal(mineHit(12_360_000n, 5), false);
  assert.equal(mineHit(1_200_000n, 0), true); // 1.20 USDT
});

test('mine portions are only the supported 5, 6, or 9 packet variants', () => {
  assert.equal(isMineGamePortionCount(5), true);
  assert.equal(isMineGamePortionCount(6), true);
  assert.equal(isMineGamePortionCount(9), true);
  assert.equal(isMineGamePortionCount(7), false);
});

test('random mine portions stay cent-exact and preserve the total', () => {
  for (const count of [5, 6, 9]) {
    let remaining = BigInt(count * 100) * USDT_CENT_MINOR;
    let slots = count;
    let sum = 0n;
    while (slots > 0) {
      const amount = randomMinePortion(remaining, slots);
      assert.ok(amount >= USDT_CENT_MINOR);
      assert.equal(amount % USDT_CENT_MINOR, 0n);
      sum += amount;
      remaining -= amount;
      slots -= 1;
    }
    assert.equal(sum, BigInt(count * 100) * USDT_CENT_MINOR);
    assert.equal(remaining, 0n);
  }
});

test('a mine portion rejects an allocation that cannot leave one cent per slot', () => {
  assert.throws(() => randomMinePortion(4n * USDT_CENT_MINOR, 5), /one cent/);
});

test('admin report exposes per-claim outcomes and all-time treasury gross payouts', () => {
  const routes = readFileSync(resolve(process.cwd(), 'src/routes/adminRoutes.ts'), 'utf8');
  const adminApp = readFileSync(resolve(process.cwd(), '../admin/src/App.tsx'), 'utf8');
  assert.match(routes, /where: \{ mineHit: \{ not: null \} \}/);
  assert.match(routes, /type: LedgerType\.GAME_PAYOUT/);
  assert.match(adminApp, /mineInvestorGrossPayout/);
  assert.match(adminApp, /claimResultsFor/);
  assert.match(adminApp, /mineGrossPayoutToSender/);
});

test('developer messages are shared in the admin panel and preview is explicit that no external send occurs', () => {
  const adminApp = readFileSync(resolve(process.cwd(), '../admin/src/App.tsx'), 'utf8');
  const adminRoutes = readFileSync(resolve(process.cwd(), 'src/routes/adminRoutes.ts'), 'utf8');
  const translations = readFileSync(resolve(process.cwd(), '../admin/src/i18n.ts'), 'utf8');
  assert.match(adminApp, /\/api\/admin\/developer-messages/);
  assert.match(adminApp, /developerPreviewOpen/);
  assert.match(adminApp, /developerMessages\.data\?\.messages/);
  assert.match(adminRoutes, /adminDeveloperMessage\.create/);
  assert.match(adminRoutes, /netRealizedMinor: settledPayoutMinor \+ settledRefundedMinor - settledFundedMinor/);
  assert.match(translations, /Preview only — saving stores this message in the shared admin panel; it does not send or notify anyone externally/);
  assert.doesNotMatch(adminApp, /admin_developer_preview_message/);
});
