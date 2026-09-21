import { useEffect, useState } from 'react';
import api, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { statusBadge } from '../components/Layout';
import { TxRow } from './Explorer';

export default function Dashboard() {
  const { user, wallets, setWallets, refresh } = useAuth();
  const [txs, setTxs] = useState([]);
  const [filter, setFilter] = useState('');
  const [notifs, setNotifs] = useState([]);
  const [showSend, setShowSend] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const loadTxs = () => {
    api.get('/transactions/mine', { params: { limit: 20, ...(filter ? { status: filter } : {}) } })
      .then(({ data }) => setTxs(data.items || []))
      .catch(() => {});
  };

  const loadWallets = () => {
    api.get('/wallets').then(({ data }) => setWallets(data.wallets || [])).catch(() => {});
  };

  const loadNotifs = () => {
    api.get('/transactions/notifications').then(({ data }) => setNotifs(data.items || [])).catch(() => {});
  };

  useEffect(() => {
    loadTxs();
    loadNotifs();
    const t = setInterval(() => { loadTxs(); loadWallets(); }, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 5000); };
  const flashErr = (m) => { setErr(m); setMsg(''); };

  const faucet = async () => {
    try {
      const { data } = await api.post('/wallets/faucet');
      flash(data.message);
      loadTxs();
    } catch (e) { flashErr(errMsg(e)); }
  };

  const newWallet = async () => {
    try {
      await api.post('/wallets', {});
      loadWallets();
      flash('New wallet created');
    } catch (e) { flashErr(errMsg(e)); }
  };

  const cancel = async (hash) => {
    if (!confirm('Cancel this transaction and unlock funds?')) return;
    try {
      await api.post(`/transactions/${hash}/cancel`);
      flash('Transaction cancelled');
      loadTxs(); loadWallets();
    } catch (e) { flashErr(errMsg(e)); }
  };

  const total = wallets.reduce((a, w) => a + (w.balance || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-black">💼 My wallet</h1>
        <span className="text-sm text-slate-400">{user?.email} · daily {user?.dailySent || 0}/{user?.dailyLimit} sent</span>
      </div>

      {msg && <p className="text-sm text-emerald-300 bg-emerald-500/10 rounded-xl px-4 py-2">{msg}</p>}
      {err && <p className="text-sm text-rose-400 bg-rose-500/10 rounded-xl px-4 py-2">{err}</p>}

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-xs text-slate-400">Total balance</p>
          <p className="text-3xl font-black text-violet-300">{total.toFixed(4)}</p>
          <div className="flex gap-2 mt-3">
            <button className="btn-primary flex-1 !py-2 text-sm" onClick={() => setShowSend(true)}>Send</button>
            <button className="btn-ghost flex-1 !py-2 text-sm" onClick={faucet}>🚰 Faucet</button>
          </div>
        </div>
        <div className="card">
          <p className="text-xs text-slate-400 mb-2">✈️ Telegram</p>
          {user?.telegramId ? (
            <div className="text-sm space-y-2">
              <p className="text-emerald-300">✅ Linked {user.telegramUsername ? `@${user.telegramUsername}` : ''}</p>
              <p className="text-slate-400 text-xs">You'll get confirm + incoming-funds alerts. Try /balance in chat.</p>
              <button className="btn-ghost !py-1.5 text-xs" onClick={async () => { await api.post('/auth/unlink-telegram'); refresh(); }}>Unlink</button>
            </div>
          ) : (
            <div className="text-sm space-y-2">
              <p className="text-slate-400">Link Telegram for instant tx alerts + chat commands.</p>
              <button className="btn-ghost !py-1.5 text-xs" onClick={() => setShowLink(true)}>Link Telegram</button>
            </div>
          )}
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">🔔 Notifications</p>
            <button className="text-xs text-violet-400" onClick={async () => { await api.post('/transactions/notifications/read-all'); loadNotifs(); }}>mark read</button>
          </div>
          <div className="space-y-1.5 max-h-36 overflow-auto text-xs">
            {notifs.slice(0, 6).map((n) => (
              <div key={n._id} className={`rounded-lg px-2 py-1.5 ${n.read ? 'bg-slate-800/50 text-slate-400' : 'bg-violet-600/15 text-slate-200'}`}>
                <b>{n.title}</b> — {n.message}
              </div>
            ))}
            {!notifs.length && <p className="text-slate-500">No notifications yet.</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Wallets ({wallets.length}/5)</h2>
          <button className="btn-ghost !py-1.5 text-xs" onClick={newWallet}>+ New wallet</button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {wallets.map((w) => (
            <div key={w.address} className="bg-slate-800/60 rounded-xl p-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <b>{w.label}</b>
                {w.isExternal && <span className="badge bg-slate-500/15 text-slate-300">watch-only</span>}
                <span className="ml-auto font-black text-violet-300">{w.balance?.toFixed(4)}</span>
              </div>
              <p className="mono text-xs text-slate-400 break-all">{w.address}</p>
              <p className="text-xs text-slate-500">available {w.available?.toFixed(4)} · locked {w.lockedBalance?.toFixed(4)} · nonce {w.nonce}</p>
              <button className="text-xs text-violet-400" onClick={() => { navigator.clipboard?.writeText(w.address); flash('Address copied'); }}>Copy address</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="font-bold mr-auto">🧾 Transactions</h2>
          {['', 'pending', 'confirmed', 'failed', 'requires_approval'].map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`text-xs px-2.5 py-1 rounded-full ${filter === s ? 'bg-violet-600' : 'bg-slate-800 text-slate-300'}`}>
              {s === '' ? 'all' : s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {txs.map((t) => (
            <div key={t.hash}>
              <TxRow tx={t} />
              {['pending', 'queued', 'requires_approval'].includes(t.status) && t.type === 'transfer' && (
                <button className="text-xs text-rose-400 mt-1 ml-1" onClick={() => cancel(t.hash)}>Cancel + unlock funds</button>
              )}
            </div>
          ))}
          {!txs.length && <p className="text-sm text-slate-500">No transactions. Hit the 🚰 Faucet to get test tokens, then Send.</p>}
        </div>
      </div>

      {showSend && <SendModal onClose={() => setShowSend(false)} onDone={(m) => { setShowSend(false); flash(m); loadTxs(); loadWallets(); }} onError={flashErr} />}
      {showLink && <LinkModal onClose={() => setShowLink(false)} />}
    </div>
  );
}

function SendModal({ onClose, onDone, onError }) {
  const { wallets } = useAuth();
  const [form, setForm] = useState({ fromAddress: wallets[0]?.address || '', toAddress: '', amount: '', note: '' });
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Number(form.amount) > 0) {
      api.get('/transactions/estimate', { params: { amount: form.amount } }).then(({ data }) => setEst(data)).catch(() => {});
    } else setEst(null);
  }, [form.amount]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { data } = await api.post('/transactions/send', { ...form, amount: Number(form.amount), idempotencyKey: key });
      onDone(`${data.message} — ${data.tx.hash.slice(0, 16)}…`);
    } catch (err) {
      onError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-30" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg">📤 Send tokens</h2>
        <form onSubmit={submit} className="space-y-3">
          <select className="input" value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })}>
            {wallets.filter((w) => !w.isExternal).map((w) => (
              <option key={w.address} value={w.address}>{w.label} — {w.available?.toFixed(4)} avail</option>
            ))}
          </select>
          <input className="input mono" placeholder="To address 0x…" value={form.toAddress} onChange={(e) => setForm({ ...form, toAddress: e.target.value })} required />
          <input className="input" placeholder="Amount" type="number" step="any" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <input className="input" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={280} />
          {est && (
            <div className="text-xs text-slate-400 bg-slate-800/60 rounded-xl p-2.5 space-y-0.5">
              <p>Fee: <b className="text-slate-200">{est.fee}</b> ({est.feePercent}% / min {est.feeMin}) · Total debit: <b className="text-slate-200">{est.total}</b></p>
              {est.needsApproval && <p className="text-violet-300">⚠️ Above {est.approvalThreshold} — will need admin approval.</p>}
              <p>Fair queue: max 2 txs/user/block, round-robin — no one can crowd you out.</p>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LinkModal({ onClose }) {
  const [code, setCode] = useState(null);

  useEffect(() => {
    api.post('/auth/link-code').then(({ data }) => setCode(data)).catch(() => {});
  }, []);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-30" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3 text-center" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg">✈️ Link Telegram</h2>
        {!code ? <p className="text-sm text-slate-400">Generating code…</p> : (
          <>
            <p className="text-3xl font-black tracking-widest text-violet-300">{code.code}</p>
            <p className="text-xs text-slate-400">Expires in {code.expiresInMin} min</p>
            {code.deepLink ? (
              <a href={code.deepLink} target="_blank" rel="noreferrer" className="btn-primary w-full">Open bot & link</a>
            ) : (
              <p className="text-sm text-slate-400">Bot not configured yet — ask admin to set TELEGRAM_BOT_TOKEN, then send <span className="mono">/link {code.code}</span> to the bot.</p>
            )}
            <button className="btn-ghost w-full" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
