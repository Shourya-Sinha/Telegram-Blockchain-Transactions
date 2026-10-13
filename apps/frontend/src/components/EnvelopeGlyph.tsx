import { useId } from 'react';

/**
 * WeChat-style red envelope icon.
 *
 * - closed: bright red pocket with the flap folded down and a gold seal —
 *   the "not claimed yet" look.
 * - open: faded light-red pocket, flap lifted, and the cream card pulled out —
 *   the "already opened/claimed" look.
 */
export function EnvelopeGlyph({ open = false, size = 40 }: { open?: boolean; size?: number }) {
  const gradientId = `envelope-gradient-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const flapId = `envelope-flap-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  return (
    <svg className={`envelope-glyph${open ? ' open' : ''}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.9" y2="1">
          {open
            ? <><stop offset="0" stopColor="#e5855f" /><stop offset="1" stopColor="#d85940" /></>
            : <><stop offset="0" stopColor="#f5453e" /><stop offset="1" stopColor="#cc3639" /></>}
        </linearGradient>
        <linearGradient id={flapId} x1="0" y1="0" x2="0.9" y2="1">
          {open
            ? <><stop offset="0" stopColor="#e59a77" /><stop offset="1" stopColor="#d69174" /></>
            : <><stop offset="0" stopColor="#e9393b" /><stop offset="1" stopColor="#bd2f38" /></>}
        </linearGradient>
      </defs>
      {/* cream message card, only visible once the envelope is open */}
      {open && <rect x="12" y="7" width="24" height="17" rx="3" fill="#ffeccf" />}
      {open && <circle cx="24" cy="13" r="3.4" fill="#f2c15e" />}
      {open && <rect x="16" y="18.5" width="16" height="2" rx="1" fill="#e9cba1" />}
      {/* pocket */}
      <rect x="5" y="13" width="38" height="28" rx="6.5" fill={`url(#${gradientId})`} />
      {/* flap: folded down when sealed, lifted up when opened */}
      {open
        ? <path d="M7 16 L24 3 L41 16 Z" fill={`url(#${flapId})`} stroke={`url(#${flapId})`} strokeWidth="2" strokeLinejoin="round" />
        : <path d="M6.5 17.5 L24 34 L41.5 17.5 L41.5 19 Q24 38 6.5 19 Z" fill={`url(#${flapId})`} opacity="0.9" />}
      {/* gold seal */}
      <circle cx="24" cy={open ? 28 : 25} r="5.6" fill="#f8d47b" stroke="#e0a83f" strokeWidth="1.2" />
      <circle cx="24" cy={open ? 28 : 25} r="2.6" fill="none" stroke="#d99b2f" strokeWidth="1" opacity="0.7" />
    </svg>
  );
}
