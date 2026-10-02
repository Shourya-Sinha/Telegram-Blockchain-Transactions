import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { getLedger, getWalletSummary, ensureWalletForTelegram } from '../services/ledgerService';
import { claimEnvelope, getEnvelope } from '../services/envelopeService';
import { createAndPublishEnvelope } from '../services/envelopePublishingService';
import { registerTelegramGroup } from '../services/groupService';
import { assertTelegramGroupMembership, chatAppKeyboard, isTelegramWebAppUrl, miniAppKeyboard, registerTelegramBot, walletDeepLink } from '../services/telegramService';
import { formatMinor, resolveWithdrawalMode } from '@red-envelope/shared';
import { AppError } from '../utils/errors';
import { botTexts, normalizeLocale } from './texts';

function telegramIdentity(ctx: { from?: { id: number; username?: string; first_name: string } }) {
  if (!ctx.from) throw new AppError(401, 'Telegram user is missing', 'TELEGRAM_USER_MISSING');
  return { telegramId: BigInt(ctx.from.id), username: ctx.from.username, firstName: ctx.from.first_name };
}

/** Preferred language of an existing user (flag selector in the Mini App). */
async function userLocale(userId: string): Promise<'en' | 'zh'> {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
  return normalizeLocale(account?.locale);
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
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const locale = normalizeLocale(user.locale);
    const texts = botTexts(locale);
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    // Groups never accept web_app buttons (Telegram answers BUTTON_TYPE_INVALID
    // and drops the whole message), so the group reply uses a t.me deep link
    // that opens the bot's private chat, where the wallet buttons live.
    if (ctx.chat && ['group', 'supergroup'].includes(ctx.chat.type)) {
      await ctx.reply(texts.startGroup, { reply_markup: chatAppKeyboard(texts.walletGroupButton, ctx.chat.type) });
      return;
    }
    // Arrived through the "Open My Wallet" deep link from a group message.
    if (payload === 'wallet') {
      const wallet = await getWalletSummary(user.id);
      const testNote = config.fundsMode === 'test' ? `\n\n⚠️ ${texts.testCurrencyWarning}` : '';
      await ctx.reply(
        [texts.walletDetails(formatMinor(wallet.availableMinor), formatMinor(wallet.lockedMinor)), '', texts.walletOpenApp].join('\n') + testNote,
        { reply_markup: miniAppKeyboard(texts.walletDetailsButton) }
      );
      return;
    }
    const keyboard = new InlineKeyboard()
      .text('💰 Balance', 'menu:balance').text('📜 History', 'menu:history').row()
      .text('↓ Deposit', 'menu:deposit').text('↑ Withdraw', 'menu:withdraw').row();
    if (isTelegramWebAppUrl(config.publicAppUrl)) {
      keyboard.webApp(texts.walletButton, config.publicAppUrl).row();
    }
    keyboard.text('❓ Help', 'menu:help');
    await ctx.reply(texts.startWelcome(ctx.from?.id), { reply_markup: keyboard });
  });

  bot.command('help', async (ctx) => ctx.reply([
    '/wallet — open the Mini App wallet (balance, history, withdrawals); works inside groups too',
    '/balance — view your wallet',
    '/deposit — get the TRC20 deposit address',
    '/withdraw — open a withdrawal request',
    '/history — recent ledger activity',
    '/lang en|zh — switch the bot language (English / 中文)',
    '/myid — show your Telegram ID (used to configure a treasury wallet)',
    '/registergroup — register this group in the app',
    '/redpacket <amount> <count> — fund and post a random red envelope in a group'
  ].join('\n')));

  bot.command('lang', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const [, requested] = (ctx.msg?.text ?? '').trim().split(/\s+/);
    if (requested !== 'en' && requested !== 'zh') {
      await ctx.reply(`Current language: ${user.locale === 'zh' ? '中文 🇨🇳' : 'English 🇬🇧'}\n\nUse /lang en for English or /lang zh for 中文. The same choice is available with the flag selector inside the Mini App.`);
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { locale: requested } });
    const texts = botTexts(requested);
    await ctx.reply(
      requested === 'zh'
        ? `✅ 语言已切换为中文 🇨🇳\n\n${texts.walletOpenApp}`
        : `✅ Language switched to English 🇬🇧\n\n${texts.walletOpenApp}`,
      { reply_markup: chatAppKeyboard(texts.walletDetailsButton, ctx.chat?.type) }
    );
  });

  bot.command('wallet', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const wallet = await getWalletSummary(user.id);
    const locale = normalizeLocale(user.locale);
    const texts = botTexts(locale);

    // In a group, never post balance details publicly. The reply carries only
    // a wallet launcher (a t.me deep link in groups — web_app buttons are
    // private-chat only); the details go to the user's private chat. This is
    // how a member opens their wallet right after claiming an envelope.
    if (ctx.chat && ['group', 'supergroup'].includes(ctx.chat.type)) {
      await ctx.reply(texts.groupWalletPrompt, { reply_markup: chatAppKeyboard(texts.walletGroupButton, ctx.chat.type) });
      try {
        const testNote = config.fundsMode === 'test' ? `\n\n⚠️ ${texts.testCurrencyWarning}` : '';
        await ctx.api.sendMessage(
          user.telegramId.toString(),
          [texts.walletDetails(formatMinor(wallet.availableMinor), formatMinor(wallet.lockedMinor)), '', texts.walletOpenApp].join('\n') + testNote,
          { reply_markup: miniAppKeyboard(texts.walletDetailsButton) }
        );
      } catch (dmError) {
        console.warn('[telegram-wallet-dm] could not message user (they may not have started the bot)', dmError);
      }
      return;
    }

    const testNote = config.fundsMode === 'test' ? `\n\n⚠️ ${texts.testCurrencyWarning}` : '';
    await ctx.reply(
      [texts.walletDetails(formatMinor(wallet.availableMinor), formatMinor(wallet.lockedMinor)), '', texts.walletOpenApp].join('\n') + testNote,
      { reply_markup: miniAppKeyboard(texts.walletDetailsButton) }
    );
  });

  bot.command('myid', async (ctx) => {
    if (!ctx.from) return;
    await ctx.reply(`Your Telegram ID is: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' });
  });

  bot.command('registergroup', async (ctx) => {
    if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) {
      await ctx.reply('Run /registergroup inside the Telegram group where envelopes should be posted.');
      return;
    }
    // const group = await registerTelegramGroup(ctx.chat);
    // await ctx.reply(`✅ Group registered\n${group?.title ?? 'This group'}\nID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
    await registerTelegramGroup(ctx.chat);

    await ctx.reply(
      `✅ Group registered\n${ctx.chat.title ?? 'This group'}\nID: <code>${ctx.chat.id}</code>`,
      { parse_mode: 'HTML' }
    );
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
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const texts = botTexts(normalizeLocale(user.locale));
    const mode = resolveWithdrawalMode({ fundsMode: config.fundsMode, testWithdrawalAddress: config.withdrawal.testWithdrawalAddress });
    if (mode === 'disabled') {
      await ctx.reply(texts.withdrawDisabled);
      return;
    }
    const keyboard = chatAppKeyboard(texts.walletDetailsButton, ctx.chat?.type);
    if (mode === 'test') {
      await ctx.reply(
        [
          texts.withdrawTest(config.withdrawal.testWithdrawalAddress ?? '', (config.withdrawal.minMinor / 1_000_000n).toString(), (config.withdrawal.feeMinor / 1_000_000n).toString()),
          '',
          `⚠️ ${texts.testCurrencyWarning}`
        ].join('\n'),
        { reply_markup: keyboard }
      );
      return;
    }
    await ctx.reply(texts.withdrawReal, { reply_markup: keyboard });
  });

  bot.command('history', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const ledger = await getLedger(user.id, 10);
    const texts = botTexts(normalizeLocale(user.locale));
    const keyboard = chatAppKeyboard(texts.historyButton, ctx.chat?.type);
    if (!ledger.length) {
      await ctx.reply(texts.historyEmpty, { reply_markup: keyboard });
      return;
    }
    const lines = ledger.map((entry: { direction: string; amountMinor: bigint; type: string; createdAt: Date }) =>
      `${entry.direction === 'CREDIT' ? '+' : '-'}${formatMinor(entry.amountMinor)} USDT · ${entry.type} · ${entry.createdAt.toISOString().slice(0, 10)}`
    );
    await ctx.reply([lines.join('\n'), '', texts.historyFooter].join('\n'), { reply_markup: keyboard });
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
    const texts = botTexts(normalizeLocale(user.locale));
    await ctx.answerCallbackQuery();
    await ctx.reply(texts.walletDetails(formatMinor(wallet.availableMinor), formatMinor(wallet.lockedMinor)));
  });
  bot.callbackQuery('menu:history', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const ledger = await getLedger(user.id, 10);
    const texts = botTexts(normalizeLocale(user.locale));
    await ctx.answerCallbackQuery();
    await ctx.reply(ledger.length ? ledger.map((entry: { direction: string; amountMinor: bigint; type: string; createdAt: Date }) => `${entry.direction === 'CREDIT' ? '+' : '-'}${formatMinor(entry.amountMinor)} USDT · ${entry.type} · ${entry.createdAt.toISOString().slice(0, 10)}`).join('\n') : texts.historyEmpty);
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
  bot.callbackQuery('menu:withdraw', async (ctx) => {
    const user = await ensureWalletForTelegram(telegramIdentity(ctx));
    const texts = botTexts(normalizeLocale(user.locale));
    await ctx.answerCallbackQuery();
    const mode = resolveWithdrawalMode({ fundsMode: config.fundsMode, testWithdrawalAddress: config.withdrawal.testWithdrawalAddress });
    if (mode === 'disabled') {
      await ctx.reply(texts.withdrawDisabledShort);
      return;
    }
    if (mode === 'test') {
      await ctx.reply(
        `${texts.withdrawTestShort(config.withdrawal.testWithdrawalAddress ?? '')}\n\n⚠️ ${texts.testCurrencyWarning}`,
        { reply_markup: chatAppKeyboard(texts.walletDetailsButton, ctx.chat?.type) }
      );
      return;
    }
    await ctx.reply(texts.withdrawReal, { reply_markup: chatAppKeyboard(texts.walletDetailsButton, ctx.chat?.type) });
  });

  bot.callbackQuery(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i, async (ctx) => {
    const envelopeId = ctx.callbackQuery.data;
    try {
      const user = await ensureWalletForTelegram(telegramIdentity(ctx));
      const envelope = await getEnvelope(envelopeId);
      await assertTelegramGroupMembership(envelope.groupId, user.telegramId);
      const result = await claimEnvelope(user.id, envelopeId);
      const locale = await userLocale(user.id);
      const texts = botTexts(locale);
      await ctx.answerCallbackQuery({
        text: texts.claimAlert(formatMinor(result.claim.amountMinor), formatMinor(result.availableMinor)),
        show_alert: true
      });
      // After a claim the user immediately wants their wallet details. Send
      // them privately (never in the group) with a button straight into the
      // Mini App, in the language picked with the Mini App flag selector.
      // Users who never started the bot cannot be messaged; the callback
      // alert above still shows the balance in that case.
      try {
        const wallet = await getWalletSummary(user.id);
        const keyboard = miniAppKeyboard(texts.walletDetailsButton);
        const currencyNote = config.fundsMode === 'test' ? `\n\n⚠️ ${texts.testCurrencyWarning}` : '';
        await ctx.api.sendMessage(
          user.telegramId.toString(),
          [
            texts.claimDmHeader,
            '',
            texts.claimDmClaimed(formatMinor(result.claim.amountMinor)),
            texts.claimDmAvailable(formatMinor(wallet.availableMinor)),
            texts.claimDmLocked(formatMinor(wallet.lockedMinor)),
            '',
            texts.claimDmOpenApp
          ].join('\n') + currencyNote,
          { parse_mode: 'HTML', reply_markup: keyboard }
        );
      } catch (dmError) {
        console.warn('[telegram-claim-dm] could not message user (they may not have started the bot)', dmError);
      }
      const latestEnvelope = await getEnvelope(envelopeId);
      if (latestEnvelope.remainingSlots <= 0) {
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
      } else {
        const keyboard = new InlineKeyboard().text(`🧧 Claim red envelope · ${latestEnvelope.remainingSlots} left`, latestEnvelope.id);
        // The envelope message is in a group: web_app buttons are private-chat
        // only, so attach a t.me deep link instead.
        const deepLink = walletDeepLink();
        if (deepLink) keyboard.row().url(texts.groupWalletButton, deepLink);
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
