import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AdminRole, DepositStatus, LedgerType, WithdrawalStatus } from '../utils/prismaEnums';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { adminAuth, requireAdminRole } from '../middleware/adminAuth';
import { rateLimit } from '../middleware/rateLimit';
import { approveWithdrawal, rejectWithdrawal, retryWithdrawal } from '../services/withdrawalService';
import { tronGateway } from '../services/tronGateway';
import { creditWallet, writeAudit } from '../services/ledgerService';
import { redis } from '../lib/redis';
import { formatMinor, jsonSafe, parseUsdtToMinor } from '@red-envelope/shared';
import { createAndPublishEnvelope } from '../services/envelopePublishingService';
import { listRegisteredGroups } from '../services/groupService';
import { AppError } from '../utils/errors';
import { verifyTotp } from '../utils/totp';
import { asyncHandler } from '../utils/asyncHandler';

export const adminRouter = Router();

adminRouter.post('/auth/login', rateLimit('admin-login', 10), asyncHandler(async (req, res) => {
  const payload = z.object({ username: z.string().min(1), password: z.string().min(1), mfaCode: z.string().optional() }).parse(req.body);
  const admin = await prisma.adminUser.findUnique({ where: { username: payload.username } });
  if (!admin || !(await bcrypt.compare(payload.password, admin.passwordHash))) { res.status(401).json({ error: 'Invalid admin credentials' }); return; }
  if (admin.mfaSecret && !payload.mfaCode) { res.status(401).json({ error: 'MFA code required', code: 'MFA_REQUIRED' }); return; }
  if (admin.mfaSecret && !verifyTotp(admin.mfaSecret, payload.mfaCode ?? '')) { res.status(401).json({ error: 'Invalid MFA code', code: 'MFA_INVALID' }); return; }
  const token = jwt.sign({ sub: admin.id, role: admin.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
  res.json({ token, admin: { id: admin.id, username: admin.username, role: admin.role } });
}));

adminRouter.use(adminAuth);

adminRouter.get('/envelopes/setup', asyncHandler(async (_req, res) => {
  const groups = await listRegisteredGroups();
  const rawTreasuryId = config.redEnvelope.treasuryTelegramId;
  let treasury = null;
  if (/^\d+$/.test(rawTreasuryId)) {
    treasury = await prisma.user.findUnique({
      where: { telegramId: BigInt(rawTreasuryId) },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        username: true,
        status: true,
        wallet: { select: { availableMinor: true, lockedMinor: true } }
      }
    });
  }
  const recent = await prisma.redEnvelope.findMany({
    include: {
      sender: { select: { telegramId: true, firstName: true, username: true } },
      _count: { select: { claims: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 25
  });
  res.json(jsonSafe({
    configured: Boolean(rawTreasuryId && treasury?.wallet && treasury.status === 'ACTIVE'),
    treasuryTelegramIdConfigured: /^\d+$/.test(rawTreasuryId),
    configurationMessage: !rawTreasuryId
      ? 'Set RED_ENVELOPE_TREASURY_TELEGRAM_ID, then restart the backend.'
      : !treasury?.wallet
        ? 'The treasury Telegram wallet is not initialized. Run /start from that account.'
        : treasury.status !== 'ACTIVE'
          ? 'The configured treasury user is banned. Restore access or configure a different treasury.'
          : undefined,
    treasury,
    groups,
    recent
  }));
}));

adminRouter.post('/envelopes/send', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), asyncHandler(async (req, res) => {
  const payload = z.object({
    total: z.string().regex(/^\d+(\.\d{1,6})?$/),
    count: z.number().int().min(1).max(500),
    mode: z.enum(['RANDOM', 'EQUAL']).default('RANDOM'),
    groupId: z.string().regex(/^-?\d+$/),
    expiresInMinutes: z.number().int().min(1).max(7 * 24 * 60).default(1440)
  }).parse(req.body);
  if (!/^\d+$/.test(config.redEnvelope.treasuryTelegramId)) {
    throw new AppError(503, 'RED_ENVELOPE_TREASURY_TELEGRAM_ID is not configured', 'TREASURY_NOT_CONFIGURED');
  }
  const treasury = await prisma.user.findUnique({
    where: { telegramId: BigInt(config.redEnvelope.treasuryTelegramId) },
    select: { id: true, status: true, wallet: { select: { id: true, availableMinor: true } } }
  });
  if (!treasury?.wallet) {
    throw new AppError(404, 'Treasury wallet not found. Open the bot and run /start from the configured treasury Telegram account.', 'TREASURY_NOT_FOUND');
  }
  if (treasury.status !== 'ACTIVE') {
    throw new AppError(403, 'The configured treasury user is banned', 'TREASURY_BANNED');
  }
  const totalMinor = parseUsdtToMinor(payload.total);
  const treasuryAvailableMinor = treasury.wallet.availableMinor ?? 0n;
  // Friendly pre-check so the admin panel gets an immediately actionable
  // message. The row-locked debit inside the transaction remains the
  // authoritative guard against races.
  if (treasuryAvailableMinor < totalMinor) {
    throw new AppError(
      400,
      `Treasury wallet has insufficient balance: this envelope needs ${payload.total} USDT but the treasury only has ${formatMinor(treasuryAvailableMinor)} USDT. Add funds to the treasury account (in test mode: Users → treasury account → Add test USDT, or run "npm run db:dev-credit -- ${config.redEnvelope.treasuryTelegramId} <amount>") and try again.`,
      'TREASURY_INSUFFICIENT_BALANCE'
    );
  }
  let envelope;
  try {
    envelope = await createAndPublishEnvelope(treasury.id, {
      ...payload,
      actorId: req.adminUser!.id,
      ipAddress: req.ip
    });
  } catch (error) {
    // A concurrent send could still drain the treasury between the pre-check
    // and the debit; map that to the same friendly error.
    if (error instanceof AppError && error.code === 'INSUFFICIENT_BALANCE') {
      throw new AppError(
        400,
        `Treasury wallet has insufficient balance: this envelope needs ${payload.total} USDT. Add funds to the treasury account and try again.`,
        'TREASURY_INSUFFICIENT_BALANCE'
      );
    }
    throw error;
  }
  res.status(201).json(jsonSafe(envelope));
}));

adminRouter.get('/dashboard', asyncHandler(async (req, res) => {
  const [walletLiability, pendingWithdrawals, depositsToday, ledgerRows] = await Promise.all([
    prisma.walletAccount.aggregate({ _sum: { availableMinor: true, lockedMinor: true } }),
    prisma.withdrawal.count({ where: { status: { in: [WithdrawalStatus.QUEUED, WithdrawalStatus.PROCESSING, WithdrawalStatus.BROADCAST, WithdrawalStatus.CONFIRMING] } } }),
    prisma.deposit.aggregate({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }, status: DepositStatus.CONFIRMED }, _sum: { amountMinor: true } }),
    prisma.ledgerEntry.findMany({ where: { createdAt: { gte: new Date(Date.now() - 14 * 86400000) }, type: { in: [LedgerType.DEPOSIT, LedgerType.WITHDRAWAL] } }, select: { type: true, amountMinor: true, createdAt: true } })
  ]);
  let hotWalletBalance = 0n;
  if (config.chainOperationsEnabled) {
    try { hotWalletBalance = await tronGateway.getUsdtBalance(); } catch (error) { console.error('[dashboard-hot-wallet]', error); }
  }
  const totalLiabilityMinor = (walletLiability._sum.availableMinor ?? 0n) + (walletLiability._sum.lockedMinor ?? 0n);
  const dayMap = new Map<string, { deposits: bigint; withdrawals: bigint }>();
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
    dayMap.set(date, { deposits: 0n, withdrawals: 0n });
  }
  for (const row of ledgerRows) { const day = row.createdAt.toISOString().slice(0, 10); const bucket = dayMap.get(day); if (bucket) bucket[row.type === LedgerType.DEPOSIT ? 'deposits' : 'withdrawals'] += row.amountMinor; }
  res.json(jsonSafe({ totalLiabilityMinor, totalLiability: totalLiabilityMinor.toString(), hotWalletBalance, pendingWithdrawals, depositsToday: depositsToday._sum.amountMinor ?? 0n, volume: [...dayMap].map(([date, values]) => ({ date, ...values })) }));
}));

