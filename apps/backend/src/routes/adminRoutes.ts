import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AdminRole, DepositStatus, LedgerType, WithdrawalStatus } from '../utils/prismaEnums';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { adminAuth, requireAdminRole } from '../middleware/adminAuth';
import { rateLimit } from '../middleware/rateLimit';
import { approveWithdrawal, retryWithdrawal } from '../services/withdrawalService';
import { tronGateway } from '../services/tronGateway';
import { writeAudit } from '../services/ledgerService';
import { redis } from '../lib/redis';
import { jsonSafe } from '@red-envelope/shared';

export const adminRouter = Router();

adminRouter.post('/auth/login', rateLimit('admin-login', 10), async (req, res) => {
  const payload = z.object({ username: z.string().min(1), password: z.string().min(1), mfaCode: z.string().optional() }).parse(req.body);
  const admin = await prisma.adminUser.findUnique({ where: { username: payload.username } });
  if (!admin || !(await bcrypt.compare(payload.password, admin.passwordHash))) { res.status(401).json({ error: 'Invalid admin credentials' }); return; }
  if (admin.mfaSecret && !payload.mfaCode) { res.status(401).json({ error: 'MFA code required', code: 'MFA_REQUIRED' }); return; }
  const token = jwt.sign({ sub: admin.id, role: admin.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
  res.json({ token, admin: { id: admin.id, username: admin.username, role: admin.role } });
});

adminRouter.use(adminAuth);

adminRouter.get('/dashboard', async (req, res) => {
  const [walletLiability, pendingWithdrawals, depositsToday, ledgerRows] = await Promise.all([
    prisma.walletAccount.aggregate({ _sum: { availableMinor: true, lockedMinor: true } }),
    prisma.withdrawal.count({ where: { status: { in: [WithdrawalStatus.QUEUED, WithdrawalStatus.PROCESSING, WithdrawalStatus.BROADCAST, WithdrawalStatus.CONFIRMING] } } }),
    prisma.deposit.aggregate({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }, status: DepositStatus.CONFIRMED }, _sum: { amountMinor: true } }),
    prisma.ledgerEntry.findMany({ where: { createdAt: { gte: new Date(Date.now() - 14 * 86400000) }, type: { in: [LedgerType.DEPOSIT, LedgerType.WITHDRAWAL] } }, select: { type: true, amountMinor: true, createdAt: true } })
  ]);
  let hotWalletBalance = 0n;
  try { hotWalletBalance = await tronGateway.getUsdtBalance(); } catch (error) { console.error('[dashboard-hot-wallet]', error); }
  const totalLiabilityMinor = (walletLiability._sum.availableMinor ?? 0n) + (walletLiability._sum.lockedMinor ?? 0n);
  const dayMap = new Map<string, { deposits: bigint; withdrawals: bigint }>();
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
    dayMap.set(date, { deposits: 0n, withdrawals: 0n });
  }
  for (const row of ledgerRows) { const day = row.createdAt.toISOString().slice(0, 10); const bucket = dayMap.get(day); if (bucket) bucket[row.type === LedgerType.DEPOSIT ? 'deposits' : 'withdrawals'] += row.amountMinor; }
  res.json(jsonSafe({ totalLiabilityMinor, totalLiability: totalLiabilityMinor.toString(), hotWalletBalance, pendingWithdrawals, depositsToday: depositsToday._sum.amountMinor ?? 0n, volume: [...dayMap].map(([date, values]) => ({ date, ...values })) }));
});

