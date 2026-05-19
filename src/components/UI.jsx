import { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, HelpCircle, AlertCircle } from 'lucide-react';

// ─── Button ────────────────────────────────────────────────────────────────────
// Flat, professional fills (no gradients) — gradient buttons read as toys
// in dashboards, single-tone fills with a thin shadow read as enterprise.
//   primary  → deep navy (top-level CTA: confirm, save, approve)
//   accent   → teal (secondary positive action: complete, finalize)
//   navy     → alias of primary for legacy call-sites
//   danger   → red (destructive: delete, reject)
//   success  → teal (alias of accent — kept so call-sites don't break)
//   gold     → amber (warnings, drafts)
//   ghost    → transparent + neutral border (low-emphasis)
//   outline  → teal border, transparent fill (medium emphasis)
const VARIANTS = {
  primary: {
    background: '#0F1235',
    color: '#fff',
    border: '1px solid #0F1235',
    boxShadow: '0 1px 2px rgba(15,18,53,.18)',
  },
  accent: {
    background: '#14B8A6',
    color: '#fff',
    border: '1px solid #14B8A6',
    boxShadow: '0 1px 2px rgba(20,184,166,.22)',
  },
  navy: {
    background: '#1B1E54',
    color: '#fff',
    border: '1px solid #1B1E54',
    boxShadow: '0 1px 2px rgba(27,30,84,.20)',
  },
  danger: {
    background: '#DC2626',
    color: '#fff',
    border: '1px solid #DC2626',
    boxShadow: '0 1px 2px rgba(220,38,38,.20)',
  },
  success: {
    background: '#14B8A6',
    color: '#fff',
    border: '1px solid #14B8A6',
    boxShadow: '0 1px 2px rgba(20,184,166,.22)',
  },
  gold: {
    background: '#F59E0B',
    color: '#fff',
    border: '1px solid #F59E0B',
    boxShadow: '0 1px 2px rgba(245,158,11,.22)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text2)',
    border: '1px solid var(--border2)',
    boxShadow: 'none',
  },
  outline: {
    background: 'transparent',
    color: 'var(--accent)',
    border: '1px solid var(--accent)',
    boxShadow: 'none',
  },
};

const SIZES = {
  sm: { padding: '5px 12px',  fontSize: 12, borderRadius: 8,  gap: 5 },
  md: { padding: '8px 18px',  fontSize: 13, borderRadius: 9,  gap: 6 },
  lg: { padding: '11px 24px', fontSize: 14, borderRadius: 10, gap: 7 },
};

export function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, icon, style = {} }) {
  const s = SIZES[size];
  const v = VARIANTS[variant] || VARIANTS.ghost;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: s.gap,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-sans)', fontWeight: 600,
        borderRadius: s.borderRadius,
        padding: s.padding, fontSize: s.fontSize,
        opacity: disabled ? .45 : 1,
        ...v,
        ...style,
      }}
    >
      {icon && <span style={{ fontSize: s.fontSize + 1 }}>{icon}</span>}
      {children}
    </button>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────────
