import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type MeResponse } from './api';
import { useWalletStore } from './store';
import { initializeTelegram, configureBackButton } from './telegram';
import { BottomNav } from './components/BottomNav';
import { ClaimModal } from './components/ClaimModal';
import { WalletScreen } from './screens/WalletScreen';
import { DeFiScreen } from './screens/DeFiScreen';
import { YieldScreen } from './screens/YieldScreen';
import { AppsScreen } from './screens/AppsScreen';
import { useT, useLang } from './i18n';

const demoMe: MeResponse = { id: 'demo', telegramId: '0', firstName: 'friend', isAdmin: false, fundsMode: 'test', depositsEnabled: false, withdrawalsEnabled: false, withdrawalMode: 'disabled', locale: 'en', wallet: { id: 'demo-wallet', availableMinor: '0', lockedMinor: '0', version: 0 }, depositAddress: '' };
export default function App() {
  const activeTab = useWalletStore((state) => state.activeTab);
  const setMe = useWalletStore((state) => state.setMe);
  const setLang = useLang((state) => state.setLang);
  const t = useT();
  const [claimId, setClaimId] = useState<string>();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/api/me'), retry: false });
  useEffect(() => {
    const cleanupTelegram = initializeTelegram();
    const id = new URLSearchParams(window.location.search).get('envelope');
    if (id) setClaimId(id);
    return cleanupTelegram;
  }, []);
  useEffect(() => { if (meQuery.data) setMe(meQuery.data); }, [meQuery.data, setMe]);
  // Adopt the server-stored language when this device has no local choice yet
  // (e.g. the user switched flags on another device).
  useEffect(() => {
    if (!meQuery.data?.locale) return;
    try { if (localStorage.getItem('tma-lang')) return; } catch { /* ignore */ }
    setLang(meQuery.data.locale, { sync: false });
  }, [meQuery.data?.locale, setLang]);
  useEffect(() => configureBackButton(() => setClaimId(undefined), Boolean(claimId)), [claimId]);
  const me = meQuery.data ?? demoMe;
  return <div className="tg-sheet-viewport">
    <div className="tg-sheet-scrim" aria-hidden="true" />
    <div className="app-shell">
      <div className="sheet-grabber" aria-hidden="true" />
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      {activeTab === 'wallet' && <WalletScreen me={me} onClaim={setClaimId} />}{activeTab === 'defi' && <DeFiScreen />}{activeTab === 'yield' && <YieldScreen />}{activeTab === 'apps' && <AppsScreen />}
      <BottomNav />
      {claimId && <ClaimModal envelopeId={claimId} onClose={() => setClaimId(undefined)} />}
      <div className="build-indicator">{meQuery.isError ? t('previewMode') : t('ledgerOnline')}</div>
    </div>
  </div>;
}
