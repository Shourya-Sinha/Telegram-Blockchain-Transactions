import { useState } from 'react';
import { useSocketEvent } from '../realtime/socket';

/**
 * Global realtime toast stack — every notification + announcement
 * pushed over WebSocket appears instantly, no refresh needed.
 */
const TONES = {
  tx: 'border-violet-500/40',
  mega: 'border-amber-500/40',
  warn: 'border-rose-500/40',
  ok: 'border-emerald-500/40',
};

export default function Toasts() {
  const [toasts, setToasts] = useState([]);

  const push = (title, message, tone = 'tx') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, title, message, tone }].slice(-5));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 7000);
  };

  useSocketEvent('notification:new', (n) => push(n.title, n.message, 'tx'));
  useSocketEvent('announcement', (a) => push('📢 Announcement', a.message, 'mega'));
  useSocketEvent('tx:approval_needed', (t) => push('⚠️ Approval needed', `${t.amount} from ${t.from}`, 'warn'));
  useSocketEvent('tx:failed', (t) => push('❌ Transaction failed', t.reason || t.hash, 'warn'));

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 w-[22rem] max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <div key={t.id} className={`card !p-3 border ${TONES[t.tone] || TONES.tx} animate-pulse-once`}>
          <div className="flex items-start gap-2">
            <div className="text-sm flex-1">
              <b>{t.title}</b>
              <p className="text-slate-400 text-xs mt-0.5 break-words">{t.message}</p>
            </div>
            <button
              className="text-slate-500 hover:text-slate-200 text-xs"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
