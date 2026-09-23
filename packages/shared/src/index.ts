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

export const withdrawalRequestSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  toAddress: z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/),
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
