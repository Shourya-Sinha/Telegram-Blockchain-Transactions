import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createEnvelopeSchema, telegramUsernameSchema } from '@red-envelope/shared';
import { isEnvelopeAudienceAllowed, normalizeEligibleTelegramIds } from './envelopeAudience';

test('new envelope requests default to the legacy unrestricted audience', () => {
  const parsed = createEnvelopeSchema.parse({ total: '10', count: 2, groupId: '-1001234567890' });
  assert.equal(parsed.audience, 'ALL');
  assert.deepEqual(parsed.eligibleTelegramIds, []);
});

test('selected audience accepts bounded positive decimal Telegram IDs only', () => {
  const valid = createEnvelopeSchema.safeParse({ total: '10', count: 2, groupId: '-1001234567890', audience: 'SELECTED', eligibleTelegramIds: ['123456789'] });
  assert.equal(valid.success, true);
  const nonNumeric = createEnvelopeSchema.safeParse({ total: '10', count: 2, groupId: '-1001234567890', audience: 'SELECTED', eligibleTelegramIds: ['@not-an-id'] });
  const zero = createEnvelopeSchema.safeParse({ total: '10', count: 2, groupId: '-1001234567890', audience: 'SELECTED', eligibleTelegramIds: ['0'] });
  const unsafe = createEnvelopeSchema.safeParse({ total: '10', count: 2, groupId: '-1001234567890', audience: 'SELECTED', eligibleTelegramIds: ['9007199254740993'] });
  assert.equal(nonNumeric.success, false);
  assert.equal(zero.success, false);
  assert.equal(unsafe.success, false);
});

test('Telegram usernames allow an optional @ and normalize to lowercase', () => {
  const valid = telegramUsernameSchema.safeParse('@Alice_123');
  assert.equal(valid.success, true);
  if (valid.success) assert.equal(valid.data, 'alice_123');
  assert.equal(telegramUsernameSchema.safeParse('abcd').success, false);
  assert.equal(telegramUsernameSchema.safeParse('https://t.me/alice').success, false);
});

test('username resolution looks up known profiles and verifies the current Telegram username', () => {
  const routes = readFileSync(resolve(process.cwd(), 'src/routes/adminRoutes.ts'), 'utf8');
  const telegram = readFileSync(resolve(process.cwd(), 'src/services/telegramService.ts'), 'utf8');
  assert.match(routes, /groups\/:chatId\/resolve-usernames/);
  assert.match(routes, /prisma\.groupMember\.findMany/);
  assert.match(routes, /prisma\.user\.findMany/);
  assert.match(telegram, /member\.user\.username/);
  assert.match(telegram, /requestedUsername\.toLowerCase\(\)/);
});

test('selected audience caps its allowlist at 500 IDs', () => {
  const parsed = createEnvelopeSchema.safeParse({
    total: '10', count: 2, groupId: '-1001234567890', audience: 'SELECTED',
    eligibleTelegramIds: Array.from({ length: 501 }, (_, index) => String(index + 1))
  });
  assert.equal(parsed.success, false);
});

test('selected IDs are checked against Telegram before the envelope transaction, without requiring roster rows', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/services/envelopeService.ts'), 'utf8');
  const verifierStart = source.indexOf('async function assertSelectedTelegramMembers');
  const createStart = source.indexOf('export async function createEnvelope');
  const createEnd = source.indexOf('export async function claimEnvelope', createStart);
  const verifier = source.slice(verifierStart, createStart);
  const create = source.slice(createStart, createEnd < 0 ? undefined : createEnd);

  assert.match(verifier, /assertTelegramGroupMembership\(groupId, BigInt\(telegramId\)\)/);
  assert.match(create, /await assertSelectedTelegramMembers\(groupId, eligibleTelegramIds\)/);
  assert.ok(create.indexOf('await assertSelectedTelegramMembers') < create.indexOf('prisma.$transaction'));
  assert.doesNotMatch(create, /groupMember\.findMany/);
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
