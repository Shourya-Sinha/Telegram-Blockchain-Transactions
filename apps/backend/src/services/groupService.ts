import { prisma } from '../lib/prisma';
import { AppError } from '../utils/errors';

type TelegramGroup = {
  id: number | bigint;
  type: string;
  title?: string;
  username?: string;
};

export type TelegramGroupMemberProfile = {
  id: number | bigint;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
  is_premium?: boolean;
};

/** Register groups from real Telegram updates so operators do not copy opaque IDs blindly. */
export async function registerTelegramGroup(chat: TelegramGroup) {
  if (!['group', 'supergroup'].includes(chat.type)) return null;
  const chatId = BigInt(chat.id);
  const existing = await prisma.groupSetting.findUnique({ where: { chatId }, select: { archivedAt: true } });
  // Do not let routine Telegram updates silently undo an admin's cleanup.
  if (existing?.archivedAt) return null;
  return prisma.groupSetting.upsert({
    where: { chatId },
    update: {
      title: chat.title,
      username: chat.username,
      chatType: chat.type,
      lastSeenAt: new Date()
    },
    create: {
      chatId,
      title: chat.title,
      username: chat.username,
      chatType: chat.type,
      lastSeenAt: new Date()
    }
  });
}

/**
 * Persist only profile fields Telegram actually supplies to the bot. The Bot
 * API does not expose phone numbers or a full historical member roster.
 */
export async function recordTelegramGroupMember(
  chat: TelegramGroup,
  member: TelegramGroupMemberProfile,
  isMessage = false
) {
  if (!['group', 'supergroup'].includes(chat.type)) return null;
  const group = await registerTelegramGroup(chat);
  if (!group || group.archivedAt) return null;
  const chatId = BigInt(chat.id);
  const telegramId = BigInt(member.id);
  const now = new Date();
  const profile = {
    username: member.username ?? null,
    firstName: member.first_name || 'Unknown',
    lastName: member.last_name ?? null,
    languageCode: member.language_code ?? null,
    isBot: member.is_bot ?? false,
    isPremium: member.is_premium ?? false,
    isMember: true,
    leftAt: null,
    lastSeenAt: now,
    ...(isMessage ? { messageCount: { increment: 1 }, lastMessageAt: now } : {})
  };
  return prisma.groupMember.upsert({
    where: { chatId_telegramId: { chatId, telegramId } },
    update: profile,
    create: {
      chatId,
      telegramId,
      username: member.username ?? null,
      firstName: member.first_name || 'Unknown',
      lastName: member.last_name ?? null,
      languageCode: member.language_code ?? null,
      isBot: member.is_bot ?? false,
      isPremium: member.is_premium ?? false,
      isMember: true,
      messageCount: isMessage ? 1 : 0,
      lastSeenAt: now,
      lastMessageAt: isMessage ? now : null
    }
  });
}

/** Mark a participant as left when Telegram sends a service/member update. */
export async function markTelegramGroupMemberLeft(chat: TelegramGroup, member: TelegramGroupMemberProfile) {
  if (!['group', 'supergroup'].includes(chat.type)) return null;
  const group = await registerTelegramGroup(chat);
  if (!group || group.archivedAt) return null;
  const now = new Date();
  return prisma.groupMember.upsert({
    where: { chatId_telegramId: { chatId: BigInt(chat.id), telegramId: BigInt(member.id) } },
    update: {
      username: member.username ?? null,
      firstName: member.first_name || 'Unknown',
      lastName: member.last_name ?? null,
      languageCode: member.language_code ?? null,
      isBot: member.is_bot ?? false,
      isPremium: member.is_premium ?? false,
      isMember: false,
      leftAt: now,
      lastSeenAt: now
    },
    create: {
      chatId: BigInt(chat.id),
      telegramId: BigInt(member.id),
      username: member.username ?? null,
      firstName: member.first_name || 'Unknown',
      lastName: member.last_name ?? null,
      languageCode: member.language_code ?? null,
      isBot: member.is_bot ?? false,
      isPremium: member.is_premium ?? false,
      isMember: false,
      leftAt: now,
      lastSeenAt: now
    }
  });
}

export async function listRegisteredGroups(options: { includePendingDeletion?: boolean; includeArchived?: boolean } = {}) {
  return prisma.groupSetting.findMany({
    where: {
      ...(options.includePendingDeletion ? {} : { deletionRequestedAt: null }),
      ...(options.includeArchived ? {} : { archivedAt: null })
    },
    include: { _count: { select: { members: true } } },
    orderBy: [{ enabled: 'desc' }, { lastSeenAt: 'desc' }]
  });
}

