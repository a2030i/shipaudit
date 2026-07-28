import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Spinner } from '../components/UI.jsx';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import { useAuth } from '../lib/auth.jsx';

// دخول هادئ ومتسق مع مساحة العمل المالية. الأصناف النهائية في design-v5.css.
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
    <div className="login-hero" style={{
      width: '100vw', height: '100vh',
      display: 'flex', overflow: 'hidden',
      position: 'relative',
    }}>

      {/* ── Left panel (desktop decoration) ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '60px 80px',
        position: 'relative', overflow: 'hidden',
      }} className="login-left-panel">

        {/* Glow orb */}
        <div style={{
          position: 'absolute', top: '20%', right: '18%',
          width: 340, height: 340, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(49,213,225,.20) 0%, transparent 70%)',
          filter: 'blur(50px)',
          pointerEvents: 'none',
        }}/>

        <div className="login-rise" style={{ position: 'relative', zIndex: 1, maxWidth: 440, width: '100%' }}>
          {/* الشعار الرسمي الأبيض الكامل */}
          <div style={{ marginBottom: 14 }}>
            <LamhaLogo height={64} variant="white"/>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 40,
            fontSize: 11, color: '#31D5E1',
            letterSpacing: 4, fontFamily: 'var(--font-mono)',
            fontWeight: 600, textTransform: 'uppercase',
          }}>
            <span className="live-dot"/>
            Operations Center
          </div>

          {/* Features — بطاقات زجاجية */}
          {[
            { icon: '📊', title: 'تدقيق فواتير الشحن',    sub: 'مراجعة تلقائية لفواتير الناقلين وكشف الفروق بالهللة' },
            { icon: '💸', title: 'إدارة المدفوعات + COD',  sub: 'تتبع كل دفعة، تسوية COD، وأعمار ديون مباشرة' },
            { icon: '📨', title: 'استلام تلقائي بالويب هوك', sub: 'الفواتير تصل لإيميل النظام وتُسجَّل تلقائياً للشركة الصحيحة' },
          ].map((f, i) => (
            <div key={f.title} className="login-rise" style={{
              display: 'flex', gap: 14, marginBottom: 16,
              padding: '15px 18px', borderRadius: 14,
              background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.12)',
              backdropFilter: 'blur(8px)',
              animationDelay: `${.12 + i * .09}s`,
            }}>
              <span style={{ fontSize: 24, flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4, color: '#FFFFFF' }}>{f.title}</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.62)', lineHeight: 1.65 }}>{f.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel (form) ── */}
      <div style={{
        width: '100%', maxWidth: 470,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 48px',
        position: 'relative',
        flexShrink: 0,
      }} className="login-right-panel">

        <div className="login-glass login-rise" style={{ width: '100%', maxWidth: 380, padding: '38px 34px', animationDelay: '.08s' }}>

          {/* Mobile logo (hidden on desktop) */}
          <div className="login-mobile-logo" style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <LamhaLogo height={44} variant="white"/>
            </div>
            <div style={{ fontSize: 10, color: '#31D5E1', letterSpacing: 3, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
              Operations Center
            </div>
          </div>

          <div style={{ marginBottom: 26 }}>
            <h2 style={{ fontSize: 21, fontWeight: 800, marginBottom: 6, color: '#FFFFFF' }}>مرحباً بك</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.58)' }}>سجّل دخولك للوصول إلى مركز العمليات</p>
          </div>

          <form onSubmit={handle}>
            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.78)', marginBottom: 7 }}>
                البريد الإلكتروني
              </label>
              <input
                type="email" required
                className="login-input"
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="example@company.com"
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.78)', marginBottom: 7 }}>
                كلمة المرور
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'} required
                  className="login-input"
                  style={{ paddingLeft: 44 }}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button type="button" aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} onClick={() => setShowPw(v => !v)} style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(255,255,255,.55)', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}>
                  {showPw ? <EyeOff size={17}/> : <Eye size={17}/>}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: 'rgba(248,113,113,.14)', border: '1px solid rgba(248,113,113,.38)',
                color: '#FCA5A5', borderRadius: 10, padding: '10px 14px',
                fontSize: 12, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center',
              }}>
                ⚠ {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '13px 0', borderRadius: 12,
              background: loading
                ? 'rgba(255,255,255,.10)'
                : 'var(--brand)',
              border: 'none',
              color: loading ? 'rgba(255,255,255,.5)' : '#fff',
              fontWeight: 700, fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: loading ? 'none' : '0 8px 22px rgba(37,99,235,.28)',
              transition: 'opacity .2s, box-shadow .2s',
              fontFamily: 'var(--font-sans)',
            }}>
              {loading ? <><Spinner size={15}/> جاري الدخول...</> : 'دخول →'}
            </button>
          </form>
        </div>

        <div style={{ position: 'absolute', bottom: 20, fontSize: 11, color: 'rgba(255,255,255,.42)' }}>
          لمحة · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