adminRouter.get('/users', asyncHandler(async (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const users = await prisma.user.findMany({ where: search ? (/^\d+$/.test(search) ? { telegramId: BigInt(search) } : { OR: [{ username: { contains: search, mode: 'insensitive' } }, { firstName: { contains: search, mode: 'insensitive' } }] }) : undefined, include: { wallet: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(jsonSafe(users));
}));
adminRouter.get('/testing', (_req, res) => {
  res.json({
    fundsMode: config.fundsMode,
    depositMode: config.depositMode,
    chainOperationsEnabled: config.chainOperationsEnabled,
    testCreditEnabled: config.allowDevCredit
  });
});
adminRouter.post('/users/:id/test-credit', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), asyncHandler(async (req, res) => {
  if (!config.allowDevCredit) {
    throw new AppError(403, 'Test credits are disabled. They can only be enabled outside production with ALLOW_DEV_CREDIT=true.', 'TEST_CREDIT_DISABLED');
  }
  const payload = z.object({
    amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
    reason: z.string().trim().min(3).max(200)
  }).parse(req.body);
  const amountMinor = parseUsdtToMinor(payload.amount);
  if (amountMinor <= 0n || amountMinor > 10_000n * 1_000_000n) {
    throw new AppError(400, 'Test credit must be greater than 0 and no more than 10,000 USDT', 'INVALID_TEST_CREDIT');
  }
  const user = await prisma.user.findUnique({ where: { id: String(req.params.id) }, include: { wallet: true } });
  if (!user?.wallet) throw new AppError(404, 'User wallet not found', 'WALLET_NOT_FOUND');

  const referenceId = `admin-test-credit:${Date.now()}:${req.adminUser!.id}`;
  const result = await prisma.$transaction(async (tx: any) => {
    const credited = await creditWallet(tx, user.id, amountMinor, LedgerType.TRANSFER, 'DEV_CREDIT', referenceId);
    await writeAudit(tx, {
      actorId: req.adminUser!.id,
      action: 'DEV_WALLET_CREDITED',
      entityType: 'User',
      entityId: user.id,
      before: { availableMinor: (credited.availableMinor - amountMinor).toString() },
      after: { amountMinor: amountMinor.toString(), availableMinor: credited.availableMinor.toString(), reason: payload.reason, referenceId },
      ipAddress: req.ip
    });
    return credited;
  });
  res.status(201).json(jsonSafe({ ...result, amountMinor, referenceId }));
}));
adminRouter.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: String(req.params.id) }, include: { wallet: true, ledger: { orderBy: { createdAt: 'desc' }, take: 100 } } });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(jsonSafe(user));
}));
adminRouter.post('/users/:id/ban', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT), asyncHandler(async (req, res) => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: String(req.params.id) }, select: { status: true } });
  const user = await prisma.user.update({ where: { id: String(req.params.id) }, data: { status: before.status === 'BANNED' ? 'ACTIVE' : 'BANNED' } });
  await prisma.auditLog.create({ data: { actorId: req.adminUser!.id, action: user.status === 'BANNED' ? 'USER_BANNED' : 'USER_UNBANNED', entityType: 'User', entityId: user.id, before, after: { status: user.status }, ipAddress: req.ip } });
  res.json(jsonSafe(user));
}));

