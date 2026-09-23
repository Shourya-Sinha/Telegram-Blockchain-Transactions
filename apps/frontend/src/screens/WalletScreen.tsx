import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type LedgerEntry, type MeResponse } from '../api';
import { DepositModal } from '../components/DepositModal';
import { WithdrawModal } from '../components/WithdrawModal';
import { haptic } from '../telegram';

function formatMinor(value: string | undefined): string { if (!value) return '0.00'; const n = BigInt(value); const whole = n / 1_000_000n; const decimals = (n % 1_000_000n).toString().padStart(6, '0').slice(0, 2); return `${whole}.${decimals}`; }
function formatDate(date: string): string { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date)); }

export function WalletScreen({ me, onClaim }: { me: MeResponse; onClaim: (id: string) => void }) {
  const [modal, setModal] = useState<'deposit' | 'withdraw' | undefined>();
  const ledger = useQuery({ queryKey: ['ledger'], queryFn: () => api<LedgerEntry[]>('/api/ledger'), retry: false });
  const available = formatMinor(me.wallet.availableMinor);
  const firstName = me.firstName || 'there';
  return <main className="screen wallet-screen">
    <header className="topbar"><div><p className="eyebrow">YOUR PORTFOLIO</p><h1>Good evening, {firstName}</h1></div><div className="avatar">{firstName.slice(0, 1).toUpperCase()}</div></header>
    <section className="balance-card"><div className="balance-glow" /><div className="balance-top"><span>Total balance</span><span className="live-dot">● Live</span></div><div className="balance-value"><span>$</span>{available}<small> USD</small></div><div className="balance-bottom"><span>≈ {available} USDT</span><span className="positive">+0.00%</span></div></section>
    <div className="action-row"><button onClick={() => { haptic(); setModal('deposit'); }}><span className="action-icon deposit">↓</span><span>Deposit</span></button><button onClick={() => { haptic(); setModal('withdraw'); }}><span className="action-icon withdraw">↑</span><span>Withdraw</span></button><button onClick={() => { haptic(); setModal('deposit'); }}><span className="action-icon transfer">⇄</span><span>Transfer</span></button></div>
    <section className="section"><div className="section-heading"><h2>Assets</h2><button className="text-button">Manage</button></div><div className="token-list"><Token icon="G" name="Gram" ticker="GRAM" value="0.00" /><Token icon="$" name="Tether" ticker="USDT" value={available} highlighted /></div></section>
    <section className="section activity-section"><div className="section-heading"><h2>Recent activity</h2><button className="text-button">See all</button></div>{ledger.data?.length ? <div className="activity-list">{ledger.data.slice(0, 4).map((entry) => <button className="activity-row" key={entry.id} onClick={() => entry.type === 'CLAIM' && onClaim(entry.referenceId ?? '')}><span className={`activity-icon ${entry.direction === 'CREDIT' ? 'credit' : 'debit'}`}>{entry.direction === 'CREDIT' ? '↓' : '↑'}</span><span className="activity-info"><strong>{entry.type[0] + entry.type.slice(1).toLowerCase()}</strong><small>{formatDate(entry.createdAt)}</small></span><span className={entry.direction === 'CREDIT' ? 'activity-amount credit-text' : 'activity-amount'}>{entry.direction === 'CREDIT' ? '+' : '-'}{formatMinor(entry.amountMinor)} USDT</span></button>)}</div> : <div className="empty-activity"><span>✦</span><p>Your activity will appear here</p><small>Deposit or claim a red envelope to begin</small></div>}</section>
    {modal === 'deposit' && <DepositModal address={me.depositAddress} confirmations={19} onClose={() => setModal(undefined)} />}
    {modal === 'withdraw' && <WithdrawModal onClose={() => setModal(undefined)} />}
  </main>;
}

function Token({ icon, name, ticker, value, highlighted }: { icon: string; name: string; ticker: string; value: string; highlighted?: boolean }) {
  return <div className="token-row"><span className={highlighted ? 'token-icon usdt' : 'token-icon gram'}>{icon}</span><span className="token-name"><strong>{name}</strong><small>{ticker}</small></span><span className="token-value"><strong>{value}</strong><small>${value}</small></span></div>;
}
