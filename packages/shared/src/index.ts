import { z } from 'zod';

export const USDT_DECIMALS = 6;
export const USDT_MINOR_PER_UNIT = 1_000_000n;

export function parseUsdtToMinor(value: string | number): bigint {
  const raw = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw new Error('Invalid USDT amount');
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * USDT_MINOR_PER_UNIT + BigInt(fraction.padEnd(USDT_DECIMALS, '0') || '0');
}

export function formatMinor(minor: bigint | number | string, decimals = USDT_DECIMALS): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function minorToNumberString(minor: bigint): string { return formatMinor(minor); }

export const envelopeModeSchema = z.enum(['RANDOM', 'EQUAL']);
export type EnvelopeMode = z.infer<typeof envelopeModeSchema>;

/** Base58 TRON address shape (TRC20 USDT destination). */
export const TRON_ADDRESS_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * Shown to users whenever they touch money while the deployment runs in test
 * mode. Repeated verbatim across the Mini App and the bot so the wording can
 * never drift between surfaces.
 */
export const TEST_CURRENCY_WARNING =
  'This is test currency only — no real USDT is sent or received. Balances, claims and withdrawals are simulated for testing.';

export type WithdrawalMode = 'real' | 'test' | 'disabled';

/**
 * Resolve which withdrawal path a deployment offers:
 * - `real`     FUNDS_MODE=real; TRC20 broadcasts through the Tron hot wallet.
 * - `test`     FUNDS_MODE=test with TEST_WITHDRAWAL_ADDRESS set; withdrawals are
 *              ledger-settled simulations that must use that one required test address.
 * - `disabled` FUNDS_MODE=test without TEST_WITHDRAWAL_ADDRESS (the safe default);
 *              the UI must explain why the button is off.
 */
export function resolveWithdrawalMode(input: { fundsMode: 'test' | 'real'; testWithdrawalAddress?: string }): WithdrawalMode {
  if (input.fundsMode === 'real') return 'real';
  return input.testWithdrawalAddress ? 'test' : 'disabled';
}

/** Test-mode withdrawals are only ever allowed to the configured required test address. */
export function isAllowedTestWithdrawalAddress(toAddress: string, requiredTestAddress: string | undefined): boolean {
  return Boolean(requiredTestAddress) && toAddress === requiredTestAddress;
}

export const withdrawalRequestSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  toAddress: z.string().regex(TRON_ADDRESS_REGEX),
  idempotencyKey: z.string().uuid().optional()
});
export type WithdrawalRequest = z.infer<typeof withdrawalRequestSchema>;

export const createEnvelopeSchema = z.object({
  total: z.string().regex(/^\d+(\.\d{1,6})?$/),
  count: z.number().int().min(1).max(500),
  mode: envelopeModeSchema.default('RANDOM'),
  groupId: z.string().regex(/^-?\d+$/),
  expiresInMinutes: z.number().int().min(1).max(7 * 24 * 60).default(24 * 60)
});

export const apiErrorSchema = z.object({ error: z.string(), code: z.string().optional() });

export interface AuthenticatedTelegramUser {
  id: string;
  telegramId: bigint;
  username?: string;
  firstName: string;
}

export interface WalletSummary {
  availableMinor: string;
  lockedMinor: string;
  totalMinor: string;
  available: string;
  locked: string;
}

export interface DashboardSummary {
  totalLiabilityMinor: string;
  totalLiability: string;
  hotWalletBalance: string;
  pendingWithdrawals: number;
  depositsToday: string;
  volume: Array<{ date: string; deposits: string; withdrawals: string }>;
}

export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as T;
}
