import { useState } from 'react';

// ─── Button ────────────────────────────────────────────────────────────────────
export function Btn({ children, onClick, variant='primary', size='md', disabled, icon, style={} }) {
  const base = {
    display:'inline-flex', alignItems:'center', gap:6,
    border:'none', cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily:'var(--font-sans)', fontWeight:600,
    borderRadius:8, transition:'all .15s',
    opacity: disabled ? .5 : 1,
    ...style,
  };
  const sizes = {
    sm: { padding:'5px 12px', fontSize:12 },
    md: { padding:'8px 18px', fontSize:13 },
    lg: { padding:'11px 26px', fontSize:14 },
  };
  const variants = {
    primary: { background:'linear-gradient(135deg,#0072ff,#00c6ff)', color:'#fff', boxShadow:'0 4px 14px #0072ff30' },
    danger:  { background:'linear-gradient(135deg,#b91c1c,#ff4d6d)', color:'#fff' },
    ghost:   { background:'transparent', border:'1px solid var(--border)', color:'var(--muted)' },
    outline: { background:'transparent', border:'1px solid var(--accent)', color:'var(--accent)' },
    success: { background:'linear-gradient(135deg,#16a34a,#22c55e)', color:'#fff', boxShadow:'0 4px 14px #22c55e28' },
    gold:    { background:'linear-gradient(135deg,#b45309,#f5a623)', color:'#fff' },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{...base,...sizes[size],...variants[variant]}}>
      {icon && <span>{icon}</span>}{children}
    </button>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style={}, accent }) {
  return (
    <div style={{
      background:'var(--card)', border:'1px solid var(--border)',
      borderRadius:12, padding:20,
      ...(accent ? { borderRight:`3px solid ${accent}` } : {}),
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─── Badge ─────────────────────────────────────────────────────────────────────
const BADGE_CFG = {
  ok:          { bg:'#00e67618', color:'#00e676', bd:'#00e67640', lbl:'✓ مطابق' },
  mismatch:    { bg:'#ff4d6d18', color:'#ff4d6d', bd:'#ff4d6d40', lbl:'✗ فرق' },
  unknown:     { bg:'#607d9e18', color:'#607d9e', bd:'#607d9e40', lbl:'؟ غير معروف' },
  no_contract: { bg:'#ffb34718', color:'#ffb347', bd:'#ffb34740', lbl:'⚠ لا عقد' },
};
export function Badge({ status, label }) {
  const c = BADGE_CFG[status] || BADGE_CFG.unknown;
  return (
    <span style={{
      display:'inline-block', padding:'2px 9px', borderRadius:4,
      fontSize:11, fontFamily:'var(--font-mono)', fontWeight:700,
      background:c.bg, color:c.color, border:`1px solid ${c.bd}`,
      whiteSpace:'nowrap',
    }}>
      {label || c.lbl}
    </span>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, color, onClick, icon }) {
  return (
    <div onClick={onClick} style={{
      background:'var(--card)', border:'1px solid var(--border)',
      borderRadius:11, padding:'14px 18px',
      borderTop:`3px solid ${color}`,
      cursor: onClick ? 'pointer' : 'default',
      transition:'transform .15s',
      minWidth:120,
    }}
    onMouseEnter={e=>onClick&&(e.currentTarget.style.transform='translateY(-2px)')}
    onMouseLeave={e=>onClick&&(e.currentTarget.style.transform='')}>
      <div style={{color:'var(--muted)',fontSize:10,fontFamily:'var(--font-mono)',marginBottom:4,display:'flex',alignItems:'center',gap:4}}>
        {icon && <span>{icon}</span>}{label}
      </div>
      <div style={{color,fontSize:22,fontFamily:'var(--font-mono)',fontWeight:700}}>{value}</div>
      {sub && <div style={{color:'var(--muted)',fontSize:10,marginTop:3}}>{sub}</div>}
    </div>
  );
}

// ─── Input ─────────────────────────────────────────────────────────────────────
export function Input({ label, ...props }) {
  return (
    <div>
      {label && <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:5,fontFamily:'var(--font-mono)'}}>{label}</label>}
      <input style={{width:'100%',padding:'8px 11px',borderRadius:7,fontSize:13,...(props.style||{})}} {...props} />
    </div>
  );
}

export function Select({ label, children, ...props }) {
  return (
    <div>
      {label && <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:5,fontFamily:'var(--font-mono)'}}>{label}</label>}
      <select style={{width:'100%',padding:'8px 11px',borderRadius:7,fontSize:13,cursor:'pointer',...(props.style||{})}} {...props}>
        {children}
      </select>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ title, children, onClose, width=520 }) {
  return (
    <div style={{position:'fixed',inset:0,background:'#000c',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="fade-in" style={{
        background:'var(--card)',border:'1px solid var(--border)',
        borderRadius:14,padding:26,width,maxWidth:'95vw',
        maxHeight:'90vh',overflowY:'auto',
        boxShadow:'0 24px 64px #000b',
      }}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <h3 style={{color:'var(--accent)',fontFamily:'var(--font-mono)',fontSize:15}}>{title}</h3>
          <button onClick={onClose} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:14}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Loading spinner ───────────────────────────────────────────────────────────
export function Spinner({ size=20, color='var(--accent)' }) {
  return (
    <div style={{
      width:size,height:size,borderRadius:'50%',
      border:`2px solid ${color}22`,
      borderTopColor:color,
      animation:'spin 0.8s linear infinite',
      display:'inline-block',
      flexShrink:0,
    }}/>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────
export function Empty({ icon='📭', title, sub }) {
  return (
    <div style={{textAlign:'center',padding:'48px 20px',color:'var(--muted)'}}>
      <div style={{fontSize:40,marginBottom:12}}>{icon}</div>
      <div style={{fontSize:14,fontWeight:600,marginBottom:6,color:'var(--text)'}}>{title}</div>
      {sub && <div style={{fontSize:12}}>{sub}</div>}
    </div>
  );
}

// ─── Toast ─────────────────────────────────────────────────────────────────────
let _toastFn = null;
export function setToastFn(fn) { _toastFn = fn; }
export function toast(msg, type='info') { _toastFn?.(msg, type); }

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  setToastFn((msg, type='info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  });
  const colors = { info:'var(--accent)', success:'var(--green)', error:'var(--red)', warn:'var(--warn)' };
  return (
    <div style={{position:'fixed',bottom:24,left:24,zIndex:9999,display:'flex',flexDirection:'column',gap:8}}>
      {toasts.map(t => (
        <div key={t.id} className="slide-in" style={{
          background:'var(--card2)',border:`1px solid ${colors[t.type]}44`,
          borderRight:`3px solid ${colors[t.type]}`,
          borderRadius:9,padding:'10px 16px',
          fontSize:13,color:'var(--text)',
          boxShadow:'0 8px 24px #0006',
          maxWidth:340,
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ─── Diff cell ─────────────────────────────────────────────────────────────────
export function DiffCell({ value }) {
  if (value === null || value === undefined) return <span style={{color:'var(--muted)'}}>—</span>;
  const abs = Math.abs(value);
  if (abs <= 0.5) return <span style={{color:'var(--muted)',fontFamily:'var(--font-mono)'}}>0.00</span>;
  const color = value > 0 ? 'var(--red)' : 'var(--green)';
  return <span style={{color,fontFamily:'var(--font-mono)',fontWeight:700}}>{value>0?'+':''}{value.toFixed(2)}</span>;
}
