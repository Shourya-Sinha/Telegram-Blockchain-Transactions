import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type ClaimResponse, type EnvelopeDetail } from '../api';
import { haptic, successHaptic } from '../telegram';
import { useT } from '../i18n';
import { formatClock, formatMinor } from './EnvelopeRow';

type Phase = 'sealed' | 'opening' | 'done';

/** How long the flap/coin animation runs before the result is revealed. */
const OPEN_ANIMATION_MS = 1250;

/**
 * WeChat-style red envelope opening flow.
 *
 * sealed  — bright red envelope with sender name, blessing, and a pulsing gold
 *           seal; tapping it starts the claim.
 * opening — the flap lifts, the seal bursts, and gold coins fly out.
 * done    — the pocket fades to light red with the flap up, the claimed amount
 *           is revealed, and the claim-details list (who took what, when)
 *           appears below — exactly like WeChat's "opened" state.
 *
 * Reopening an envelope that this viewer already claimed (from history) skips
 * straight to the opened view. Sent/refund history rows also open in read-only
 * detail mode so tapping any envelope history item shows its UI.
 */
export function ClaimModal({ envelopeId, viewOnly = false, onClose }: { envelopeId: string; viewOnly?: boolean; onClose: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const [phase, setPhase] = useState<Phase>(viewOnly ? 'done' : 'sealed');
  const [animDone, setAnimDone] = useState(false);

  const detail = useQuery({
    queryKey: ['envelope', envelopeId],
    queryFn: () => api<EnvelopeDetail>(`/api/envelopes/${envelopeId}`),
    retry: false
  });

  const mutation = useMutation({
    mutationFn: () => api<ClaimResponse>(`/api/envelopes/${envelopeId}/claim`, { method: 'POST' }),
    onSuccess: () => {
      successHaptic();
      void client.invalidateQueries({ queryKey: ['me'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
      void client.invalidateQueries({ queryKey: ['envelope', envelopeId] });
    }
  });

  const myClaim = detail.data?.claims.find((claim) => claim.mine);
  const detailUnavailable = detail.isError;
  const envelopeClosed = Boolean(detail.data && (detail.data.status !== 'ACTIVE' || detail.data.remainingSlots <= 0));

  // Already opened by this viewer (arrived via a history row), read-only
  // history details, or a closed envelope should show the opened detail view
  // immediately, with no active seal to tap.
  useEffect(() => {
    if (phase === 'sealed' && (myClaim || viewOnly || envelopeClosed || detailUnavailable) && !mutation.isPending) setPhase('done');
  }, [phase, myClaim, viewOnly, envelopeClosed, detailUnavailable, mutation.isPending]);

  const openEnvelope = () => {
    if (phase !== 'sealed' || mutation.isPending) return;
    if (viewOnly || envelopeClosed || detailUnavailable) { setPhase('done'); return; }
    haptic('medium');
    setAnimDone(false);
    setPhase('opening');
    mutation.mutate();
    window.setTimeout(() => setAnimDone(true), OPEN_ANIMATION_MS);
  };

  // The reveal waits for both the flap animation and the ledger result.
  useEffect(() => {
    if (phase !== 'opening' || !animDone || mutation.isPending) return;
    setPhase('done');
  }, [phase, animDone, mutation.isPending]);

  const claimed = mutation.isSuccess ? mutation.data.claim.amountMinor : myClaim?.amountMinor;
  const error = mutation.isError ? mutation.error : undefined;
  const detailError = detail.isError ? detail.error : undefined;
  const errorCode = error instanceof ApiError ? error.code : undefined;
  const missMessage = errorCode === 'ALREADY_CLAIMED' ? t('alreadyClaimedNote')
    : errorCode === 'ENVELOPE_CLOSED' ? t('envelopeFullyClaimed')
      : errorCode === 'ENVELOPE_EXPIRED' ? t('envelopeExpiredMsg')
        : (error instanceof Error && error.message) || t('envelopeGone');

  const senderName = detail.data?.sender.firstName?.trim();
  const senderTitle = senderName ? t('redEnvelopeFrom', { name: senderName }) : t('redEnvelopeGeneric');
  const claims = detail.data?.claims ?? [];
  const claimedCount = detail.data ? detail.data.totalSlots - detail.data.remainingSlots : claims.length;
  const statusLabel = detail.data?.status === 'ACTIVE' ? t('envelopeStatusActive')
    : detail.data?.status === 'COMPLETED' ? t('envelopeStatusCompleted')
      : detail.data?.status === 'EXPIRED' ? t('envelopeStatusExpired')
        : detail.data?.status === 'REFUNDED' ? t('envelopeStatusRefunded')
          : t('loadingActivity');
  const detailsMessage = detail.data
    ? `${t('claimsProgress', { claimed: claimedCount, total: detail.data.totalSlots })} · ${statusLabel}`
    : detailError instanceof Error && detailError.message
      ? detailError.message
        : detailUnavailable
          ? t('envelopeDetailsUnavailable')
          : t('loadingActivity');
  const canTapToClaim = phase === 'sealed' && !viewOnly && !envelopeClosed && !detailUnavailable;

  return <div className="hongbao-overlay" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="hb-close" onClick={() => { haptic(); onClose(); }} aria-label={t('done')}>×</button>
    <header className="hb-sender">
      <span className="hb-sender-avatar">{(senderName ?? '🧧').slice(0, 1).toUpperCase()}</span>
      <strong>{senderTitle}</strong>
      <p className="hb-blessing" lang="zh">{t('blessing')}</p>
    </header>

    <div
      className={`hb-envelope phase-${phase}`}
      onClick={openEnvelope}
      role={canTapToClaim ? 'button' : undefined}
      tabIndex={canTapToClaim ? 0 : undefined}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEnvelope(); } }}
    >
      <div className="hb-body">
        <div className="hb-reveal">
          {phase === 'done' && claimed && <>
            <span className="hb-reveal-label">{t('claimAdded')}</span>
            <div className="hb-amount">+{formatMinor(claimed)} <small>USDT</small></div>
          </>}
          {phase === 'done' && !claimed && <div className="hb-missed">{viewOnly || envelopeClosed || detailUnavailable ? detailsMessage : missMessage}</div>}
        </div>
        <div className="hb-flap">
          <div className="hb-flap-shape" />
          {canTapToClaim && <button className="hb-seal" onClick={(event) => { event.stopPropagation(); openEnvelope(); }} aria-label={t('tapToOpen')}><span lang="zh">福</span></button>}
        </div>
        {phase === 'opening' && <div className="hb-coins" aria-hidden="true">{Array.from({ length: 9 }).map((_, index) => <span key={index} />)}</div>}
      </div>
    </div>

    <p className="hb-hint" aria-live="polite">
      {phase === 'sealed' && t('tapToOpen')}
      {phase === 'opening' && t('claimOpening')}
      {phase === 'done' && claimed && t('blessing')}
      {phase === 'done' && !claimed && (viewOnly || envelopeClosed || detailUnavailable) && t('envelopeHistoryHint')}
    </p>

    {phase === 'done' && claims.length > 0 && <div className="hb-claims">
      <div className="hb-claims-title">{t('claimDetails')} · {claims.length}/{detail.data?.totalSlots ?? claims.length}</div>
      {claims.map((claim) => <div className="hb-claim" key={claim.id}>
        <span className="hb-claim-avatar">{(claim.user.firstName || '?').slice(0, 1).toUpperCase()}</span>
        <span className="hb-claim-name">{claim.user.firstName}{claim.mine && <em>{t('youLabel')}</em>}</span>
        <small className="hb-claim-time">{formatClock(claim.claimedAt)}</small>
        <span className="hb-claim-amount">{formatMinor(claim.amountMinor)}</span>
      </div>)}
    </div>}

    <button className="hb-done" onClick={onClose}>{t('done')}</button>
  </div>;
}
