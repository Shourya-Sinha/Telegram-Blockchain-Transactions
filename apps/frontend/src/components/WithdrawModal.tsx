import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { api } from '../api';
import { haptic, successHaptic } from '../telegram';

export function WithdrawModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');
  const client = useQueryClient();
  const fee = 1;
  const total = useMemo(() => amount && Number.isFinite(Number(amount)) ? (Number(amount) + fee).toFixed(2) : '0.00', [amount]);
  const mutation = useMutation({ mutationFn: () => api('/api/withdrawals', { method: 'POST', body: JSON.stringify({ amount, toAddress: address, idempotencyKey: crypto.randomUUID() }) }), onSuccess: () => { successHaptic(); void client.invalidateQueries({ queryKey: ['me'] }); setMessage('Withdrawal queued securely. You can follow its status in activity.'); }, onError: (error) => setMessage(error instanceof Error ? error.message : 'Unable to submit withdrawal.') });
  const submit = () => { haptic('medium'); setMessage(''); if (!amount || Number(amount) < 20) { setMessage('Minimum withdrawal is 20 USDT.'); return; } if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) { setMessage('Enter a valid TRON address.'); return; } mutation.mutate(); };
  useEffect(() => { const main = window.Telegram?.WebApp.MainButton; if (!main) return; main.setText('Confirm withdrawal'); main.show(); main.enable(); main.onClick(submit); return () => { main.offClick(submit); main.hide(); }; });
  return <Modal title="Withdraw USDT" onClose={onClose}>
    <div className="form-stack">
      <label className="field-label">Amount <span>USDT</span><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))} /></label>
      <label className="field-label">TRC20 destination address<input placeholder="T..." value={address} onChange={(event) => setAddress(event.target.value.trim())} /></label>
      <div className="fee-card"><div><span>Network fee</span><strong>{fee.toFixed(2)} USDT</strong></div><div><span>You will receive</span><strong className="green">{amount ? Math.max(0, Number(amount)).toFixed(2) : '0.00'} USDT</strong></div><div className="fee-total"><span>Total deducted</span><strong>{total} USDT</strong></div></div>
      {message && <div className={message.startsWith('Withdrawal') ? 'success-box' : 'error-box'}>{message}</div>}
      <button className="primary-button" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? 'Submitting…' : 'Confirm withdrawal'}</button>
      <p className="muted center small">Withdrawals below 50 USDT are processed automatically. Larger requests may require finance approval.</p>
    </div>
  </Modal>;
}
