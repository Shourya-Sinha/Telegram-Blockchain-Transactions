import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { api } from '../api';
import { successHaptic } from '../telegram';

function formatMinor(value: string | bigint | undefined): string { if (!value) return '0.00'; const n = BigInt(value); return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`; }
export function ClaimModal({ envelopeId, onClose }: { envelopeId: string; onClose: () => void }) {
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
        setMessage('This envelope is no longer available.');
      }
    },
    onError: (error) => { setPhase('done'); setMessage(error instanceof Error ? error.message : 'Open the wallet inside Telegram to claim.'); }
  });
  useEffect(() => { setPhase('opening'); const timer = setTimeout(() => mutation.mutate(), 850); return () => clearTimeout(timer); }, []);
  return <Modal title="A little luck for you" onClose={onClose}><div className="claim-content"><div className={phase === 'opening' ? 'envelope-art opening' : 'envelope-art'}><div className="envelope-flap">✦</div><div className="envelope-body">🧧</div></div>{phase !== 'done' && <><h3 className="claim-title">Opening your envelope…</h3><p className="muted">The amount is selected fairly and recorded atomically.</p></>}{phase === 'done' && amount && <><div className="claim-amount">+{formatMinor(amount)} <span>USDT</span></div><p className="muted">Added to your available wallet balance.</p></>}{phase === 'done' && !amount && message && <div className="error-box">{message}</div>}<button className="secondary-button" onClick={onClose}>Done</button></div></Modal>;
}
