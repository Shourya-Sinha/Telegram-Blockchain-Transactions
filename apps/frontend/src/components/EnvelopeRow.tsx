import type { LedgerEntry } from '../api';
import { haptic } from '../telegram';
import { useT } from '../i18n';
import { EnvelopeGlyph } from './EnvelopeGlyph';

export function formatMinor(value: string | bigint | undefined): string {
  if (!value) return '0.00';
  const n = BigInt(value);
  return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`;
}

export function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}

export function formatClock(date: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}

/**
 * True for every ledger movement that belongs to a red envelope: the claim
 * credit, the sender's debit, and the expiry refund.
 */
export function isEnvelopeEntry(entry: Pick<LedgerEntry, 'type' | 'referenceType'>): boolean {
  return entry.referenceType === 'RED_ENVELOPE' && ['CLAIM', 'TRANSFER', 'REFUND'].includes(entry.type);
}

/**
 * WeChat-style envelope row used by Recent activity and the History panel.
 *
 * - claimed (CLAIM): light-red *opened* envelope, "From {sender}", +amount
 * - sent (TRANSFER): bright-red *sealed* envelope, -amount, claimed progress
 * - expired (REFUND): dimmed sealed envelope, "Expired · refunded"
 */
export function EnvelopeRow({ entry, onOpen }: { entry: LedgerEntry; onOpen?: (envelopeId: string) => void }) {
  const t = useT();
  const meta = entry.envelope;
  const isClaim = entry.type === 'CLAIM';
  const isRefund = entry.type === 'REFUND';
  const senderName = meta?.senderFirstName?.trim() || meta?.senderUsername?.trim();
  const modeLabel = meta?.mode === 'EQUAL' ? t('modeEqual') : meta?.mode === 'RANDOM' ? t('modeRandom') : undefined;
  const subtitleParts = [formatDateTime(entry.createdAt)];
  if (modeLabel) subtitleParts.push(modeLabel);
  if (meta?.totalSlots) subtitleParts.push(t('sharesLabel', { count: meta.totalSlots }));

  const title = isClaim
    ? (senderName ? t('fromSender', { name: senderName }) : t('redEnvelopeGeneric'))
    : isRefund
      ? t('envelopeRefunded')
      : t('envelopeSent');
  const variant = isClaim ? 'claimed' : isRefund ? 'expired' : 'sent';

  const content = <>
    <EnvelopeGlyph open={isClaim && !isRefund} size={40} />
    <span className="activity-info">
      <strong>{title}</strong>
      <small>{subtitleParts.join(' · ')}</small>
    </span>
    <span className="envelope-side">
      <span className={entry.direction === 'CREDIT' ? 'activity-amount credit-text' : 'activity-amount'}>
        {entry.direction === 'CREDIT' ? '+' : '-'}{formatMinor(entry.amountMinor)} USDT
      </span>
      {entry.type === 'TRANSFER' && meta && <small className="envelope-progress">{t('claimsProgress', { claimed: meta.totalSlots - meta.remainingSlots, total: meta.totalSlots })}</small>}
    </span>
  </>;

  if (isClaim && onOpen && entry.referenceId) {
    return <button className={`envelope-row ${variant}`} onClick={() => { haptic(); onOpen(entry.referenceId!); }}>{content}</button>;
  }
  return <div className={`envelope-row ${variant}`}>{content}</div>;
}
