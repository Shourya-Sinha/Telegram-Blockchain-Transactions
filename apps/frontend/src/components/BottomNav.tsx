import { haptic } from '../telegram';
import { useWalletStore } from '../store';

const items = [{ id: 'wallet', icon: '▣', label: 'Wallet' }, { id: 'defi', icon: '◈', label: 'DeFi' }, { id: 'yield', icon: '✦', label: 'Yield' }, { id: 'apps', icon: '⌘', label: 'Apps' }] as const;
export function BottomNav() {
  const active = useWalletStore((state) => state.activeTab);
  const setActive = useWalletStore((state) => state.setActiveTab);
  return <nav className="bottom-nav">{items.map((item) => <button key={item.id} className={active === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { haptic(); setActive(item.id); }}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}</nav>;
}
