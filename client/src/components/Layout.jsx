import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function statusBadge(status) {
  const map = {
    confirmed: 'bg-emerald-500/15 text-emerald-400',
    pending: 'bg-amber-500/15 text-amber-400',
    queued: 'bg-amber-500/15 text-amber-400',
    processing: 'bg-sky-500/15 text-sky-400',
    confirming: 'bg-sky-500/15 text-sky-400',
    failed: 'bg-rose-500/15 text-rose-400',
    cancelled: 'bg-slate-500/15 text-slate-400',
    rejected: 'bg-rose-500/15 text-rose-400',
    requires_approval: 'bg-violet-500/15 text-violet-300',
  };
  return <span className={`badge ${map[status] || 'bg-slate-500/15 text-slate-300'}`}>{status?.replace('_', ' ')}</span>;
}

export default function Layout({ children }) {
  const { user, isAdmin, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  const link = (to, label) => (
    <Link
      key={to}
      to={to}
      className={`px-3 py-2 rounded-lg text-sm font-medium ${loc.pathname === to ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 backdrop-blur bg-slate-950/80 border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2">
          <Link to="/" className="font-black text-lg mr-2">
            ⛓️ TBT<span className="text-violet-400">Chain</span>
          </Link>
          {user && (
            <>
              {link('/dashboard', 'Wallet')}
              {link('/explorer', 'Explorer')}
              {isAdmin && link('/admin', '🛠 Admin')}
            </>
          )}
          {!user && link('/explorer', 'Explorer')}
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <>
                <span className="text-xs text-slate-400 hidden sm:block">
                  {user.name} · {user.role}
                </span>
                <button
                  className="btn-ghost !py-1.5 !px-3 text-sm"
                  onClick={() => {
                    logout();
                    nav('/');
                  }}
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn-ghost !py-1.5 !px-3 text-sm">Login</Link>
                <Link to="/register" className="btn-primary !py-1.5 !px-3 text-sm">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      <footer className="max-w-6xl mx-auto px-4 py-8 text-center text-xs text-slate-500">
        TBT Chain — fair-order blockchain transactions with Telegram alerts · demo testnet, not real money
      </footer>
    </div>
  );
}
