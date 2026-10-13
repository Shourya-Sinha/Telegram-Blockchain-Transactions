import assert from 'node:assert/strict';
import test from 'node:test';
import { botTexts, normalizeLocale } from './texts';

test('bot translations expose the same keys in English and Chinese', () => {
  const en = Object.keys(botTexts('en')).sort();
  const zh = Object.keys(botTexts('zh')).sort();
  assert.deepEqual(zh, en);
});

test('Chinese bot texts are actually Chinese, not English fallbacks', () => {
  const zh = botTexts('zh');
  assert.notEqual(zh.startGroup, botTexts('en').startGroup);
  assert.match(zh.startGroup, /红包/);
  assert.match(zh.testCurrencyWarning, /测试/);
});

test('locale normalization only accepts en and zh', () => {
  assert.equal(normalizeLocale('zh'), 'zh');
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('fr'), 'en');
  assert.equal(normalizeLocale(undefined), 'en');
});
