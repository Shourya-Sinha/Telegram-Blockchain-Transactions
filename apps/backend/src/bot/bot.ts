import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { getLedger, getWalletSummary, ensureWalletForTelegram } from '../services/ledgerService';
import { claimEnvelope, getEnvelope } from '../services/envelopeService';
import { createAndPublishEnvelope } from '../services/envelopePublishingService';
import { registerTelegramGroup } from '../services/groupService';
import { assertTelegramGroupMembership, registerTelegramBot } from '../services/telegramService';
import { formatMinor } from '@red-envelope/shared';
import { AppError } from '../utils/errors';

function telegramIdentity(ctx: { from?: { id: number; username?: string; first_name: string } }) {
  if (!ctx.from) throw new AppError(401, 'Telegram user is missing', 'TELEGRAM_USER_MISSING');
  return { telegramId: BigInt(ctx.from.id), username: ctx.from.username, firstName: ctx.from.first_name };
}

async function recordGroupActivity(ctx: {
  from?: { id: number };
  chat?: { id: number | bigint; type: string; title?: string; username?: string };
}): Promise<void> {
  if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return;
  await registerTelegramGroup(ctx.chat);
  if (!ctx.from) return;
  const key = `group:messages:${ctx.chat.id.toString()}:${ctx.from.id}`;
  await redis.incr(key);
  await redis.expire(key, 60 * 60 * 24 * 30);
}

