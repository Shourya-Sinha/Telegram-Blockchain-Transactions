import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type LedgerEntry, type Withdrawal } from '../api';
import { configureBackButton, haptic } from '../telegram';

function formatMinor(value: string | undefined): string {
  if (!value) return '0.00';
  const n = BigInt(value);
  return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`;
}
function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}

const STATUS_LABEL: Record<Withdrawal['status'], string> = {
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  BROADCAST: 'Broadcast',
  CONFIRMING: 'Confirming',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  REJECTED: 'Rejected'
};

/**
 * Full transaction history: every ledger movement (deposits, claims,
 * envelopes, withdrawals, fees, refunds) plus the status of each withdrawal
 * request. Reached from the wallet's "See all" button and the history action.
 */
export function HistoryPanel({ testMode, onClose }: { testMode: boolean; onClose: () => void }) {
  const ledger = useQuery({ queryKey: ['ledger'], queryFn: () => api<LedgerEntry[]>('/api/ledger?limit=100'), retry: false });
  const withdrawals = useQuery({ queryKey: ['withdrawals'], queryFn: () => api<Withdrawal[]>('/api/withdrawals'), retry: false });
  useEffect(() => configureBackButton(onClose, true), [onClose]);
  return (
    <section className="history-panel">
      <header className="history-header">
        <button className="text-button" onClick={() => { haptic(); onClose(); }}>‹ Wallet</button>
        <h2>History</h2>
      </header>
      {testMode && <div className="warning-box history-warning"><p>This is test currency only — history shows simulated activity.</p></div>}
      <section className="section">
        <div className="section-heading"><h2>Withdrawals</h2><small className="history-count">{withdrawals.data?.length ?? 0}</small></div>
        {withdrawals.isLoading ? <div className="empty-activity"><p>Loading withdrawals…</p></div>
          : withdrawals.data?.length ? <div className="activity-list">{withdrawals.data.map((w) => (
            <div className="withdrawal-row" key={w.id}>
              <span className="activity-icon withdraw">↑</span>
              <span className="activity-info">
                <strong>{formatMinor(w.amountMinor)} USDT{testMode ? ' · test' : ''}</strong>
                <small>{formatDate(w.createdAt)} · fee {formatMinor(w.feeMinor)}</small>
                <small className="withdrawal-address">{w.toAddress}</small>
                {w.txHash && <small className="withdrawal-address">tx {w.txHash.slice(0, 12)}…</small>}
              </span>
              <span className={`status-chip status-${w.status.toLowerCase()}`}>{STATUS_LABEL[w.status]}{testMode && w.status === 'COMPLETED' ? ' · simulated' : ''}</span>
            </div>
          ))}</div>
          : <div className="empty-activity"><span>↑</span><p>No withdrawals yet</p><small>Withdrawal requests and their status appear here</small></div>}
      </section>
      <section className="section">
        <div className="section-heading"><h2>All activity</h2><small className="history-count">{ledger.data?.length ?? 0}</small></div>
        {ledger.isLoading ? <div className="empty-activity"><p>Loading activity…</p></div>
          : ledger.data?.length ? <div className="activity-list">{ledger.data.map((entry) => (
            <div className="activity-row" key={entry.id}>
              <span className={`activity-icon ${entry.direction === 'CREDIT' ? 'credit' : ''}`}>{entry.direction === 'CREDIT' ? '↓' : '↑'}</span>
              <span className="activity-info"><strong>{entry.type[0] + entry.type.slice(1).toLowerCase()}</strong><small>{formatDate(entry.createdAt)}</small></span>
              <span className={entry.direction === 'CREDIT' ? 'activity-amount credit-text' : 'activity-amount'}>{entry.direction === 'CREDIT' ? '+' : '-'}{formatMinor(entry.amountMinor)} USDT</span>
            </div>
          ))}</div>
          : <div className="empty-activity"><span>✦</span><p>Your activity will appear here</p><small>Deposit or claim a red envelope to begin</small></div>}
      </section>
    </section>
  );
}
