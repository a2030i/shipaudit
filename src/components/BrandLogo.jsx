// Lamha brand logo.
//
// Drop the official artwork into `public/`:
//   • public/lamha-logo.png   — full horizontal logo (wordmark + mark)
//   • public/lamha-mark.png   — just the hexagonal mark (used when collapsed)
//
// If a file is missing the component silently falls back to an inline
// SVG approximation so the UI never breaks. Replace the PNGs with the
// official artwork to get a pixel-perfect logo.

import { useState } from 'react';

// Official artwork uploaded as logo.webp; the mark-only file is optional
// (collapsed sidebar falls back to the SVG mark below).
const FULL_LOGO_SRC = '/logo.webp';
const MARK_SRC      = '/lamha-mark.png';

// SVG mark in the official Lamha colors (navy + sky) so it reads on the
// white sidebar when collapsed and the PNG mark isn't provided.
function FallbackMark({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="Lamha">
      <path d="M32 6 L10 18 L10 46 L32 58 Z" fill="#1B3B6F"/>
      <path d="M32 6 L54 18 L54 46 L32 58 Z" fill="#3B9AD9"/>
      <path d="M32 14 L46 24 L46 40 L32 50 L18 40 L18 24 Z"
            stroke="#fff" strokeOpacity=".25" strokeWidth="1.4" fill="none"/>
      <circle cx="32" cy="32" r="3" fill="#fff" fillOpacity=".3"/>
    </svg>
  );
}

export function LamhaMark({ size = 32 }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <FallbackMark size={size}/>;
  return (
    <img
      src={MARK_SRC}
      alt="Lamha"
      width={size}
      height={size}
      onError={() => setBroken(true)}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
}

export function LamhaLogo({ height = 32 }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    // Inline fallback wordmark + mark
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, lineHeight: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: height * 0.78, fontWeight: 800, color: 'var(--brand-navy)', letterSpacing: '-.5px', lineHeight: 1 }}>لمحة</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: height * 0.32, color: 'var(--brand-teal)', letterSpacing: 3, fontWeight: 600, textTransform: 'uppercase', lineHeight: 1 }}>LAMHA</span>
        </div>
        <FallbackMark size={height + 4}/>
      </div>
    );
  }

  return (
    <img
      src={FULL_LOGO_SRC}
      alt="Lamha"
      height={height}
      onError={() => setBroken(true)}
      // Sidebar bg now equals the logo's #F4F4F4 background, so the artwork
      // blends in with no grey box — no blend trick needed.
      style={{ display: 'block', height, width: 'auto', objectFit: 'contain' }}
    />
  );
}
