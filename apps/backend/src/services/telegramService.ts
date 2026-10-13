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

function appUrlWithParams(params?: Record<string, string>): string {
  try {
    const url = new URL(config.publicAppUrl);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return config.publicAppUrl;
  }
}

export function walletAppUrl(): string {
  return appUrlWithParams();
}

export function historyAppUrl(): string {
  return appUrlWithParams({ view: 'history' });
}

export function envelopeAppUrl(envelopeId: string): string {
  return appUrlWithParams({ envelope: envelopeId });
}

/** Keyboard with a single "open the Mini App" button, or undefined when the URL is not usable. */
export function miniAppKeyboard(label: string, appUrl = walletAppUrl()): InlineKeyboard | undefined {
  return isTelegramWebAppUrl(appUrl) ? new InlineKeyboard().webApp(label, appUrl) : undefined;
}

export function getBotUsername(): string | undefined {
  return activeBot?.botInfo?.username;
}

const START_PAYLOAD_MAX_LENGTH = 512;

export function envelopeStartPayload(envelopeId: string): string {
  return `envelope_${envelopeId}`;
}

export function envelopeIdFromStartPayload(payload: string | undefined): string | undefined {
  const match = (payload ?? '').trim().match(/^envelope[_-]([0-9a-f]{8}-[0-9a-f-]{27,})$/i);
  return match?.[1];
}

export function miniAppStartLink(startPayload?: string): string | undefined {
  const username = getBotUsername();
  const shortName = config.telegramMiniAppShortName;
  if (!username || !shortName) return undefined;
  if (startPayload && startPayload.length > START_PAYLOAD_MAX_LENGTH) return undefined;
  const suffix = startPayload ? `?startapp=${encodeURIComponent(startPayload)}` : '';
  return `https://t.me/${username}/${shortName}${suffix}`;
}

/**
 * t.me deep link that opens the bot's private chat and runs /start with an
 * optional payload. Group messages cannot carry native web_app buttons, so
 * this fallback opens the private chat where the bot can show a web_app button.
 */
export function botStartDeepLink(payload = 'wallet'): string | undefined {
  const username = getBotUsername();
  return username ? `https://t.me/${username}?start=${encodeURIComponent(payload)}` : undefined;
}

export function walletDeepLink(): string | undefined {
  return miniAppStartLink('wallet') ?? botStartDeepLink('wallet');
}

export function historyDeepLink(): string | undefined {
  return miniAppStartLink('history') ?? botStartDeepLink('history');
}

export function envelopeDeepLink(envelopeId: string): string | undefined {
  const payload = envelopeStartPayload(envelopeId);
  return miniAppStartLink(payload) ?? botStartDeepLink(payload);
}

/**
 * Native web_app (Mini App) buttons only exist in private chats — sending one
 * to a group or supergroup makes Telegram reject the whole message with
 * BUTTON_TYPE_INVALID. Pick the button type by chat: web_app in private chats,
 * t.me deep link everywhere else.
 */
export function chatAppKeyboard(label: string, chatType?: string, appUrl = walletAppUrl(), groupDeepLink = walletDeepLink()): InlineKeyboard | undefined {
  if (chatType === 'group' || chatType === 'supergroup') {
    return groupDeepLink ? new InlineKeyboard().url(label, groupDeepLink) : undefined;
  }
  return miniAppKeyboard(label, appUrl);
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
  sender?: { firstName?: string | null } | null;
};

type EnvelopeKeyboardState = {
  id: string;
  groupId: bigint;
  messageId: number;
  remainingSlots: number;
  status: string;
};

function envelopeGroupKeyboard(envelopeId: string, remainingSlots?: number, status = 'ACTIVE'): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const canClaim = status === 'ACTIVE' && (remainingSlots === undefined || remainingSlots > 0);
  const claimLink = envelopeDeepLink(envelopeId);
  if (canClaim) {
    const label = remainingSlots === undefined
      ? '🧧 Claim red envelope · 拆红包'
      : `🧧 Claim red envelope · ${remainingSlots} left`;
    if (claimLink) keyboard.url(label, claimLink);
    else keyboard.text(label, envelopeId);
  }
  const walletLink = walletDeepLink();
  if (walletLink) keyboard.row().url('💰 Open My Wallet · 打开钱包', walletLink);
  return keyboard;
}

export async function refreshEnvelopeMessageKeyboard(envelope: EnvelopeKeyboardState): Promise<void> {
  if (!envelope.messageId) return;
  try {
    await getTelegramBot().api.editMessageReplyMarkup(envelope.groupId.toString(), envelope.messageId, {
      reply_markup: envelopeGroupKeyboard(envelope.id, envelope.remainingSlots, envelope.status)
    });
  } catch (error) {
    console.warn('[telegram-envelope-keyboard] could not update envelope message', error);
  }
}

export async function publishEnvelopeMessage(envelope: PublishableEnvelope): Promise<number> {
  // The first button now opens the Mini App envelope screen instead of claiming
  // inside a Telegram callback. Groups still cannot use web_app buttons, so it
  // is a t.me deep link (direct startapp when TELEGRAM_MINI_APP_SHORT_NAME is
  // configured; otherwise /start sends the private web_app button).
  const keyboard = envelopeGroupKeyboard(envelope.id);
  const mode = envelope.mode === 'EQUAL' ? 'even split · 平均' : 'lucky draw · 拼手气';
  const senderName = envelope.sender?.firstName?.trim();
  // WeChat-style announcement: "{name}'s red envelope" plus the classic
  // blessing, so the arriving message reads like a red envelope, not a report.
  const title = senderName
    ? `🧧 ${senderName}'s red envelope · ${senderName} 的红包`
    : '🧧 Red envelope · 红包';
  const message = await getTelegramBot().api.sendMessage(
    envelope.groupId.toString(),
    [
      title,
      '恭喜发财，大吉大利 🎊',
      '',
      `Total · 总额: ${formatMinor(envelope.totalMinor)} USDT`,
      `Claims · 份数: ${envelope.totalSlots} · ${mode}`,
      `Expires · 过期: ${envelope.expiresAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`,
      '',
      'Tap below to open it. Each Telegram account can claim once. · 点击下方按钮领取，每个账号限领一次。'
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
