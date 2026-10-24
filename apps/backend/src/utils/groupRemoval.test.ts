import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

test('group removal waits for active envelopes and archives immediately when idle', () => {
  const groups = read('src/services/groupService.ts');
  const routes = read('src/routes/adminRoutes.ts');
  assert.match(groups, /tx\.redEnvelope\.count\(\{ where: \{ groupId: chatId, status: 'ACTIVE' \} \}\)/);
  assert.match(groups, /if \(activeEnvelopes > 0\)/);
  assert.match(groups, /deletionRequestedAt: requestedAt/);
  assert.match(groups, /await archiveGroup\(tx, chatId, archivedAt\)/);
  assert.match(routes, /adminRouter\.delete\('\/groups\/:chatId'/);
});

test('pending removal prevents new envelopes and expiry worker archives after all active envelopes settle', () => {
  const groups = read('src/services/groupService.ts');
  const envelopes = read('src/services/envelopeService.ts');
  const workers = read('src/jobs/workers.ts');
  assert.match(envelopes, /GROUP_REMOVAL_PENDING/);
  assert.match(envelopes, /await lockAndAssertGroupAvailable\(tx, groupId\)/);
  assert.match(envelopes, /await processPendingGroupRemovals\(\)/);
  assert.match(groups, /deletionRequestedAt: \{ not: null \}/);
  assert.match(groups, /status: 'ACTIVE'/);
  assert.match(groups, /GROUP_AUTO_ARCHIVED/);
  assert.match(workers, /repeat: \{ every: 60_000 \}/);
});

test('archived groups are hidden from available lists and Telegram updates do not re-register them', () => {
  const groups = read('src/services/groupService.ts');
  assert.match(groups, /existing\?\.archivedAt\) return null/);
  assert.match(groups, /deletionRequestedAt: null/);
  assert.match(groups, /archivedAt: null/);
  assert.match(groups, /export async function restoreArchivedGroup/);
});
