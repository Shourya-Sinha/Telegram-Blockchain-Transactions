import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { haptic } from '../telegram';
import { apiErrorMessage, useT } from '../i18n';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

type Group = { id: string; chatId: string; title?: string; username?: string; enabled: boolean };
type GameType = 'STANDARD' | 'MINE';
const MINE_COUNTS = [5, 6, 9] as const;

export function DeFiScreen() {
  const t = useT();
  const client = useQueryClient();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<Group[]>('/api/groups'), retry: false });
  const [total, setTotal] = useState('10');
  const [count, setCount] = useState('5');
  const [groupId, setGroupId] = useState('');
  const [mode, setMode] = useState<'RANDOM' | 'EQUAL'>('RANDOM');
  const [gameType, setGameType] = useState<GameType>('STANDARD');
  const [mineDigit, setMineDigit] = useState(0);
  const [expiresInMinutes, setExpiresInMinutes] = useState(1440);
  const [message, setMessage] = useState('');
  const [messageIsSuccess, setMessageIsSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api<{ envelope: { id: string } }>('/api/envelopes', {
      method: 'POST',
      body: JSON.stringify({
        total,
        count: Number(count),
        groupId,
        mode: gameType === 'MINE' ? 'RANDOM' : mode,
        gameType,
        ...(gameType === 'MINE' ? { mineDigit } : {}),
        expiresInMinutes
      })
    }),
    onSuccess: (data) => {
      setMessage(t('envelopePosted', { id: data.envelope.id.slice(0, 8) }));
      setMessageIsSuccess(true);
      void client.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) => {
      setMessage(apiErrorMessage(t, error));
      setMessageIsSuccess(false);
    }
  });

  const submit = () => {
    haptic('medium');
    setMessage('');
    setMessageIsSuccess(false);
    if (!groupId) {
      setMessage(t('selectGroupFirst'));
      return;
    }
    if (gameType === 'MINE') {
      const normalizedTotal = total.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(normalizedTotal)) {
        setMessage(t('mineAmountPrecisionError'));
        return;
      }
      if (Number(normalizedTotal) < Number(count) / 100) {
        setMessage(t('mineAmountMinimumError'));
        return;
      }
    }
    mutation.mutate();
  };

  const setType = (next: GameType) => {
    setGameType(next);
    if (next === 'MINE') {
      if (!MINE_COUNTS.includes(Number(count) as (typeof MINE_COUNTS)[number])) setCount('5');
      setMode('RANDOM');
    }
  };

  return <main className="screen">
    <header className="topbar"><div><p className="eyebrow">{t('defiEyebrow')}</p><h1>{t('defiTitle')}</h1></div><div className="topbar-actions"><LanguageSwitcher /><span className="round-symbol">◈</span></div></header>
    <section className="feature-banner"><div className="banner-orb">🧧</div><div><span className="eyebrow">{t('defiBannerEyebrow')}</span><h2>{t('defiBannerTitle')}</h2><p>{t('defiBannerText')}</p></div></section>

    <section className="section create-card">
      <div className="section-heading"><div><h2>{t('createEnvelope')}</h2><p className="muted">{t('createEnvelopeHint')}</p></div><span className="status-pill">{gameType === 'MINE' ? t('mineMode') : t('standardMode')}</span></div>
      <label className="field-label">{t('telegramGroup')}<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">{t('selectGroup')}</option>{groups.data?.map((group) => <option key={group.id} value={group.chatId}>{group.title ?? group.username ?? group.chatId}</option>)}</select></label>
      {!groups.isLoading && !groups.data?.length && <div className="warning-box"><span>!</span><p>{t('noGroups')}</p></div>}

      <label className="field-label">{t('envelopeMode')}<select value={gameType} onChange={(event) => setType(event.target.value as GameType)}><option value="STANDARD">{t('standardMode')}</option><option value="MINE">{t('mineMode')}</option></select></label>
      <div className="inline-fields"><label className="field-label">{t('totalUsdt')}<input type="number" min="0" inputMode="decimal" step={gameType === 'MINE' ? '0.01' : '0.000001'} value={total} onChange={(event) => setTotal(event.target.value)} /></label>
        <label className="field-label">{t('claims')}{gameType === 'MINE' ? <select value={count} onChange={(event) => setCount(event.target.value)}>{MINE_COUNTS.map((slots) => <option key={slots} value={slots}>{slots}</option>)}</select> : <input inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value.replace(/\D/g, ''))} />}</label>
      </div>
      {gameType === 'MINE' ? <>
        <label className="field-label">{t('mineTargetDigit')}<select value={mineDigit} onChange={(event) => setMineDigit(Number(event.target.value))}>{Array.from({ length: 10 }, (_, digit) => <option key={digit} value={digit}>{digit}</option>)}</select></label>
        <p className="muted">{t('mineAmountPrecisionHint')}</p>
      </> : <label className="field-label">{t('distribution')}<select value={mode} onChange={(event) => setMode(event.target.value as 'RANDOM' | 'EQUAL')}><option value="RANDOM">{t('randomShares')}</option><option value="EQUAL">{t('equalShares')}</option></select></label>}

      <label className="field-label">{t('envelopeExpiry')}<select value={expiresInMinutes} onChange={(event) => setExpiresInMinutes(Number(event.target.value))}><option value={60}>{t('expiryOneHour')}</option><option value={1440}>{t('expiryOneDay')}</option><option value={10080}>{t('expirySevenDays')}</option></select></label>
      <button className="primary-button" disabled={mutation.isPending || groups.isLoading} onClick={submit}>{mutation.isPending ? t('fundingPosting') : t('postEnvelope')}</button>
      {message && <div className={messageIsSuccess ? 'success-box' : 'error-box'} role={messageIsSuccess ? 'status' : 'alert'}>{message}</div>}
    </section>

    <section className="section rules-card" aria-labelledby="how-to-play-title">
      <div className="section-heading"><div><h2 id="how-to-play-title">{t('howToPlayTitle')}</h2><p className="muted">{t('howToPlayNetwork')}</p></div><span className="status-pill gold-pill">{t('reviewRequiredBadge')}</span></div>
      <p className="how-to-play-intro">{t('howToPlayIntro')}</p>
      <ol className="how-to-play-list">
        <li><strong>{t('howToPlayStep1Title')}</strong><p>{t('howToPlayStep1Text')}</p></li>
        <li><strong>{t('howToPlayStep2Title')}</strong><p>{t('howToPlayStep2Text')}</p></li>
        <li className="how-to-play-critical"><strong>{t('howToPlayStep3Title')}</strong><p>{t('howToPlayStep3Text')}</p></li>
        <li><strong>{t('howToPlayStep4Title')}</strong><p>{t('howToPlayStep4Text')}</p></li>
      </ol>
      <div className="rules-compliance">{t('howToPlayCompliance')}</div>
    </section>

    <section className="section"><div className="section-heading"><h2>{t('howClaimsWork')}</h2><span className="muted">{t('ledgerVerified')}</span></div><div className="claim-history"><div className="history-item"><span className="history-icon">🧧</span><div><strong>{t('claimsWorkTitle')}</strong><small>{t('claimsWorkText')}</small></div><span className="muted">1×</span></div></div></section>
  </main>;
}