adminRouter.get('/withdrawals', asyncHandler(async (req, res) => {
  const status = req.query.status ? z.enum(['QUEUED', 'PROCESSING', 'BROADCAST', 'CONFIRMING', 'COMPLETED', 'FAILED', 'REJECTED']).parse(String(req.query.status)) : undefined;
  const withdrawals = await prisma.withdrawal.findMany({ where: { status }, include: { user: { select: { telegramId: true, username: true, firstName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(jsonSafe(withdrawals));
}));
adminRouter.post('/withdrawals/:id/approve', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), asyncHandler(async (req, res) => res.json(jsonSafe(await approveWithdrawal(String(req.params.id), req.adminUser!.id, req.ip)))));
adminRouter.post('/withdrawals/:id/retry', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), asyncHandler(async (req, res) => res.json(jsonSafe(await retryWithdrawal(String(req.params.id), req.adminUser!.id, req.ip)))));
adminRouter.post('/withdrawals/:id/reject', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
  res.json(jsonSafe(await rejectWithdrawal(String(req.params.id), req.adminUser!.id, reason, req.ip)));
}));

adminRouter.get('/deposits', asyncHandler(async (req, res) => {
  const status = req.query.status ? z.enum(['PENDING', 'CONFIRMED', 'FAILED']).parse(String(req.query.status)) : undefined;
  const deposits = await prisma.deposit.findMany({
    where: { status },
    include: { user: { select: { telegramId: true, username: true, firstName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json(jsonSafe(deposits));
}));

adminRouter.get('/emergency/status', asyncHandler(async (_req, res) => {
  const [withdrawals, envelopes] = await Promise.all([redis.get('emergency:withdrawals-disabled'), redis.get('emergency:envelopes-disabled')]);
  res.json({ withdrawalsDisabled: withdrawals === '1', envelopesDisabled: envelopes === '1' });
}));
adminRouter.post('/emergency/disable-withdrawals', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), asyncHandler(async (req, res) => {
  const disabled = z.object({ disabled: z.boolean().default(true) }).parse(req.body).disabled;
  if (disabled) await redis.set('emergency:withdrawals-disabled', '1'); else await redis.del('emergency:withdrawals-disabled');
  await prisma.auditLog.create({ data: { actorId: req.adminUser!.id, action: disabled ? 'WITHDRAWALS_DISABLED' : 'WITHDRAWALS_ENABLED', entityType: 'System', entityId: 'withdrawals', after: { disabled }, ipAddress: req.ip } });
  res.json({ disabled });
}));
adminRouter.post('/emergency/disable-envelopes', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), asyncHandler(async (req, res) => {
  const disabled = z.object({ disabled: z.boolean().default(true) }).parse(req.body).disabled;
  if (disabled) await redis.set('emergency:envelopes-disabled', '1'); else await redis.del('emergency:envelopes-disabled');
  await prisma.auditLog.create({ data: { actorId: req.adminUser!.id, action: disabled ? 'ENVELOPES_DISABLED' : 'ENVELOPES_ENABLED', entityType: 'System', entityId: 'envelopes', after: { disabled }, ipAddress: req.ip } });
  res.json({ disabled });
}));

adminRouter.get('/settings', asyncHandler(async (req, res) => {
  const chatId = req.query.chatId ? BigInt(String(req.query.chatId)) : undefined;
  res.json(jsonSafe(chatId === undefined ? await prisma.groupSetting.findMany({ orderBy: { chatId: 'asc' } }) : await prisma.groupSetting.findUnique({ where: { chatId } })));
}));
adminRouter.put('/settings/:chatId', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT), asyncHandler(async (req, res) => {
  const chatId = BigInt(String(req.params.chatId));
  const payload = z.object({ enabled: z.boolean(), minAccountAgeDays: z.number().int().min(0).max(3650), minMessages: z.number().int().min(0).max(100000), maxClaimsPerDay: z.number().int().min(0).max(100000) }).parse(req.body);
  const setting = await prisma.groupSetting.upsert({ where: { chatId }, update: payload, create: { chatId, ...payload } });
  await prisma.auditLog.create({ data: { actorId: req.adminUser!.id, action: 'GROUP_SETTING_UPDATED', entityType: 'GroupSetting', entityId: setting.id, after: payload, ipAddress: req.ip } });
  res.json(jsonSafe(setting));
}));
adminRouter.get('/audit-logs', asyncHandler(async (req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit ?? 100), 500) });
  res.json(jsonSafe(logs));
}));
