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

export function getBotUsername(): string | undefined {
  return activeBot?.botInfo?.username;
}

/**
 * t.me deep link that opens the bot's private chat and runs /start wallet.
 * Group messages cannot carry native web_app buttons, so this is how a group
 * member reaches the wallet: one tap opens the bot chat, where the wallet
 * buttons and the persistent 🧧 menu button live.
 */
export function walletDeepLink(): string | undefined {
  const username = getBotUsername();
  return username ? `https://t.me/${username}?start=wallet` : undefined;
}

/**
 * Native web_app (Mini App) buttons only exist in private chats — sending one
 * to a group or supergroup makes Telegram reject the whole message with
 * BUTTON_TYPE_INVALID. Pick the button type by chat: web_app in private chats,
 * t.me deep link everywhere else.
 */
export function chatAppKeyboard(label: string, chatType?: string): InlineKeyboard | undefined {
  if (chatType === 'group' || chatType === 'supergroup') {
    const deepLink = walletDeepLink();
    return deepLink ? new InlineKeyboard().url(label, deepLink) : undefined;
  }
  return miniAppKeyboard(label);
}

type ButtonPayload = {
  chat_id?: string | number;
  reply_markup?: { inline_keyboard?: Array<Array<Record<string, unknown>>> };
};

/**
 * Last line of defense against BUTTON_TYPE_INVALID: rewrite any web_app button
 * that is still aimed at a group/channel (negative chat id) into the bot's
 * t.me wallet deep link — or drop it when no deep link is available — so the
 * message always stays deliverable. Private-chat payloads pass through
 * untouched, and payloads without web_app buttons are returned as-is.
 */
export function rewriteGroupWebAppButtons<T>(payload: T, deepLink: string | undefined): T {
  const candidate = payload as ButtonPayload;
  if (typeof candidate !== 'object' || candidate === null) return payload;
  if (candidate.chat_id === undefined || !(Number(candidate.chat_id) < 0)) return payload;
  const keyboard = candidate.reply_markup?.inline_keyboard;
  if (!keyboard || !keyboard.some((row) => row.some((button) => 'web_app' in button))) return payload;
  const inline_keyboard = keyboard.map((row) => row.flatMap((button) => {
    if (!('web_app' in button)) return [button];
    if (!deepLink) return [];
    return [{ text: (button.text as string | undefined) ?? 'Open', url: deepLink }];
  }));
  return { ...candidate, reply_markup: { ...candidate.reply_markup, inline_keyboard } } as T;
}

/**
 * Installs an API transformer on every outgoing Telegram call. Even if a
 * future change (or a local merge) attaches a web_app button to a group
 * message again, the button is converted to a t.me deep link before the
 * request reaches Telegram, so users always receive the message.
 */
export function installGroupButtonGuard(bot: Bot): void {
  bot.api.config.use((prev, method, payload, signal) => {
    const patched = rewriteGroupWebAppButtons(payload, walletDeepLink());
    if (patched !== payload) {
      console.warn(`[telegram-button-guard] ${method}: web_app button aimed at a group was converted to a t.me deep link`);
    }
    return prev(method, patched, signal);
  });
  console.log('[telegram] group button guard active — web_app buttons cannot reach group messages');
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
  // they claimed. It is bilingual because a group message is the same for
  // every viewer, and it must be a plain t.me deep link — web_app buttons are
  // rejected by Telegram outside private chats (BUTTON_TYPE_INVALID).
  const keyboard = new InlineKeyboard().text('🧧 Claim red envelope · 领取红包', envelope.id);
  const deepLink = walletDeepLink();
  if (deepLink) keyboard.row().url('💰 Open My Wallet · 打开钱包', deepLink);
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
