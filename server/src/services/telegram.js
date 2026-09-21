const env = require('../config/env');

let botInstance = null;

function setBot(bot) {
  botInstance = bot;
}

async function sendTelegramMessage(telegramId, text) {
  if (!botInstance || !telegramId) return false;
  try {
    await botInstance.telegram.sendMessage(telegramId, text, { parse_mode: 'HTML' });
    return true;
  } catch (e) {
    console.warn('[telegram] send failed:', e.message);
    return false;
  }
}

async function notifyUser(user, title, message, txHash = null) {
  try {
    const Notification = require('../models/Notification');
    await Notification.create({ user: user._id, title, message, type: 'tx', txHash });
  } catch (e) {
    console.warn('[notify] db failed:', e.message);
  }
  if (user.telegramId) {
    const sym = env.TOKEN_SYMBOL;
    await sendTelegramMessage(
      user.telegramId,
      `🔔 <b>${escapeHtml(title)}</b>\n${escapeHtml(message)}\n${txHash ? `<code>${txHash.slice(0, 18)}…</code>` : ''}\n<i>${sym} Chain</i>`
    );
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { setBot, sendTelegramMessage, notifyUser };
