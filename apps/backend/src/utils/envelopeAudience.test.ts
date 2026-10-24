import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createEnvelopeSchema, telegramUsernameSchema } from '@red-envelope/shared';
import { isEligibleUsernameRecipient, isEnvelopeAudienceAllowed, normalizeEligibleTelegramIds, normalizeEligibleTelegramUsernames } from './envelopeAudience';

test('new envelope requests default to the legacy unrestricted audience', () => {
  const parsed = createEnvelopeSchema.parse({ total: '10', count: 2, groupId: '-1001234567890' });
  assert.equal(parsed.audience, 'ALL');
  assert.deepEqual(parsed.eligibleTelegramIds, []);
  assert.deepEqual(parsed.eligibleUsernames, []);
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

test('selected envelopes accept a bounded mix of Telegram IDs and deferred username reservations', () => {
  const parsed = createEnvelopeSchema.parse({
    total: '10', count: 2, groupId: '-1001234567890', audience: 'SELECTED',
    eligibleTelegramIds: ['123456789'], eligibleUsernames: ['@Alice_123', 'alice_123']
  });
  assert.deepEqual(parsed.eligibleUsernames, ['alice_123', 'alice_123']);
  assert.deepEqual(normalizeEligibleTelegramUsernames('SELECTED', parsed.eligibleUsernames), ['alice_123']);
  assert.deepEqual(normalizeEligibleTelegramUsernames('ALL', ['@Alice_123']), []);

  const overLimit = createEnvelopeSchema.safeParse({
    total: '10', count: 2, groupId: '-1001234567890', audience: 'SELECTED',
    eligibleTelegramIds: Array.from({ length: 300 }, (_, index) => String(index + 1)),
    eligibleUsernames: Array.from({ length: 201 }, (_, index) => `user_${index}`)
  });
  assert.equal(overLimit.success, false);
});

test('username reservations bind to the first verified claimant ID and stay bound after a rename', () => {
  const pending = { username: 'alice_123', telegramId: null };
  assert.equal(isEligibleUsernameRecipient(pending, { telegramId: 42n, username: '@Alice_123' }), true);
  assert.equal(isEligibleUsernameRecipient(pending, { telegramId: 43n, username: 'alice_123' }), true);
  const bound = { username: 'alice_123', telegramId: 42n };
  assert.equal(isEligibleUsernameRecipient(bound, { telegramId: 42n, username: 'alice_new' }), true);
  assert.equal(isEligibleUsernameRecipient(bound, { telegramId: 43n, username: 'alice_123' }), false);
});

test('username resolution looks up known profiles and verifies the current Telegram username', () => {
  const routes = readFileSync(resolve(process.cwd(), 'src/routes/adminRoutes.ts'), 'utf8');
  const telegram = readFileSync(resolve(process.cwd(), 'src/services/telegramService.ts'), 'utf8');
  assert.match(routes, /groups\/:chatId\/resolve-usernames/);
  assert.match(routes, /prisma\.groupMember\.findMany/);
  assert.match(routes, /prisma\.user\.findMany/);
  assert.match(routes, /res\.json\(\{ resolved, unresolved \}\)/);
  assert.match(telegram, /member\.user\.username/);
  assert.match(telegram, /requestedUsername\.toLowerCase\(\)/);
});

test('admin recipient selector retains profile and numeric-ID selection while adding unknown usernames', () => {
  const picker = readFileSync(resolve(process.cwd(), '../admin/src/components/GroupMemberPicker.tsx'), 'utf8');
  const createForm = readFileSync(resolve(process.cwd(), '../admin/src/App.tsx'), 'utf8');
  const service = readFileSync(resolve(process.cwd(), 'src/services/envelopeService.ts'), 'utf8');
  assert.match(picker, /members\.map\(\(member\)/);
  assert.match(picker, /const addManualIds/);
  assert.match(picker, /result\.unresolved/);
  assert.match(createForm, /eligibleUsernames: audience === 'SELECTED' \? eligibleTelegramUsernames/);
  assert.match(service, /tx\.redEnvelopeEligibleUsername\.createMany/);
});

test('first eligible username claim is bound to the Telegram-authenticated numeric ID', () => {
  const claims = readFileSync(resolve(process.cwd(), 'src/services/envelopeService.ts'), 'utf8');
  const eligibility = readFileSync(resolve(process.cwd(), 'src/services/eligibilityService.ts'), 'utf8');
  assert.match(claims, /redEnvelopeEligibleUsername\.updateMany/);
  assert.match(claims, /telegramId: claimant\.telegramId, boundAt: new Date\(\)/);
  assert.match(claims, /RED_ENVELOPE_USERNAME_BOUND/);
  assert.match(eligibility, /isEnvelopeRecipientSelected\(prisma, envelopeId, user\)/);
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
