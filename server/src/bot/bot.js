const { Telegraf } = require('telegraf');
const env = require('../config/env');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { setBot } = require('../services/telegram');
const { createTransfer, faucetClaim } = require('../services/txService');

function startBot() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log('[bot] TELEGRAM_BOT_TOKEN not set — bot disabled (link codes still work once set)');
    return null;
  }
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  setBot(bot);

  bot.start(async (ctx) => {
    const payload = ctx.message.text.split(' ')[1] || '';
    if (payload.startsWith('link_')) {
      const code = payload.replace('link_', '').toUpperCase();
      const user = await User.findOne({ linkCode: code });
      if (!user || !user.linkCodeExpires || user.linkCodeExpires < new Date()) {
        return ctx.reply('❌ Invalid or expired link code. Generate a new one from the web dashboard → Profile → Link Telegram.');
      }
      user.telegramId = String(ctx.from.id);
      user.telegramUsername = ctx.from.username || null;
      user.linkCode = null;
      user.linkCodeExpires = null;
      await user.save();
      return ctx.reply(`✅ Telegram linked to ${user.email}!\n\nCommands:\n/balance — wallet balances\n/address — your addresses\n/history — recent transactions\n/send <0x…> <amount> — quick send\n/faucet — claim test tokens\n/help — all commands`);
    }
    return ctx.reply(
      `👋 Welcome to ${env.TOKEN_NAME}!\n\n1) Create an account on the web app\n2) Profile → Link Telegram (get a code)\n3) Tap the deep link or /link <CODE>\n\nThen use /balance, /send, /history right here.`
    );
  });

  bot.command('link', async (ctx) => {
    const code = (ctx.message.text.split(' ')[1] || '').toUpperCase();
    if (!code) return ctx.reply('Usage: /link <CODE> — get the code from web dashboard → Profile.');
    const user = await User.findOne({ linkCode: code });
    if (!user || !user.linkCodeExpires || user.linkCodeExpires < new Date()) return ctx.reply('❌ Invalid or expired code.');
    user.telegramId = String(ctx.from.id);
    user.telegramUsername = ctx.from.username || null;
    user.linkCode = null;
    user.linkCodeExpires = null;
    await user.save();
    ctx.reply(`✅ Linked to ${user.email}!`);
  });

  async function linkedUser(ctx) {
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user) {
      await ctx.reply('🔗 Link your account first: web dashboard → Profile → Link Telegram, then /link <CODE>.');
      return null;
    }
    if (user.status !== 'active') {
      await ctx.reply(`⛔ Account is ${user.status}. Contact support.`);
      return null;
    }
    return user;
  }

  bot.command('balance', async (ctx) => {
    const user = await linkedUser(ctx);
    if (!user) return;
    const wallets = await Wallet.find({ user: user._id });
    if (!wallets.length) return ctx.reply('No wallets yet — create one in the web app.');
    const lines = wallets.map((w, i) => `${i + 1}. <code>${w.address}</code>\n   💰 ${w.balance} ${env.TOKEN_SYMBOL} (avail ${(w.balance - w.lockedBalance).toFixed(4)})`);
    ctx.replyWithHTML(`💼 <b>Balances</b>\n\n${lines.join('\n\n')}`);
  });

  bot.command('address', async (ctx) => {
    const user = await linkedUser(ctx);
    if (!user) return;
    const w = await Wallet.findOne({ user: user._id }).sort({ createdAt: 1 });
    if (!w) return ctx.reply('No wallet yet.');
    ctx.replyWithHTML(`📥 <b>Deposit address</b>\n<code>${w.address}</code>\n\nShare this to receive ${env.TOKEN_SYMBOL}.`);
  });

  bot.command('history', async (ctx) => {
    const user = await linkedUser(ctx);
    if (!user) return;
    const txs = await Transaction.find({ $or: [{ fromUser: user._id }, { toUser: user._id }] }).sort({ createdAt: -1 }).limit(5).lean();
    if (!txs.length) return ctx.reply('No transactions yet. Use /faucet to get test tokens!');
    const lines = txs.map((t) => `${t.status === 'confirmed' ? '✅' : '⏳'} ${t.type} ${t.amount} ${env.TOKEN_SYMBOL} → <code>${t.toAddress.slice(0, 10)}…</code> (${t.status})`);
    ctx.replyWithHTML(`🧾 <b>Recent transactions</b>\n\n${lines.join('\n')}`);
  });

  bot.command('faucet', async (ctx) => {
    const user = await linkedUser(ctx);
    if (!user) return;
    try {
      const tx = await faucetClaim(user);
      ctx.replyWithHTML(`🚰 <b>Faucet claimed!</b>\n+${tx.amount} ${env.TOKEN_SYMBOL} incoming.\nTx: <code>${tx.hash.slice(0, 20)}…</code>\nIt will confirm in the next block (~10s).`);
    } catch (e) {
      ctx.reply(`❌ ${e.message}`);
    }
  });

  bot.command('send', async (ctx) => {
    const user = await linkedUser(ctx);
    if (!user) return;
    const [, to, amt] = ctx.message.text.split(' ');
    if (!to || !amt || !/^0x[0-9a-fA-F]{40}$/.test(to) || !Number.isFinite(Number(amt))) {
      return ctx.reply('Usage: /send <0x…address> <amount>\nExample: /send 0x1234…abcd 10');
    }
    try {
      const { tx, needsApproval } = await createTransfer(user, { toAddress: to, amount: Number(amt) });
      ctx.replyWithHTML(`📤 <b>Sent to mempool</b>\n${tx.amount} ${env.TOKEN_SYMBOL} → <code>${to.slice(0, 12)}…</code>\nFee: ${tx.fee}\nTx: <code>${tx.hash.slice(0, 20)}…</code>\n${needsApproval ? '⚠️ Large tx — awaiting admin approval.' : 'Fair queue: confirms in an upcoming block.'}`);
    } catch (e) {
      ctx.reply(`❌ ${e.message}`);
    }
  });

  bot.command('help', (ctx) => {
    ctx.reply('/start — welcome\n/link <CODE> — link account\n/balance — balances\n/address — deposit address\n/history — recent txs\n/send <addr> <amt> — send\n/faucet — test tokens\n/unlink — unlink Telegram\n/help — this list');
  });

  bot.command('unlink', async (ctx) => {
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user) return ctx.reply('Nothing to unlink.');
    user.telegramId = null;
    user.telegramUsername = null;
    await user.save();
    ctx.reply('🔓 Telegram unlinked.');
  });

  bot.launch().then(() => console.log('[bot] Telegram bot running'));
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  return bot;
}

module.exports = { startBot };
