import { useState } from 'react';
import { Spinner } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handle = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (result?.error) {
        setError('البريد الإلكتروني أو كلمة المرور غير صحيحة');
        setLoading(false);
      }
      // if success: stay loading while AuthProvider fetches profile
    } catch (err) {
      setError(`خطأ في الاتصال: ${err.message}`);
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'var(--bg)',
      display: 'flex', overflow: 'hidden',
      backgroundImage: `
        radial-gradient(ellipse 80% 60% at 15% 50%, rgba(56,189,248,.07) 0%, transparent 60%),
        radial-gradient(ellipse 60% 50% at 85% 20%, rgba(167,139,250,.05) 0%, transparent 55%),
        radial-gradient(ellipse 40% 40% at 50% 90%, rgba(14,165,233,.04) 0%, transparent 50%)
      `,
    }}>

      {/* ── Left panel (desktop decoration) ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '60px 80px',
        borderLeft: '1px solid var(--border)',
        position: 'relative', overflow: 'hidden',
      }} className="login-left-panel">

        {/* Grid decoration */}
        <div style={{
          position: 'absolute', inset: 0, opacity: .025,
          backgroundImage: `linear-gradient(var(--accent) 1px, transparent 1px), linear-gradient(90deg, var(--accent) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}/>

        {/* Glow orb */}
        <div style={{
          position: 'absolute', top: '25%', right: '20%',
          width: 300, height: 300, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56,189,248,.12) 0%, transparent 70%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}/>

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 420, width: '100%' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 48 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'linear-gradient(135deg, var(--accent3), var(--accent))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, boxShadow: '0 8px 32px rgba(56,189,248,.35)',
              flexShrink: 0,
            }}>📦</div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 26, lineHeight: 1 }}>
                Ship<span style={{ color: 'var(--accent)' }}>Audit</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, letterSpacing: 1 }}>
                FINANCIAL MANAGEMENT SYSTEM
              </div>
            </div>
          </div>

          {/* Features */}
          {[
            { icon: '📊', title: 'تدقيق فواتير الشحن', sub: 'مراجعة تلقائية لفواتير شركات الشحن وكشف الفروق' },
            { icon: '📨', title: 'إدارة البريد المالي',  sub: 'تصنيف ومتابعة المراسلات المالية الواردة بالذكاء الاصطناعي' },
            { icon: '✨', title: 'تحليل ذكي',            sub: 'استخراج البيانات وتوليد التقارير تلقائياً' },
          ].map(f => (
            <div key={f.title} style={{
              display: 'flex', gap: 14, marginBottom: 24,
              padding: '14px 16px', borderRadius: 12,
              background: 'rgba(13,31,54,.6)', border: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{f.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>{f.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel (form) ── */}
      <div style={{
        width: '100%', maxWidth: 440,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 48px',
        background: 'var(--bg2)',
        position: 'relative',
        flexShrink: 0,
      }} className="login-right-panel">

        {/* Mobile logo (hidden on desktop) */}
        <div className="login-mobile-logo" style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: '0 auto 12px',
            background: 'linear-gradient(135deg, var(--accent3), var(--accent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, boxShadow: '0 8px 32px rgba(56,189,248,.35)',
          }}>📦</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 22 }}>
            Ship<span style={{ color: 'var(--accent)' }}>Audit</span>
          </div>
        </div>

        <div style={{ width: '100%', maxWidth: 360 }}>
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>مرحباً بك</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>سجّل دخولك للوصول إلى النظام</p>
          </div>

          <form onSubmit={handle}>
            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 7 }}>
                البريد الإلكتروني
              </label>
              <input
                type="email" required
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="example@company.com"
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 10,
                  fontSize: 13, background: 'var(--surface)',
                  border: '1.5px solid var(--border2)', color: 'var(--text)',
                  outline: 'none', boxSizing: 'border-box', direction: 'ltr',
                  transition: 'border-color .2s, box-shadow .2s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px rgba(56,189,248,.12)'; }}
                onBlur={e  => { e.target.style.borderColor = 'var(--border2)'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 7 }}>
                كلمة المرور
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'} required
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    width: '100%', padding: '12px 44px 12px 14px', borderRadius: 10,
                    fontSize: 13, background: 'var(--surface)',
                    border: '1.5px solid var(--border2)', color: 'var(--text)',
                    outline: 'none', boxSizing: 'border-box', direction: 'ltr',
                    transition: 'border-color .2s, box-shadow .2s',
                  }}
                  onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px rgba(56,189,248,.12)'; }}
                  onBlur={e  => { e.target.style.borderColor = 'var(--border2)'; e.target.style.boxShadow = 'none'; }}
                />
                <button type="button" onClick={() => setShowPw(v => !v)} style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted)', fontSize: 15, padding: 0,
                }}>
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.3)',
                color: 'var(--red)', borderRadius: 10, padding: '10px 14px',
                fontSize: 12, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center',
              }}>
                ⚠ {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '13px 0', borderRadius: 11,
              background: loading
                ? 'var(--surface)'
                : 'linear-gradient(135deg, var(--accent3), var(--accent))',
              border: 'none',
              color: loading ? 'var(--muted)' : '#fff',
              fontWeight: 700, fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: loading ? 'none' : '0 4px 20px rgba(56,189,248,.35)',
              transition: 'opacity .2s, box-shadow .2s',
              fontFamily: 'var(--font-sans)',
            }}>
              {loading ? <><Spinner size={15}/> جاري الدخول...</> : 'دخول →'}
            </button>
          </form>
        </div>

        <div style={{ position: 'absolute', bottom: 20, fontSize: 11, color: 'var(--muted2)' }}>
          ShipAudit Pro · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
