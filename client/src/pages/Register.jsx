import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errMsg } from '../api/client';

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form.name, form.email, form.password);
      nav('/dashboard');
    } catch (err) {
      setError(errMsg(err, 'Registration failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto pt-10">
      <div className="card space-y-4">
        <h1 className="text-2xl font-black">Create your wallet 🎉</h1>
        <p className="text-sm text-slate-400">Free testnet account with an auto-created wallet + faucet tokens.</p>
        {error && <p className="text-sm text-rose-400 bg-rose-500/10 rounded-xl px-3 py-2">{error}</p>}
        <form onSubmit={submit} className="space-y-3">
          <input className="input" placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input className="input" placeholder="Password (6+ chars)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="text-sm text-slate-400">Have an account? <Link to="/login" className="text-violet-400">Login</Link></p>
      </div>
    </div>
  );
}
