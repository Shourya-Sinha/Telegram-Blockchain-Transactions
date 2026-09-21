import { useEffect, useRef, useState } from 'react';
import api, { errMsg, downloadCSV } from '../../api/client';
import { statusBadge } from '../../components/Layout';
import { TxRow } from '../Explorer';
import { useSocketEvent } from '../../realtime/socket';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from 'recharts';

const TABS = ['Overview', 'Live Pulse', 'Users', 'Transactions', 'Mempool', 'Settings', 'Audit'];

export default function AdminDashboard() {
  const [tab, setTab] = useState('Overview');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 4000); };
  const flashErr = (e) => setErr(errMsg(e));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black">🛠 Admin dashboard</h1>
      {msg && <p className="text-sm text-emerald-300 bg-emerald-500/10 rounded-xl px-4 py-2">{msg}</p>}
      {err && <p className="text-sm text-rose-400 bg-rose-500/10 rounded-xl px-4 py-2">{err}</p>}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-violet-600' : 'bg-slate-800 text-slate-300'}`}>{t}</button>
        ))}
      </div>
      {tab === 'Overview' && <Overview flash={flash} flashErr={flashErr} />}
      {tab === 'Live Pulse' && <LivePulse />}
      {tab === 'Users' && <Users flash={flash} flashErr={flashErr} />}
      {tab === 'Transactions' && <Transactions flash={flash} flashErr={flashErr} />}
      {tab === 'Mempool' && <Mempool flash={flash} flashErr={flashErr} />}
      {tab === 'Settings' && <SettingsTab flash={flash} flashErr={flashErr} />}
      {tab === 'Audit' && <AuditTab flashErr={flashErr} />}
    </div>
  );
}

function Overview({ flash, flashErr }) {
  const [data, setData] = useState(null);
  const [mint, setMint] = useState({ toAddress: '', amount: '' });
  const [broadcast, setBroadcast] = useState('');

  const load = () => api.get('/admin/overview').then(({ data }) => setData(data)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  useSocketEvent('chain:tick', () => load());
  useSocketEvent('presence', (p) => setData((d) => (d ? { ...d, online: p.online } : d)));

  if (!data) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          ['Users', data.users, `+${data.newUsers24h} today`],
          ['Transactions', data.transactions, `${data.last24h} last 24h`],
          ['Blocks', data.blocks, ''],
          ['Supply', Number(data.supply).toLocaleString(), ''],
          ['Online now', data.online ?? '—', 'sockets'],
        ].map(([k, v, sub]) => (
          <div key={k} className="card text-center">
            <p className="text-2xl font-black text-violet-300">{v}</p>
            <p className="text-xs text-slate-400">{k} {sub && `· ${sub}`}</p>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-bold mb-2">Transactions by status</h3>
          <div className="flex flex-wrap gap-2">
            {data.byStatus.map((s) => (
              <span key={s._id} className="text-xs bg-slate-800 rounded-lg px-2.5 py-1.5">{s._id}: <b>{s.count}</b> (vol {Number(s.volume).toFixed(1)})</span>
            ))}
          </div>
          <h3 className="font-bold mt-4 mb-2">Mempool: {data.mempool.total} waiting</h3>
          <div className="space-y-1 text-xs text-slate-400">
            {data.mempool.rows.map((r) => <p key={r._id}>{r._id}: {r.count} txs · vol {Number(r.volume).toFixed(1)}</p>)}
            {!data.mempool.rows.length && <p>Empty 🎉</p>}
          </div>
          <button className="btn-ghost mt-3 !py-1.5 text-sm" onClick={async () => { try { const { data } = await api.post('/admin/mine'); flash(`Mined: ${JSON.stringify(data.result).slice(0, 120)}`); load(); } catch (e) { flashErr(e); } }}>
            ⛏ Mine a block now
          </button>
        </div>
        <div className="card">
          <h3 className="font-bold mb-2">Activity (14 days)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.daily}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis dataKey="_id" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
              <Line type="monotone" dataKey="count" stroke="#a78bfa" strokeWidth={2} dot={false} name="txs" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <EvmCard flash={flash} flashErr={flashErr} />

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card space-y-2">
          <h3 className="font-bold">🪙 Mint tokens</h3>
          <input className="input mono" placeholder="To address 0x…" value={mint.toAddress} onChange={(e) => setMint({ ...mint, toAddress: e.target.value })} />
          <input className="input" placeholder="Amount" type="number" value={mint.amount} onChange={(e) => setMint({ ...mint, amount: e.target.value })} />
          <button className="btn-success w-full !py-2 text-sm" onClick={async () => { try { await api.post('/admin/mint', { toAddress: mint.toAddress, amount: Number(mint.amount) }); flash('Mint queued'); setMint({ toAddress: '', amount: '' }); } catch (e) { flashErr(e); } }}>Mint</button>
        </div>
        <div className="card space-y-2">
          <h3 className="font-bold">📢 Telegram broadcast</h3>
          <textarea className="input" rows={3} placeholder="Announcement to all linked users + everyone online…" value={broadcast} onChange={(e) => setBroadcast(e.target.value)} />
          <button className="btn-primary w-full !py-2 text-sm" onClick={async () => { try { const { data } = await api.post('/admin/broadcast', { message: broadcast }); flash(`Broadcast sent to ${data.sent}/${data.total} Telegram + all online`); setBroadcast(''); } catch (e) { flashErr(e); } }}>Send broadcast</button>
        </div>
      </div>
    </div>
  );
}

