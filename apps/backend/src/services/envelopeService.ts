import { randomUUID } from 'node:crypto';
import { EnvelopeAudience, EnvelopeMode, EnvelopeStatus, LedgerType } from '../utils/prismaEnums';
import { createEnvelopeSchema, parseUsdtToMinor } from '@red-envelope/shared';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { AppError, isPrismaUniqueError } from '../utils/errors';
import { assertClaimEligibility } from './eligibilityService';
import { creditWallet, debitWallet, type Transaction, writeAudit } from './ledgerService';
import { randomClaimAmount } from '../utils/envelopeAllocation';
import { isEligibleUsernameRecipient, isEnvelopeAudienceAllowed, normalizeEligibleTelegramIds, normalizeEligibleTelegramUsernames, normalizeTelegramUsername } from '../utils/envelopeAudience';
import { assertTelegramGroupMembership } from './telegramService';
import { processPendingGroupRemovals } from './groupService';

export type CreateEnvelopeInput = {
  total: string;
  count: number;
  mode: 'RANDOM' | 'EQUAL';
  groupId: string;
  expiresInMinutes: number;
  audience?: 'ALL' | 'SELECTED';
  eligibleTelegramIds?: string[];
  eligibleUsernames?: string[];
  messageId?: number;
  ipAddress?: string;
  actorId?: string;
};

async function lockAndAssertGroupAvailable(tx: Transaction, groupId: bigint): Promise<void> {
  const rows = await tx.$queryRawUnsafe(
    `SELECT "chatId" FROM "GroupSetting" WHERE "chatId" = $1::bigint FOR UPDATE`,
    groupId.toString()
  ) as Array<{ chatId: bigint }>;
  if (rows.length === 0) throw new AppError(404, 'This Telegram group is not registered. Add the bot and run /registergroup there first.', 'GROUP_NOT_REGISTERED');
  const group = await tx.groupSetting.findUnique({ where: { chatId: groupId }, select: { enabled: true, deletionRequestedAt: true, archivedAt: true } });
  if (!group || group.archivedAt) throw new AppError(404, 'This Telegram group is not registered. Add the bot and run /registergroup there first.', 'GROUP_NOT_REGISTERED');
  if (group.deletionRequestedAt) throw new AppError(409, 'This group is scheduled for removal and cannot receive new envelopes', 'GROUP_REMOVAL_PENDING');
  if (!group.enabled) throw new AppError(403, 'Red envelopes are disabled in this group', 'GROUP_DISABLED');
}

async function assertSelectedTelegramMembers(groupId: bigint, telegramIds: string[]): Promise<void> {
  let nextIndex = 0;
  const failures: Array<{ telegramId: string; error: unknown }> = [];
  const workers = Array.from({ length: Math.min(8, telegramIds.length) }, async () => {
    while (nextIndex < telegramIds.length) {
      const telegramId = telegramIds[nextIndex++];
      try {
        await assertTelegramGroupMembership(groupId, BigInt(telegramId));
      } catch (error) {
        failures.push({ telegramId, error });
      }
    }
  });
  await Promise.all(workers);

  if (failures.length === 0) return;
  const notMembers = failures.filter(({ error }) => error instanceof AppError && error.code === 'GROUP_MEMBERSHIP_REQUIRED').map(({ telegramId }) => telegramId);
  const unverified = failures.filter(({ error }) => !(error instanceof AppError) || error.code !== 'GROUP_MEMBERSHIP_REQUIRED').map(({ telegramId }) => telegramId);
  const formatIds = (ids: string[]) => `${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ` … and ${ids.length - 10} more` : ''}`;
  const reasons = [
    notMembers.length ? `Not current members of this group: ${formatIds(notMembers)}.` : '',
    unverified.length ? `Could not verify: ${formatIds(unverified)}. Check the IDs and make sure the bot is a group administrator.` : ''
  ].filter(Boolean);
  throw new AppError(400, reasons.join(' '), 'ENVELOPE_AUDIENCE_INVALID');
}

