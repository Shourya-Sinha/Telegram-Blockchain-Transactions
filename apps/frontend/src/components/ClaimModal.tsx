import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, isTerminalEnvelopeError, type ClaimResponse, type EnvelopeDetail } from '../api';
import { haptic, successHaptic } from '../telegram';
import { apiErrorMessage, useT } from '../i18n';
import { formatClock, formatDateTime, formatMinor } from './EnvelopeRow';

type Phase = 'sealed' | 'opening' | 'done';

/** How long the flap/coin animation runs before the result is revealed. */
const OPEN_ANIMATION_MS = 1250;
const CLAIM_REQUIREMENT_ERROR_CODES = new Set([
  'ACCOUNT_TOO_NEW', 'MESSAGE_REQUIREMENT', 'CLAIM_LIMIT', 'GROUP_DISABLED', 'ENVELOPES_DISABLED'
]);

function apiErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/**
 * WeChat-style red envelope screen.
 *
 * sealed  — bright red envelope with sender name, blessing, and a pulsing gold
 *           seal; tapping it (or the Try again button) claims a share.
 * opening — the flap lifts, the seal bursts, and gold coins fly out.
 * done    — the pocket fades to light red with the flap up, the claimed amount
 *           is revealed, and the envelope details (total, shares, mode, status,
 *           expiry) plus the claim list appear below.
 *
 * Two rules keep this screen from ever dead-ending:
 * 1. A failure that can be retried (network, rate limit, membership check,
 *    server error) returns the envelope to its sealed state with the reason on
 *    screen and a Try again button — audience denial, already-claimed, closed,
 *    expired and missing envelopes are final.
 * 2. The back arrow, the × and the Done button live outside the scroll area, so
 *    however long the claim list grows they stay on screen.
 */
