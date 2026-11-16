import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTestPayouts, calculateTurnoverCommission, DEFAULT_TEST_GAME_PROFILES, normalizeOddsEntries, parseMultiplierHundredths, parseTestUnits } from './testGames';

function odds(profileKey: string, variant: string, packetCount: number, outcomeKey: string) {
  const profile = DEFAULT_TEST_GAME_PROFILES.find((candidate) => candidate.key === profileKey)!;
  return profile.odds.find((row) => row.variant === variant && row.packetCount === packetCount && row.outcomeKey === outcomeKey)!;
}

test('poster presets preserve their independent stake ranges and conflicting odds', () => {
  const first = DEFAULT_TEST_GAME_PROFILES[0];
  const second = DEFAULT_TEST_GAME_PROFILES[1];
  assert.equal(first.stakeMinUnits, '30');
  assert.equal(first.stakeMaxUnits, '1000');
  assert.equal(second.stakeMinUnits, '20');
  assert.equal(second.stakeMaxUnits, '500');
  assert.equal(odds(first.key, 'SINGLE_MINE', 5, 'HITS_3').multiplier, '5.0');
  assert.equal(odds(second.key, 'SINGLE_MINE', 5, 'HITS_3').multiplier, '6.0');
  assert.equal(odds(first.key, 'CHAIN_MINE', 5, 'CHAIN_2_OF_2').multiplier, '4.0');
  assert.equal(odds(second.key, 'CHAIN_MINE', 5, 'CHAIN_2_OF_2').multiplier, '5.0');
  assert.equal(odds(first.key, 'SINGLE_MINE', 6, 'HITS_2').multiplier, '3.0');
  assert.equal(odds(second.key, 'SINGLE_MINE', 6, 'HITS_2').multiplier, '2.8');
  assert.equal(odds(first.key, 'CHAIN_MINE', 6, 'CHAIN_3_OF_3').multiplier, '12');
  assert.equal(odds(second.key, 'CHAIN_MINE', 6, 'CHAIN_3_OF_3').multiplier, '13.15');
});

test('9-packet poster rates retain the base rate, visible reward rows, and inferred series', () => {
  const first = odds('poster_daxiaojie', 'NINE_MULTI_MINE', 9, 'M2_HITS_6');
  const inferred = odds('poster_daxiaojie', 'NINE_MULTI_MINE', 9, 'M2_HITS_8');
  const second = odds('poster_rongyao', 'NINE_MULTI_MINE', 9, 'M5_HITS_5');
  assert.equal(first.baseMultiplier, '1.01');
  assert.equal(first.multiplier, '1.0');
  assert.equal(inferred.inferred, true);
  assert.equal(inferred.multiplier, '3.0');
  assert.equal(second.multiplier, '19');
  assert.equal(odds('poster_daxiaojie', 'NINE_MULTI_MINE', 9, 'M9_HITS_9').multiplier, '100');
});

test('test game stakes use the existing six-decimal USDT minor-unit scale', () => {
  assert.equal(parseTestUnits('30'), 30_000_000n);
  assert.equal(parseTestUnits('1.123456'), 1_123_456n);
  assert.throws(() => parseTestUnits('1.1234567'), /six decimal places/);
  assert.throws(() => parseTestUnits('0'), /greater than zero/);
});

test('both payout interpretations are calculated without choosing or paying either one', () => {
  const win = calculateTestPayouts(10_000_000n, parseMultiplierHundredths('2'), true);
  assert.equal(win.payoutMultiplierIncludesStake, 20_000_000n);
  assert.equal(win.payoutMultiplierIsProfit, 30_000_000n);
  assert.equal(win.netMultiplierIncludesStake, 10_000_000n);
  assert.equal(win.netMultiplierIsProfit, 20_000_000n);
  const loss = calculateTestPayouts(10_000_000n, 200, false);
  assert.equal(loss.payoutMultiplierIncludesStake, 0n);
  assert.equal(loss.payoutMultiplierIsProfit, 0n);
  assert.equal(loss.netMultiplierIncludesStake, -10_000_000n);
  assert.equal(loss.netMultiplierIsProfit, -10_000_000n);
});

test('turnover commission is snapshot-friendly and defaults to zero', () => {
  assert.equal(calculateTurnoverCommission(10_000_000n, 250), 250_000n);
  assert.equal(calculateTurnoverCommission(10_000_000n, 0), 0n);
  assert.throws(() => calculateTurnoverCommission(10_000_000n, 10_001), /Invalid/);
});

test('odds table validation rejects duplicate keys and invalid base multipliers', () => {
  const rows = DEFAULT_TEST_GAME_PROFILES[0].odds.slice(0, 2);
  assert.equal(normalizeOddsEntries(rows).length, 2);
  assert.throws(() => normalizeOddsEntries([rows[0], { ...rows[0] }]), /Duplicate/);
  assert.throws(() => normalizeOddsEntries([{ ...rows[0], baseMultiplier: '0' }]), /outside the supported range/);
});