export async function createEnvelope(senderId: string, input: CreateEnvelopeInput) {
  const parsed = createEnvelopeSchema.parse(input);
  if ((await redis.get('emergency:envelopes-disabled')) === '1') throw new AppError(503, 'Red envelope creation is temporarily disabled', 'ENVELOPES_DISABLED');
  const totalMinor = parseUsdtToMinor(parsed.total);
  const groupId = BigInt(parsed.groupId);
  const group = await prisma.groupSetting.findUnique({ where: { chatId: groupId }, select: { enabled: true, deletionRequestedAt: true, archivedAt: true } });
  if (!group || group.archivedAt) throw new AppError(404, 'This Telegram group is not registered. Add the bot and run /registergroup there first.', 'GROUP_NOT_REGISTERED');
  if (group.deletionRequestedAt) throw new AppError(409, 'This group is scheduled for removal and cannot receive new envelopes', 'GROUP_REMOVAL_PENDING');
  if (!group.enabled) throw new AppError(403, 'Red envelopes are disabled in this group', 'GROUP_DISABLED');
  const eligibleTelegramIds = normalizeEligibleTelegramIds(parsed.audience, parsed.eligibleTelegramIds);
  const eligibleUsernames = normalizeEligibleTelegramUsernames(parsed.audience, parsed.eligibleUsernames);
  if (parsed.audience === 'SELECTED' && eligibleTelegramIds.length + eligibleUsernames.length === 0) {
    throw new AppError(400, 'Select at least one group member or change the audience to everyone', 'ENVELOPE_AUDIENCE_EMPTY');
  }
  if (totalMinor < BigInt(parsed.count)) throw new AppError(400, 'Each slot must contain at least 0.000001 USDT', 'AMOUNT_TOO_SMALL');
  if (parsed.audience === 'SELECTED' && eligibleTelegramIds.length > 0) {
    // Verify numeric IDs against this Telegram group before taking funds.
    // Username reservations are matched against Telegram-verified profiles at
    // claim time because the Bot API cannot resolve arbitrary usernames.
    await assertSelectedTelegramMembers(groupId, eligibleTelegramIds);
  }
  const id = randomUUID();
  try {
    return await prisma.$transaction(async (tx: Transaction) => {
      await lockAndAssertGroupAvailable(tx, groupId);
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
        audience: parsed.audience as EnvelopeAudience,
        expiresAt: new Date(Date.now() + parsed.expiresInMinutes * 60_000),
        status: EnvelopeStatus.ACTIVE
      }, include: { sender: { select: { firstName: true } } } });
      if (eligibleTelegramIds.length > 0) {
        await tx.redEnvelopeEligibleUser.createMany({
          data: eligibleTelegramIds.map((telegramId) => ({ envelopeId: envelope.id, telegramId: BigInt(telegramId) }))
        });
      }
      if (eligibleUsernames.length > 0) {
        await tx.redEnvelopeEligibleUsername.createMany({
          data: eligibleUsernames.map((username) => ({ envelopeId: envelope.id, username }))
        });
      }
      const debit = await debitWallet(tx, senderId, totalMinor, LedgerType.TRANSFER, 'RED_ENVELOPE', envelope.id);
      await writeAudit(tx, { actorId: input.actorId, action: 'RED_ENVELOPE_CREATED', entityType: 'RedEnvelope', entityId: envelope.id, ipAddress: input.ipAddress, after: { totalMinor: totalMinor.toString(), slots: parsed.count, mode: parsed.mode, groupId: parsed.groupId, audience: parsed.audience, eligibleCount: eligibleTelegramIds.length + eligibleUsernames.length, usernameRecipientCount: eligibleUsernames.length } });
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
  await tx.$queryRawUnsafe(`SELECT \"id\" FROM \"RedEnvelope\" WHERE \"id\" = $1::uuid FOR UPDATE`, envelopeId);
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

async function matchSelectedRecipient(tx: Transaction, envelopeId: string, claimant: { telegramId: bigint; username: string | null }): Promise<{ allowed: boolean; pendingUsername?: string }> {
  const [selectedById, boundEntry] = await Promise.all([
    tx.redEnvelopeEligibleUser.findUnique({
      where: { envelopeId_telegramId: { envelopeId, telegramId: claimant.telegramId } },
      select: { telegramId: true }
    }),
    tx.redEnvelopeEligibleUsername.findFirst({
      where: { envelopeId, telegramId: claimant.telegramId },
      select: { telegramId: true }
    })
  ]);

  const username = normalizeTelegramUsername(claimant.username);
  const usernameEntry = username
    ? await tx.redEnvelopeEligibleUsername.findUnique({
      where: { envelopeId_username: { envelopeId, username } },
      select: { username: true, telegramId: true }
    })
    : null;
  if (selectedById || boundEntry) {
    return { allowed: true, pendingUsername: usernameEntry?.telegramId === null ? username : undefined };
  }
  if (!username || !usernameEntry || !isEligibleUsernameRecipient(usernameEntry, claimant)) return { allowed: false };
  return { allowed: true, pendingUsername: usernameEntry.telegramId === null ? username : undefined };
}

export async function claimEnvelope(userId: string, envelopeId: string, ipAddress?: string) {
  const initial = await prisma.redEnvelope.findUnique({ where: { id: envelopeId }, select: { groupId: true } });
  if (!initial) throw new AppError(404, 'Red envelope not found', 'ENVELOPE_NOT_FOUND');
  await assertClaimEligibility(userId, initial.groupId, envelopeId);

  try {
    const result = await prisma.$transaction(async (tx: Transaction) => {
      await lockEnvelope(tx, envelopeId);
      const envelope = await tx.redEnvelope.findUnique({ where: { id: envelopeId } });
      if (!envelope) throw new AppError(404, 'Red envelope not found', 'ENVELOPE_NOT_FOUND');
      const claimant = await tx.user.findUnique({ where: { id: userId }, select: { telegramId: true, username: true } });
      if (!claimant) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
      const recipientMatch = envelope.audience === EnvelopeAudience.SELECTED
        ? await matchSelectedRecipient(tx, envelopeId, claimant)
        : { allowed: true as const };
      if (!isEnvelopeAudienceAllowed({ audience: envelope.audience, isSelected: recipientMatch.allowed })) {
        throw new AppError(403, 'This red envelope is limited to selected group members', 'ENVELOPE_NOT_ELIGIBLE');
      }
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
      if (recipientMatch.pendingUsername) {
        const binding = await tx.redEnvelopeEligibleUsername.updateMany({
          where: { envelopeId, username: recipientMatch.pendingUsername, telegramId: null },
          data: { telegramId: claimant.telegramId, boundAt: new Date() }
        });
        if (binding.count === 0) {
          const currentBinding = await tx.redEnvelopeEligibleUsername.findUnique({
            where: { envelopeId_username: { envelopeId, username: recipientMatch.pendingUsername } },
            select: { telegramId: true }
          });
          if (currentBinding?.telegramId !== claimant.telegramId) {
            throw new AppError(403, 'This username reservation has already been claimed by another Telegram account', 'ENVELOPE_NOT_ELIGIBLE');
          }
        } else {
          await writeAudit(tx, {
            action: 'RED_ENVELOPE_USERNAME_BOUND',
            entityType: 'RedEnvelopeEligibleUsername',
            entityId: `${envelopeId}:${recipientMatch.pendingUsername}`,
            ipAddress,
            after: { envelopeId, username: recipientMatch.pendingUsername, telegramId: claimant.telegramId.toString() }
          });
        }
      }
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
  const envelope = await prisma.redEnvelope.findUnique({ where: { id: envelopeId }, include: { sender: { select: { firstName: true, username: true } }, claims: { orderBy: { claimedAt: 'asc' }, include: { user: { select: { firstName: true, username: true } } } } } });
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
  await processPendingGroupRemovals();
  return expired;
}
