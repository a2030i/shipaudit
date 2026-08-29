import { useState } from 'react';
import { ArrowLeft, CircleGauge, Eye, EyeOff, Search, ShieldCheck } from 'lucide-react';
import { Spinner } from '../components/UI.jsx';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import { useAuth } from '../lib/auth.jsx';
import './LoginPage.css';

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
      console.error('[auth] sign-in unavailable', err);
      setError('تعذر الاتصال بخدمة الدخول. حاول مرة أخرى.');
      setLoading(false);
    }
  };

  return (
    <main className="login-hero" dir="rtl">
      <section className="login-left-panel" aria-label="ShipAudit V2">
        <div className="login-story login-rise">
          <div className="login-brand">
            <LamhaLogo height={64} variant="white"/>
          </div>
          <span className="login-product-kicker"><i className="live-dot"/> SHIPAUDIT V2</span>
          <h1>نظام تشغيل موحّد لقيادة الشركة</h1>
          <p className="login-story__lead">من الإشارة إلى القرار ثم الإجراء والنتيجة، ضمن مساحة واحدة تربط السياق المالي والتشغيلي الحقيقي.</p>

          <div className="login-capabilities">
          {[
            { icon: CircleGauge, title: 'مركز قيادة تنفيذي', sub: 'الاستثناءات والقرارات مرتبة بحسب الأثر وقابلية التنفيذ.' },
            { icon: Search, title: 'وصول موحّد للكيانات', sub: 'العميل والمتجر والفاتورة والسياق المرتبط من نقطة وصول واحدة.' },
            { icon: ShieldCheck, title: 'إجراءات آمنة وقابلة للتحقق', sub: 'مراجعة الأثر ثم التنفيذ عبر التكاملات الحالية وتتبّع النتيجة.' },
          ].map((f, i) => (
            <div key={f.title} className="login-capability login-rise" style={{ animationDelay: `${.1 + i * .07}s` }}>
              <span><f.icon size={19}/></span>
              <div>
                <strong>{f.title}</strong>
                <small>{f.sub}</small>
              </div>
            </div>
          ))}
          </div>
        </div>
      </section>

      <section className="login-right-panel" aria-label="تسجيل الدخول">
        <div className="login-glass login-rise">
          <div className="login-mobile-logo">
            <div>
              <LamhaLogo height={44} variant="color"/>
            </div>
            <span>SHIPAUDIT V2</span>
          </div>

          <div className="login-form-heading">
            <span>مساحة الإدارة</span>
            <h2>تسجيل الدخول</h2>
            <p>ادخل إلى مركز القيادة ومساحات العمل الموحّدة.</p>
          </div>

          <form onSubmit={handle}>
            <div className="login-field">
              <label htmlFor="login-email">البريد الإلكتروني</label>
              <input
                id="login-email" type="email" required autoComplete="username"
                className="login-input"
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="example@company.com"
              />
            </div>

            <div className="login-field">
              <label htmlFor="login-password">كلمة المرور</label>
              <div className="login-password-field">
                <input
                  id="login-password" type={showPw ? 'text' : 'password'} required autoComplete="current-password"
                  className="login-input"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button type="button" aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} onClick={() => setShowPw(v => !v)}>
                  {showPw ? <EyeOff size={17}/> : <Eye size={17}/>}
                </button>
              </div>
            </div>

            {error && (
              <div className="login-error" role="alert"><span aria-hidden="true">!</span>{error}</div>
            )}

            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? <><Spinner size={15}/> جارٍ التحقق…</> : <>دخول آمن <ArrowLeft size={17}/></>}
            </button>
          </form>
        </div>

        <footer className="login-footer">لمحة · {new Date().getFullYear()}</footer>
      </section>
    </main>
  );
}
