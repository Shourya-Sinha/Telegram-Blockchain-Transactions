import { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Modal } from './Modal';
import { api } from '../api';
import { haptic } from '../telegram';
import { useT } from '../i18n';

export function DepositModal({ address, confirmations, onClose }: { address?: string; confirmations: number; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const value = address ?? '';
  const copy = async () => { haptic(); if (value) await navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); };
  return <Modal title={t('depositTitle')} onClose={onClose}>
    <div className="deposit-content">
      <div className="qr-wrap">{value ? <QRCodeCanvas value={value} size={164} bgColor="#ffffff" fgColor="#0a1220" includeMargin /> : <div className="qr-empty">{t('addressUnavailable')}</div>}</div>
      <p className="muted center">{t('depositHint', { confirmations })}</p>
      <div className="address-box"><span>{value || t('configureDepositAddress')}</span><button onClick={copy}>{copied ? t('copied') : t('copy')}</button></div>
      <div className="warning-box"><span>!</span><p>{t('depositWarning')}</p></div>
    </div>
  </Modal>;
}

export function useDepositAddress() {
  return async () => api<{ address: string; confirmations: number }>('/api/deposit/address');
}
