import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LedgerEntry, type MeResponse } from './api';
import { useWalletStore } from './store';
import { initializeTelegram, configureBackButton, setSwipeDismissEnabled, telegramStartParam } from './telegram';
import { BottomNav } from './components/BottomNav';
import { ClaimModal } from './components/ClaimModal';
import { TransactionDetail, detailTargetKey, type DetailTarget } from './components/TransactionDetail';
import { WalletScreen } from './screens/WalletScreen';
import { DeFiScreen } from './screens/DeFiScreen';
import { YieldScreen } from './screens/YieldScreen';
import { AppsScreen } from './screens/AppsScreen';
import { useT, useLang } from './i18n';

const demoMe: MeResponse = { id: 'demo', telegramId: '0', firstName: 'friend', isAdmin: false, fundsMode: 'test', depositsEnabled: false, withdrawalsEnabled: false, withdrawalMode: 'disabled', locale: 'en', wallet: { id: 'demo-wallet', availableMinor: '0', lockedMinor: '0', version: 0 }, depositAddress: '' };

type ClaimLaunch = { envelopeId: string; viewOnly?: boolean };

const ENVELOPE_ID_RE = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

function paramsFromHash(): URLSearchParams {
  const raw = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(raw);
}

function envelopeFromStartParam(value?: string | null): string | undefined {
  const payload = (value ?? '').trim();
  if (!payload) return undefined;
  if (ENVELOPE_ID_RE.test(payload)) return payload;
  const match = payload.match(/^envelope[_-]([0-9a-f]{8}-[0-9a-f-]{27,})$/i);
  return match?.[1];
}

function readLaunchTarget(): { envelopeId?: string; openHistory?: boolean } {
  const search = new URLSearchParams(window.location.search);
  const hash = paramsFromHash();
  const start = telegramStartParam() || search.get('tgWebAppStartParam') || hash.get('tgWebAppStartParam') || search.get('startapp') || hash.get('startapp');
  const directEnvelope = search.get('envelope') || hash.get('envelope');
  const envelopeId = envelopeFromStartParam(directEnvelope) ?? envelopeFromStartParam(start);
  const view = search.get('view') || hash.get('view') || start;
  return { envelopeId, openHistory: view === 'history' };
}

export default function App() {
  const activeTab = useWalletStore((state) => state.activeTab);
  const setActiveTab = useWalletStore((state) => state.setActiveTab);
  const setMe = useWalletStore((state) => state.setMe);
  const setLang = useLang((state) => state.setLang);
  const t = useT();
  const client = useQueryClient();
  // Screens stack: history → transaction details → red envelope. Back always
  // closes the top-most one, never the whole mini app.
  const [claimLaunch, setClaimLaunch] = useState<ClaimLaunch>();
  const [detail, setDetail] = useState<DetailTarget>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/api/me'), retry: false });
  useEffect(() => {
    const cleanupTelegram = initializeTelegram();
    const launch = readLaunchTarget();
    if (launch.envelopeId) setClaimLaunch({ envelopeId: launch.envelopeId });
    if (launch.openHistory) {
      setActiveTab('wallet');
      setHistoryOpen(true);
    }
    return cleanupTelegram;
  }, [setActiveTab]);
  useEffect(() => { if (meQuery.data) setMe(meQuery.data); }, [meQuery.data, setMe]);
  // Adopt the server-stored language when this device has no local choice yet
  // (e.g. the user switched flags on another device).
  useEffect(() => {
    if (!meQuery.data?.locale) return;
    try { if (localStorage.getItem('tma-lang')) return; } catch { /* ignore */ }
    setLang(meQuery.data.locale, { sync: false });
  }, [meQuery.data?.locale, setLang]);
  useEffect(() => {
    if (activeTab === 'wallet') return;
    if (historyOpen) setHistoryOpen(false);
    if (detail) setDetail(undefined);
  }, [activeTab, historyOpen, detail]);

  const closeTopLayer = useCallback(() => {
    if (claimLaunch) { setClaimLaunch(undefined); return; }
    if (detail) { setDetail(undefined); return; }
    if (historyOpen) setHistoryOpen(false);
  }, [claimLaunch, detail, historyOpen]);

  const overlayOpen = Boolean(claimLaunch || detail);
  const anyLayerOpen = overlayOpen || (activeTab === 'wallet' && historyOpen);

  useEffect(() => configureBackButton(closeTopLayer, anyLayerOpen), [closeTopLayer, anyLayerOpen]);
  // Telegram's swipe-to-dismiss gesture steals scrolling inside overlays, which
  // makes a long claim list feel frozen; restore it as soon as they close.
  useEffect(() => {
    setSwipeDismissEnabled(!overlayOpen);
    return () => setSwipeDismissEnabled(true);
  }, [overlayOpen]);
  useEffect(() => {
    if (!anyLayerOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeTopLayer(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyLayerOpen, closeTopLayer]);

  const me = meQuery.data ?? demoMe;
  const openEnvelope = (envelopeId: string, options?: { viewOnly?: boolean }) => {
    if (!envelopeId) return;
    setClaimLaunch({ envelopeId, viewOnly: options?.viewOnly });
  };
  // The envelope screen links back to the plain ledger details of the same
  // movement when that row is already loaded in the history list.
  const ledgerEntryFor = (envelopeId: string): LedgerEntry | undefined =>
    (client.getQueryData<LedgerEntry[]>(['ledger']) ?? []).find((entry) => entry.referenceId === envelopeId);
  const envelopeLedgerEntry = claimLaunch ? ledgerEntryFor(claimLaunch.envelopeId) : undefined;

  return <div className="tg-sheet-viewport">
    <div className="tg-sheet-scrim" aria-hidden="true" />
    <div className="app-shell">
      <div className="sheet-grabber" aria-hidden="true" />
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      {activeTab === 'wallet' && <WalletScreen me={me} onClaim={openEnvelope} showHistory={historyOpen} onShowHistory={() => setHistoryOpen(true)} onCloseHistory={() => setHistoryOpen(false)} onOpenDetail={setDetail} />}{activeTab === 'defi' && <DeFiScreen />}{activeTab === 'yield' && <YieldScreen />}{activeTab === 'apps' && <AppsScreen />}
      <BottomNav />
      {detail && <TransactionDetail key={detailTargetKey(detail)} target={detail} onClose={() => setDetail(undefined)} onOpenEnvelope={openEnvelope} />}
      {claimLaunch && <ClaimModal
        key={`${claimLaunch.envelopeId}:${claimLaunch.viewOnly ? 'view' : 'claim'}`}
        envelopeId={claimLaunch.envelopeId}
        viewOnly={claimLaunch.viewOnly}
        onClose={() => setClaimLaunch(undefined)}
        onShowLedgerDetails={envelopeLedgerEntry ? () => { setDetail({ kind: 'ledger', entry: envelopeLedgerEntry }); setClaimLaunch(undefined); } : undefined}
      />}
      <div className="build-indicator">{meQuery.isError ? t('previewMode') : t('ledgerOnline')}</div>
    </div>
  </div>;
}
