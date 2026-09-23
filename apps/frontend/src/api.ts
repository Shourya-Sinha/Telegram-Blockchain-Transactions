import { telegramInitData } from './telegram';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  const initData = telegramInitData();
  if (initData) headers.set('x-telegram-init-data', initData);
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Request failed');
  return body as T;
}

export interface WalletResponse { id: string; availableMinor: string; lockedMinor: string; version: number; }
export interface MeResponse { id: string; telegramId: string; firstName: string; username?: string; isAdmin: boolean; wallet: WalletResponse; depositAddress?: string; }
export interface LedgerEntry { id: string; amountMinor: string; type: string; direction: 'CREDIT' | 'DEBIT'; createdAt: string; referenceId?: string; }
