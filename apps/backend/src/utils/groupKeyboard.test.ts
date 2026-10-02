import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

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
