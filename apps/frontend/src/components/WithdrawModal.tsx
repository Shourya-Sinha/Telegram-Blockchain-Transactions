import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { api, type MeResponse } from '../api';
import { haptic, successHaptic } from '../telegram';
import { useT } from '../i18n';

function formatMinor(value: string | undefined): string { if (!value) return '0'; const n = BigInt(value); return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`; }

export function WithdrawModal({ me, onClose }: { me: MeResponse; onClose: () => void }) {
  const t = useT();
  const testMode = me.withdrawalMode === 'test';
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState(me.testWithdrawalAddress ?? '');
  const [message, setMessage] = useState('');
  const client = useQueryClient();
  const fee = me.withdrawalFeeMinor ? Number(formatMinor(me.withdrawalFeeMinor)) : 1;
  const minimum = me.withdrawalMinMinor ? Number(formatMinor(me.withdrawalMinMinor)) : 20;
  const total = useMemo(() => amount && Number.isFinite(Number(amount)) ? (Number(amount) + fee).toFixed(2) : '0.00', [amount, fee]);
  const mutation = useMutation({
    mutationFn: () => api('/api/withdrawals', { method: 'POST', body: JSON.stringify({ amount, toAddress: address, idempotencyKey: crypto.randomUUID() }) }),
    onSuccess: () => {
      successHaptic();
      void client.invalidateQueries({ queryKey: ['me'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
      void client.invalidateQueries({ queryKey: ['withdrawals'] });
      setMessage(testMode ? t('testWithdrawSuccess') : t('withdrawSuccess'));
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : t('envelopeFailed'))
  });
  const submit = () => {
    haptic('medium');
    setMessage('');
    if (!amount || Number(amount) < minimum) { setMessage(t('minWithdrawalError', { min: minimum })); return; }
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) { setMessage(t('invalidAddressError')); return; }
    mutation.mutate();
  };
  useEffect(() => { const main = window.Telegram?.WebApp.MainButton; if (!main) return; main.setText(testMode ? t('confirmTestWithdrawal') : t('confirmWithdrawal')); main.show(); main.enable(); main.onClick(submit); return () => { main.offClick(submit); main.hide(); }; });
  return <Modal title={testMode ? t('withdrawTestTitle') : t('withdrawTitle')} onClose={onClose}>
    <div className="form-stack">
      {testMode && <div className="warning-box"><p>{t('testCurrencyWarning')}</p></div>}
      <label className="field-label">{t('amount')} <span>USDT</span><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))} /></label>
      <label className="field-label">{testMode ? t('requiredTestAddress') : t('destinationAddress')}
        <input placeholder="T..." value={address} readOnly={testMode} onChange={(event) => setAddress(event.target.value.trim())} />
      </label>
      <div className="fee-card"><div><span>{t('networkFee')}</span><strong>{fee.toFixed(2)} USDT</strong></div><div><span>{t('youWillReceive')}</span><strong className="green">{amount ? Math.max(0, Number(amount)).toFixed(2) : '0.00'} USDT</strong></div><div className="fee-total"><span>{t('totalDeducted')}</span><strong>{total} USDT</strong></div></div>
      {message && <div className={message === t('testWithdrawSuccess') || message === t('withdrawSuccess') ? 'success-box' : 'error-box'}>{message}</div>}
      <button className="primary-button" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? t('submitting') : testMode ? t('confirmTestWithdrawal') : t('confirmWithdrawal')}</button>
      <p className="muted center small">{testMode ? t('testWithdrawNote') : t('autoApprovalNote')}</p>
    </div>
  </Modal>;
}
