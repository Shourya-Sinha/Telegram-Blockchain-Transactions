import { LedgerDirection, LedgerType } from '../utils/prismaEnums';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/errors';

export type Transaction = any;

type WalletRow = { id: string; availableMinor: bigint; lockedMinor: bigint; version: number };

export async function ensureWalletForTelegram(identity: { telegramId: bigint; username?: string; firstName: string }) {
  const user = await prisma.user.upsert({
    where: { telegramId: identity.telegramId },
    update: { username: identity.username, firstName: identity.firstName },
    create: { telegramId: identity.telegramId, username: identity.username, firstName: identity.firstName, wallet: { create: {} } },
    include: { wallet: true }
  });
  if (user.status === 'BANNED') throw new AppError(403, 'This Telegram account is banned', 'BANNED');
  // Imported lazily to avoid a module cycle: the development credit service
  // uses the ledger helpers below for its one-time test-only credit.
  const { grantAutomaticTestCredit } = await import('./devCreditService');
  await grantAutomaticTestCredit(user.id);
  return user;
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

export async function reserveWallet(
  tx: Transaction,
  userId: string,
  amountMinor: bigint,
  type: LedgerType,
  referenceType: string,
  referenceId: string
): Promise<{ availableMinor: bigint; lockedMinor: bigint; entryId: string }> {
  if (amountMinor <= 0n) throw new AppError(400, 'Reserve amount must be positive', 'INVALID_AMOUNT');
  const wallet = await lockWallet(tx, userId);
  if (wallet.availableMinor < amountMinor) throw new AppError(400, 'Insufficient available balance', 'INSUFFICIENT_BALANCE');
  const availableMinor = wallet.availableMinor - amountMinor;
  const lockedMinor = wallet.lockedMinor + amountMinor;
  await tx.walletAccount.update({ where: { id: wallet.id }, data: { availableMinor, lockedMinor, version: { increment: 1 } } });
  const entry = await tx.ledgerEntry.create({ data: {
    userId, amountMinor, type, direction: LedgerDirection.DEBIT, balanceAfterMinor: availableMinor, referenceType, referenceId
  } });
  return { availableMinor, lockedMinor, entryId: entry.id };
}

export async function settleReservedWallet(tx: Transaction, userId: string, amountMinor: bigint): Promise<bigint> {
  if (amountMinor <= 0n) throw new AppError(400, 'Settlement amount must be positive', 'INVALID_AMOUNT');
  const wallet = await lockWallet(tx, userId);
  if (wallet.lockedMinor < amountMinor) throw new AppError(409, 'Reserved withdrawal balance is inconsistent', 'RESERVATION_MISSING');
  const lockedMinor = wallet.lockedMinor - amountMinor;
  await tx.walletAccount.update({ where: { id: wallet.id }, data: { lockedMinor, version: { increment: 1 } } });
  return lockedMinor;
}

export async function releaseReservedWallet(
  tx: Transaction,
  userId: string,
  amountMinor: bigint,
  type: LedgerType,
  referenceType: string,
  referenceId: string
): Promise<{ availableMinor: bigint; lockedMinor: bigint; entryId: string }> {
  if (amountMinor <= 0n) throw new AppError(400, 'Release amount must be positive', 'INVALID_AMOUNT');
  const wallet = await lockWallet(tx, userId);
  if (wallet.lockedMinor < amountMinor) throw new AppError(409, 'Reserved withdrawal balance is inconsistent', 'RESERVATION_MISSING');
  const availableMinor = wallet.availableMinor + amountMinor;
  const lockedMinor = wallet.lockedMinor - amountMinor;
  await tx.walletAccount.update({ where: { id: wallet.id }, data: { availableMinor, lockedMinor, version: { increment: 1 } } });
  const entry = await tx.ledgerEntry.create({ data: {
    userId, amountMinor, type, direction: LedgerDirection.CREDIT, balanceAfterMinor: availableMinor, referenceType, referenceId
  } });
  return { availableMinor, lockedMinor, entryId: entry.id };
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

// Local structural types keep this file type-safe even where inference is
// unavailable; they are fully compatible with the generated Prisma client.
type LedgerEntryRow = { id: string; userId: string; amountMinor: bigint; type: string; direction: string; balanceAfterMinor: bigint; referenceType: string; referenceId: string; createdAt: Date };
type EnvelopeMetaRow = { id: string; mode: string; totalSlots: number; remainingSlots: number; status: string; sender: { firstName: string; username: string | null } };

export async function getLedger(userId: string, limit = 50) {
  const entries = (await prisma.ledgerEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) })) as LedgerEntryRow[];
  // WeChat-style history rows need to know who sent each envelope and how it
  // was shared, so batch-load the metadata for every RED_ENVELOPE reference
  // on this page instead of one query per row.
  const envelopeIds = [...new Set(entries.filter((entry) => entry.referenceType === 'RED_ENVELOPE').map((entry) => entry.referenceId))];
  if (envelopeIds.length === 0) return entries;
  const envelopes = (await prisma.redEnvelope.findMany({
    where: { id: { in: envelopeIds } },
    select: {
      id: true,
      mode: true,
      totalSlots: true,
      remainingSlots: true,
      status: true,
      sender: { select: { firstName: true, username: true } }
    }
  })) as EnvelopeMetaRow[];
  const byId = new Map(envelopes.map((envelope) => [envelope.id, {
    id: envelope.id,
    senderFirstName: envelope.sender.firstName,
    senderUsername: envelope.sender.username,
    mode: envelope.mode,
    totalSlots: envelope.totalSlots,
    remainingSlots: envelope.remainingSlots,
    status: envelope.status
  }]));
  return entries.map((entry) => ({ ...entry, envelope: byId.get(entry.referenceId) }));
}
