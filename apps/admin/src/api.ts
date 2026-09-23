export async function adminApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); headers.set('content-type', 'application/json'); const token = localStorage.getItem('admin_token'); if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'Request failed'); return body as T;
}
export interface Dashboard { totalLiability: string; totalLiabilityMinor: string; hotWalletBalance: string; pendingWithdrawals: number; depositsToday: string; volume: Array<{ date: string; deposits: string; withdrawals: string }> }
export interface Withdrawal { id: string; amountMinor: string; feeMinor: string; toAddress: string; status: string; txHash?: string; createdAt: string; user: { telegramId: string; username?: string; firstName: string } }
export interface User { id: string; telegramId: string; username?: string; firstName: string; status: string; createdAt: string; wallet?: { availableMinor: string; lockedMinor: string } }
