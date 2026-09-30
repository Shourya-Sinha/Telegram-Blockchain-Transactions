import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { haptic } from '../telegram';

type Group = { id: string; chatId: string; title?: string; username?: string; enabled: boolean };

export function DeFiScreen() {
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
      setMessage(`Envelope ${data.envelope.id.slice(0, 8)} was posted in the Telegram group.`);
      void client.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Unable to create envelope.')
  });

  const submit = () => {
    haptic('medium');
    setMessage('');
    if (!groupId) {
      setMessage('Select the Telegram group where the bot should post the claim button.');
      return;
    }
    mutation.mutate();
  };

  return <main className="screen">
    <header className="topbar"><div><p className="eyebrow">COMMUNITY FINANCE</p><h1>DeFi & Red Envelopes</h1></div><span className="round-symbol">◈</span></header>
    <section className="feature-banner"><div className="banner-orb">🧧</div><div><span className="eyebrow">TELEGRAM NATIVE</span><h2>Share a little luck.</h2><p>Turn your USDT balance into a fair, instant community moment.</p></div></section>
    <section className="section create-card">
      <div className="section-heading"><div><h2>Create red envelope</h2><p className="muted">Funds are debited atomically, then the bot posts the claim button.</p></div><span className="status-pill">{mode}</span></div>
      <label className="field-label">Telegram group<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Select a registered group</option>{groups.data?.map((group) => <option key={group.id} value={group.chatId}>{group.title ?? group.username ?? group.chatId}</option>)}</select></label>
      {!groups.isLoading && !groups.data?.length && <div className="warning-box"><span>!</span><p>No groups are registered. Add the bot to a group and run /registergroup there first.</p></div>}
      <div className="inline-fields"><label className="field-label">Total USDT<input inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} /></label><label className="field-label">Claims<input inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value.replace(/\D/g, ''))} /></label></div>
      <label className="field-label">Distribution<select value={mode} onChange={(event) => setMode(event.target.value as 'RANDOM' | 'EQUAL')}><option value="RANDOM">Random shares</option><option value="EQUAL">Equal shares</option></select></label>
      <button className="primary-button" disabled={mutation.isPending || groups.isLoading} onClick={submit}>{mutation.isPending ? 'Funding and posting…' : 'Post envelope to group'}</button>
      {message && <div className={message.startsWith('Envelope') ? 'success-box' : 'error-box'}>{message}</div>}
    </section>
    <section className="section"><div className="section-heading"><h2>How claims work</h2><span className="muted">Ledger verified</span></div><div className="claim-history"><div className="history-item"><span className="history-icon">🧧</span><div><strong>Members tap the group button</strong><small>Telegram verifies their identity and one share is credited to their wallet</small></div><span className="muted">1×</span></div></div></section>
  </main>;
}
