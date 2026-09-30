import { DepositStatus, LedgerType } from '../utils/prismaEnums';
import { type Transaction } from './ledgerService';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { creditWallet, writeAudit } from './ledgerService';
import { type IncomingTransfer } from './tronGateway';
import { AppError } from '../utils/errors';

export async function recordIncomingTransfer(userId: string, transfer: IncomingTransfer) {
  if (!config.chainOperationsEnabled || config.depositMode !== 'unique') {
    throw new AppError(403, 'Blockchain deposits are disabled outside unique-address real-funds mode', 'DEPOSITS_DISABLED');
  }
  return prisma.$transaction(async (tx: Transaction) => {
    const existing = await tx.deposit.findUnique({ where: { txHash: transfer.txHash } });
    if (existing?.status === DepositStatus.CONFIRMED) return existing;
    const deposit = existing ?? await tx.deposit.create({ data: {
      txHash: transfer.txHash,
      userId,
      amountMinor: transfer.amountMinor,
      fromAddress: transfer.fromAddress,
      toAddress: transfer.toAddress,
      tokenContract: config.tron.usdtContract,
      detectedAt: new Date(transfer.timestamp),
      confirmations: transfer.confirmations,
      status: DepositStatus.PENDING
    } });
    if (deposit.userId !== userId) return deposit;
    const confirmations = Math.max(deposit.confirmations, transfer.confirmations);
    if (confirmations < config.tron.confirmations) {
      return tx.deposit.update({ where: { id: deposit.id }, data: { confirmations } });
    }
    const locked = await tx.$queryRawUnsafe(`SELECT \"id\" FROM \"Deposit\" WHERE \"id\" = $1 FOR UPDATE`, deposit.id);
    void locked;
    const latest = await tx.deposit.findUnique({ where: { id: deposit.id } });
    if (!latest || latest.status === DepositStatus.CONFIRMED) return latest ?? deposit;
    const credit = await creditWallet(tx, userId, latest.amountMinor, LedgerType.DEPOSIT, 'DEPOSIT', latest.id);
    const confirmed = await tx.deposit.update({ where: { id: latest.id }, data: { confirmations, status: DepositStatus.CONFIRMED, confirmedAt: new Date() } });
    await writeAudit(tx, { action: 'DEPOSIT_CONFIRMED', entityType: 'Deposit', entityId: confirmed.id, after: { txHash: confirmed.txHash, amountMinor: latest.amountMinor.toString(), balanceAfterMinor: credit.availableMinor.toString() } });
    return confirmed;
  }, { isolationLevel: 'ReadCommitted' });
}
