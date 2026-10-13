import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { haptic } from '../telegram';
import { useT } from '../i18n';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

type Group = { id: string; chatId: string; title?: string; username?: string; enabled: boolean };

export function DeFiScreen() {
  const t = useT();
  const client = useQueryClient();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<Group[]>('/api/groups'), retry: false });
  const [total, setTotal] = useState('10');
  const [count, setCount] = useState('5');
  const [groupId, setGroupId] = useState('');
  const [mode, setMode] = useState<'RANDOM' | 'EQUAL'>('RANDOM');
  const [message, setMessage] = useState('');
  const mutation = useMutation({
    mutationFn: () => api<{ envelope: { id: string } }>('/api/envelopes', {
      method: 'POST',
      body: JSON.stringify({ total, count: Number(count), groupId, mode, expiresInMinutes: 1440 })
    }),
    onSuccess: (data) => {
      setMessage(t('envelopePosted', { id: data.envelope.id.slice(0, 8) }));
      void client.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : t('envelopeFailed'))
  });

  const submit = () => {
    haptic('medium');
    setMessage('');
    if (!groupId) {
      setMessage(t('selectGroupFirst'));
      return;
    }
    mutation.mutate();
  };

  return <main className="screen">
    <header className="topbar"><div><p className="eyebrow">{t('defiEyebrow')}</p><h1>{t('defiTitle')}</h1></div><div className="topbar-actions"><LanguageSwitcher /><span className="round-symbol">◈</span></div></header>
    <section className="feature-banner"><div className="banner-orb">🧧</div><div><span className="eyebrow">{t('defiBannerEyebrow')}</span><h2>{t('defiBannerTitle')}</h2><p>{t('defiBannerText')}</p></div></section>
    <section className="section create-card">
      <div className="section-heading"><div><h2>{t('createEnvelope')}</h2><p className="muted">{t('createEnvelopeHint')}</p></div><span className="status-pill">{mode}</span></div>
      <label className="field-label">{t('telegramGroup')}<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">{t('selectGroup')}</option>{groups.data?.map((group) => <option key={group.id} value={group.chatId}>{group.title ?? group.username ?? group.chatId}</option>)}</select></label>
      {!groups.isLoading && !groups.data?.length && <div className="warning-box"><span>!</span><p>{t('noGroups')}</p></div>}
      <div className="inline-fields"><label className="field-label">{t('totalUsdt')}<input inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} /></label><label className="field-label">{t('claims')}<input inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value.replace(/\D/g, ''))} /></label></div>
      <label className="field-label">{t('distribution')}<select value={mode} onChange={(event) => setMode(event.target.value as 'RANDOM' | 'EQUAL')}><option value="RANDOM">{t('randomShares')}</option><option value="EQUAL">{t('equalShares')}</option></select></label>
      <button className="primary-button" disabled={mutation.isPending || groups.isLoading} onClick={submit}>{mutation.isPending ? t('fundingPosting') : t('postEnvelope')}</button>
      {message && <div className={message === t('envelopePosted', { id: message.match(/[0-9a-f]{8}/)?.[0] ?? '' }) ? 'success-box' : 'error-box'}>{message}</div>}
    </section>
    <section className="section"><div className="section-heading"><h2>{t('howClaimsWork')}</h2><span className="muted">{t('ledgerVerified')}</span></div><div className="claim-history"><div className="history-item"><span className="history-icon">🧧</span><div><strong>{t('claimsWorkTitle')}</strong><small>{t('claimsWorkText')}</small></div><span className="muted">1×</span></div></div></section>
  </main>;
}
