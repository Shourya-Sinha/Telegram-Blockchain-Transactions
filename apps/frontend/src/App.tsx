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

const demoMe: MeResponse = { id: 'demo', telegramId: '0', firstName: 'friend', isAdmin: false, wallet: { id: 'demo-wallet', availableMinor: '0', lockedMinor: '0', version: 0 }, depositAddress: '' };
export default function App() {
  const activeTab = useWalletStore((state) => state.activeTab);
  const setMe = useWalletStore((state) => state.setMe);
  const [claimId, setClaimId] = useState<string>();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/api/me'), retry: false });
  useEffect(() => { initializeTelegram(); const id = new URLSearchParams(window.location.search).get('envelope'); if (id) setClaimId(id); }, []);
  useEffect(() => { if (meQuery.data) setMe(meQuery.data); }, [meQuery.data, setMe]);
  useEffect(() => configureBackButton(() => setClaimId(undefined), Boolean(claimId)), [claimId]);
  const me = meQuery.data ?? demoMe;
  return <div className="app-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" />{activeTab === 'wallet' && <WalletScreen me={me} onClaim={setClaimId} />}{activeTab === 'defi' && <DeFiScreen onClaim={setClaimId} />}{activeTab === 'yield' && <YieldScreen />}{activeTab === 'apps' && <AppsScreen />}<BottomNav />{claimId && <ClaimModal envelopeId={claimId} onClose={() => setClaimId(undefined)} />}<div className="build-indicator">{meQuery.isError ? 'Preview mode · open inside Telegram for live data' : 'Custodial ledger online'}</div></div>;
}
