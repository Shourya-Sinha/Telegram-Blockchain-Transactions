import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

export default function Landing() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/blocks/explorer/stats').then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  return (
    <div className="space-y-10">
      <section className="text-center pt-10 space-y-4">
        <p className="badge bg-violet-500/15 text-violet-300">MERN · Fair mempool · Telegram bot · Admin console</p>
        <h1 className="text-4xl sm:text-5xl font-black leading-tight">
          Blockchain transactions,<br />with a <span className="text-violet-400">fair chance for everyone</span>
        </h1>
        <p className="text-slate-400 max-w-2xl mx-auto">
          Send {stats?.symbol || 'TBT'} in seconds, get Telegram confirmations, explore every block —
          and no whale can push you out of a block: our round-robin mempool guarantees every active user a slot.
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <Link to="/register" className="btn-primary">Create free wallet</Link>
          <Link to="/explorer" className="btn-ghost">Explore the chain</Link>
        </div>
      </section>

      {stats && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['Block height', stats.height],
            ['Transactions', stats.transactions],
            ['On-chain volume', `${Number(stats.volume).toLocaleString()} ${stats.symbol}`],
            ['Mempool waiting', stats.mempool],
          ].map(([k, v]) => (
            <div key={k} className="card text-center">
              <p className="text-2xl font-black text-violet-300">{v}</p>
              <p className="text-xs text-slate-400 mt-1">{k}</p>
            </div>
          ))}
        </section>
      )}

      <section className="grid sm:grid-cols-3 gap-4">
        {[
          ['⚖️ Fair ordering', 'Max 2 txs per user per block, interleaved round-robin. Fee overpaying has a hard cap — waiting time boosts you instead.'],
          ['✈️ Telegram-native', 'Link your Telegram, then /balance, /send and /history from chat. Instant confirm + incoming-funds alerts.'],
          ['🛠 Admin control', 'Live mempool, approvals for large transfers, freeze/ban, mint, fee policy, broadcasts and full audit log.'],
          ['🔒 Real-world safety', 'Balance locking, idempotency keys, nonces, daily limits, cancelled-tx refunds, failure receipts.'],
          ['🧾 Full explorer', 'Blocks, transactions, addresses — every state change is browseable and searchable.'],
          ['🚰 Free test tokens', 'One-click faucet gets you started. No real money, no wallet extensions needed.'],
        ].map(([t, d]) => (
          <div key={t} className="card">
            <h3 className="font-bold mb-1">{t}</h3>
            <p className="text-sm text-slate-400">{d}</p>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="font-bold text-lg mb-2">How fairness works ⚖️</h2>
        <ol className="text-sm text-slate-300 space-y-1 list-decimal ml-5">
          <li>Every pending transaction is grouped by sender address.</li>
          <li>Senders are ordered by who waited longest (FIFO across users).</li>
          <li>Each block takes at most <b>{stats?.fairness?.maxTxPerUserPerBlock ?? 2}</b> txs per sender, round-robin, until the block is full (<b>{stats?.fairness?.maxTxPerBlock ?? 10}</b>).</li>
          <li>Fees help only within a cap — so spam can't starve small users.</li>
        </ol>
      </section>
    </div>
  );
}
