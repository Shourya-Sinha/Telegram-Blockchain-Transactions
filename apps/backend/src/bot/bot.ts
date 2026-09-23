import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config';
import { redis } from '../lib/redis';
import { getLedger, getWalletSummary, ensureWalletForTelegram } from '../services/ledgerService';
import { createEnvelope, claimEnvelope } from '../services/envelopeService';
import { formatMinor, parseUsdtToMinor } from '@red-envelope/shared';
import { AppError } from '../utils/errors';

function telegramIdentity(ctx: { from?: { id: number; username?: string; first_name: string } }) {
  if (!ctx.from) throw new AppError(401, 'Telegram user is missing', 'TELEGRAM_USER_MISSING');
  return { telegramId: BigInt(ctx.from.id), username: ctx.from.username, firstName: ctx.from.first_name };
}

async function incrementGroupMessages(ctx: { from?: { id: number }; chat?: { id: number | bigint; type: string } }): Promise<void> {
  if (!ctx.from || !ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return;
  const key = `group:messages:${ctx.chat.id.toString()}:${ctx.from.id}`;
  await redis.incr(key);
  await redis.expire(key, 60 * 60 * 24 * 30);
}

export function createTelegramBot(): Bot {
  if (!config.botToken) throw new Error('BOT_TOKEN is required to start the Telegram bot');
  const bot = new Bot(config.botToken);
  bot.use(async (ctx, next) => {
    try { await incrementGroupMessages(ctx); } catch (error) { console.error('[telegram-message-counter]', error); }
    await next();
  });

  bot.command('start', async (ctx) => {
    await ensureWalletForTelegram(telegramIdentity(ctx));
    await ctx.reply('Welcome to Red Envelope Wallet 🧧\nYour funds are held securely in a custodial ledger. Use /balance to get started.', { parse_mode: 'HTML' });
  });
  bot.command('help', async (ctx) => ctx.reply(['/balance — view your wallet', '/deposit — get the TRC20 deposit address', '/withdraw — open a withdrawal request', '/history — recent ledger activity', '/redpacket <amount> <count> — create a red envelope in a group'].join('\n')));
  bot.command('balance', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const wallet = await getWalletSummary(user.id);
    await ctx.reply(`💳 Available: ${formatMinor(wallet.availableMinor)} USDT\n🔒 Locked: ${formatMinor(wallet.lockedMinor)} USDT`);
  });
  bot.command('deposit', async (ctx) => {
    await ensureWalletForTelegram(telegramIdentity(ctx));
    await ctx.reply(`Send USDT on TRC20 to:\n<code>${config.tron.hotWalletAddress || 'Deposit address is being provisioned'}</code>\n\nDeposits are credited after ${config.tron.confirmations} confirmations. Always verify the network.`, { parse_mode: 'HTML' });
  });
  bot.command('withdraw', async (ctx) => {
    const keyboard = new InlineKeyboard().url('Open Wallet', config.publicAppUrl);
    await ctx.reply('Open your wallet to submit a TRC20 withdrawal. Minimum and network fee are shown before confirmation.', { reply_markup: keyboard });
  });
  bot.command('history', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const ledger = await getLedger(user.id, 10);
    if (!ledger.length) { await ctx.reply('No ledger activity yet.'); return; }
    const lines = ledger.map((entry: { direction: string; amountMinor: bigint; type: string; createdAt: Date }) => `${entry.direction === 'CREDIT' ? '+' : '-'}${formatMinor(entry.amountMinor)} USDT · ${entry.type} · ${entry.createdAt.toISOString().slice(0, 10)}`);
    await ctx.reply(lines.join('\n'));
  });
  bot.command('redpacket', async (ctx) => {
    if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) { await ctx.reply('Create red envelopes from a group chat.'); return; }
    const [, amount, countRaw] = (ctx.msg?.text ?? '').trim().split(/\s+/);
    const count = Number(countRaw);
    if (!amount || !Number.isInteger(count) || count < 1 || count > 500) { await ctx.reply('Usage: /redpacket <amount in USDT> <number of slots>'); return; }
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    try {
      const envelope = await createEnvelope(user.id, { total: amount, count, mode: 'RANDOM', groupId: ctx.chat.id.toString(), expiresInMinutes: 24 * 60, messageId: ctx.msg?.message_id });
      const keyboard = new InlineKeyboard().text('🧧 Claim Red Envelope', envelope.envelope.id);
      await ctx.reply(`🧧 Red Envelope\nTotal: ${formatMinor(envelope.envelope.totalMinor)} USDT\nSlots: ${count}\nTap to claim — each person can claim once.`, { reply_markup: keyboard });
    } catch (error) { await ctx.reply(error instanceof Error ? error.message : 'Unable to create red envelope.'); }
  });
  bot.callbackQuery(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i, async (ctx) => {
    const envelopeId = ctx.callbackQuery.data;
    try {
      const user = await ensureWalletForTelegram(telegramIdentity(ctx));
      const result = await claimEnvelope(user.id, envelopeId);
      if (result.kind === 'claimed') await ctx.answerCallbackQuery(`You claimed ${formatMinor(result.claim.amountMinor)} USDT!`);
      else await ctx.answerCallbackQuery('This envelope is no longer available.');
    } catch (error) {
      await ctx.answerCallbackQuery(error instanceof Error ? error.message.slice(0, 190) : 'Unable to claim');
    }
  });
  bot.catch((error) => console.error('[telegram-bot]', error.error));
  return bot;
}