adminRouter.get('/users', async (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const users = await prisma.user.findMany({ where: search ? (/^\d+$/.test(search) ? { telegramId: BigInt(search) } : { OR: [{ username: { contains: search, mode: 'insensitive' } }, { firstName: { contains: search, mode: 'insensitive' } }] }) : undefined, include: { wallet: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(jsonSafe(users));
});
adminRouter.get('/users/:id', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: String(req.params.id) }, include: { wallet: true, ledger: { orderBy: { createdAt: 'desc' }, take: 100 } } });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(jsonSafe(user));
});
adminRouter.post('/users/:id/ban', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT), async (req, res) => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: String(req.params.id) }, select: { status: true } });
  const user = await prisma.user.update({ where: { id: String(req.params.id) }, data: { status: before.status === 'BANNED' ? 'ACTIVE' : 'BANNED' } });
  await prisma.auditLog.create({ data: { actorId: req.adminUser!.id, action: user.status === 'BANNED' ? 'USER_BANNED' : 'USER_UNBANNED', entityType: 'User', entityId: user.id, before, after: { status: user.status }, ipAddress: req.ip } });
  res.json(jsonSafe(user));
});

adminRouter.get('/withdrawals', async (req, res) => {
  const status = req.query.status ? z.enum(['QUEUED', 'PROCESSING', 'BROADCAST', 'CONFIRMING', 'COMPLETED', 'FAILED', 'REJECTED']).parse(String(req.query.status)) : undefined;
  const withdrawals = await prisma.withdrawal.findMany({ where: { status }, include: { user: { select: { telegramId: true, username: true, firstName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(jsonSafe(withdrawals));
});
adminRouter.post('/withdrawals/:id/approve', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), async (req, res) => res.json(jsonSafe(await approveWithdrawal(String(req.params.id), req.adminUser!.id, req.ip))));
adminRouter.post('/withdrawals/:id/retry', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), async (req, res) => res.json(jsonSafe(await retryWithdrawal(String(req.params.id), req.adminUser!.id, req.ip))));

adminRouter.post('/emergency/disable-withdrawals', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), async (req, res) => {
  const disabled = z.object({ disabled: z.boolean().default(true) }).parse(req.body).disabled;
  if (disabled) await redis.set('emergency:withdrawals-disabled', '1'); else await redis.del('emergency:withdrawals-disabled');
  await prisma.auditLog.create({ data: { actorId: req.adminUser!.id, action: disabled ? 'WITHDRAWALS_DISABLED' : 'WITHDRAWALS_ENABLED', entityType: 'System', entityId: 'withdrawals', after: { disabled }, ipAddress: req.ip } });
  res.json({ disabled });
});
adminRouter.post('/emergency/disable-envelopes', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.FINANCE), async (req, res) => {
  const disabled = z.object({ disabled: z.boolean().default(true) }).parse(req.body).disabled;
  if (disabled) await redis.set('emergency:envelopes-disabled', '1'); else await redis.del('emergency:envelopes-disabled');
  await prisma.auditLog.create({ data: { actorId: req.adminUser!.id, action: disabled ? 'ENVELOPES_DISABLED' : 'ENVELOPES_ENABLED', entityType: 'System', entityId: 'envelopes', after: { disabled }, ipAddress: req.ip } });
  res.json({ disabled });
});

adminRouter.get('/settings', async (req, res) => {
  const chatId = req.query.chatId ? BigInt(String(req.query.chatId)) : undefined;
  res.json(jsonSafe(chatId === undefined ? await prisma.groupSetting.findMany({ orderBy: { chatId: 'asc' } }) : await prisma.groupSetting.findUnique({ where: { chatId } })));
});
adminRouter.put('/settings/:chatId', requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT), async (req, res) => {
  const chatId = BigInt(String(req.params.chatId));
  const payload = z.object({ enabled: z.boolean(), minAccountAgeDays: z.number().int().min(0).max(3650), minMessages: z.number().int().min(0).max(100000), maxClaimsPerDay: z.number().int().min(0).max(100000) }).parse(req.body);
  const setting = await prisma.groupSetting.upsert({ where: { chatId }, update: payload, create: { chatId, ...payload } });
  await prisma.auditLog.create({ data: { actorId: req.adminUser!.id, action: 'GROUP_SETTING_UPDATED', entityType: 'GroupSetting', entityId: setting.id, after: payload, ipAddress: req.ip } });
  res.json(jsonSafe(setting));
});
adminRouter.get('/audit-logs', async (req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit ?? 100), 500) });
  res.json(jsonSafe(logs));
});
