import type { LedgerEntry } from '../api';
import { haptic } from '../telegram';
import { useT } from '../i18n';
import { EnvelopeGlyph } from './EnvelopeGlyph';

export type OpenEnvelopeHandler = (envelopeId: string, options?: { viewOnly?: boolean }) => void;

export function formatMinor(value: string | bigint | undefined): string {
  if (!value) return '0.00';
  try {
    const n = BigInt(value);
    const negative = n < 0n;
    const abs = negative ? -n : n;
    return `${negative ? '-' : ''}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`;
  } catch {
    // Never let a malformed amount take the whole screen down.
    return '0.00';
  }
}

export function formatDateTime(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed);
}

export function formatClock(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

/**
 * True for every ledger movement that belongs to a red envelope: the claim
 * credit, the sender's debit, and the expiry refund.
 */
export function isEnvelopeEntry(entry: Pick<LedgerEntry, 'type' | 'referenceType'>): boolean {
  return entry.referenceType === 'RED_ENVELOPE' && ['CLAIM', 'TRANSFER', 'REFUND'].includes(entry.type);
}

/**
 * An envelope row is still openable (sealed, tap to claim) only while the
 * envelope is ACTIVE with shares left and this row is the sender's debit.
 * Claims, refunds and finished envelopes open as read-only details instead.
 */
export function isClaimableEntry(entry: LedgerEntry): boolean {
  if (entry.type !== 'TRANSFER' || entry.referenceType !== 'RED_ENVELOPE') return false;
  const meta = entry.envelope;
  if (!meta) return true; // metadata missing: let the envelope screen decide
  return meta.status === 'ACTIVE' && meta.remainingSlots > 0;
}

/**
 * WeChat-style envelope row used by Recent activity and the History panel.
 * Every envelope row opens something: a still-open envelope you sent opens
 * sealed so you can tap the seal, and every other envelope row opens its
 * read-only details (amount, sender, shares, status, claim list).
 *
 * - claimed (CLAIM): light-red *opened* envelope, "From {sender}", +amount
 * - sent (TRANSFER): bright-red *sealed* envelope, -amount, claimed progress
 * - expired (REFUND): dimmed sealed envelope, "Expired · refunded"
 */
export function EnvelopeRow({ entry, onOpen }: { entry: LedgerEntry; onOpen?: OpenEnvelopeHandler }) {
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

  if (onOpen && entry.referenceId) {
    const claimable = isClaimableEntry(entry);
    return <button type="button" className={`envelope-row ${variant}`} onClick={() => { haptic(); onOpen(entry.referenceId, { viewOnly: !claimable }); }}>{content}</button>;
  }
  return <div className={`envelope-row ${variant}`}>{content}</div>;
}
