import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { Bot, InlineKeyboard } from 'grammy';
import { installGroupButtonGuard, registerTelegramBot, rewriteGroupWebAppButtons } from '../services/telegramService';

const read = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

/**
 * Telegram rejects web_app (Mini App) buttons outside private chats with
 * BUTTON_TYPE_INVALID — and it rejects the ENTIRE message, so a group /start
 * reply or envelope post silently never arrives. These guards keep every
 * group-facing keyboard on t.me deep links.
 */
test('envelope messages posted to groups never use private-only web_app buttons', () => {
  const source = read('src/services/telegramService.ts');
  const body = source.slice(source.indexOf('export async function publishEnvelopeMessage'));
  assert.equal(body.includes('.webApp('), false, 'publishEnvelopeMessage must not attach a web_app button (groups reject it)');
  assert.equal(body.includes('.url('), true, 'publishEnvelopeMessage should use a t.me deep-link url button');
  assert.equal(body.includes('walletDeepLink()'), true);
});

test('chatAppKeyboard picks web_app for private chats and a deep link for groups', () => {
  const source = read('src/services/telegramService.ts');
  assert.match(source, /export function chatAppKeyboard/);
  assert.match(source, /chatType === 'group' \|\| chatType === 'supergroup'/);
  // The group branch must not fall through to the web_app keyboard.
  const groupBranch = source.slice(source.indexOf('export function chatAppKeyboard'));
  assert.match(groupBranch, /return deepLink \? new InlineKeyboard\(\)\.url\(label, deepLink\) : undefined;/);
});

test('the claim keyboard edit on a group envelope message uses a deep link, not web_app', () => {
  const source = read('src/bot/bot.ts');
  const claimHandler = source.slice(source.indexOf('bot.callbackQuery(/^[0-9a-f]{8}'));
  assert.equal(claimHandler.includes('.webApp('), false, 'the envelope edit happens on a group message; web_app would be rejected');
  assert.equal(claimHandler.includes('walletDeepLink()'), true);
  // Every command that can be typed inside a group must pick its keyboard by chat type.
  assert.match(source, /chatAppKeyboard\(texts\.(walletGroupButton|historyButton|walletDetailsButton), ctx\.chat(\?)?\.(type|type)\)/);
});

test('the bot installs the group button guard on every outgoing Telegram call', () => {
  const source = read('src/bot/bot.ts');
  assert.match(source, /installGroupButtonGuard\(bot\)/);
});

test('rewriteGroupWebAppButtons converts a web_app button aimed at a group into a t.me deep link', () => {
  const payload = {
    chat_id: -1003589890000,
    reply_markup: { inline_keyboard: [[{ text: '💰 Open My Wallet', web_app: { url: 'https://example.com' } }]] }
  };
  const patched = rewriteGroupWebAppButtons(payload, 'https://t.me/mybot?start=wallet');
  assert.notEqual(patched, payload);
  const button = (patched as typeof payload).reply_markup.inline_keyboard[0][0] as unknown as { text: string; url: string };
  assert.equal(button.text, '💰 Open My Wallet');
  assert.equal(button.url, 'https://t.me/mybot?start=wallet');
  assert.equal('web_app' in button, false);
});

test('rewriteGroupWebAppButtons drops the button when no deep link is available but keeps the message deliverable', () => {
  const payload = {
    chat_id: '-1001234567890',
    reply_markup: { inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://example.com' } }, { text: 'Claim', callback_data: 'x' }]] }
  };
  const patched = rewriteGroupWebAppButtons(payload, undefined);
  const row = (patched as typeof payload).reply_markup.inline_keyboard[0] as Array<Record<string, unknown>>;
  assert.equal(row.length, 1);
  assert.equal('callback_data' in row[0], true);
});

test('rewriteGroupWebAppButtons leaves private chats and web_app-free group messages untouched', () => {
  const privatePayload = { chat_id: 700000001, reply_markup: { inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://example.com' } }]] } };
  assert.equal(rewriteGroupWebAppButtons(privatePayload, 'https://t.me/x'), privatePayload);
  const plainGroupPayload = { chat_id: -1003589890000, reply_markup: { inline_keyboard: [[{ text: 'Claim', callback_data: 'x' }]] } };
  assert.equal(rewriteGroupWebAppButtons(plainGroupPayload, 'https://t.me/x'), plainGroupPayload);
  const noKeyboard = { chat_id: -1003589890000, text: 'hello' };
  assert.equal(rewriteGroupWebAppButtons(noKeyboard, 'https://t.me/x'), noKeyboard);
});

/**
 * End-to-end replay of the production incident: a web_app button aimed at the
 * envelope supergroup goes through a real grammY Bot instance. The API guard
 * must rewrite it to the t.me deep link before the request "leaves" the
 * process, so Telegram can never answer BUTTON_TYPE_INVALID again.
 */
test('end-to-end: a web_app button aimed at a group is rewritten on a real Bot API call', async () => {
  const bot = new Bot('1:test-token');
  bot.botInfo = {
    id: 1, is_bot: true, first_name: 'Test', username: 'testbot',
    can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false
  } as never;
  registerTelegramBot(bot);

  // Capture transformer stands in for the network: it records what would have
  // been sent to Telegram and returns a canned successful response.
  let captured: { method: string; payload: Record<string, any> } | undefined;
  bot.api.config.use((_prev, method, payload) => {
    captured = { method, payload: payload as Record<string, any> };
    return Promise.resolve({ ok: true, result: { message_id: 1, date: 0, chat: { id: -1003589890000, type: 'supergroup' }, text: 'x' } } as never);
  });

  installGroupButtonGuard(bot);

  // The exact mistake that caused the production error: a web_app button sent
  // to the group chat.
  await bot.api.sendMessage(-1003589890000, '🧧 Red Envelope Wallet', {
    reply_markup: new InlineKeyboard().webApp('💰 Open My Wallet · 打开钱包', 'https://example.com')
  });

  assert.ok(captured, 'the capture transformer must have run');
  assert.equal(captured!.method, 'sendMessage');
  const row = captured!.payload.reply_markup.inline_keyboard[0];
  assert.equal(row.length, 1);
  assert.equal('web_app' in row[0], false, 'web_app buttons must never reach a group message');
  assert.equal(row[0].url, 'https://t.me/testbot?start=wallet');

  // The same button to a private chat must pass through untouched.
  await bot.api.sendMessage(700000001, 'your wallet', {
    reply_markup: new InlineKeyboard().webApp('🧧 Open My Wallet', 'https://example.com')
  });
  const privateRow = captured!.payload.reply_markup.inline_keyboard[0];
  assert.equal('web_app' in privateRow[0], true, 'private chats keep native web_app buttons');
});
