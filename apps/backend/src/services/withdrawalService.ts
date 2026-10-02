import { randomUUID } from 'node:crypto';
import { LedgerType, WithdrawalStatus } from '../utils/prismaEnums';
import { isAllowedTestWithdrawalAddress, parseUsdtToMinor, withdrawalRequestSchema } from '@red-envelope/shared';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { config } from '../config';
import { AppError, isPrismaUniqueError } from '../utils/errors';
import { releaseReservedWallet, reserveWallet, settleReservedWallet, type Transaction, writeAudit } from './ledgerService';
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

  if (!config.chainOperationsEnabled) {
    if (!config.withdrawal.testWithdrawalsEnabled) {
      // Why the button is off: this deployment runs FUNDS_MODE=test and no
      // TEST_WITHDRAWAL_ADDRESS is configured, so there is nothing safe to
      // withdraw to. Real TRC20 payouts require FUNDS_MODE=real plus the Tron
      // hot-wallet environment.
      throw new AppError(403, 'Withdrawals are disabled: this deployment runs in test mode (FUNDS_MODE=test) and no TEST_WITHDRAWAL_ADDRESS is configured. Set TEST_WITHDRAWAL_ADDRESS to the required test TRC20 address to enable simulated test withdrawals.', 'TEST_MODE');
    }
    return createSimulatedTestWithdrawal(userId, input, { ...parsed, amountMinor, feeMinor, idempotencyKey });
  }

  try {
    const withdrawal = await prisma.$transaction(async (tx: Transaction) => {
      const created = await tx.withdrawal.create({ data: { userId, amountMinor, feeMinor, toAddress: parsed.toAddress, idempotencyKey, status: WithdrawalStatus.QUEUED, fundsReserved: true } });
      const amountReserve = await reserveWallet(tx, userId, amountMinor, LedgerType.WITHDRAWAL, 'WITHDRAWAL', created.id);
      const feeReserve = feeMinor > 0n ? await reserveWallet(tx, userId, feeMinor, LedgerType.FEE, 'WITHDRAWAL', created.id) : undefined;
      const latest = feeReserve ?? amountReserve;
      await writeAudit(tx, { action: 'WITHDRAWAL_REQUESTED', entityType: 'Withdrawal', entityId: created.id, ipAddress: input.ipAddress, after: { amountMinor: amountMinor.toString(), feeMinor: feeMinor.toString(), reservedMinor: (amountMinor + feeMinor).toString(), toAddress: parsed.toAddress, idempotencyKey } });
      return { ...created, availableMinor: latest.availableMinor, lockedMinor: latest.lockedMinor };
    }, { isolationLevel: 'ReadCommitted' });
    if (amountMinor <= config.withdrawal.autoApprovalLimitMinor) await withdrawalQueue.add('process', { withdrawalId: withdrawal.id }, { jobId: withdrawal.id, removeOnComplete: 100, removeOnFail: 100 });
    return withdrawal;
  } catch (error) {
    if (isPrismaUniqueError(error)) throw new AppError(409, 'This withdrawal request has already been submitted', 'IDEMPOTENCY_CONFLICT');
    throw error;
  }
}

/**
 * Test-mode withdrawal: the full ledger flow (reserve amount + fee, then
 * settle) runs inside one transaction, but no TRC20 transaction is ever
 * broadcast. The destination must be exactly the required test address from
 * TEST_WITHDRAWAL_ADDRESS, and the record completes with an explicit
 * "simulated" audit trail so finance can tell it apart from real payouts.
 */
