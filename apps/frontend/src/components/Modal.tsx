import type { ReactNode } from 'react';
import { haptic } from '../telegram';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-card">
      <div className="modal-header"><div><div className="eyebrow">RED ENVELOPE WALLET</div><h2>{title}</h2></div><button className="icon-button" onClick={() => { haptic(); onClose(); }} aria-label="Close">×</button></div>
      {children}
    </div>
  </div>;
}
