import { haptic } from '../telegram';
import { useWalletStore } from '../store';
import { useT } from '../i18n';

const items = [{ id: 'wallet', icon: '▣', key: 'navWallet' }, { id: 'defi', icon: '◈', key: 'navDefi' }, { id: 'yield', icon: '✦', key: 'navYield' }, { id: 'apps', icon: '⌘', key: 'navApps' }] as const;
export function BottomNav() {
  const t = useT();
  const active = useWalletStore((state) => state.activeTab);
  const setActive = useWalletStore((state) => state.setActiveTab);
  return <nav className="bottom-nav">{items.map((item) => <button key={item.id} className={active === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { haptic(); setActive(item.id); }}><span className="nav-icon">{item.icon}</span><span>{t(item.key)}</span></button>)}</nav>;
}
