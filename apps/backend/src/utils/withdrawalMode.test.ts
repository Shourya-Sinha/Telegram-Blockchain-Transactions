import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedTestWithdrawalAddress, resolveWithdrawalMode, TEST_CURRENCY_WARNING, TRON_ADDRESS_REGEX } from '@red-envelope/shared';

const TEST_ADDRESS = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';

test('withdrawal mode is disabled in test funds mode without a required test address', () => {
  // This is exactly why the Mini App's Withdraw button is grey: FUNDS_MODE=test
  // and TEST_WITHDRAWAL_ADDRESS is empty.
  assert.equal(resolveWithdrawalMode({ fundsMode: 'test', testWithdrawalAddress: undefined }), 'disabled');
  assert.equal(resolveWithdrawalMode({ fundsMode: 'test', testWithdrawalAddress: '' }), 'disabled');
});

test('withdrawal mode is test in test funds mode once a required test address is configured', () => {
  assert.equal(resolveWithdrawalMode({ fundsMode: 'test', testWithdrawalAddress: TEST_ADDRESS }), 'test');
});

test('withdrawal mode is real whenever funds mode is real', () => {
  assert.equal(resolveWithdrawalMode({ fundsMode: 'real', testWithdrawalAddress: undefined }), 'real');
});

test('test withdrawals accept only the single required test address', () => {
  assert.equal(isAllowedTestWithdrawalAddress(TEST_ADDRESS, TEST_ADDRESS), true);
  assert.equal(isAllowedTestWithdrawalAddress('TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi', TEST_ADDRESS), false);
  // A test address must be configured at all.
  assert.equal(isAllowedTestWithdrawalAddress(TEST_ADDRESS, undefined), false);
});

test('the test currency warning is explicit that no real USDT moves', () => {
  assert.match(TEST_CURRENCY_WARNING, /test currency only/i);
  assert.match(TEST_CURRENCY_WARNING, /no real USDT/i);
});

test('TRON address regex accepts base58 TRC20 addresses and rejects other chains', () => {
  assert.equal(TRON_ADDRESS_REGEX.test(TEST_ADDRESS), true);
  assert.equal(TRON_ADDRESS_REGEX.test('0x281055afc982d96fab65b3a49cac8b878184cb16'), false);
  assert.equal(TRON_ADDRESS_REGEX.test('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), false);
  assert.equal(TRON_ADDRESS_REGEX.test('T'), false);
});
