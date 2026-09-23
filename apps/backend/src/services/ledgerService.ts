import { LedgerDirection, LedgerType } from '../utils/prismaEnums';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/errors';

export type Transaction = any;

type WalletRow = { id: string; availableMinor: bigint; lockedMinor: bigint; version: number };

export async function ensureWalletForTelegram(identity: { telegramId: bigint; username?: string; firstName: string }) {
  return prisma.user.upsert({
    where: { telegramId: identity.telegramId },
    update: { username: identity.username, firstName: identity.firstName },
    create: { telegramId: identity.telegramId, username: identity.username, firstName: identity.firstName, wallet: { create: {} } },
    include: { wallet: true }
  });
}

async function lockWallet(tx: Transaction, userId: string): Promise<WalletRow> {
  const rows = await tx.$queryRawUnsafe(`SELECT \"id\", \"availableMinor\", \"lockedMinor\", \"version\" FROM \"WalletAccount\" WHERE \"userId\" = $1 FOR UPDATE`, userId) as WalletRow[];
  if (rows.length === 0) throw new AppError(500, 'Wallet account is not initialized', 'WALLET_MISSING');
  return rows[0];
}

export async function debitWallet(
  tx: Transaction,
  userId: string,
  amountMinor: bigint,
  type: LedgerType,
  referenceType: string,
  referenceId: string
): Promise<{ availableMinor: bigint; entryId: string }> {
  if (amountMinor <= 0n) throw new AppError(400, 'Debit amount must be positive', 'INVALID_AMOUNT');
  const wallet = await lockWallet(tx, userId);
  if (wallet.availableMinor < amountMinor) throw new AppError(400, 'Insufficient available balance', 'INSUFFICIENT_BALANCE');
  const availableMinor = wallet.availableMinor - amountMinor;
  await tx.walletAccount.update({ where: { id: wallet.id }, data: { availableMinor, version: { increment: 1 } } });
  const entry = await tx.ledgerEntry.create({ data: {
    userId, amountMinor, type, direction: LedgerDirection.DEBIT, balanceAfterMinor: availableMinor, referenceType, referenceId
  } });
  return { availableMinor, entryId: entry.id };
}

export async function creditWallet(
  tx: Transaction,
  userId: string,
  amountMinor: bigint,
  type: LedgerType,
  referenceType: string,
  referenceId: string
): Promise<{ availableMinor: bigint; entryId: string }> {
  if (amountMinor <= 0n) throw new AppError(400, 'Credit amount must be positive', 'INVALID_AMOUNT');
  const wallet = await lockWallet(tx, userId);
  const availableMinor = wallet.availableMinor + amountMinor;
  await tx.walletAccount.update({ where: { id: wallet.id }, data: { availableMinor, version: { increment: 1 } } });
  const entry = await tx.ledgerEntry.create({ data: {
    userId, amountMinor, type, direction: LedgerDirection.CREDIT, balanceAfterMinor: availableMinor, referenceType, referenceId
  } });
  return { availableMinor, entryId: entry.id };
}

export async function writeAudit(
  tx: Transaction,
  input: { actorId?: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; ipAddress?: string }
): Promise<void> {
  await tx.auditLog.create({ data: {
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before === undefined ? undefined : input.before as any,
    after: input.after === undefined ? undefined : input.after as any,
    ipAddress: input.ipAddress
  } });
}

export async function getWalletSummary(userId: string) {
  const wallet = await prisma.walletAccount.findUnique({ where: { userId } });
  if (!wallet) throw new AppError(404, 'Wallet account not found', 'WALLET_NOT_FOUND');
  return wallet;
}

export async function getLedger(userId: string, limit = 50) {
  return prisma.ledgerEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) });
}
