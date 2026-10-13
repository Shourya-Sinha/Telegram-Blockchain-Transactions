import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Deposit, type LedgerEntry, type Withdrawal } from '../api';
import { haptic } from '../telegram';
import { depositStatusLabel, ledgerTypeLabel, useT, withdrawalStatusLabel, type Translate } from '../i18n';
import { formatMinor, isEnvelopeEntry, type OpenEnvelopeHandler } from './EnvelopeRow';

/** Which history row the sheet describes: a ledger movement or a withdrawal request. */
export type DetailTarget =
  | { kind: 'ledger'; entry: LedgerEntry }
  | { kind: 'withdrawal'; withdrawal: Withdrawal };

export function detailTargetKey(target: DetailTarget): string {
  return target.kind === 'ledger' ? `ledger:${target.entry.id}` : `withdrawal:${target.withdrawal.id}`;
}

function formatFull(date?: string | null): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(parsed);
}

function shorten(value: string, head = 10, tail = 8): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** One label/value line; long hashes and addresses can be copied with one tap. */
function Row({ label, value, copyable }: { label: string; value?: ReactNode; copyable?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  if (value === undefined || value === null || value === '') return null;
  const copy = async () => {
    haptic();
    try { await navigator.clipboard?.writeText(copyable ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked in some WebViews */ }
  };
  return <div className="detail-row">
    <span className="detail-row-label">{label}</span>
    <span className="detail-row-value">{value}{copyable && <button className="detail-copy" onClick={copy}>{copied ? t('copied') : t('copyAddress')}</button>}</span>
  </div>;
}

function envelopeModeLabel(t: Translate, mode?: string): string | undefined {
  if (mode === 'EQUAL') return t('modeEqual');
  if (mode === 'RANDOM') return t('modeRandom');
  return undefined;
}

function envelopeStatusText(t: Translate, status?: string): string | undefined {
  if (status === 'ACTIVE') return t('envelopeStatusActive');
  if (status === 'COMPLETED') return t('envelopeStatusCompleted');
  if (status === 'EXPIRED') return t('envelopeStatusExpired');
  if (status === 'REFUNDED') return t('envelopeStatusRefunded');
  return undefined;
}

/**
 * Full details for a single history entry — the screen that opens when any row
 * in Recent activity or History is tapped.
 *
 * Deposits, withdrawals and fees resolve their on-chain record (address, tx
 * hash, confirmations, status) from the user's own deposit/withdrawal lists;
 * red envelope movements show the envelope summary plus a button that opens the
 * envelope UI itself. The header back arrow, the footer Close button, the
 * backdrop and Telegram's native back arrow all dismiss it, so this screen can
 * never trap the user.
 */
export function TransactionDetail({ target, onClose, onOpenEnvelope }: { target: DetailTarget; onClose: () => void; onOpenEnvelope?: OpenEnvelopeHandler }) {
  const t = useT();
  const entry = target.kind === 'ledger' ? target.entry : undefined;
  const requested = target.kind === 'withdrawal' ? target.withdrawal : undefined;
  const referenceType = entry?.referenceType ?? 'WITHDRAWAL';
  const referenceId = entry?.referenceId ?? requested?.id ?? '';
  const needsWithdrawal = referenceType === 'WITHDRAWAL';
  const needsDeposit = referenceType === 'DEPOSIT';

  const withdrawals = useQuery({
    queryKey: ['withdrawals'],
    queryFn: () => api<Withdrawal[]>('/api/withdrawals'),
    retry: false,
    enabled: needsWithdrawal && target.kind === 'ledger'
  });
  const deposits = useQuery({
    queryKey: ['deposits'],
    queryFn: () => api<Deposit[]>('/api/deposits'),
    retry: false,
    enabled: needsDeposit
  });

  const withdrawal = requested ?? withdrawals.data?.find((item) => item.id === referenceId);
  const deposit = deposits.data?.find((item) => item.id === referenceId || item.txHash === referenceId);
  const envelopeMeta = entry?.envelope;
  const isEnvelope = Boolean(entry && isEnvelopeEntry(entry));

  const amountMinor = entry?.amountMinor ?? requested?.amountMinor ?? '0';
  const credit = entry ? entry.direction === 'CREDIT' : false;
  const title = entry
    ? (isEnvelope ? t('envelopeDetailsTitle') : ledgerTypeLabel(t, entry.type))
    : t('withdrawalDetailsTitle');
  const createdAt = entry?.createdAt ?? requested?.createdAt;
  const statusChip = withdrawal
    ? { text: withdrawalStatusLabel(t, withdrawal.status), className: `status-chip status-${withdrawal.status.toLowerCase()}` }
    : deposit
      ? { text: depositStatusLabel(t, deposit.status), className: `status-chip status-${deposit.status.toLowerCase()}` }
      : envelopeMeta
        ? { text: envelopeStatusText(t, envelopeMeta.status) ?? envelopeMeta.status, className: `status-chip status-${envelopeMeta.status.toLowerCase()}` }
        : undefined;
  const loadingExtra = (needsWithdrawal && withdrawals.isLoading) || (needsDeposit && deposits.isLoading);
  const icon = isEnvelope ? '🧧' : credit ? '↓' : '↑';

  return <div className="detail-overlay" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="detail-sheet">
      <header className="detail-header">
        <button className="detail-back" onClick={() => { haptic(); onClose(); }} aria-label={t('back')}>‹</button>
        <h2>{title}</h2>
        <button className="icon-button" onClick={() => { haptic(); onClose(); }} aria-label={t('close')}>×</button>
      </header>
      <div className="detail-scroll">
        <div className="detail-amount-card">
          <span className={`detail-amount-icon${credit ? ' credit' : ''}`}>{icon}</span>
          <div className={credit ? 'detail-amount credit-text' : 'detail-amount'}>{credit ? '+' : '-'}{formatMinor(amountMinor)} <small>USDT</small></div>
          <small className="detail-amount-sub">{formatFull(createdAt) ?? t('loadingDetails')}</small>
          {statusChip && <span className={statusChip.className}>{statusChip.text}</span>}
        </div>

        <div className="detail-rows">
          <Row label={t('typeLabel')} value={entry ? ledgerTypeLabel(t, entry.type) : t('withdrawalDetailsTitle')} />
          <Row label={t('directionLabel')} value={entry ? (credit ? t('directionCredit') : t('directionDebit')) : t('directionDebit')} />
          <Row label={t('dateTimeLabel')} value={formatFull(createdAt)} />
          <Row label={t('balanceAfterLabel')} value={entry?.balanceAfterMinor ? `${formatMinor(entry.balanceAfterMinor)} USDT` : undefined} />

          {envelopeMeta && <>
            <Row label={t('senderLabel')} value={envelopeMeta.senderFirstName || envelopeMeta.senderUsername || undefined} />
            <Row label={t('distributionLabel')} value={envelopeModeLabel(t, envelopeMeta.mode)} />
            <Row label={t('sharesClaimedLabel')} value={t('claimsProgress', { claimed: envelopeMeta.totalSlots - envelopeMeta.remainingSlots, total: envelopeMeta.totalSlots })} />
            <Row label={t('envelopeStatusHeading')} value={envelopeStatusText(t, envelopeMeta.status)} />
          </>}

          {withdrawal && <>
            <Row label={t('statusLabel')} value={withdrawalStatusLabel(t, withdrawal.status)} />
            <Row label={t('destinationLabel')} value={shorten(withdrawal.toAddress, 12, 10)} copyable={withdrawal.toAddress} />
            <Row label={t('networkLabel')} value={withdrawal.chain} />
            <Row label={t('feeOnlyLabel')} value={`${formatMinor(withdrawal.feeMinor)} USDT`} />
            <Row label={t('netReceivedLabel')} value={`${formatMinor((BigInt(withdrawal.amountMinor) - BigInt(withdrawal.feeMinor)).toString())} USDT`} />
            <Row label={t('txHashLabel')} value={withdrawal.txHash ? shorten(withdrawal.txHash, 12, 10) : undefined} copyable={withdrawal.txHash ?? undefined} />
            <Row label={t('requestedAtLabel')} value={formatFull(withdrawal.createdAt)} />
            <Row label={t('completedAtLabel')} value={formatFull(withdrawal.completedAt)} />
          </>}

          {deposit && <>
            <Row label={t('statusLabel')} value={depositStatusLabel(t, deposit.status)} />
            <Row label={t('fromAddressLabel')} value={shorten(deposit.fromAddress, 12, 10)} copyable={deposit.fromAddress} />
            <Row label={t('txHashLabel')} value={shorten(deposit.txHash, 12, 10)} copyable={deposit.txHash} />
            <Row label={t('confirmationsLabel')} value={String(deposit.confirmations)} />
            <Row label={t('completedAtLabel')} value={formatFull(deposit.confirmedAt)} />
          </>}

          <Row label={t('referenceLabel')} value={referenceId ? shorten(referenceId, 8, 6) : undefined} copyable={referenceId} />
          {loadingExtra && <div className="detail-row"><span className="detail-row-label">{t('loadingDetails')}</span></div>}
          {!withdrawal && !deposit && !envelopeMeta && !loadingExtra && <p className="detail-note">{t('noExtraDetails')}</p>}
        </div>

        {isEnvelope && entry?.referenceId && onOpenEnvelope && <button
          className="primary-button detail-primary"
          onClick={() => { haptic(); onOpenEnvelope(entry.referenceId, { viewOnly: entry.type !== 'TRANSFER' || envelopeMeta?.status !== 'ACTIVE' }); }}
        >{envelopeMeta?.status === 'ACTIVE' && entry.type === 'TRANSFER' ? t('openEnvelopeAction') : t('viewEnvelope')}</button>}
      </div>
      <footer className="detail-footer">
        <button className="secondary-button detail-close" onClick={() => { haptic(); onClose(); }}>{t('close')}</button>
      </footer>
    </section>
  </div>;
}
