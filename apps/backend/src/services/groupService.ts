import { prisma } from '../lib/prisma';

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
  return prisma.groupSetting.upsert({
    where: { chatId: BigInt(chat.id) },
    update: {
      title: chat.title,
      username: chat.username,
      chatType: chat.type,
      lastSeenAt: new Date()
    },
    create: {
      chatId: BigInt(chat.id),
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
  await registerTelegramGroup(chat);
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
  await registerTelegramGroup(chat);
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

export async function listRegisteredGroups() {
  return prisma.groupSetting.findMany({
    include: { _count: { select: { members: true } } },
    orderBy: [{ enabled: 'desc' }, { lastSeenAt: 'desc' }]
  });
}
