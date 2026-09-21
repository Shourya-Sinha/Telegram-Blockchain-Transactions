import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const token = localStorage.getItem('tbt_token');
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setWallets(data.wallets || []);
    } catch {
      localStorage.removeItem('tbt_token');
      setUser(null);
      setWallets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('tbt_token', data.token);
    setUser(data.user);
    setWallets(data.wallets || []);
    return data;
  };

  const register = async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password });
    localStorage.setItem('tbt_token', data.token);
    setUser(data.user);
    setWallets(data.wallet ? [data.wallet] : []);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('tbt_token');
    setUser(null);
    setWallets([]);
  };

  return (
    <AuthContext.Provider value={{ user, wallets, setWallets, loading, login, register, logout, refresh, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}
