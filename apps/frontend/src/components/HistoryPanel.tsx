import { useQuery } from '@tanstack/react-query';
import { api, type LedgerEntry, type Withdrawal } from '../api';
import { haptic } from '../telegram';
import { ledgerTypeLabel, useT, withdrawalStatusLabel } from '../i18n';
import { EnvelopeRow, formatMinor, isEnvelopeEntry, type OpenEnvelopeHandler } from './EnvelopeRow';

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}

/**
 * Full transaction history: every ledger movement (deposits, claims,
 * envelopes, withdrawals, fees, refunds) plus the status of each withdrawal
 * request. Reached from the wallet's History action and "See all".
 * Red envelope movements render as WeChat-style envelope rows.
 */
export function HistoryPanel({ testMode, onClose, onOpenEnvelope }: { testMode: boolean; onClose: () => void; onOpenEnvelope?: OpenEnvelopeHandler }) {
  const t = useT();
  const ledger = useQuery({ queryKey: ['ledger'], queryFn: () => api<LedgerEntry[]>('/api/ledger?limit=100'), retry: false });
  const withdrawals = useQuery({ queryKey: ['withdrawals'], queryFn: () => api<Withdrawal[]>('/api/withdrawals'), retry: false });
  return (
    <section className="history-panel">
      <header className="history-header">
        <button className="text-button" onClick={() => { haptic(); onClose(); }}>{t('backToWallet')}</button>
        <h2>{t('historyTitle')}</h2>
      </header>
      {testMode && <div className="warning-box history-warning"><p>{t('testHistoryWarning')}</p></div>}
      <section className="section">
        <div className="section-heading"><h2>{t('withdrawals')}</h2><small className="history-count">{withdrawals.data?.length ?? 0}</small></div>
        {withdrawals.isLoading ? <div className="empty-activity"><p>{t('loadingWithdrawals')}</p></div>
          : withdrawals.data?.length ? <div className="activity-list">{withdrawals.data.map((w) => (
            <div className="withdrawal-row" key={w.id}>
              <span className="activity-icon withdraw">↑</span>
              <span className="activity-info">
                <strong>{formatMinor(w.amountMinor)} USDT{testMode ? t('withdrawalTestTag') : ''}</strong>
                <small>{formatDate(w.createdAt)} · {t('feeLabel', { amount: formatMinor(w.feeMinor) })}</small>
                <small className="withdrawal-address">{w.toAddress}</small>
                {w.txHash && <small className="withdrawal-address">{t('txLabel', { hash: `${w.txHash.slice(0, 12)}…` })}</small>}
              </span>
              <span className={`status-chip status-${w.status.toLowerCase()}`}>{withdrawalStatusLabel(t, w.status)}{testMode && w.status === 'COMPLETED' ? t('simulatedTag') : ''}</span>
            </div>
          ))}</div>
          : <div className="empty-activity"><span>↑</span><p>{t('noWithdrawals')}</p><small>{t('noWithdrawalsHint')}</small></div>}
      </section>
      <section className="section">
        <div className="section-heading"><h2>{t('allActivity')}</h2><small className="history-count">{ledger.data?.length ?? 0}</small></div>
        {ledger.isLoading ? <div className="empty-activity"><p>{t('loadingActivity')}</p></div>
          : ledger.data?.length ? <div className="activity-list">{ledger.data.map((entry) => isEnvelopeEntry(entry) ? <EnvelopeRow key={entry.id} entry={entry} onOpen={onOpenEnvelope} /> : (
            <div className="activity-row" key={entry.id}>
              <span className={`activity-icon ${entry.direction === 'CREDIT' ? 'credit' : ''}`}>{entry.direction === 'CREDIT' ? '↓' : '↑'}</span>
              <span className="activity-info"><strong>{ledgerTypeLabel(t, entry.type)}</strong><small>{formatDate(entry.createdAt)}</small></span>
              <span className={entry.direction === 'CREDIT' ? 'activity-amount credit-text' : 'activity-amount'}>{entry.direction === 'CREDIT' ? '+' : '-'}{formatMinor(entry.amountMinor)} USDT</span>
            </div>
          ))}</div>
          : <div className="empty-activity"><span>✦</span><p>{t('activityEmptyTitle')}</p><small>{t('activityEmptyHint')}</small></div>}
      </section>
    </section>
  );
}
