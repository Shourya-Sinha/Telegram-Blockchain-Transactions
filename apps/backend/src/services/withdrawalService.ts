import { randomUUID } from 'node:crypto';
import { LedgerType, WithdrawalStatus } from '../utils/prismaEnums';
import { parseUsdtToMinor, withdrawalRequestSchema } from '@red-envelope/shared';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { config } from '../config';
import { AppError, isPrismaUniqueError } from '../utils/errors';
import { debitWallet, type Transaction, writeAudit } from './ledgerService';
import { withdrawalQueue } from '../jobs/queues';
import { tronGateway } from './tronGateway';

type RequestInput = { amount: string; toAddress: string; idempotencyKey?: string; ipAddress?: string };

async function lockWithdrawal(tx: Transaction, id: string) {
  await tx.$queryRawUnsafe(`SELECT \"id\" FROM \"Withdrawal\" WHERE \"id\" = $1 FOR UPDATE`, id);
  return tx.withdrawal.findUnique({ where: { id } });
}

export async function createWithdrawal(userId: string, input: RequestInput) {
  const parsed = withdrawalRequestSchema.parse(input);
  const amountMinor = parseUsdtToMinor(parsed.amount);
  if (amountMinor < config.withdrawal.minMinor) throw new AppError(400, `Minimum withdrawal is ${config.withdrawal.minMinor / 1_000_000n} USDT`, 'WITHDRAWAL_TOO_SMALL');
  const feeMinor = config.withdrawal.feeMinor;
  const idempotencyKey = parsed.idempotencyKey ?? randomUUID();
  if (await prisma.withdrawal.findUnique({ where: { idempotencyKey }, select: { id: true, status: true } })) {
    throw new AppError(409, 'This withdrawal request has already been submitted', 'IDEMPOTENCY_CONFLICT');
  }
  if ((await redis.get('emergency:withdrawals-disabled')) === '1') throw new AppError(503, 'Withdrawals are temporarily disabled', 'WITHDRAWALS_DISABLED');

  try {
    const withdrawal = await prisma.$transaction(async (tx: Transaction) => {
      const created = await tx.withdrawal.create({ data: { userId, amountMinor, feeMinor, toAddress: parsed.toAddress, idempotencyKey, status: WithdrawalStatus.QUEUED } });
      const debit = await debitWallet(tx, userId, amountMinor, LedgerType.WITHDRAWAL, 'WITHDRAWAL', created.id);
      await debitWallet(tx, userId, feeMinor, LedgerType.FEE, 'WITHDRAWAL', created.id);
      await writeAudit(tx, { action: 'WITHDRAWAL_REQUESTED', entityType: 'Withdrawal', entityId: created.id, ipAddress: input.ipAddress, after: { amountMinor: amountMinor.toString(), feeMinor: feeMinor.toString(), toAddress: parsed.toAddress, idempotencyKey } });
      return { ...created, availableMinor: debit.availableMinor - feeMinor };
    }, { isolationLevel: 'ReadCommitted' });
    if (amountMinor <= config.withdrawal.autoApprovalLimitMinor) await withdrawalQueue.add('process', { withdrawalId: withdrawal.id }, { jobId: withdrawal.id, removeOnComplete: 100, removeOnFail: 100 });
    return withdrawal;
  } catch (error) {
    if (isPrismaUniqueError(error)) throw new AppError(409, 'This withdrawal request has already been submitted', 'IDEMPOTENCY_CONFLICT');
    throw error;
  }
}

export async function approveWithdrawal(id: string, adminId: string, ipAddress?: string) {
  const updated = await prisma.$transaction(async (tx: Transaction) => {
    const withdrawal = await lockWithdrawal(tx, id);
    if (!withdrawal) throw new AppError(404, 'Withdrawal not found', 'WITHDRAWAL_NOT_FOUND');
    if (withdrawal.status !== WithdrawalStatus.QUEUED) throw new AppError(409, 'Only queued withdrawals can be approved', 'INVALID_STATUS');
    const result = await tx.withdrawal.update({ where: { id }, data: { status: WithdrawalStatus.PROCESSING } });
    await writeAudit(tx, { actorId: adminId, action: 'WITHDRAWAL_APPROVED', entityType: 'Withdrawal', entityId: id, ipAddress, before: { status: withdrawal.status }, after: { status: result.status } });
    return result;
  });
  await withdrawalQueue.add('process', { withdrawalId: id }, { jobId: id, removeOnComplete: 100, removeOnFail: 100 });
  return updated;
}

