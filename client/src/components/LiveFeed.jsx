import { useEffect, useState } from 'react';
import api from '../api/client';
import { useSocketEvent } from '../realtime/socket';

/**
 * Public live activity feed — new blocks + confirmed txs stream in
 * over WebSocket the moment the miner produces them.
 */
export default function LiveFeed({ limit = 12 }) {
  const [items, setItems] = useState([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    api.get('/blocks?limit=5')
      .then(({ data }) => {
        const seed = (data.items || []).map((b) => ({
          id: `seed-${b.number}`,
          kind: 'block',
          text: `Block #${b.number} · ${b.txCount} txs`,
          time: b.timestamp,
        }));
        setItems(seed);
      })
      .catch(() => {});
  }, []);

  const push = (item) =>
    setItems((prev) => [{ ...item, id: Math.random().toString(36).slice(2), time: new Date().toISOString() }, ...prev].slice(0, limit));

  useSocketEvent('hello', () => setLive(true));
  useSocketEvent('block:mined', (b) => {
    setLive(true);
    push({ kind: 'block', text: `Block #${b.number} · ${b.txCount} txs` });
  });
  useSocketEvent('tx:confirmed', (t) => {
    push({ kind: 'tx', text: `${t.amount} → ${t.toAddress?.slice(0, 10)}… (#${t.blockNumber})` });
  });
  useSocketEvent('announcement', (a) => push({ kind: 'mega', text: a.message?.slice(0, 80) }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-block w-2 h-2 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
        <h3 className="font-bold text-sm">{live ? 'LIVE' : 'Connecting…'} · Chain activity</h3>
      </div>
      <div className="space-y-1.5 max-h-72 overflow-auto text-xs">
        {items.map((it) => (
          <div key={it.id} className="bg-slate-800/60 rounded-lg px-2.5 py-1.5 flex items-center gap-2">
            <span>{it.kind === 'block' ? '⛏️' : it.kind === 'mega' ? '📢' : '💸'}</span>
            <span className="flex-1 break-words">{it.text}</span>
            <span className="text-slate-500 whitespace-nowrap">{new Date(it.time).toLocaleTimeString()}</span>
          </div>
        ))}
        {!items.length && <p className="text-slate-500">Waiting for chain activity…</p>}
      </div>
    </div>
  );
}