// Flat surface with subtle 1px border + soft shadow on hover. Drops the
// borderTop accent strip — the colour gets relocated to the icon tile or
// to a small chip inside the card, freeing the card itself to look like
// a calm primitive.
export function Card({ children, style = {}, accent, hover = false }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => hover && setHovered(true)}
      onMouseLeave={() => hover && setHovered(false)}
      style={{
        background: 'var(--card)',
        border: `1px solid var(--border)`,
        borderRadius: 'var(--r-lg)',
        padding: 20,
        transition: 'transform .18s, box-shadow .18s, border-color .18s',
        transform: hovered && hover ? 'translateY(-1px)' : 'none',
        boxShadow: hovered && hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        ...(accent ? { borderTop: `2px solid ${accent}` } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── StatCard ──────────────────────────────────────────────────────────────────
// Cleaner stat: tiny mono label up top, an optional tinted icon tile on
// the right, a confident mono number, an optional sub-line. No accent
// strip — colour shows through the icon tile and the number.
export function StatCard({ label, value, sub, color, onClick, icon, trend }) {
  const [hovered, setHovered] = useState(false);
  const tone = color || 'var(--text)';
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onClick && setHovered(true)}
      onMouseLeave={() => onClick && setHovered(false)}
      style={{
        background: 'var(--card)',
        border: `1px solid var(--border)`,
        borderRadius: 'var(--r-lg)',
        padding: '16px 20px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform .18s, box-shadow .18s',
        transform: hovered && onClick ? 'translateY(-1px)' : 'none',
        boxShadow: hovered && onClick ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        minWidth: 130,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ color: 'var(--muted)', fontSize: 10.5, fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>
          {label}
        </span>
        {icon && (
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 12%, transparent)`,
            color: tone,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13,
          }}>
            {icon}
          </div>
        )}
      </div>
      <div style={{ color: tone, fontSize: 26, fontFamily: 'var(--font-mono)', fontWeight: 700, lineHeight: 1, letterSpacing: -0.5 }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>{sub}</div>}
      {trend !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 6 }}>
          {trend > 0
            ? <TrendingUp size={11} color="var(--red)"/>
            : <TrendingDown size={11} color="var(--green)"/>
          }
          <span style={{ color: trend > 0 ? 'var(--red)' : 'var(--green)', fontSize: 10.5, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {trend > 0 ? '+' : ''}{trend.toFixed(2)} ر.س
          </span>
        </div>
      )}
    </div>
  );
}

// ─── PageHero ─────────────────────────────────────────────────────────────────
// Standardized page header for every screen. Replaces the per-page gradient
// hero blocks (each one a different palette) with one calm primitive:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │  TAG          [title]                       [stat] [stat] [stat] │
//   │               subtitle                                  [action] │
//   └──────────────────────────────────────────────────────────────────┘
//
// Variants:
//   • white  (default) — light page hero, 1px border, soft shadow
//   • dark   — navy spotlight (use sparingly for screens that own a single
//              critical metric, e.g. dashboard "balance owed" or
//              receivables "total debt")
//
// Use <PageHero stats={...}> for KPI tiles on the right.
// Use <PageHero actions={...}> for the action bar (buttons).
export function PageHero({
  tag, title, subtitle,
  stats = [], actions, variant = 'white',
  meta, icon,
}) {
  const dark = variant === 'dark';
  return (
    <div style={{
      position: 'relative',
      borderRadius: 'var(--r-lg)',
      padding: '22px 28px',
      marginBottom: 18,
      background: dark ? '#0F1235' : 'var(--card)',
      color: dark ? '#fff' : 'var(--text)',
      border: dark ? '1px solid #0F1235' : '1px solid var(--border)',
      boxShadow: dark
        ? '0 10px 32px rgba(15,18,53,.20)'
        : 'var(--shadow-sm)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: stats.length ? 'minmax(0,1fr) auto' : 'minmax(0,1fr) auto',
        alignItems: 'center', gap: 24,
      }}>
        {/* Left: tag → title → subtitle */}
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 16 }}>
          {icon && (
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: dark ? 'rgba(255,255,255,.08)' : 'var(--accent-dim)',
              color: dark ? '#fff' : 'var(--accent)',
            }}>{icon}</div>
          )}
          <div style={{ minWidth: 0 }}>
            {tag && (
              <div style={{
                fontSize: 10.5, fontFamily: 'var(--font-mono)',
                letterSpacing: 2, textTransform: 'uppercase',
                color: dark ? 'rgba(255,255,255,.55)' : 'var(--muted)',
                fontWeight: 600, marginBottom: 4,
              }}>{tag}</div>
            )}
            <h1 style={{
              fontFamily: 'var(--font-sans)', fontSize: 22, fontWeight: 800,
              color: dark ? '#fff' : 'var(--text)',
              margin: 0, lineHeight: 1.2,
            }}>{title}</h1>
            {subtitle && (
              <div style={{
                fontSize: 12.5, marginTop: 4,
                color: dark ? 'rgba(255,255,255,.65)' : 'var(--muted)',
              }}>{subtitle}</div>
            )}
            {meta && (
              <div style={{
                fontSize: 10.5, marginTop: 6, fontFamily: 'var(--font-mono)',
                color: dark ? 'rgba(255,255,255,.45)' : 'var(--muted2)',
                letterSpacing: 0.5,
              }}>{meta}</div>
            )}
          </div>
        </div>

        {/* Right: stat tiles + actions */}
        {(stats.length > 0 || actions) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            flexWrap: 'wrap', justifyContent: 'flex-end',
          }}>
            {stats.map((s, i) => (
              <StatTile key={i} {...s} dark={dark}/>
            ))}
            {actions && (
              <div style={{ display: 'flex', gap: 6, marginInlineStart: stats.length ? 6 : 0 }}>
                {actions}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── StatTile ────────────────────────────────────────────────────────────────
// Single KPI inside a PageHero. Compact, mono number, tiny label.
// Stays legible on both light & dark hero backgrounds.
export function StatTile({ label, value, hint, color, big, dark }) {
  const valueColor = color || (dark ? '#fff' : 'var(--text)');
  return (
    <div style={{
      paddingInline: 14, paddingBlock: 6,
      borderInlineStart: dark
        ? '1px solid rgba(255,255,255,.14)'
        : '1px solid var(--border)',
      minWidth: big ? 130 : 100,
    }}>
      <div style={{
        fontSize: 9.5, opacity: dark ? .7 : 1,
        fontFamily: 'var(--font-mono)', letterSpacing: 1.5,
        textTransform: 'uppercase', fontWeight: 600,
        color: dark ? 'rgba(255,255,255,.7)' : 'var(--muted)',
        whiteSpace: 'nowrap',
      }}>{label}</div>
      <div style={{
        fontSize: big ? 22 : 17, fontWeight: 800,
        color: valueColor, fontFamily: 'var(--font-mono)',
        marginTop: 3, whiteSpace: 'nowrap', letterSpacing: -0.3,
      }}>{value ?? '—'}</div>
      {hint && (
        <div style={{
          fontSize: 10, marginTop: 2,
          color: dark ? 'rgba(255,255,255,.5)' : 'var(--muted)',
        }}>{hint}</div>
      )}
    </div>
  );
}

// ─── Badge ─────────────────────────────────────────────────────────────────────
const BADGE_CFG = {
  ok:          { bg: 'rgba(45,212,191,.10)', color: 'var(--green)',  bd: 'rgba(45,212,191,.30)',  lbl: '✓ مطابق',     Icon: CheckCircle2 },
  mismatch:    { bg: 'rgba(248,113,113,.10)', color: 'var(--red)',    bd: 'rgba(248,113,113,.28)', lbl: '✗ فرق',       Icon: XCircle },
  favorable:   { bg: 'rgba(45,212,191,.12)', color: 'var(--accent)', bd: 'rgba(45,212,191,.32)',  lbl: '↓ لصالحك',    Icon: CheckCircle2 },
  unknown:     { bg: 'rgba(122,130,196,.10)', color: 'var(--muted)',  bd: 'rgba(122,130,196,.28)', lbl: '؟ غير معروف', Icon: HelpCircle },
  no_contract: { bg: 'rgba(251,146,60,.10)', color: 'var(--warn)',   bd: 'rgba(251,146,60,.28)',  lbl: '⚠ لا عقد',   Icon: AlertTriangle },
};

export function Badge({ status, label }) {
  const c = BADGE_CFG[status] || BADGE_CFG.unknown;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 9px', borderRadius: 20,
      fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
      background: c.bg, color: c.color, border: `1px solid ${c.bd}`,
      whiteSpace: 'nowrap',
    }}>
      {label || c.lbl}
    </span>
  );
}

// ─── Input ─────────────────────────────────────────────────────────────────────
export function Input({ label, hint, error, style: outerStyle = {}, ...props }) {
  return (
    <div style={{ ...outerStyle }}>
      {label && (
        <label style={{ display: 'block', color: error ? 'var(--red)' : 'var(--muted)', fontSize: 11, marginBottom: 5, fontFamily: 'var(--font-mono)', letterSpacing: .3 }}>
          {label}
        </label>
      )}
      <input
        style={{
          width: '100%', padding: '8px 12px',
          borderRadius: 'var(--r-md)', fontSize: 13,
          borderColor: error ? 'var(--red)' : undefined,
          ...(props.style || {}),
        }}
        {...{ ...props, style: undefined }}
      />
      {hint  && <div style={{ color: 'var(--muted)', fontSize: 10, marginTop: 4 }}>{hint}</div>}
      {error && <div style={{ color: 'var(--red)', fontSize: 10, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

export function Select({ label, children, style: outerStyle = {}, ...props }) {
  return (
    <div style={{ ...outerStyle }}>
      {label && (
        <label style={{ display: 'block', color: 'var(--muted)', fontSize: 11, marginBottom: 5, fontFamily: 'var(--font-mono)', letterSpacing: .3 }}>
          {label}
        </label>
      )}
      <select
        style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--r-md)', fontSize: 13, cursor: 'pointer', ...(props.style || {}) }}
        {...{ ...props, style: undefined }}
      >
        {children}
      </select>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ title, children, onClose, width = 520 }) {
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,18,53,.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="scale-in"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)',
          padding: 28, width,
          maxWidth: '95vw', maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h3 style={{ color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 800, letterSpacing: -0.2 }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--muted)', borderRadius: 8,
              padding: '6px 8px', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={14}/>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 20, color = 'var(--accent)' }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `2px solid color-mix(in srgb, ${color} 18%, transparent)`,
      borderTopColor: color,
      animation: 'spin .7s linear infinite',
      display: 'inline-block', flexShrink: 0,
    }}/>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────
export function Empty({ icon = '📭', title, sub, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '52px 20px', color: 'var(--muted)' }}>
      <div style={{
        width: 56, height: 56, margin: '0 auto 16px',
        background: 'var(--surface)', borderRadius: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
        border: '1px solid var(--border)',
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--text2)' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, marginBottom: 16 }}>{sub}</div>}
      {action}
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────
export function SectionHeader({ title, icon, action, style = {} }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '13px 18px', borderBottom: '1px solid var(--border)',
      ...style,
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600 }}>
        {icon && <span>{icon}</span>}{title}
      </span>
      {action}
    </div>
  );
}

// ─── Toast ─────────────────────────────────────────────────────────────────────
let _toastFn = null;
export function setToastFn(fn) { _toastFn = fn; }
export function toast(msg, type = 'info') { _toastFn?.(msg, type); }

const TOAST_COLORS = {
  info:    { color: 'var(--accent)',  icon: <AlertCircle size={15}/> },
  success: { color: 'var(--green)',   icon: <CheckCircle2 size={15}/> },
  error:   { color: 'var(--red)',     icon: <XCircle size={15}/> },
  warn:    { color: 'var(--warn)',    icon: <AlertTriangle size={15}/> },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  setToastFn((msg, type = 'info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  });

  return (
    <div style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => {
        const cfg = TOAST_COLORS[t.type] || TOAST_COLORS.info;
        return (
          <div
            key={t.id}
            className="slide-in"
            style={{
              background: 'var(--card2)',
              border: `1px solid color-mix(in srgb, ${cfg.color} 28%, transparent)`,
              borderRight: `3px solid ${cfg.color}`,
              borderRadius: 10,
              padding: '10px 16px',
              fontSize: 13, color: 'var(--text)',
              boxShadow: '0 8px 32px rgba(0,0,0,.6)',
              maxWidth: 340,
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <span style={{ color: cfg.color, display: 'flex', flexShrink: 0 }}>{cfg.icon}</span>
            {t.msg}
          </div>
        );
      })}
    </div>
  );
}

// ─── Diff cell ─────────────────────────────────────────────────────────────────
export function DiffCell({ value }) {
  if (value === null || value === undefined) return <span style={{ color: 'var(--muted)' }}>—</span>;
  const abs = Math.abs(value);
  if (abs <= 0.5) return <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>0.00</span>;
  const isOver = value > 0;
  return (
    <span style={{
      color: isOver ? 'var(--red)' : 'var(--green)',
      fontFamily: 'var(--font-mono)', fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', gap: 2,
    }}>
      {isOver ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
      {isOver ? '+' : ''}{value.toFixed(2)}
    </span>
  );
}
