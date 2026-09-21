import { useEffect, useState } from 'react';
import api, { errMsg } from '../api/client';
import { statusBadge, anchorBadge } from '../components/Layout';
import { useSocketEvent } from '../realtime/socket';

const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—');

export default function Explorer() {
  const [stats, setStats] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [open, setOpen] = useState({}); // blockNumber -> {block, txs}

  const load = () => {
    api.get('/blocks/explorer/stats').then(({ data }) => setStats(data)).catch(() => {});
    api.get('/blocks?limit=10').then(({ data }) => setBlocks(data.items || [])).catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  // ---- Realtime: new blocks stream in, stats tick live ----
  useSocketEvent('hello', () => setLive(true));
  useSocketEvent('block:mined', (b) => {
    setLive(true);
    setBlocks((prev) => {
      if (prev.some((x) => x.number === b.number)) return prev;
      return [{ number: b.number, hash: b.hash, txCount: b.txCount, timestamp: b.timestamp, anchor: { status: 'none' } }, ...prev].slice(0, 10);
    });
  });
  useSocketEvent('chain:tick', (t) => {
    setLive(true);
    setStats((s) => (s ? { ...s, height: t.height, mempool: t.mempool } : s));
  });
  useSocketEvent('anchor:confirmed', ({ block, evmTxHash, chainId }) => {
    const patch = (b) => (b.number === block ? { ...b, anchor: { ...(b.anchor || {}), status: 'confirmed', evmTxHash, evmChainId: chainId } } : b);
    setBlocks((prev) => prev.map(patch));
    setOpen((prev) => (prev[block] ? { ...prev, [block]: { ...prev[block], block: patch(prev[block].block) } } : prev));
  });

  const search = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    try {
      const { data } = await api.get('/blocks/search', { params: { q } });
      setResult(data);
    } catch (err) {
      setError(errMsg(err, 'Not found'));
    }
  };

  const toggleBlock = async (n) => {
    if (open[n]) {
      const c = { ...open };
      delete c[n];
      setOpen(c);
      return;
    }
    const { data } = await api.get(`/blocks/${n}`);
    setOpen({ ...open, [n]: data });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-black">🔍 Block explorer</h1>
        <span className={`badge ${live ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${live ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
          {live ? 'LIVE' : 'connecting…'}
        </span>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            ['Height', stats.height],
            ['Blocks', stats.blocks],
            ['Txs', stats.transactions],
            ['Volume', `${Number(stats.volume).toLocaleString()} ${stats.symbol}`],
            ['Mempool', stats.mempool],
          ].map(([k, v]) => (
            <div key={k} className="card text-center !p-3">
              <p className="font-black text-violet-300">{v}</p>
              <p className="text-[11px] text-slate-400">{k}</p>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={search} className="flex gap-2">
        <input className="input" placeholder="Search tx hash / address / block number…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary whitespace-nowrap">Search</button>
      </form>
      {error && <p className="text-sm text-rose-400">{error}</p>}

      {result && (
        <div className="card space-y-2">
          <p className="badge bg-violet-500/15 text-violet-300">{result.type}</p>
          {result.type === 'transaction' && <TxRow tx={result.tx} />}
          {result.type === 'block' && (
            <div className="space-y-2">
              <BlockRow b={result.block} onToggle={() => toggleBlock(result.block.number)} />
              {anchorBadge(result.block)}
            </div>
          )}
          {result.type === 'address' && (
            <div>
              <p className="mono text-sm break-all">{q}</p>
              <p className="text-sm text-slate-400">Balance: {result.wallet?.balance ?? '— (external)'} {stats?.symbol}</p>
              <div className="mt-2 space-y-2">{(result.txs || []).map((t) => <TxRow key={t.hash} tx={t} />)}</div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="font-bold mb-3">Latest blocks <span className="text-xs font-normal text-slate-500">(streaming live)</span></h2>
        <div className="space-y-2">
          {blocks.map((b) => (
            <div key={b.number} className="bg-slate-800/60 rounded-xl p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-[200px]"><BlockRow b={b} onToggle={() => toggleBlock(b.number)} /></div>
                {anchorBadge(b)}
              </div>
              {open[b.number] && (
                <div className="mt-2 space-y-2 border-t border-slate-700 pt-2">
                  {(open[b.number].txs || []).map((t) => <TxRow key={t.hash} tx={t} />)}
                  {!open[b.number].txs?.length && <p className="text-xs text-slate-500">Empty block</p>}
                </div>
              )}
            </div>
          ))}
          {!blocks.length && <p className="text-sm text-slate-500">No blocks yet.</p>}
        </div>
      </div>
    </div>
  );
}

function BlockRow({ b, onToggle }) {
  return (
    <button onClick={onToggle} className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="font-black text-violet-300">#{b.number}</span>
      <span className="mono text-slate-400">{short(b.hash)}</span>
      <span className="text-slate-300">{b.txCount} txs</span>
      <span className="text-slate-500 text-xs ml-auto">{new Date(b.timestamp).toLocaleString()}</span>
    </button>
  );
}

export function TxRow({ tx }) {
  if (!tx) return null;
  return (
    <div className="bg-slate-800/60 rounded-xl p-3 text-sm space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-violet-300">{short(tx.hash)}</span>
        {statusBadge(tx.status)}
        <span className="badge bg-slate-500/15 text-slate-300">{tx.type}</span>
        {tx.blockNumber !== null && tx.blockNumber !== undefined && <span className="text-xs text-slate-500">block #{tx.blockNumber}</span>}
        <span className="ml-auto font-bold">{tx.amount} <span className="text-xs font-normal text-slate-400">+ fee {tx.fee}</span></span>
      </div>
      <p className="text-xs text-slate-400 mono break-all">from {tx.fromAddress} → to {tx.toAddress}</p>
      {tx.failureReason && <p className="text-xs text-rose-400">⚠ {tx.failureReason}</p>}
      {tx.note && <p className="text-xs text-slate-500">📝 {tx.note}</p>}
    </div>
  );
}
