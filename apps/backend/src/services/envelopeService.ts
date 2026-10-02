import { randomUUID } from 'node:crypto';
import { EnvelopeMode, EnvelopeStatus, LedgerType } from '../utils/prismaEnums';
import { createEnvelopeSchema, parseUsdtToMinor } from '@red-envelope/shared';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { AppError, isPrismaUniqueError } from '../utils/errors';
import { assertClaimEligibility } from './eligibilityService';
import { creditWallet, debitWallet, type Transaction, writeAudit } from './ledgerService';
import { randomClaimAmount } from '../utils/envelopeAllocation';

export type CreateEnvelopeInput = {
  total: string;
  count: number;
  mode: 'RANDOM' | 'EQUAL';
  groupId: string;
  expiresInMinutes: number;
  messageId?: number;
  ipAddress?: string;
  actorId?: string;
};

export async function createEnvelope(senderId: string, input: CreateEnvelopeInput) {
  const parsed = createEnvelopeSchema.parse(input);
  if ((await redis.get('emergency:envelopes-disabled')) === '1') throw new AppError(503, 'Red envelope creation is temporarily disabled', 'ENVELOPES_DISABLED');
  const totalMinor = parseUsdtToMinor(parsed.total);
  const groupId = BigInt(parsed.groupId);
  const group = await prisma.groupSetting.findUnique({ where: { chatId: groupId }, select: { enabled: true } });
  if (!group) throw new AppError(404, 'This Telegram group is not registered. Add the bot and run /registergroup there first.', 'GROUP_NOT_REGISTERED');
  if (!group.enabled) throw new AppError(403, 'Red envelopes are disabled in this group', 'GROUP_DISABLED');
  if (totalMinor < BigInt(parsed.count)) throw new AppError(400, 'Each slot must contain at least 0.000001 USDT', 'AMOUNT_TOO_SMALL');
  const id = randomUUID();
  try {
    return await prisma.$transaction(async (tx: Transaction) => {
      const envelope = await tx.redEnvelope.create({ data: {
        id,
        senderId,
        groupId,
        messageId: input.messageId ?? 0,
        totalMinor,
        remainingMinor: totalMinor,
        totalSlots: parsed.count,
        remainingSlots: parsed.count,
        mode: parsed.mode as EnvelopeMode,
        expiresAt: new Date(Date.now() + parsed.expiresInMinutes * 60_000),
        status: EnvelopeStatus.ACTIVE
      } });
      const debit = await debitWallet(tx, senderId, totalMinor, LedgerType.TRANSFER, 'RED_ENVELOPE', envelope.id);
      await writeAudit(tx, { actorId: input.actorId, action: 'RED_ENVELOPE_CREATED', entityType: 'RedEnvelope', entityId: envelope.id, ipAddress: input.ipAddress, after: { totalMinor: totalMinor.toString(), slots: parsed.count, mode: parsed.mode, groupId: parsed.groupId } });
      return { envelope, availableMinor: debit.availableMinor };
    }, { isolationLevel: 'ReadCommitted' });
  } catch (error) {
    // Turn the bare ledger rejection into an actionable message: include how
    // much the envelope needs so the user knows what to top up.
    if (error instanceof AppError && error.code === 'INSUFFICIENT_BALANCE') {
      throw new AppError(400, `Insufficient available balance: this envelope needs ${parsed.total} USDT but your available balance is lower. Top up your wallet and try again.`, 'INSUFFICIENT_BALANCE');
    }
    throw error;
  }
}

async function lockEnvelope(tx: Transaction, envelopeId: string): Promise<void> {
  await tx.$queryRawUnsafe(`SELECT \"id\" FROM \"RedEnvelope\" WHERE \"id\" = $1 FOR UPDATE`, envelopeId);
}

export async function attachEnvelopeMessage(envelopeId: string, messageId: number): Promise<void> {
  await prisma.redEnvelope.update({ where: { id: envelopeId }, data: { messageId } });
}

/**
 * Compensates a failed Telegram publication. The debit and refund stay visible in
 * the ledger instead of leaving an active envelope that nobody can open.
 */
export async function refundUnpublishedEnvelope(envelopeId: string, actorId?: string, reason?: string): Promise<void> {
  await prisma.$transaction(async (tx: Transaction) => {
    await lockEnvelope(tx, envelopeId);
    const envelope = await tx.redEnvelope.findUnique({ where: { id: envelopeId } });
    if (!envelope || envelope.status !== EnvelopeStatus.ACTIVE) return;
    const claimCount = await tx.redEnvelopeClaim.count({ where: { envelopeId } });
    if (claimCount > 0) return;
    await tx.redEnvelope.update({
      where: { id: envelopeId },
      data: { status: EnvelopeStatus.REFUNDED, remainingMinor: 0n, remainingSlots: 0 }
    });
    if (envelope.remainingMinor > 0n) {
      await creditWallet(tx, envelope.senderId, envelope.remainingMinor, LedgerType.REFUND, 'RED_ENVELOPE', envelope.id);
    }
    await writeAudit(tx, {
      actorId,
      action: 'RED_ENVELOPE_PUBLICATION_FAILED',
      entityType: 'RedEnvelope',
      entityId: envelope.id,
      before: { status: envelope.status, remainingMinor: envelope.remainingMinor.toString() },
      after: { status: EnvelopeStatus.REFUNDED, reason: reason?.slice(0, 300) }
    });
  });
}

