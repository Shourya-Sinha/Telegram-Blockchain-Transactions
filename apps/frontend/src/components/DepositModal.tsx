import { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Modal } from './Modal';
import { api } from '../api';
import { haptic } from '../telegram';

export function DepositModal({ address, confirmations, onClose }: { address?: string; confirmations: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const value = address ?? '';
  const copy = async () => { haptic(); if (value) await navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); };
  return <Modal title="Deposit USDT" onClose={onClose}>
    <div className="deposit-content">
      <div className="qr-wrap">{value ? <QRCodeCanvas value={value} size={164} bgColor="#ffffff" fgColor="#0a1220" includeMargin /> : <div className="qr-empty">Address unavailable</div>}</div>
      <p className="muted center">Only send USDT using the TRC20 network. Deposits need {confirmations} confirmations.</p>
      <div className="address-box"><span>{value || 'Configure a deposit address'}</span><button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
      <div className="warning-box"><span>!</span><p>Sending another token or network may result in permanent loss. Double-check the address before sending.</p></div>
    </div>
  </Modal>;
}

export function useDepositAddress() {
  return async () => api<{ address: string; confirmations: number }>('/api/deposit/address');
}