export function ClaimModal({ envelopeId, viewOnly = false, onClose, onShowLedgerDetails }: {
  envelopeId: string;
  viewOnly?: boolean;
  onClose: () => void;
  onShowLedgerDetails?: () => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const [phase, setPhase] = useState<Phase>(viewOnly ? 'done' : 'sealed');
  const [animDone, setAnimDone] = useState(false);

  const detail = useQuery({
    queryKey: ['envelope', envelopeId],
    queryFn: () => api<EnvelopeDetail>(`/api/envelopes/${envelopeId}`),
    retry: false,
    enabled: Boolean(envelopeId)
  });

  const mutation = useMutation({
    mutationFn: () => api<ClaimResponse>(`/api/envelopes/${envelopeId}/claim`, { method: 'POST' }),
    onSuccess: () => {
      successHaptic();
      void client.invalidateQueries({ queryKey: ['me'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
      void client.invalidateQueries({ queryKey: ['envelope', envelopeId] });
    },
    onError: (error) => {
      // Definitive outcomes (including audience denial) do not benefit from a
      // retry; refresh the envelope/history to keep the visible state current.
      if (isTerminalEnvelopeError(error)) {
        void client.invalidateQueries({ queryKey: ['ledger'] });
        void detail.refetch();
      }
    }
  });

  const myClaim = detail.data?.claims.find((claim) => claim.mine);
  const claimError = mutation.isError ? mutation.error : undefined;
  const detailFailed = detail.isError;
  const audienceDenied = apiErrorCode(detail.error) === 'ENVELOPE_NOT_ELIGIBLE'
    || apiErrorCode(claimError) === 'ENVELOPE_NOT_ELIGIBLE';
  const claimRequirementsNotMet = [detail.error, claimError]
    .some((error) => CLAIM_REQUIREMENT_ERROR_CODES.has(apiErrorCode(error) ?? ''));
  const envelopeClosed = Boolean(detail.data && (detail.data.status !== 'ACTIVE' || detail.data.remainingSlots <= 0));

  // Anything already settled for this viewer (their own claim, a read-only
  // history row, a finished envelope) opens straight into the detail view.
  useEffect(() => {
    if (phase === 'sealed' && !mutation.isPending && (myClaim || viewOnly || envelopeClosed)) setPhase('done');
  }, [phase, myClaim, viewOnly, envelopeClosed, mutation.isPending]);

  const canTapToClaim = phase === 'sealed' && !viewOnly && !envelopeClosed && !myClaim && !audienceDenied;

  const openEnvelope = () => {
    if (!canTapToClaim || mutation.isPending) return;
    haptic('medium');
    mutation.reset();
    setAnimDone(false);
    setPhase('opening');
    mutation.mutate();
    window.setTimeout(() => setAnimDone(true), OPEN_ANIMATION_MS);
  };

  // The reveal waits for both the flap animation and the server answer. A
  // retryable failure rewinds to the sealed state instead of showing a dead
  // envelope the user has to close and reopen.
  useEffect(() => {
    if (phase !== 'opening' || !animDone || mutation.isPending) return;
    if (mutation.isError && !isTerminalEnvelopeError(mutation.error)) { setPhase('sealed'); return; }
    setPhase('done');
  }, [phase, animDone, mutation.isPending, mutation.isError, mutation.error]);

  const claimed = mutation.data?.claim?.amountMinor ?? myClaim?.amountMinor;
  const retryableClaimError = Boolean(claimError) && !isTerminalEnvelopeError(claimError);
  const claimErrorMessage = claimError ? apiErrorMessage(t, claimError) : undefined;
  const detailErrorMessage = detailFailed ? apiErrorMessage(t, detail.error) : undefined;

  const senderName = detail.data?.sender.firstName?.trim();
  const senderTitle = senderName ? t('redEnvelopeFrom', { name: senderName }) : t('redEnvelopeGeneric');
  const claims = detail.data?.claims ?? [];
  const claimedCount = detail.data ? detail.data.totalSlots - detail.data.remainingSlots : claims.length;
  const statusLabel = detail.data?.status === 'ACTIVE' ? t('envelopeStatusActive')
    : detail.data?.status === 'COMPLETED' ? t('envelopeStatusCompleted')
      : detail.data?.status === 'EXPIRED' ? t('envelopeStatusExpired')
        : detail.data?.status === 'REFUNDED' ? t('envelopeStatusRefunded')
          : detail.isLoading ? t('loadingEnvelope') : t('envelopeLoadFailed');
  const modeLabel = detail.data?.mode === 'EQUAL' ? t('modeEqual') : detail.data?.mode === 'RANDOM' ? t('modeRandom') : undefined;
  const summaryLine = detail.data
    ? `${t('claimsProgress', { claimed: claimedCount, total: detail.data.totalSlots })} · ${statusLabel}`
    : detail.isLoading ? t('loadingEnvelope') : (detailErrorMessage ?? t('envelopeDetailsUnavailable'));
  const revealText = claimErrorMessage ?? summaryLine;

  return <div className="hongbao-overlay" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="hb-topbar">
      <button className="hb-back" onClick={() => { haptic(); onClose(); }} aria-label={t('back')}>‹</button>
      <span className="hb-topbar-title">{senderTitle}</span>
      <button className="hb-close" onClick={() => { haptic(); onClose(); }} aria-label={t('close')}>×</button>
    </header>

    <div className="hb-scroll">
      <div className="hb-sender">
        <span className="hb-sender-avatar">{(senderName ?? '🧧').slice(0, 1).toUpperCase()}</span>
        <strong>{senderTitle}</strong>
        <p className="hb-blessing" lang="zh">{t('blessing')}</p>
      </div>

      <div
        className={`hb-envelope phase-${phase}`}
        onClick={canTapToClaim ? openEnvelope : undefined}
        role={canTapToClaim ? 'button' : undefined}
        tabIndex={canTapToClaim ? 0 : undefined}
        onKeyDown={(event) => { if (canTapToClaim && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openEnvelope(); } }}
      >
        <div className="hb-body">
          <div className="hb-reveal">
            {phase === 'done' && claimed && <>
              <span className="hb-reveal-label">{t('claimAdded')}</span>
              <div className="hb-amount">+{formatMinor(claimed)} <small>USDT</small></div>
            </>}
            {phase === 'done' && !claimed && <div className="hb-missed">{revealText}</div>}
          </div>
          <div className="hb-flap">
            <div className="hb-flap-shape" />
            {canTapToClaim && <button type="button" className="hb-seal" onClick={(event) => { event.stopPropagation(); openEnvelope(); }} aria-label={t('tapToOpen')}><span lang="zh">福</span></button>}
          </div>
          {phase === 'opening' && <div className="hb-coins" aria-hidden="true">{Array.from({ length: 9 }).map((_, index) => <span key={index} />)}</div>}
        </div>
      </div>

      {!audienceDenied && <p className="hb-hint" aria-live="polite">
        {phase === 'sealed' && (retryableClaimError ? t('envelopeTapAgain') : t('tapToOpen'))}
        {phase === 'opening' && t('claimOpening')}
        {phase === 'done' && claimed && t('blessing')}
        {phase === 'done' && !claimed && t('envelopeHistoryHint')}
      </p>}

      {(audienceDenied || retryableClaimError || detailFailed) && <div className="hb-error" role="alert">
        <strong>{audienceDenied ? t('claimNotEligibleTitle') : claimRequirementsNotMet ? t('claimRequirementsTitle') : retryableClaimError ? t('claimFailedTitle') : t('envelopeLoadFailed')}</strong>
        <span>{audienceDenied
          ? (apiErrorCode(detail.error) === 'ENVELOPE_NOT_ELIGIBLE' ? detailErrorMessage : claimErrorMessage)
          : retryableClaimError ? claimErrorMessage : detailErrorMessage}</span>
        {detailFailed && !audienceDenied && <button type="button" className="hb-inline-button" onClick={() => { haptic(); void detail.refetch(); }}>{t('retry')}</button>}
      </div>}

      {detail.data && <div className="hb-meta">
        <div><span>{t('envelopeTotalLabel')}</span><strong>{formatMinor(detail.data.totalMinor)} USDT</strong></div>
        <div><span>{t('sharesClaimedLabel')}</span><strong>{t('claimsProgress', { claimed: claimedCount, total: detail.data.totalSlots })}</strong></div>
        {modeLabel && <div><span>{t('distributionLabel')}</span><strong>{modeLabel}</strong></div>}
        <div><span>{t('envelopeStatusHeading')}</span><strong>{statusLabel}</strong></div>
        {myClaim && <div><span>{t('yourShareLabel')}</span><strong className="credit-text">+{formatMinor(myClaim.amountMinor)} USDT</strong></div>}
        <div><span>{detail.data.status === 'ACTIVE' ? t('expiresAtLabel') : t('expiredAtLabel')}</span><strong>{formatDateTime(detail.data.expiresAt)}</strong></div>
      </div>}

      {claims.length > 0 && <div className="hb-claims">
        <div className="hb-claims-title">{t('claimDetails')} · {claims.length}/{detail.data?.totalSlots ?? claims.length}</div>
        {claims.map((claim) => <div className="hb-claim" key={claim.id}>
          <span className="hb-claim-avatar">{(claim.user.firstName || '?').slice(0, 1).toUpperCase()}</span>
          <span className="hb-claim-name">{claim.user.firstName}{claim.mine && <em>{t('youLabel')}</em>}</span>
          <small className="hb-claim-time">{formatClock(claim.claimedAt)}</small>
          <span className="hb-claim-amount">{formatMinor(claim.amountMinor)}</span>
        </div>)}
      </div>}

      {onShowLedgerDetails && <button type="button" className="hb-details-link" onClick={() => { haptic(); onShowLedgerDetails(); }}>{t('transactionDetails')} ›</button>}
    </div>

    <footer className="hb-footer">
      {(retryableClaimError || (canTapToClaim && phase === 'sealed')) && <button
        type="button"
        className="hb-retry"
        disabled={mutation.isPending}
        onClick={openEnvelope}
      >{retryableClaimError ? t('tryAgain') : t('openEnvelopeAction')}</button>}
      <button type="button" className="hb-done" onClick={() => { haptic(); onClose(); }}>{t('done')}</button>
    </footer>
  </div>;
}