export async function claimEnvelope(userId: string, envelopeId: string, ipAddress?: string) {
  const initial = await prisma.redEnvelope.findUnique({ where: { id: envelopeId }, select: { groupId: true } });
  if (!initial) throw new AppError(404, 'Red envelope not found', 'ENVELOPE_NOT_FOUND');
  await assertClaimEligibility(userId, initial.groupId);

  try {
    const result = await prisma.$transaction(async (tx: Transaction) => {
      await lockEnvelope(tx, envelopeId);
      const envelope = await tx.redEnvelope.findUnique({ where: { id: envelopeId } });
      if (!envelope) throw new AppError(404, 'Red envelope not found', 'ENVELOPE_NOT_FOUND');
      if (envelope.status !== EnvelopeStatus.ACTIVE || envelope.remainingSlots <= 0 || envelope.remainingMinor <= 0n) {
        return { kind: 'closed' as const };
      }
      if (envelope.expiresAt.getTime() <= Date.now()) {
        await tx.redEnvelope.update({ where: { id: envelope.id }, data: { status: EnvelopeStatus.EXPIRED, remainingMinor: 0n, remainingSlots: 0 } });
        if (envelope.remainingMinor > 0n) {
          await creditWallet(tx, envelope.senderId, envelope.remainingMinor, LedgerType.REFUND, 'RED_ENVELOPE', envelope.id);
        }
        await writeAudit(tx, { action: 'RED_ENVELOPE_EXPIRED', entityType: 'RedEnvelope', entityId: envelope.id, ipAddress, before: { remainingMinor: envelope.remainingMinor.toString() }, after: { remainingMinor: '0' } });
        return { kind: 'expired' as const };
      }
      const alreadyClaimed = await tx.redEnvelopeClaim.findUnique({ where: { envelopeId_userId: { envelopeId, userId } } });
      if (alreadyClaimed) return { kind: 'already_claimed' as const, claim: alreadyClaimed };
      const amountMinor = envelope.mode === EnvelopeMode.EQUAL
        ? (envelope.remainingSlots === 1 ? envelope.remainingMinor : envelope.remainingMinor / BigInt(envelope.remainingSlots) + (envelope.remainingMinor % BigInt(envelope.remainingSlots) > 0n ? 1n : 0n))
        : randomClaimAmount(envelope.remainingMinor, envelope.remainingSlots);
      const nextRemainingSlots = envelope.remainingSlots - 1;
      const nextRemainingMinor = envelope.remainingMinor - amountMinor;
      const claim = await tx.redEnvelopeClaim.create({ data: { envelopeId, userId, amountMinor } });
      await tx.redEnvelope.update({ where: { id: envelope.id }, data: {
        remainingMinor: nextRemainingMinor,
        remainingSlots: nextRemainingSlots,
        status: nextRemainingSlots === 0 ? EnvelopeStatus.COMPLETED : EnvelopeStatus.ACTIVE
      } });
      const credit = await creditWallet(tx, userId, amountMinor, LedgerType.CLAIM, 'RED_ENVELOPE', envelope.id);
      await writeAudit(tx, { action: 'RED_ENVELOPE_CLAIMED', entityType: 'RedEnvelopeClaim', entityId: claim.id, ipAddress, after: { envelopeId, userId, amountMinor: amountMinor.toString() } });
      return { kind: 'claimed' as const, claim, availableMinor: credit.availableMinor };
    }, { isolationLevel: 'ReadCommitted' });

    if (result.kind === 'closed') throw new AppError(409, 'This red envelope has already been claimed', 'ENVELOPE_CLOSED');
    if (result.kind === 'expired') throw new AppError(410, 'This red envelope has expired', 'ENVELOPE_EXPIRED');
    if (result.kind === 'already_claimed') throw new AppError(409, 'You have already claimed this red envelope', 'ALREADY_CLAIMED');
    return result;
  } catch (error) {
    if (isPrismaUniqueError(error)) throw new AppError(409, 'You have already claimed this red envelope', 'ALREADY_CLAIMED');
    throw error;
  }
}

export async function getEnvelope(envelopeId: string) {
  const envelope = await prisma.redEnvelope.findUnique({ where: { id: envelopeId }, include: { claims: { orderBy: { claimedAt: 'asc' }, include: { user: { select: { firstName: true, username: true } } } } } });
  if (!envelope) throw new AppError(404, 'Red envelope not found', 'ENVELOPE_NOT_FOUND');
  return envelope;
}

export async function expireEnvelopes(): Promise<number> {
  const candidates = await prisma.redEnvelope.findMany({ where: { status: EnvelopeStatus.ACTIVE, expiresAt: { lte: new Date() } }, select: { id: true }, take: 100 });
  let expired = 0;
  for (const candidate of candidates) {
    try {
      await prisma.$transaction(async (tx: Transaction) => {
        await lockEnvelope(tx, candidate.id);
        const envelope = await tx.redEnvelope.findUnique({ where: { id: candidate.id } });
        if (!envelope || envelope.status !== EnvelopeStatus.ACTIVE || envelope.expiresAt > new Date()) return;
        await tx.redEnvelope.update({ where: { id: envelope.id }, data: { status: EnvelopeStatus.EXPIRED, remainingMinor: 0n, remainingSlots: 0 } });
        if (envelope.remainingMinor > 0n) await creditWallet(tx, envelope.senderId, envelope.remainingMinor, LedgerType.REFUND, 'RED_ENVELOPE', envelope.id);
        await writeAudit(tx, { action: 'RED_ENVELOPE_EXPIRED', entityType: 'RedEnvelope', entityId: envelope.id, after: { refundedMinor: envelope.remainingMinor.toString() } });
        expired += 1;
      });
    } catch (error) { console.error('[envelope-expiry]', candidate.id, error); }
  }
  return expired;
}
