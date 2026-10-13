import { prisma } from '../lib/prisma';

type TelegramGroup = {
  id: number | bigint;
  type: string;
  title?: string;
  username?: string;
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

export async function listRegisteredGroups() {
  return prisma.groupSetting.findMany({ orderBy: [{ enabled: 'desc' }, { lastSeenAt: 'desc' }] });
}
