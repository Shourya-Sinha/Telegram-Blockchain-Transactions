export async function adminApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); headers.set('content-type', 'application/json'); const token = localStorage.getItem('admin_token'); if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers }); const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Keep the machine-readable code (e.g. TREASURY_INSUFFICIENT_BALANCE) so
    // screens can show a localized, friendly message next to the detail.
    const error = new Error(body.error ?? 'Request failed') as Error & { code?: string };
    error.code = body.code;
    throw error;
  }
  return body as T;
}
export interface Dashboard { totalLiability: string; totalLiabilityMinor: string; hotWalletBalance: string; pendingWithdrawals: number; depositsToday: string; volume: Array<{ date: string; deposits: string; withdrawals: string }> }
export interface Withdrawal { id: string; amountMinor: string; feeMinor: string; toAddress: string; status: string; txHash?: string; createdAt: string; user: { telegramId: string; username?: string; firstName: string } }
export interface Deposit { id: string; txHash: string; amountMinor: string; fromAddress: string; toAddress: string; tokenContract: string; confirmations: number; status: string; detectedAt: string; confirmedAt?: string; user: { telegramId: string; username?: string; firstName: string } }
export interface LedgerEntry { id: string; amountMinor: string; type: string; direction: 'CREDIT' | 'DEBIT'; balanceAfterMinor: string; referenceType: string; referenceId: string; createdAt: string }
export interface User { id: string; telegramId: string; username?: string; firstName: string; status: string; createdAt: string; wallet?: { availableMinor: string; lockedMinor: string }; ledger?: LedgerEntry[] }
export interface GroupSetting { id: string; chatId: string; title?: string; username?: string; chatType?: string; lastSeenAt: string; enabled: boolean; minAccountAgeDays: number; minMessages: number; maxClaimsPerDay: number }
export interface EnvelopeRecord { id: string; groupId: string; totalMinor: string; remainingMinor: string; totalSlots: number; remainingSlots: number; mode: 'RANDOM' | 'EQUAL'; status: string; createdAt: string; expiresAt: string; sender: { telegramId: string; firstName: string; username?: string }; _count: { claims: number } }
export interface EnvelopeSetup { configured: boolean; treasuryTelegramIdConfigured: boolean; configurationMessage?: string; treasury: null | { id: string; telegramId: string; firstName: string; username?: string; wallet?: { availableMinor: string; lockedMinor: string } }; groups: GroupSetting[]; recent: EnvelopeRecord[] }