export async function retryWithdrawal(id: string, adminId: string, ipAddress?: string) {
  const updated = await prisma.$transaction(async (tx: Transaction) => {
    const withdrawal = await lockWithdrawal(tx, id);
    if (!withdrawal) throw new AppError(404, 'Withdrawal not found', 'WITHDRAWAL_NOT_FOUND');
    if (withdrawal.status !== WithdrawalStatus.FAILED) throw new AppError(409, 'Only failed withdrawals can be retried', 'INVALID_STATUS');
    const result = await tx.withdrawal.update({ where: { id }, data: { status: WithdrawalStatus.QUEUED } });
    await writeAudit(tx, { actorId: adminId, action: 'WITHDRAWAL_RETRY_REQUESTED', entityType: 'Withdrawal', entityId: id, ipAddress, before: { status: withdrawal.status }, after: { status: result.status } });
    return result;
  });
  await withdrawalQueue.add('process', { withdrawalId: id }, { jobId: `${id}:${Date.now()}`, removeOnComplete: 100, removeOnFail: 100 });
  return updated;
}

export async function processWithdrawal(withdrawalId: string): Promise<void> {
  const intent = await prisma.$transaction(async (tx: Transaction) => {
    const withdrawal = await lockWithdrawal(tx, withdrawalId);
    if (!withdrawal) throw new AppError(404, 'Withdrawal not found', 'WITHDRAWAL_NOT_FOUND');
    if (![WithdrawalStatus.QUEUED, WithdrawalStatus.PROCESSING, WithdrawalStatus.FAILED].includes(withdrawal.status)) return null;
    const updated = await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { status: WithdrawalStatus.PROCESSING, attempts: { increment: 1 } } });
    await writeAudit(tx, { action: 'WITHDRAWAL_BROADCAST_INTENT', entityType: 'Withdrawal', entityId: withdrawal.id, before: { status: withdrawal.status, attempts: withdrawal.attempts }, after: { status: updated.status, attempts: updated.attempts } });
    return { ...updated, intentStartedAt: Date.now() };
  });
  if (!intent) return;

  try {
    const hotBalance = await tronGateway.getUsdtBalance();
    if (hotBalance > config.tron.capMinor) {
      await redis.set('alert:hot-wallet-cap', JSON.stringify({ balance: hotBalance.toString(), at: new Date().toISOString() }), 'EX', 3600);
      throw new Error('Hot wallet cap exceeded; sweep to cold storage before broadcasting');
    }
    // If a previous RPC call succeeded but the response was lost, match the transfer before retrying.
    let txHash = await tronGateway.findRecentOutgoingTransfer(intent.toAddress, intent.amountMinor, intent.intentStartedAt - 2 * 60_000);
    if (!txHash) txHash = await tronGateway.sendUsdt(intent.toAddress, intent.amountMinor);
    await prisma.$transaction(async (tx: Transaction) => {
      const current = await lockWithdrawal(tx, withdrawalId);
      if (!current) throw new AppError(404, 'Withdrawal not found', 'WITHDRAWAL_NOT_FOUND');
      await tx.withdrawal.update({ where: { id: withdrawalId }, data: { txHash, status: WithdrawalStatus.BROADCAST } });
      await writeAudit(tx, { action: 'WITHDRAWAL_BROADCAST', entityType: 'Withdrawal', entityId: withdrawalId, after: { txHash } });
    });
    await prisma.withdrawal.update({ where: { id: withdrawalId }, data: { status: WithdrawalStatus.CONFIRMING } });
    await tronGateway.waitForConfirmations(txHash);
    await prisma.$transaction(async (tx: Transaction) => {
      await tx.withdrawal.update({ where: { id: withdrawalId }, data: { status: WithdrawalStatus.COMPLETED } });
      await writeAudit(tx, { action: 'WITHDRAWAL_COMPLETED', entityType: 'Withdrawal', entityId: withdrawalId, after: { txHash } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Withdrawal processing failed';
    await prisma.$transaction(async (tx: Transaction) => {
      const current = await lockWithdrawal(tx, withdrawalId);
      if (!current || current.status === WithdrawalStatus.COMPLETED) return;
      await tx.withdrawal.update({ where: { id: withdrawalId }, data: { status: WithdrawalStatus.FAILED } });
      await writeAudit(tx, { action: 'WITHDRAWAL_FAILED', entityType: 'Withdrawal', entityId: withdrawalId, before: { status: current.status }, after: { status: WithdrawalStatus.FAILED, error: message } });
    });
    throw error;
  }
}
