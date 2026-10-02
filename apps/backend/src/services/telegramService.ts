import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { formatMinor } from '@red-envelope/shared';
import { config } from '../config';
import { AppError } from '../utils/errors';

let activeBot: Bot | undefined;

export function registerTelegramBot(bot: Bot): void {
  activeBot = bot;
}

export function getTelegramBot(): Bot {
  if (!activeBot) throw new AppError(503, 'Telegram bot is not configured', 'BOT_NOT_CONFIGURED');
  return activeBot;
}

/**
 * Telegram only accepts Mini App (web_app) buttons for HTTPS URLs (plus
 * localhost for local testing). Guard every webApp button with this so a
 * misconfigured PUBLIC_APP_URL degrades to a missing button instead of
 * breaking /start replies or envelope publishing.
 */
export function isTelegramWebAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/** Keyboard with a single "open the Mini App" button, or undefined when the URL is not usable. */
export function miniAppKeyboard(label: string): InlineKeyboard | undefined {
  return isTelegramWebAppUrl(config.publicAppUrl) ? new InlineKeyboard().webApp(label, config.publicAppUrl) : undefined;
}

type PublishableEnvelope = {
  id: string;
  groupId: bigint;
  totalMinor: bigint;
  totalSlots: number;
  mode: string;
  expiresAt: Date;
};

export async function publishEnvelopeMessage(envelope: PublishableEnvelope): Promise<number> {
  // The claim button stays first; the wallet button underneath is how a group
  // member reaches the Mini App and sees their balance/history right where
  // they claimed, without hunting for the bot menu. It is bilingual because a
  // group message is the same for every viewer.
  const keyboard = new InlineKeyboard().text('🧧 Claim red envelope · 领取红包', envelope.id);
  if (isTelegramWebAppUrl(config.publicAppUrl)) keyboard.row().webApp('💰 Open My Wallet · 打开钱包', config.publicAppUrl);
  const mode = envelope.mode === 'EQUAL' ? 'equal shares' : 'random shares';
  const message = await getTelegramBot().api.sendMessage(
    envelope.groupId.toString(),
    [
      '🧧 Red Envelope',
      '',
      `Total: ${formatMinor(envelope.totalMinor)} USDT`,
      `Claims: ${envelope.totalSlots} · ${mode}`,
      `Expires: ${envelope.expiresAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`,
      '',
      'Tap below to claim. Each Telegram account can claim once.'
    ].join('\n'),
    { reply_markup: keyboard }
  );
  return message.message_id;
}

async function readMembership(groupId: bigint, telegramId: bigint) {
  const numericTelegramId = Number(telegramId);
  if (!Number.isSafeInteger(numericTelegramId)) throw new Error('Telegram ID is outside the supported range');
  return getTelegramBot().api.getChatMember(groupId.toString(), numericTelegramId);
}

export async function isTelegramGroupMember(groupId: bigint, telegramId: bigint): Promise<boolean> {
  try {
    const member = await readMembership(groupId, telegramId);
    return member.status !== 'left' && member.status !== 'kicked';
  } catch {
    return false;
  }
}

export async function assertTelegramGroupMembership(groupId: bigint, telegramId: bigint): Promise<void> {
  try {
    const member = await readMembership(groupId, telegramId);
    if (member.status === 'left' || member.status === 'kicked') {
      throw new AppError(403, 'Join the Telegram group before continuing', 'GROUP_MEMBERSHIP_REQUIRED');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(403, 'Unable to verify group membership. Ask an admin to make the bot a group administrator.', 'MEMBERSHIP_UNVERIFIED');
  }
}
