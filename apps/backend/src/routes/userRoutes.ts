import { Router } from 'express';
import { z } from 'zod';
import { claimEnvelope, getEnvelope } from '../services/envelopeService';
import { createAndPublishEnvelope } from '../services/envelopePublishingService';
import { listRegisteredGroups } from '../services/groupService';
import { assertTelegramGroupMembership, isTelegramGroupMember } from '../services/telegramService';
import { getLedger, getWalletSummary } from '../services/ledgerService';
import { createWithdrawal } from '../services/withdrawalService';
import { telegramAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { jsonSafe } from '@red-envelope/shared';

export const userRouter = Router();
userRouter.use(telegramAuth);

userRouter.get('/me', async (req, res) => {
  const user = req.telegramUser!;
  const [wallet, account] = await Promise.all([
    getWalletSummary(user.id),
    prisma.user.findUnique({ where: { id: user.id }, select: { depositAddress: true } })
  ]);
  const depositAddress = account?.depositAddress;
  res.json(jsonSafe({
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    isAdmin: user.isAdmin,
    wallet,
    fundsMode: config.fundsMode,
    depositsEnabled: config.fundsMode === 'real' && config.depositMode === 'unique' && Boolean(depositAddress),
    withdrawalsEnabled: config.chainOperationsEnabled,
    depositAddress: config.fundsMode === 'real' && config.depositMode === 'unique' ? depositAddress : undefined
  }));
});

userRouter.get('/wallet', async (req, res) => {
  res.json(jsonSafe(await getWalletSummary(req.telegramUser!.id)));
});

userRouter.get('/ledger', async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(jsonSafe(await getLedger(req.telegramUser!.id, Number.isFinite(limit) ? limit : 50)));
});
userRouter.get('/history', async (req, res) => res.json(jsonSafe(await getLedger(req.telegramUser!.id, 50))));

userRouter.get('/deposit/address', async (req, res) => {
  if (config.fundsMode !== 'real') {
    res.status(403).json({ error: 'Blockchain deposits are disabled in test mode. Ask an admin to add test USDT.', code: 'TEST_MODE' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.telegramUser!.id }, select: { depositAddress: true } });
  if (config.depositMode !== 'unique' || !user?.depositAddress) {
    res.status(503).json({ error: 'A unique TRON deposit address has not been provisioned for this account.', code: 'DEPOSIT_ADDRESS_UNAVAILABLE' });
    return;
  }
  res.json({ address: user.depositAddress, chain: 'TRC20', confirmations: config.tron.confirmations });
});

userRouter.get('/groups', async (req, res) => {
  const groups = await listRegisteredGroups();
  const memberGroups = [];
  for (const group of groups) {
    if (group.enabled && await isTelegramGroupMember(group.chatId, req.telegramUser!.telegramId)) memberGroups.push(group);
  }
  res.json(jsonSafe(memberGroups));
});

userRouter.post('/envelopes', rateLimit('envelope-create'), async (req, res) => {
  const payload = z.object({
    total: z.string().regex(/^\d+(\.\d{1,6})?$/),
    count: z.number().int().min(1).max(500),
    mode: z.enum(['RANDOM', 'EQUAL']).default('RANDOM'),
    groupId: z.string().regex(/^-?\d+$/),
    expiresInMinutes: z.number().int().min(1).max(7 * 24 * 60).default(1440)
  }).parse(req.body);
  await assertTelegramGroupMembership(BigInt(payload.groupId), req.telegramUser!.telegramId);
  const envelope = await createAndPublishEnvelope(req.telegramUser!.id, { ...payload, ipAddress: req.ip });
  res.status(201).json(jsonSafe(envelope));
});

userRouter.get('/envelopes/:id', async (req, res) => {
  const envelope = await getEnvelope(String(req.params.id));
  await assertTelegramGroupMembership(envelope.groupId, req.telegramUser!.telegramId);
  res.json(jsonSafe(envelope));
});
userRouter.post('/envelopes/:id/claim', rateLimit('envelope-claim', config.claimRateLimitPerMinute), async (req, res) => {
  const envelope = await getEnvelope(String(req.params.id));
  await assertTelegramGroupMembership(envelope.groupId, req.telegramUser!.telegramId);
  const result = await claimEnvelope(req.telegramUser!.id, envelope.id, req.ip);
  res.json(jsonSafe(result));
});

userRouter.post('/withdrawals', rateLimit('withdrawal-create'), async (req, res) => {
  const payload = z.object({ amount: z.string(), toAddress: z.string(), idempotencyKey: z.string().uuid().optional() }).parse(req.body);
  const withdrawal = await createWithdrawal(req.telegramUser!.id, { ...payload, ipAddress: req.ip });
  res.status(201).json(jsonSafe(withdrawal));
});
userRouter.get('/withdrawals', async (req, res) => {
  const withdrawals = await prisma.withdrawal.findMany({ where: { userId: req.telegramUser!.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json(jsonSafe(withdrawals));
});