async function lockGroupForRemoval(tx: any, chatId: bigint): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT "chatId" FROM "GroupSetting" WHERE "chatId" = $1::bigint FOR UPDATE`,
    chatId.toString()
  );
}

async function archiveGroup(tx: any, chatId: bigint, archivedAt: Date): Promise<void> {
  await tx.groupMember.deleteMany({ where: { chatId } });
  await tx.groupSetting.update({ where: { chatId }, data: { archivedAt, deletionRequestedAt: null } });
}

/** Remove a group immediately when idle, or schedule it after active envelopes settle. */
export async function requestGroupRemoval(chatId: bigint, actorId: string, ipAddress?: string) {
  return prisma.$transaction(async (tx: any) => {
    await lockGroupForRemoval(tx, chatId);
    const group = await tx.groupSetting.findUnique({ where: { chatId } });
    if (!group || group.archivedAt) throw new AppError(404, 'Registered Telegram group not found', 'GROUP_NOT_FOUND');
    const activeEnvelopes = await tx.redEnvelope.count({ where: { groupId: chatId, status: 'ACTIVE' } });

    if (activeEnvelopes > 0) {
      if (!group.deletionRequestedAt) {
        const requestedAt = new Date();
        await tx.groupSetting.update({ where: { chatId }, data: { deletionRequestedAt: requestedAt } });
        await tx.auditLog.create({ data: {
          actorId,
          action: 'GROUP_REMOVAL_SCHEDULED',
          entityType: 'GroupSetting',
          entityId: group.id,
          ipAddress,
          before: { chatId: chatId.toString() },
          after: { activeEnvelopes, deletionRequestedAt: requestedAt.toISOString() }
        } });
      }
      return { status: 'PENDING' as const, activeEnvelopes };
    }

    const archivedAt = new Date();
    await archiveGroup(tx, chatId, archivedAt);
    await tx.auditLog.create({ data: {
      actorId,
      action: 'GROUP_ARCHIVED',
      entityType: 'GroupSetting',
      entityId: group.id,
      ipAddress,
      before: { chatId: chatId.toString() },
      after: { archivedAt: archivedAt.toISOString() }
    } });
    return { status: 'ARCHIVED' as const, activeEnvelopes: 0 };
  }, { isolationLevel: 'ReadCommitted' });
}

export async function cancelGroupRemoval(chatId: bigint, actorId: string, ipAddress?: string) {
  return prisma.$transaction(async (tx: any) => {
    await lockGroupForRemoval(tx, chatId);
    const group = await tx.groupSetting.findUnique({ where: { chatId } });
    if (!group || group.archivedAt) throw new AppError(404, 'Registered Telegram group not found', 'GROUP_NOT_FOUND');
    if (!group.deletionRequestedAt) throw new AppError(409, 'This group is not scheduled for removal', 'GROUP_REMOVAL_NOT_PENDING');
    await tx.groupSetting.update({ where: { chatId }, data: { deletionRequestedAt: null } });
    await tx.auditLog.create({ data: {
      actorId,
      action: 'GROUP_REMOVAL_CANCELLED',
      entityType: 'GroupSetting',
      entityId: group.id,
      ipAddress,
      before: { deletionRequestedAt: group.deletionRequestedAt.toISOString() },
      after: { chatId: chatId.toString() }
    } });
    return { status: 'ACTIVE' as const };
  }, { isolationLevel: 'ReadCommitted' });
}

export async function restoreArchivedGroup(chatId: bigint, actorId: string, ipAddress?: string) {
  return prisma.$transaction(async (tx: any) => {
    await lockGroupForRemoval(tx, chatId);
    const group = await tx.groupSetting.findUnique({ where: { chatId } });
    if (!group) throw new AppError(404, 'Archived Telegram group not found', 'GROUP_NOT_FOUND');
    if (!group.archivedAt) throw new AppError(409, 'This group is not archived', 'GROUP_NOT_ARCHIVED');
    await tx.groupSetting.update({ where: { chatId }, data: { archivedAt: null, deletionRequestedAt: null } });
    await tx.auditLog.create({ data: {
      actorId,
      action: 'GROUP_RESTORED',
      entityType: 'GroupSetting',
      entityId: group.id,
      ipAddress,
      before: { archivedAt: group.archivedAt.toISOString() },
      after: { chatId: chatId.toString() }
    } });
    return { status: 'ACTIVE' as const };
  }, { isolationLevel: 'ReadCommitted' });
}

/** Called by the envelope-expiry worker after it marks expired envelopes. */
export async function processPendingGroupRemovals(): Promise<number> {
  const pendingGroups = await prisma.groupSetting.findMany({
    where: { deletionRequestedAt: { not: null }, archivedAt: null },
    select: { chatId: true }
  });
  let archived = 0;
  for (const candidate of pendingGroups) {
    try {
      await prisma.$transaction(async (tx: any) => {
        await lockGroupForRemoval(tx, candidate.chatId);
        const group = await tx.groupSetting.findUnique({ where: { chatId: candidate.chatId } });
        if (!group || !group.deletionRequestedAt || group.archivedAt) return;
        const activeEnvelopes = await tx.redEnvelope.count({ where: { groupId: candidate.chatId, status: 'ACTIVE' } });
        if (activeEnvelopes > 0) return;
        const archivedAt = new Date();
        await archiveGroup(tx, candidate.chatId, archivedAt);
        await tx.auditLog.create({ data: {
          action: 'GROUP_AUTO_ARCHIVED',
          entityType: 'GroupSetting',
          entityId: group.id,
          before: { chatId: candidate.chatId.toString(), deletionRequestedAt: group.deletionRequestedAt.toISOString() },
          after: { archivedAt: archivedAt.toISOString() }
        } });
        archived += 1;
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      console.error('[group-removal]', candidate.chatId.toString(), error);
    }
  }
  return archived;
}
