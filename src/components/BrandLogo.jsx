// Lamha brand logo — SVG inline so it scales perfectly, themes via currentColor.
// Two variants:
//   <LamhaMark/>  → just the hexagonal icon (square aspect, sidebar collapsed)
//   <LamhaLogo/>  → full wordmark + icon (sidebar expanded, login splash, headers)
//
// The hex icon is a stylised "lamha" diamond split: deep navy facets on the
// left, teal facets on the right, with three motion lines suggesting shipping
// speed. Matches the official artwork.

export function LamhaMark({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Lamha"
    >
      {/* Hexagon — left half (deep navy) */}
      <path
        d="M32 6 L10 18 L10 46 L32 58 Z"
        fill="#1B1E54"
      />
      {/* Hexagon — right half (teal) */}
      <path
        d="M32 6 L54 18 L54 46 L32 58 Z"
        fill="#2DD4BF"
      />
      {/* Inner diamond highlight */}
      <path
        d="M32 14 L46 24 L46 40 L32 50 L18 40 L18 24 Z"
        stroke="#fff"
        strokeOpacity=".18"
        strokeWidth="1.4"
        fill="none"
      />
      {/* Center accent */}
      <circle cx="32" cy="32" r="3" fill="#fff" fillOpacity=".22" />
    </svg>
  );
}

export function LamhaLogo({ height = 28, color = '#fff', accent = '#2DD4BF' }) {
  // Motion lines + mark + Arabic "لمحة" wordmark.
  // Sized to match a 28px-tall mark; wordmark uses the system font in a bold weight.
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        lineHeight: 1,
      }}
      aria-label="Lamha"
    >
      {/* Wordmark — Arabic + Latin stacked */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontSize: height * 0.78,
          fontWeight: 800,
          color,
          letterSpacing: '-.5px',
          lineHeight: 1,
        }}>
          لمحة
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: height * 0.32,
          color: accent,
          letterSpacing: 3,
          fontWeight: 600,
          textTransform: 'uppercase',
          lineHeight: 1,
        }}>
          LAMHA
        </span>
      </div>

      {/* Motion lines */}
      <svg
        width={height * 0.5}
        height={height}
        viewBox="0 0 16 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0 }}
      >
        <rect x="0" y="9"  width="16" height="2.2" rx="1.1" fill={color} opacity=".9"/>
        <rect x="3" y="15" width="13" height="2.2" rx="1.1" fill={accent} opacity=".9"/>
        <rect x="6" y="21" width="10" height="2.2" rx="1.1" fill={color} opacity=".7"/>
      </svg>

      <LamhaMark size={height + 4}/>
    </div>
  );
}