async function createSimulatedTestWithdrawal(
  userId: string,
  input: RequestInput,
  parsed: { toAddress: string; amountMinor: bigint; feeMinor: bigint; idempotencyKey: string }
) {
  if (!isAllowedTestWithdrawalAddress(parsed.toAddress, config.withdrawal.testWithdrawalAddress)) {
    throw new AppError(403, `Test withdrawals must use the required test TRC20 address: ${config.withdrawal.testWithdrawalAddress}`, 'TEST_WITHDRAWAL_ADDRESS_REQUIRED');
  }
  try {
    const withdrawal = await prisma.$transaction(async (tx: Transaction) => {
      const created = await tx.withdrawal.create({ data: { userId, amountMinor: parsed.amountMinor, feeMinor: parsed.feeMinor, toAddress: parsed.toAddress, idempotencyKey: parsed.idempotencyKey, status: WithdrawalStatus.QUEUED, fundsReserved: true } });
      const amountReserve = await reserveWallet(tx, userId, parsed.amountMinor, LedgerType.WITHDRAWAL, 'WITHDRAWAL', created.id);
      const feeReserve = parsed.feeMinor > 0n ? await reserveWallet(tx, userId, parsed.feeMinor, LedgerType.FEE, 'WITHDRAWAL', created.id) : undefined;
      const latestReserve = feeReserve ?? amountReserve;
      await writeAudit(tx, {
        action: 'WITHDRAWAL_REQUESTED',
        entityType: 'Withdrawal',
        entityId: created.id,
        ipAddress: input.ipAddress,
        after: { amountMinor: parsed.amountMinor.toString(), feeMinor: parsed.feeMinor.toString(), reservedMinor: (parsed.amountMinor + parsed.feeMinor).toString(), toAddress: parsed.toAddress, idempotencyKey: parsed.idempotencyKey, mode: 'test', simulated: true }
      });
      // Simulated payout: settle the reservation immediately. The wallet moves
      // from reserved back to nothing — available was already debited above,
      // exactly like a real completed withdrawal.
      await settleReservedWallet(tx, userId, parsed.amountMinor + parsed.feeMinor);
      const completed = await tx.withdrawal.update({ where: { id: created.id }, data: { status: WithdrawalStatus.COMPLETED, fundsReserved: false, completedAt: new Date() } });
      await writeAudit(tx, {
        action: 'WITHDRAWAL_TEST_COMPLETED',
        entityType: 'Withdrawal',
        entityId: created.id,
        ipAddress: input.ipAddress,
        after: { status: WithdrawalStatus.COMPLETED, simulated: true, note: 'Simulated test-mode withdrawal. No TRC20 transaction was broadcast. Test currency only.' }
      });
      return { ...completed, availableMinor: latestReserve.availableMinor, lockedMinor: latestReserve.lockedMinor };
    }, { isolationLevel: 'ReadCommitted' });
    return withdrawal;
  } catch (error) {
    if (isPrismaUniqueError(error)) throw new AppError(409, 'This withdrawal request has already been submitted', 'IDEMPOTENCY_CONFLICT');
    throw error;
  }
}

export async function approveWithdrawal(id: string, adminId: string, ipAddress?: string) {
  if (!config.chainOperationsEnabled) throw new AppError(403, 'Blockchain withdrawals are disabled in test mode', 'TEST_MODE');
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
  if (!config.chainOperationsEnabled) throw new AppError(403, 'Blockchain withdrawals are disabled in test mode', 'TEST_MODE');
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

export async function rejectWithdrawal(id: string, adminId: string, reason: string, ipAddress?: string) {
  return prisma.$transaction(async (tx: Transaction) => {
    const withdrawal = await lockWithdrawal(tx, id);
    if (!withdrawal) throw new AppError(404, 'Withdrawal not found', 'WITHDRAWAL_NOT_FOUND');
    if (![WithdrawalStatus.QUEUED, WithdrawalStatus.FAILED].includes(withdrawal.status) || withdrawal.txHash) {
      throw new AppError(409, 'Only an unbroadcast queued or failed withdrawal can be rejected', 'INVALID_STATUS');
    }
    let availableMinor: bigint | undefined;
    if (withdrawal.fundsReserved) {
      const amountRelease = await releaseReservedWallet(tx, withdrawal.userId, withdrawal.amountMinor, LedgerType.REFUND, 'WITHDRAWAL_REJECTED', withdrawal.id);
      availableMinor = amountRelease.availableMinor;
      if (withdrawal.feeMinor > 0n) {
        const feeRelease = await releaseReservedWallet(tx, withdrawal.userId, withdrawal.feeMinor, LedgerType.REFUND, 'WITHDRAWAL_FEE_REJECTED', withdrawal.id);
        availableMinor = feeRelease.availableMinor;
      }
    }
    const result = await tx.withdrawal.update({ where: { id }, data: { status: WithdrawalStatus.REJECTED, fundsReserved: false } });
    await writeAudit(tx, {
      actorId: adminId,
      action: 'WITHDRAWAL_REJECTED',
      entityType: 'Withdrawal',
      entityId: id,
      ipAddress,
      before: { status: withdrawal.status },
      after: { status: result.status, reason, releasedMinor: withdrawal.fundsReserved ? (withdrawal.amountMinor + withdrawal.feeMinor).toString() : 'legacy-debit-not-released' }
    });
    return { ...result, availableMinor };
  });
}

export async function processWithdrawal(withdrawalId: string): Promise<void> {
  if (!config.chainOperationsEnabled) throw new AppError(403, 'Refusing to broadcast a blockchain withdrawal in test mode', 'TEST_MODE');
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
    let txHash = intent.txHash ?? await tronGateway.findRecentOutgoingTransfer(intent.toAddress, intent.amountMinor, intent.intentStartedAt - 2 * 60_000);
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
      const current = await lockWithdrawal(tx, withdrawalId);
      if (!current) throw new AppError(404, 'Withdrawal not found', 'WITHDRAWAL_NOT_FOUND');
      if (current.fundsReserved) await settleReservedWallet(tx, current.userId, current.amountMinor + current.feeMinor);
      await tx.withdrawal.update({ where: { id: withdrawalId }, data: { status: WithdrawalStatus.COMPLETED, completedAt: new Date() } });
      await writeAudit(tx, { action: 'WITHDRAWAL_COMPLETED', entityType: 'Withdrawal', entityId: withdrawalId, after: { txHash, settledReservedMinor: current.fundsReserved ? (current.amountMinor + current.feeMinor).toString() : 'legacy-debit' } });
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
