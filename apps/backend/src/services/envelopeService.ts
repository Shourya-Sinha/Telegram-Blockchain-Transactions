import { randomBytes, randomUUID } from 'node:crypto';
import { EnvelopeMode, EnvelopeStatus, LedgerType } from '../utils/prismaEnums';
import { createEnvelopeSchema, parseUsdtToMinor } from '@red-envelope/shared';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { AppError, isPrismaUniqueError } from '../utils/errors';
import { assertClaimEligibility } from './eligibilityService';
import { creditWallet, debitWallet, type Transaction, writeAudit } from './ledgerService';

type CreateInput = { total: string; count: number; mode: 'RANDOM' | 'EQUAL'; groupId: string; expiresInMinutes: number; messageId?: number; ipAddress?: string };

function randomBigInt(maxExclusive: bigint): bigint {
  if (maxExclusive <= 0n) throw new Error('random upper bound must be positive');
  const bytes = Math.ceil(maxExclusive.toString(2).length / 8);
  const excessBits = BigInt(bytes * 8) - BigInt(maxExclusive.toString(2).length);
  const mask = (1n << BigInt(bytes * 8)) - 1n;
  while (true) {
    const candidate = BigInt(`0x${randomBytes(bytes).toString('hex')}`) & mask;
    const normalized = excessBits > 0n ? candidate >> excessBits : candidate;
    if (normalized < maxExclusive) return normalized;
  }
}

/** Integer-only version of the classic "double mean" envelope algorithm. */
function randomClaimAmount(remaining: bigint, slots: number): bigint {
  if (slots <= 1) return remaining;
  const maxByMean = (remaining / BigInt(slots)) * 2n;
  const maxByRemainder = remaining - BigInt(slots - 1); // leave at least one minor unit per slot
  const maximum = maxByMean < maxByRemainder ? maxByMean : maxByRemainder;
  if (maximum <= 1n) return 1n;
  return randomBigInt(maximum) + 1n;
}

export async function createEnvelope(senderId: string, input: CreateInput) {
  const parsed = createEnvelopeSchema.parse(input);
  if ((await redis.get('emergency:envelopes-disabled')) === '1') throw new AppError(503, 'Red envelope creation is temporarily disabled', 'ENVELOPES_DISABLED');
  const totalMinor = parseUsdtToMinor(parsed.total);
  const groupId = BigInt(parsed.groupId);
  if (totalMinor < BigInt(parsed.count)) throw new AppError(400, 'Each slot must contain at least 0.000001 USDT', 'AMOUNT_TOO_SMALL');
  const id = randomUUID();
  return prisma.$transaction(async (tx: Transaction) => {
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
    await writeAudit(tx, { action: 'RED_ENVELOPE_CREATED', entityType: 'RedEnvelope', entityId: envelope.id, ipAddress: input.ipAddress, after: { totalMinor: totalMinor.toString(), slots: parsed.count, mode: parsed.mode } });
    return { envelope, availableMinor: debit.availableMinor };
  }, { isolationLevel: 'ReadCommitted' });
}

async function lockEnvelope(tx: Transaction, envelopeId: string): Promise<void> {
  await tx.$queryRawUnsafe(`SELECT \"id\" FROM \"RedEnvelope\" WHERE \"id\" = $1 FOR UPDATE`, envelopeId);
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
