import { Router } from 'express';
import { z } from 'zod';
import { createEnvelope, claimEnvelope, getEnvelope } from '../services/envelopeService';
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
  const wallet = await getWalletSummary(user.id);
  res.json(jsonSafe({ id: user.id, telegramId: user.telegramId, username: user.username, firstName: user.firstName, isAdmin: user.isAdmin, wallet, depositAddress: config.tron.hotWalletAddress }));
});

userRouter.get('/wallet', async (req, res) => {
  res.json(jsonSafe(await getWalletSummary(req.telegramUser!.id)));
});

userRouter.get('/ledger', async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(jsonSafe(await getLedger(req.telegramUser!.id, Number.isFinite(limit) ? limit : 50)));
});
userRouter.get('/history', async (req, res) => res.json(jsonSafe(await getLedger(req.telegramUser!.id, 50))));

userRouter.get('/deposit/address', async (_req, res) => {
  res.json({ address: config.tron.hotWalletAddress, chain: 'TRC20', confirmations: config.tron.confirmations });
});

userRouter.post('/envelopes', rateLimit('envelope-create'), async (req, res) => {
  const payload = z.object({ total: z.string(), count: z.number().int(), mode: z.enum(['RANDOM', 'EQUAL']).default('RANDOM'), groupId: z.string(), expiresInMinutes: z.number().int().default(1440) }).parse(req.body);
  const envelope = await createEnvelope(req.telegramUser!.id, { ...payload, ipAddress: req.ip });
  res.status(201).json(jsonSafe(envelope));
});

userRouter.get('/envelopes/:id', async (req, res) => res.json(jsonSafe(await getEnvelope(String(req.params.id)))));
userRouter.post('/envelopes/:id/claim', rateLimit('envelope-claim', config.claimRateLimitPerMinute), async (req, res) => {
  const result = await claimEnvelope(req.telegramUser!.id, String(req.params.id), req.ip);
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
