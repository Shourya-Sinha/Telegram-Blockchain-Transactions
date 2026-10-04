import { telegramInitData } from './telegram';

/** Error thrown for non-2xx API responses, carrying the backend error code. */
export class ApiError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  const initData = telegramInitData();
  if (initData) headers.set('x-telegram-init-data', initData);
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error ?? 'Request failed', body.code);
  return body as T;
}

export interface WalletResponse { id: string; availableMinor: string; lockedMinor: string; version: number; }
export type WithdrawalMode = 'real' | 'test' | 'disabled';
export interface MeResponse {
  id: string; telegramId: string; firstName: string; username?: string; isAdmin: boolean;
  wallet: WalletResponse; fundsMode: 'test' | 'real';
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  withdrawalMode: WithdrawalMode;
  locale: 'en' | 'zh';
  withdrawalMinMinor?: string;
  withdrawalFeeMinor?: string;
  testWithdrawalAddress?: string;
  testCurrencyWarning?: string;
  depositAddress?: string;
}
/** Sender + sharing metadata attached to ledger rows that reference a red envelope. */
export interface LedgerEnvelopeMeta {
  id: string;
  senderFirstName: string;
  senderUsername?: string | null;
  mode: 'RANDOM' | 'EQUAL';
  totalSlots: number;
  remainingSlots: number;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'REFUNDED';
}
export interface LedgerEntry {
  id: string; amountMinor: string; type: string; direction: 'CREDIT' | 'DEBIT';
  referenceType: string; referenceId: string; createdAt: string;
  envelope?: LedgerEnvelopeMeta;
}
export interface EnvelopeClaimView {
  id: string; amountMinor: string; claimedAt: string;
  user: { firstName: string; username?: string };
  mine?: boolean;
}
export interface EnvelopeDetail {
  id: string; groupId: string; totalMinor: string; remainingMinor: string;
  totalSlots: number; remainingSlots: number;
  mode: 'RANDOM' | 'EQUAL'; status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'REFUNDED';
  expiresAt: string; createdAt: string;
  sender: { firstName: string; username?: string };
  claims: EnvelopeClaimView[];
}
export interface ClaimResponse {
  kind: 'claimed';
  claim: { amountMinor: string };
  availableMinor: string;
}
export interface Withdrawal {
  id: string; amountMinor: string; feeMinor: string; toAddress: string; chain: string;
  txHash?: string | null; status: 'QUEUED' | 'PROCESSING' | 'BROADCAST' | 'CONFIRMING' | 'COMPLETED' | 'FAILED' | 'REJECTED';
  createdAt: string; completedAt?: string | null;
}
