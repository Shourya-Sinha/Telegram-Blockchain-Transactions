import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnvelopeSchema } from '@red-envelope/shared';
import { isEnvelopeAudienceAllowed, normalizeEligibleTelegramIds } from './envelopeAudience';

test('new envelope requests default to the legacy unrestricted audience', () => {
  const parsed = createEnvelopeSchema.parse({ total: '10', count: 2, groupId: '-1001234567890' });
  assert.equal(parsed.audience, 'ALL');
  assert.deepEqual(parsed.eligibleTelegramIds, []);
});

test('selected audience accepts bounded decimal Telegram IDs only', () => {
  const valid = createEnvelopeSchema.safeParse({ total: '10', count: 2, groupId: '-1001234567890', audience: 'SELECTED', eligibleTelegramIds: ['123456789'] });
  assert.equal(valid.success, true);
  const invalid = createEnvelopeSchema.safeParse({ total: '10', count: 2, groupId: '-1001234567890', audience: 'SELECTED', eligibleTelegramIds: ['@not-an-id'] });
  assert.equal(invalid.success, false);
});

test('selected Telegram IDs are canonicalized and deduplicated', () => {
  assert.deepEqual(normalizeEligibleTelegramIds('SELECTED', ['00042', '42', '123456']), ['42', '123456']);
});

test('public envelopes do not persist a selected-member allowlist', () => {
  assert.deepEqual(normalizeEligibleTelegramIds('ALL', ['42', '123456']), []);
});

test('only explicitly selected Telegram IDs can claim a selected-audience envelope', () => {
  assert.equal(isEnvelopeAudienceAllowed({ audience: 'SELECTED', isSelected: true }), true);
  assert.equal(isEnvelopeAudienceAllowed({ audience: 'SELECTED', isSelected: false }), false);
});

test('the sender may view their envelope history without gaining claim access', () => {
  assert.equal(isEnvelopeAudienceAllowed({ audience: 'SELECTED', isSelected: false, isSender: true, allowSenderView: true }), true);
  assert.equal(isEnvelopeAudienceAllowed({ audience: 'SELECTED', isSelected: false, isSender: true }), false);
});

test('all-audience envelopes remain claimable by any verified group member', () => {
  assert.equal(isEnvelopeAudienceAllowed({ audience: 'ALL', isSelected: false }), true);
});
