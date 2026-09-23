import { create } from 'zustand';
import type { MeResponse } from './api';

type Tab = 'wallet' | 'defi' | 'yield' | 'apps';
interface WalletState {
  activeTab: Tab;
  me?: MeResponse;
  setActiveTab: (tab: Tab) => void;
  setMe: (me: MeResponse) => void;
}
export const useWalletStore = create<WalletState>((set) => ({ activeTab: 'wallet', setActiveTab: (activeTab) => set({ activeTab }), setMe: (me) => set({ me }) }));
