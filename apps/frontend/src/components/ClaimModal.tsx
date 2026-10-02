import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { api } from '../api';
import { successHaptic } from '../telegram';
import { useT } from '../i18n';

function formatMinor(value: string | bigint | undefined): string { if (!value) return '0.00'; const n = BigInt(value); return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`; }
export function ClaimModal({ envelopeId, onClose }: { envelopeId: string; onClose: () => void }) {
  const t = useT();
  const [phase, setPhase] = useState<'closed' | 'opening' | 'done'>('closed');
  const [amount, setAmount] = useState<string>();
  const [message, setMessage] = useState('');
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api<{ kind: string; claim?: { amountMinor: string }}>(`/api/envelopes/${envelopeId}/claim`, { method: 'POST' }),
    onSuccess: (result) => {
      setPhase('done');
      if (result.kind === 'claimed') {
        setAmount(result.claim?.amountMinor);
        successHaptic();
        void client.invalidateQueries({ queryKey: ['me'] });
        void client.invalidateQueries({ queryKey: ['ledger'] });
      } else {
        setMessage(t('envelopeGone'));
      }
    },
    onError: (error) => { setPhase('done'); setMessage(error instanceof Error ? error.message : t('claimInTelegram')); }
  });
  useEffect(() => { setPhase('opening'); const timer = setTimeout(() => mutation.mutate(), 850); return () => clearTimeout(timer); }, []);
  return <Modal title={t('claimTitle')} onClose={onClose}><div className="claim-content"><div className={phase === 'opening' ? 'envelope-art opening' : 'envelope-art'}><div className="envelope-flap">✦</div><div className="envelope-body">🧧</div></div>{phase !== 'done' && <><h3 className="claim-title">{t('claimOpening')}</h3><p className="muted">{t('claimOpeningHint')}</p></>}{phase === 'done' && amount && <><div className="claim-amount">+{formatMinor(amount)} <span>USDT</span></div><p className="muted">{t('claimAdded')}</p></>}{phase === 'done' && !amount && message && <div className="error-box">{message}</div>}<button className="secondary-button" onClick={onClose}>{t('done')}</button></div></Modal>;
}
