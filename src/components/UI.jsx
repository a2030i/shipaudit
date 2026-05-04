import { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, HelpCircle, AlertCircle } from 'lucide-react';

// ─── Button ────────────────────────────────────────────────────────────────────
const VARIANTS = {
  primary: {
    background: 'linear-gradient(135deg, var(--accent3), var(--accent2))',
    color: '#fff',
    border: '1px solid transparent',
    boxShadow: '0 4px 16px rgba(14,165,233,.28)',
  },
  danger: {
    background: 'linear-gradient(135deg, #be123c, var(--red))',
    color: '#fff',
    border: '1px solid transparent',
    boxShadow: '0 4px 16px rgba(248,113,113,.2)',
  },
  success: {
    background: 'linear-gradient(135deg, var(--green2), var(--green))',
    color: '#fff',
    border: '1px solid transparent',
    boxShadow: '0 4px 16px rgba(52,211,153,.22)',
  },
  gold: {
    background: 'linear-gradient(135deg, var(--gold2), var(--gold))',
    color: '#0a0f18',
    border: '1px solid transparent',
    boxShadow: '0 4px 16px rgba(251,191,36,.22)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--muted)',
    border: '1px solid var(--border2)',
    boxShadow: 'none',
  },
  outline: {
    background: 'transparent',
    color: 'var(--accent)',
    border: '1px solid rgba(56,189,248,.35)',
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
export function Card({ children, style = {}, accent, hover = false }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => hover && setHovered(true)}
      onMouseLeave={() => hover && setHovered(false)}
      style={{
        background: 'var(--card)',
        border: `1px solid ${hovered && hover ? 'var(--border2)' : 'var(--border)'}`,
        borderRadius: 'var(--r-lg)',
        padding: 20,
        transition: 'all .2s',
        transform: hovered && hover ? 'translateY(-2px)' : 'none',
        boxShadow: hovered && hover ? 'var(--shadow-md)' : 'none',
        ...(accent ? { borderTop: `2px solid ${accent}` } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── StatCard ──────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, color, onClick, icon, trend }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onClick && setHovered(true)}
      onMouseLeave={() => onClick && setHovered(false)}
      style={{
        background: 'var(--card)',
        border: `1px solid ${hovered ? 'var(--border2)' : 'var(--border)'}`,
        borderRadius: 'var(--r-lg)',
        padding: '16px 20px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all .2s',
        transform: hovered && onClick ? 'translateY(-2px)' : 'none',
        boxShadow: hovered && onClick ? 'var(--shadow-md)' : 'none',
        minWidth: 130,
        borderTop: `2px solid ${color}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: .5 }}>
          {label}
        </span>
        {icon && (
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: `color-mix(in srgb, ${color} 14%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13,
          }}>
            {icon}
          </div>
        )}
      </div>
      <div style={{ color, fontSize: 24, fontFamily: 'var(--font-mono)', fontWeight: 700, lineHeight: 1 }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ color: 'var(--muted)', fontSize: 10, marginTop: 5 }}>{sub}</div>}
      {trend !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 5 }}>
          {trend > 0
            ? <TrendingUp size={11} color="var(--red)"/>
            : <TrendingDown size={11} color="var(--green)"/>
          }
          <span style={{ color: trend > 0 ? 'var(--red)' : 'var(--green)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
            {trend > 0 ? '+' : ''}{trend.toFixed(2)} ر.س
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Badge ─────────────────────────────────────────────────────────────────────
const BADGE_CFG = {
  ok:          { bg: 'rgba(52,211,153,.1)',  color: 'var(--green)',  bd: 'rgba(52,211,153,.25)',  lbl: '✓ مطابق',     Icon: CheckCircle2 },
  mismatch:    { bg: 'rgba(248,113,113,.1)', color: 'var(--red)',    bd: 'rgba(248,113,113,.25)', lbl: '✗ فرق',       Icon: XCircle },
  unknown:     { bg: 'rgba(74,106,144,.1)',  color: 'var(--muted)',  bd: 'rgba(74,106,144,.25)',  lbl: '؟ غير معروف', Icon: HelpCircle },
  no_contract: { bg: 'rgba(251,146,60,.1)',  color: 'var(--warn)',   bd: 'rgba(251,146,60,.25)',  lbl: '⚠ لا عقد',   Icon: AlertTriangle },
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
        background: 'rgba(2,5,10,.82)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="scale-in"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border2)',
          borderRadius: 'var(--r-xl)',
          padding: 28, width,
          maxWidth: '95vw', maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 24px 80px rgba(0,0,0,.8), 0 0 0 1px rgba(56,189,248,.06)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h3 style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700 }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--muted)', borderRadius: 8,
              padding: '5px 8px', cursor: 'pointer',
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
