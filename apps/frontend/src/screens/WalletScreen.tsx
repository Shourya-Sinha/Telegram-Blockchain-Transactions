import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type LedgerEntry, type MeResponse } from '../api';
import { DepositModal } from '../components/DepositModal';
import { WithdrawModal } from '../components/WithdrawModal';
import { HistoryPanel } from '../components/HistoryPanel';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { haptic } from '../telegram';
import { greetingKey, ledgerTypeLabel, useT } from '../i18n';

function formatMinor(value: string | undefined): string { if (!value) return '0.00'; const n = BigInt(value); const whole = n / 1_000_000n; const decimals = (n % 1_000_000n).toString().padStart(6, '0').slice(0, 2); return `${whole}.${decimals}`; }
function formatDate(date: string): string { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date)); }

const withdrawHint = (me: MeResponse, t: ReturnType<typeof useT>): string | undefined => {
  if (me.withdrawalsEnabled) return undefined;
  if (me.fundsMode === 'test') return t('testBannerDisabled');
  return t('withdrawDisabledHint');
};

export function WalletScreen({ me, onClaim }: { me: MeResponse; onClaim: (id: string) => void }) {
  const t = useT();
  const [modal, setModal] = useState<'deposit' | 'withdraw' | undefined>();
  const [showHistory, setShowHistory] = useState(false);
  const ledger = useQuery({ queryKey: ['ledger'], queryFn: () => api<LedgerEntry[]>('/api/ledger'), retry: false });
  const available = formatMinor(me.wallet.availableMinor);
  const locked = formatMinor(me.wallet.lockedMinor);
  const firstName = me.firstName || 'there';
  const testBanner = me.fundsMode === 'test'
    ? (me.withdrawalMode === 'test' ? t('testBannerTestWithdraw') : t('testBannerDisabled'))
    : '';
  if (showHistory) return <HistoryPanel testMode={me.fundsMode === 'test'} onClose={() => setShowHistory(false)} />;
  return <main className="screen wallet-screen">
    <header className="topbar">
      <div><p className="eyebrow">{t('yourPortfolio')}</p><h1>{t(greetingKey(), { name: firstName })}</h1></div>
      <div className="topbar-actions"><LanguageSwitcher /><div className="avatar">{firstName.slice(0, 1).toUpperCase()}</div></div>
    </header>
    {me.fundsMode === 'test' && <div className="mode-banner"><strong>{t('testMode')}</strong><span>{testBanner}</span></div>}
    <section className="balance-card"><div className="balance-glow" /><div className="balance-top"><span>{me.fundsMode === 'test' ? t('testBalance') : t('totalBalance')}</span><span className="live-dot">● {me.fundsMode === 'test' ? t('demo') : t('live')}</span></div><div className="balance-value"><span>$</span>{available}<small> USD</small></div><div className="balance-bottom"><span>{t('usdAvailable', { amount: available })}</span><span>{t('pending', { amount: locked })}</span></div></section>
    <div className="action-row">
      <button disabled={!me.depositsEnabled} title={!me.depositsEnabled ? t('testBannerDisabled') : undefined} onClick={() => { haptic(); setModal('deposit'); }}><span className="action-icon deposit">↓</span><span>{t('deposit')}</span></button>
      <button disabled={!me.withdrawalsEnabled} title={withdrawHint(me, t)} onClick={() => { haptic(); setModal('withdraw'); }}><span className="action-icon withdraw">↑</span><span>{me.withdrawalMode === 'test' ? t('withdrawTest') : t('withdraw')}</span></button>
      <button onClick={() => { haptic(); setShowHistory(true); }}><span className="action-icon transfer">🕘</span><span>{t('history')}</span></button>
    </div>
    <section className="section"><div className="section-heading"><h2>{t('assets')}</h2><button className="text-button">{t('manage')}</button></div><div className="token-list"><Token icon="G" name="Gram" ticker="GRAM" value="0.00" /><Token icon="$" name={t('tether')} ticker="USDT" value={available} highlighted /></div></section>
    <section className="section activity-section"><div className="section-heading"><h2>{t('recentActivity')}</h2><button className="text-button" onClick={() => { haptic(); setShowHistory(true); }}>{t('seeAll')}</button></div>{ledger.data?.length ? <div className="activity-list">{ledger.data.slice(0, 4).map((entry) => <button className="activity-row" key={entry.id} onClick={() => entry.type === 'CLAIM' && onClaim(entry.referenceId ?? '')}><span className={`activity-icon ${entry.direction === 'CREDIT' ? 'credit' : 'debit'}`}>{entry.direction === 'CREDIT' ? '↓' : '↑'}</span><span className="activity-info"><strong>{ledgerTypeLabel(t, entry.type)}</strong><small>{formatDate(entry.createdAt)}</small></span><span className={entry.direction === 'CREDIT' ? 'activity-amount credit-text' : 'activity-amount'}>{entry.direction === 'CREDIT' ? '+' : '-'}{formatMinor(entry.amountMinor)} USDT</span></button>)}</div> : <div className="empty-activity"><span>✦</span><p>{t('activityEmptyTitle')}</p><small>{t('activityEmptyHint')}</small></div>}</section>
    {modal === 'deposit' && <DepositModal address={me.depositAddress} confirmations={19} onClose={() => setModal(undefined)} />}
    {modal === 'withdraw' && <WithdrawModal me={me} onClose={() => setModal(undefined)} />}
  </main>;
}

function Token({ icon, name, ticker, value, highlighted }: { icon: string; name: string; ticker: string; value: string; highlighted?: boolean }) {
  return <div className="token-row"><span className={highlighted ? 'token-icon usdt' : 'token-icon gram'}>{icon}</span><span className="token-name"><strong>{name}</strong><small>{ticker}</small></span><span className="token-value"><strong>{value}</strong><small>${value}</small></span></div>;
}
