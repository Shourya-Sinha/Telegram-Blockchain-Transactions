import { telegramInitData } from './telegram';

/** Error thrown for non-2xx API responses, carrying the backend error code. */
export class ApiError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}

function parseBody(text: string): Record<string, unknown> {
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  const initData = telegramInitData();
  if (initData) headers.set('x-telegram-init-data', initData);
  let response: Response;
  try {
    // Wallet data must never be answered from the WebView cache. Without this
    // the browser revalidates (the `304 … /api/envelopes/<id>` lines in the
    // server log), balances render stale, and WebViews that hand the bare 304
    // to fetch() made a perfectly good envelope look unavailable.
    response = await fetch(path, { cache: 'no-store', ...options, headers });
  } catch {
    throw new ApiError('Network unavailable. Check your connection and try again.', 'NETWORK_ERROR');
  }
  const body = parseBody(await response.text().catch(() => ''));
  if (!response.ok) {
    throw new ApiError(
      typeof body.error === 'string' ? body.error : `Request failed (${response.status})`,
      typeof body.code === 'string' ? body.code : `HTTP_${response.status}`
    );
  }
  return body as T;
}

/**
 * Claim/detail failures that are permanent for this envelope. Everything else
 * (network blips, rate limits, membership checks, 5xx) can be retried, so the
 * envelope UI keeps its seal tappable instead of dead-ending.
 */
const TERMINAL_ENVELOPE_CODES = ['ALREADY_CLAIMED', 'ENVELOPE_CLOSED', 'ENVELOPE_EXPIRED', 'ENVELOPE_NOT_FOUND'];
export function isTerminalEnvelopeError(error: unknown): boolean {
  return error instanceof ApiError && Boolean(error.code && TERMINAL_ENVELOPE_CODES.includes(error.code));
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
  /** Wallet balance right after this movement — shown in the detail sheet. */
  balanceAfterMinor?: string;
  envelope?: LedgerEnvelopeMeta;
}
export interface Deposit {
  id: string; txHash: string; amountMinor: string; fromAddress: string; toAddress: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'; confirmations: number;
  createdAt: string; confirmedAt?: string | null;
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