function EvmCard({ flash, flashErr }) {
  const [evm, setEvm] = useState(null);
  const load = () => api.get('/admin/evm').then(({ data }) => setEvm(data)).catch(() => {});
  useEffect(() => { load(); }, []);
  useSocketEvent('anchor:confirmed', () => load());

  if (!evm) return null;
  const st = evm.status || {};

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="font-bold">🔗 Sepolia anchoring</h3>
        <span className={`badge ${st.mode === 'post' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>
          {st.mode === 'post' ? '● posting' : '○ off'}
        </span>
        <button
          className="ml-auto btn-ghost !py-1 !px-2.5 text-xs"
          onClick={async () => { try { const { data } = await api.post('/admin/evm/retry'); flash(`Anchor worker: ${JSON.stringify(data).slice(0, 140)}`); load(); } catch (e) { flashErr(e); } }}
        >
          ↻ Retry pending
        </button>
      </div>
      {!st.configured ? (
        <p className="text-xs text-slate-400">
          Not configured — set <span className="mono">EVM_RPC_URL</span> + <span className="mono">EVM_SETTLEMENT_KEY</span> in server/.env,
          then enable <span className="mono">evmAnchorMode = post</span> in Settings. Every block gets a proof-of-existence tx on Sepolia.
        </p>
      ) : (
        <div className="text-xs text-slate-400 space-y-1">
          <p>Signer <span className="mono text-slate-200">{st.signerAddress}</span> · chain {st.chainId} (expect {st.expectedChainId}) · balance {st.balance ?? '…'} ETH</p>
          <p>Anchor target: <span className="mono text-slate-200">{st.anchorAddress || '(self)'}</span></p>
          {st.lastError && <p className="text-rose-400">⚠ {st.lastError}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-2 text-xs">
        {(evm.counts || []).map((c) => (
          <span key={c._id || 'none'} className="bg-slate-800 rounded-lg px-2 py-1">{c._id || 'none'}: <b>{c.count}</b></span>
        ))}
      </div>
      {(evm.recent || []).length > 0 && (
        <div className="mt-2 space-y-1 text-xs">
          {evm.recent.map((b) => (
            <p key={b.number} className="mono">
              <span className="text-slate-500">#{b.number}</span>{' '}
              <a className="text-violet-400" target="_blank" rel="noreferrer" href={`${evm.explorer}/tx/${b.anchor.evmTxHash}`}>
                {b.anchor.evmTxHash.slice(0, 18)}…
              </a>{' '}
              <span className="text-slate-500">{b.anchor.status}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function LivePulse() {
  const [hits, setHits] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [rpm, setRpm] = useState([]);
  const [online, setOnline] = useState(0);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    api.get('/admin/pulse').then(({ data }) => {
      setHits(data.hits || []);
      setRoutes(data.routes || []);
      setRpm(data.rpm || []);
      setOnline(data.online || 0);
    }).catch(() => {});
  }, []);

  useSocketEvent('pulse:hit', (h) => {
    if (pausedRef.current) return;
    setHits((prev) => [h, ...prev].slice(0, 100));
  });
  useSocketEvent('presence', (p) => setOnline(p.online));

  const shown = filter ? hits.filter((h) => `${h.method} ${h.path} ${h.user || ''} ${h.status}`.toLowerCase().includes(filter.toLowerCase())) : hits;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-emerald-500/15 text-emerald-400">
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-emerald-400 animate-pulse" /> LIVE · every API hit
        </span>
        <span className="text-xs text-slate-400">🟢 {online} online</span>
        <input className="input !w-56 !py-1.5 text-sm ml-auto" placeholder="Filter hits…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn-ghost !py-1.5 text-sm" onClick={() => setPaused(!paused)}>{paused ? '▶ Resume' : '⏸ Pause'}</button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-bold mb-2 text-sm">Requests / minute</h3>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={rpm}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#94a3b8' }} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
              <Bar dataKey="count" fill="#a78bfa" name="req/min" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3 className="font-bold mb-2 text-sm">Top routes (this session)</h3>
          <div className="space-y-1 text-xs max-h-[150px] overflow-auto">
            {routes.map((r) => (
              <p key={r.route} className="mono break-all">
                <span className="text-slate-500">{r.count}× {r.avgMs}ms</span> {r.route}{' '}
                {r.errors > 0 && <span className="text-rose-400">⚠{r.errors}</span>}
              </p>
            ))}
            {!routes.length && <p className="text-slate-500">No traffic yet — click around the app.</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-bold mb-2 text-sm">Hit stream {paused && '(paused)'}</h3>
        <div className="space-y-1 text-xs max-h-[420px] overflow-auto font-mono">
          {shown.map((h) => (
            <div key={h.id} className="bg-slate-800/60 rounded-lg px-2.5 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="text-slate-500">{new Date(h.time).toLocaleTimeString()}</span>
              <span className="text-violet-300 font-bold">{h.method}</span>
              <span className="text-slate-200 break-all">{h.path}</span>
              <span className={h.status >= 500 ? 'text-rose-400' : h.status >= 400 ? 'text-amber-400' : 'text-emerald-400'}>{h.status}</span>
              <span className="text-slate-500">{h.ms}ms</span>
              {h.user && <span className="text-sky-300">{h.user}</span>}
              {h.ip && <span className="text-slate-600 ml-auto">{h.ip}</span>}
            </div>
          ))}
          {!shown.length && <p className="text-slate-500 font-sans">No hits yet.</p>}
        </div>
      </div>
    </div>
  );
}

function Users({ flash, flashErr }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const load = () => api.get('/admin/users', { params: { search, status, limit: 30 } }).then(({ data }) => setItems(data.items || [])).catch(() => {});
  useEffect(() => { load(); }, []); // eslint-disable-line

  const update = async (id, body) => {
    try {
      await api.patch(`/admin/users/${id}`, body);
      flash('User updated');
      load();
    } catch (e) { flashErr(e); }
  };

  const exportCSV = async () => {
    try {
      const p = new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}) }).toString();
      await downloadCSV(`/admin/export/users${p ? `?${p}` : ''}`, 'tbt-users.csv');
      flash('Users CSV downloaded');
    } catch (e) { flashErr(e); }
  };

  return (
    <div className="card space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <input className="input" placeholder="Search email / name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input !w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">all statuses</option>
          <option value="active">active</option>
          <option value="frozen">frozen</option>
          <option value="banned">banned</option>
        </select>
        <button className="btn-ghost">Go</button>
        <button type="button" className="btn-ghost" onClick={exportCSV}>⬇ CSV</button>
      </form>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Balance</th><th>Daily</th><th>Actions</th></tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u._id}>
                <td><b>{u.name}</b><br /><span className="text-xs text-slate-400">{u.email}{u.telegramUsername ? ` · @${u.telegramUsername}` : ''}</span></td>
                <td><span className="badge bg-slate-500/15">{u.role}</span></td>
                <td><span className={`badge ${u.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : u.status === 'frozen' ? 'bg-amber-500/15 text-amber-400' : 'bg-rose-500/15 text-rose-400'}`}>{u.status}</span></td>
                <td>{Number(u.wallets?.balance || 0).toFixed(2)} <span className="text-xs text-slate-500">({u.wallets?.count}w)</span></td>
                <td className="text-xs">{u.dailySent}/{u.dailyLimit}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.status !== 'active' && <button className="text-xs bg-emerald-600 rounded-lg px-2 py-1" onClick={() => update(u._id, { status: 'active' })}>Activate</button>}
                    {u.status === 'active' && <button className="text-xs bg-amber-600 rounded-lg px-2 py-1" onClick={() => update(u._id, { status: 'frozen' })}>Freeze</button>}
                    <button className="text-xs bg-rose-600 rounded-lg px-2 py-1" onClick={() => { if (confirm(`Ban ${u.email}?`)) update(u._id, { status: 'banned' }); }}>Ban</button>
                    <button className="text-xs bg-slate-700 rounded-lg px-2 py-1" onClick={() => update(u._id, { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? 'Demote' : 'Promote'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Transactions({ flash, flashErr }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const load = () => api.get('/admin/transactions', { params: { status, search, limit: 20 } }).then(({ data }) => setItems(data.items || [])).catch(() => {});
  useEffect(() => { load(); }, []); // eslint-disable-line
  useSocketEvent('tx:approval_needed', () => load());
  useSocketEvent('mempool:update', () => load());

  const act = async (hash, action) => {
    try {
      await api.post(`/admin/transactions/${hash}/${action}`);
      flash(`${action} ok`);
      load();
    } catch (e) { flashErr(e); }
  };

  const exportCSV = async () => {
    try {
      const p = new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) }).toString();
      await downloadCSV(`/admin/export/transactions${p ? `?${p}` : ''}`, 'tbt-transactions.csv');
      flash('Transactions CSV downloaded');
    } catch (e) { flashErr(e); }
  };

  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <input className="input" placeholder="Search hash / address…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input !w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">all statuses</option>
          {['pending', 'queued', 'processing', 'confirming', 'confirmed', 'failed', 'cancelled', 'rejected', 'requires_approval'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-ghost">Go</button>
        <button type="button" className="btn-ghost" onClick={exportCSV}>⬇ CSV</button>
      </form>
      {items.map((t) => (
        <div key={t.hash} className="card !p-3">
          <TxRow tx={t} />
          <div className="flex gap-2 mt-2">
            {t.status === 'requires_approval' && (
              <>
                <button className="btn-success !py-1 !px-3 text-xs" onClick={() => act(t.hash, 'approve')}>Approve</button>
                <button className="btn-danger !py-1 !px-3 text-xs" onClick={() => act(t.hash, 'reject')}>Reject</button>
              </>
            )}
            {['pending', 'queued'].includes(t.status) && (
              <button className="btn-danger !py-1 !px-3 text-xs" onClick={() => act(t.hash, 'reject')}>Reject</button>
            )}
            {t.status === 'failed' && (
              <button className="btn-ghost !py-1 !px-3 text-xs" onClick={() => act(t.hash, 'retry')}>Retry</button>
            )}
          </div>
        </div>
      ))}
      {!items.length && <p className="text-sm text-slate-500">No transactions match.</p>}
    </div>
  );
}

function Mempool({ flash, flashErr }) {
  const [data, setData] = useState(null);
  const load = () => api.get('/admin/mempool').then(({ data }) => setData(data)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  useSocketEvent('mempool:update', () => load());
  useSocketEvent('block:mined', () => load());

  if (!data) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="font-bold mb-2">Fair queue status — {data.stats.total} waiting <span className="text-xs font-normal text-emerald-400">● live</span></h3>
        <div className="text-sm text-slate-400 space-y-1">
          {data.stats.rows.map((r) => <p key={r._id}>{r._id}: {r.count} txs · volume {Number(r.volume).toFixed(2)}</p>)}
        </div>
        <h4 className="font-bold mt-3 mb-1 text-sm">Top senders in queue (spam watch)</h4>
        <div className="text-xs text-slate-400 space-y-0.5">
          {data.stats.bySender.map((s) => <p key={s._id} className="mono">{s._id} — {s.count} txs</p>)}
          {!data.stats.bySender.length && <p>Queue empty 🎉</p>}
        </div>
      </div>
      <div className="space-y-2">
        {data.pending.map((t) => (
          <div key={t.hash} className="card !p-3">
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="mono text-violet-300">{t.hash.slice(0, 14)}…</span>
              {statusBadge(t.status)}
              <span>{t.amount} (+{t.fee} fee)</span>
              <span className="text-xs text-slate-500 mono">from {t.fromAddress.slice(0, 10)}… nonce {t.nonce}</span>
              <button
                className="ml-auto text-xs bg-rose-600 rounded-lg px-2 py-1"
                onClick={async () => { if (!confirm('Drop this tx from mempool? Funds unlock.')) return; try { await api.delete(`/admin/mempool/${t.hash}`); flash('Dropped'); load(); } catch (e) { flashErr(e); } }}
              >
                Drop
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsTab({ flash, flashErr }) {
  const [settings, setSettings] = useState([]);

  useEffect(() => {
    api.get('/admin/settings').then(({ data }) => setSettings(data.settings || [])).catch(() => {});
  }, []);

  const save = async () => {
    try {
      const body = {};
      for (const s of settings) body[s.key] = s.value;
      await api.put('/admin/settings', body);
      flash('Settings saved — fairness + fee policy live immediately');
    } catch (e) { flashErr(e); }
  };

  const set = (key, value) => setSettings(settings.map((s) => (s.key === key ? { ...s, value } : s)));

  const num = (key, label, hint) => {
    const s = settings.find((x) => x.key === key);
    if (!s) return null;
    return (
      <label className="block text-sm">
        <span className="text-slate-300 font-medium">{label}</span>
        <input className="input mt-1" type="number" step="any" value={s.value} onChange={(e) => set(key, Number(e.target.value))} />
        <span className="text-xs text-slate-500">{hint}</span>
      </label>
    );
  };

  const text = (key, label, hint) => {
    const s = settings.find((x) => x.key === key);
    if (!s) return null;
    return (
      <label className="block text-sm">
        <span className="text-slate-300 font-medium">{label}</span>
        <input className="input mt-1 mono" type="text" value={s.value || ''} onChange={(e) => set(key, e.target.value)} />
        <span className="text-xs text-slate-500">{hint}</span>
      </label>
    );
  };

  const bool = (key, label, hint) => {
    const s = settings.find((x) => x.key === key);
    if (!s) return null;
    return (
      <label className="flex items-start gap-3 text-sm bg-slate-800/60 rounded-xl p-3">
        <input type="checkbox" className="mt-1" checked={!!s.value} onChange={(e) => set(key, e.target.checked)} />
        <span><b>{label}</b><br /><span className="text-xs text-slate-500">{hint}</span></span>
      </label>
    );
  };

  const anchorMode = settings.find((x) => x.key === 'evmAnchorMode');

  return (
    <div className="card space-y-4">
      <h3 className="font-bold">⛓ Chain & fairness policy</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        {num('maxTxPerBlock', 'Max txs per block', 'Block capacity. Lower = slower but steadier.')}
        {num('maxTxPerUserPerBlock', 'Max txs per user per block', 'Core fairness knob. 2 = every active user gets in when ≤5 senders race.')}
        {num('feePercent', 'Fee %', 'Percent fee per transfer.')}
        {num('feeMin', 'Min fee', 'Floor fee; also scales the anti-whale fee cap (50×).')}
        {num('faucetAmount', 'Faucet payout', 'Test tokens per claim.')}
        {num('faucetCooldownMs', 'Faucet cooldown (ms)', '3600000 = 1 hour.')}
        {num('dailySendLimit', 'Default daily send limit', 'Per-user cap; overridable per user.')}
        {num('largeTxApprovalThreshold', 'Large-tx approval threshold', '0 = off. Transfers ≥ this need admin approval.')}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {bool('chainPaused', 'Pause mining (maintenance)', 'Stops block production; txs stay queued.')}
        {bool('registrationsOpen', 'Registrations open', 'Turn off to close signups.')}
      </div>
      <h3 className="font-bold">🔗 Sepolia anchoring</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="text-slate-300 font-medium">Anchor mode</span>
          <select className="input mt-1" value={anchorMode?.value || 'off'} onChange={(e) => set('evmAnchorMode', e.target.value)}>
            <option value="off">off — embedded chain only</option>
            <option value="post">post — anchor every block to Sepolia</option>
          </select>
          <span className="text-xs text-slate-500">Needs EVM_RPC_URL + EVM_SETTLEMENT_KEY in server/.env.</span>
        </label>
        {text('evmAnchorAddress', 'Anchor address', 'Sepolia destination for anchor txs (blank = signer itself).')}
      </div>
      <button className="btn-primary" onClick={save}>Save settings</button>
    </div>
  );
}

function AuditTab({ flashErr }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get('/admin/audit?limit=50').then(({ data }) => setItems(data.items || [])).catch(() => {});
  }, []);

  const exportCSV = async () => {
    try {
      await downloadCSV('/admin/export/audit', 'tbt-audit.csv');
    } catch (e) { flashErr(e); }
  };

  return (
    <div className="card">
      <div className="flex items-center mb-3">
        <h3 className="font-bold mr-auto">📜 Audit log</h3>
        <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={exportCSV}>⬇ CSV</button>
      </div>
      <div className="space-y-1.5 text-xs max-h-[500px] overflow-auto">
        {items.map((a) => (
          <div key={a._id} className="bg-slate-800/60 rounded-lg px-2.5 py-1.5">
            <span className="text-slate-500">{new Date(a.createdAt).toLocaleString()}</span>{' '}
            <b className="text-violet-300">{a.action}</b>{' '}
            <span className="text-slate-400">by {a.actorEmail || 'system'}</span>{' '}
            {a.target && <span className="mono text-slate-300">{a.target}</span>}
            {a.detail && <pre className="text-slate-500 whitespace-pre-wrap">{JSON.stringify(a.detail).slice(0, 200)}</pre>}
          </div>
        ))}
        {!items.length && <p className="text-slate-500">No audit entries yet.</p>}
      </div>
    </div>
  );
}