export function createTelegramBot(): Bot {
  if (!config.botToken) throw new Error('BOT_TOKEN is required to start the Telegram bot');
  const bot = new Bot(config.botToken);
  registerTelegramBot(bot);

  bot.use(async (ctx, next) => {
    try {
      await recordGroupActivity(ctx);
    } catch (error) {
      console.error('[telegram-group-activity]', error);
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    await ensureWalletForTelegram(telegramIdentity(ctx));
    const keyboard = new InlineKeyboard()
      .text('💰 Balance', 'menu:balance').text('📜 History', 'menu:history').row()
      .text('↓ Deposit', 'menu:deposit').webApp('↑ Withdraw', config.publicAppUrl).row()
      .webApp('🧧 Open Red Envelope Wallet', config.publicAppUrl).text('❓ Help', 'menu:help');
    await ctx.reply(
      `Welcome to Red Envelope Wallet 🧧\n\nYour account is secured by Telegram ID ${ctx.from?.id}. Your display name and @username are profile labels only and never identify financial ownership.`,
      { reply_markup: keyboard }
    );
  });

  bot.command('help', async (ctx) => ctx.reply([
    '/balance — view your wallet',
    '/deposit — get the TRC20 deposit address',
    '/withdraw — open a withdrawal request',
    '/history — recent ledger activity',
    '/myid — show your Telegram ID (used to configure a treasury wallet)',
    '/registergroup — register this group in the app',
    '/redpacket <amount> <count> — fund and post a random red envelope in a group'
  ].join('\n')));

  bot.command('myid', async (ctx) => {
    if (!ctx.from) return;
    await ctx.reply(`Your Telegram ID is: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' });
  });

  bot.command('registergroup', async (ctx) => {
    if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) {
      await ctx.reply('Run /registergroup inside the Telegram group where envelopes should be posted.');
      return;
    }
    const group = await registerTelegramGroup(ctx.chat);
    await ctx.reply(`✅ Group registered\n${group?.title ?? 'This group'}\nID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
  });

  bot.command('balance', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const wallet = await getWalletSummary(user.id);
    await ctx.reply(`💳 Available: ${formatMinor(wallet.availableMinor)} USDT\n🔒 Locked/pending withdrawal: ${formatMinor(wallet.lockedMinor)} USDT`);
  });

  bot.command('deposit', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    if (config.fundsMode !== 'real') {
      await ctx.reply('Test mode is active. Blockchain deposits are disabled; ask an administrator to add test USDT.');
      return;
    }
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { depositAddress: true } });
    await ctx.reply(
      account?.depositAddress
        ? `Send only USDT on TRC20 to your assigned address:\n<code>${account.depositAddress}</code>\n\nDeposits are credited after ${config.tron.confirmations} confirmations.`
        : 'Your unique deposit address has not been provisioned. Contact support.',
      { parse_mode: 'HTML' }
    );
  });

  bot.command('withdraw', async (ctx) => {
    if (!config.chainOperationsEnabled) {
      await ctx.reply('Test mode is active. Blockchain withdrawals are disabled. Test balance can only be used for test red envelopes.');
      return;
    }
    const keyboard = new InlineKeyboard().webApp('🧧 Open Wallet', config.publicAppUrl);
    await ctx.reply(
      'Open your wallet to submit a TRC20 withdrawal. Minimum and network fee are shown before confirmation.',
      { reply_markup: keyboard }
    );
  });

  bot.command('history', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const ledger = await getLedger(user.id, 10);
    if (!ledger.length) {
      await ctx.reply('No ledger activity yet.');
      return;
    }
    const lines = ledger.map((entry: { direction: string; amountMinor: bigint; type: string; createdAt: Date }) =>
      `${entry.direction === 'CREDIT' ? '+' : '-'}${formatMinor(entry.amountMinor)} USDT · ${entry.type} · ${entry.createdAt.toISOString().slice(0, 10)}`
    );
    await ctx.reply(lines.join('\n'));
  });

  bot.command('redpacket', async (ctx) => {
    if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) {
      await ctx.reply('Create red envelopes from a group chat.');
      return;
    }
    const [, amount, countRaw] = (ctx.msg?.text ?? '').trim().split(/\s+/);
    const count = Number(countRaw);
    if (!amount || !Number.isInteger(count) || count < 1 || count > 500) {
      await ctx.reply('Usage: /redpacket <amount in USDT> <number of claims>\nExample: /redpacket 10 5');
      return;
    }
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    try {
      await createAndPublishEnvelope(user.id, {
        total: amount,
        count,
        mode: 'RANDOM',
        groupId: ctx.chat.id.toString(),
        expiresInMinutes: 24 * 60
      });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Unable to create red envelope.');
    }
  });

  bot.callbackQuery('menu:balance', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const wallet = await getWalletSummary(user.id);
    await ctx.answerCallbackQuery();
    await ctx.reply(`💳 Available: ${formatMinor(wallet.availableMinor)} USDT\n🔒 Locked/pending withdrawal: ${formatMinor(wallet.lockedMinor)} USDT`);
  });
  bot.callbackQuery('menu:history', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const ledger = await getLedger(user.id, 10);
    await ctx.answerCallbackQuery();
    await ctx.reply(ledger.length ? ledger.map((entry: { direction: string; amountMinor: bigint; type: string; createdAt: Date }) => `${entry.direction === 'CREDIT' ? '+' : '-'}${formatMinor(entry.amountMinor)} USDT · ${entry.type} · ${entry.createdAt.toISOString().slice(0, 10)}`).join('\n') : 'No ledger activity yet.');
  });
  bot.callbackQuery('menu:deposit', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    await ctx.answerCallbackQuery();
    if (config.fundsMode !== 'real') {
      await ctx.reply('Test mode is active. Blockchain deposits and withdrawals are disabled; ask an administrator to add test USDT.');
      return;
    }
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { depositAddress: true } });
    await ctx.reply(account?.depositAddress ? `Send only USDT TRC20 to your assigned address:\n<code>${account.depositAddress}</code>\n\nCredit requires ${config.tron.confirmations} confirmations.` : 'Your unique deposit address has not been provisioned. Contact support.', { parse_mode: 'HTML' });
  });
  bot.callbackQuery('menu:help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('Use Balance and History to inspect your internal USDT ledger. Open Wallet to create envelopes or request a withdrawal. Never share a seed phrase or private key—the bot will never ask for one.');
  });

  bot.callbackQuery(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i, async (ctx) => {
    const envelopeId = ctx.callbackQuery.data;
    try {
      const user = await ensureWalletForTelegram(telegramIdentity(ctx));
      const envelope = await getEnvelope(envelopeId);
      await assertTelegramGroupMembership(envelope.groupId, user.telegramId);
      const result = await claimEnvelope(user.id, envelopeId);
      await ctx.answerCallbackQuery({
        text: `You claimed ${formatMinor(result.claim.amountMinor)} USDT! New available balance: ${formatMinor(result.availableMinor)} USDT.`,
        show_alert: true
      });
      const latestEnvelope = await getEnvelope(envelopeId);
      if (latestEnvelope.remainingSlots <= 0) {
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
      } else {
        const keyboard = new InlineKeyboard().text(`🧧 Claim red envelope · ${latestEnvelope.remainingSlots} left`, latestEnvelope.id);
        await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => undefined);
      }
    } catch (error) {
      await ctx.answerCallbackQuery({
        text: error instanceof Error ? error.message.slice(0, 190) : 'Unable to claim',
        show_alert: true
      });
    }
  });

  bot.catch(async (botError) => {
    console.error('[telegram-bot]', botError.error);
    if (!(botError.error instanceof AppError)) return;
    try {
      if (botError.ctx.callbackQuery) {
        await botError.ctx.answerCallbackQuery({ text: botError.error.message.slice(0, 190), show_alert: true });
      } else {
        await botError.ctx.reply(botError.error.message);
      }
    } catch (replyError) {
      console.error('[telegram-bot-error-reply]', replyError);
    }
  });
  return bot;
}
