import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import './design-v5.css'
import './workspace-layout.css'
import './product-shell.css'
import './operations-os.css'
import './shipaudit-os-v2.css'
import './mobile-experience.css'
// This is the final cascade layer by contract: Safari mobile sizing and the
// real PageSlot end spacer must win over every historical/theme stylesheet.
import './mobile-scroll.css'
import './navigation-hub.css'
// Enterprise redesign foundation. This final layer intentionally adapts legacy
// screens while the reference workspaces migrate to the new primitives.
import './design-system/tokens.css'
import './design-system/components.css'
import './design-system/responsive.css'
import './design-system/shell.css'
import './design-system/reference-screens.css'

// توقيت السعودية عالمياً: قاعدة البيانات تخزّن UTC، ونريد العرض بتوقيت الرياض مهما كان
// جهاز المتصفّح. نحقن timeZone='Asia/Riyadh' في كل دوال Date.toLocale* حين لا يُمرَّر
// timeZone صراحةً — يغطّي كل مواضع عرض التاريخ/الوقت دفعة واحدة بلا تغيير صيغها. لا يمسّ
// Number.toLocaleString (الأرقام)، ولا الاستدعاءات التي تمرّر timeZone (مثل saTime.js).
// (لا عملية لأجهزة السعودية أصلاً — يُصحّح فقط الأجهزة بتوقيت مختلف.)
(() => {
  const TZ = 'Asia/Riyadh';
  for (const m of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
    const orig = Date.prototype[m];
    Date.prototype[m] = function (locale, opts) {
      const displayLocale = locale || 'en-GB';
      return orig.call(this, displayLocale, {
        ...(opts || {}),
        timeZone: opts?.timeZone || TZ,
        // ar-SA defaults to Umm al-Qura on many devices. Product dates are Gregorian.
        calendar: 'gregory',
        // ثبّت أرقام التاريخ على 0-9 حتى لا يظهر نفس التاريخ بصيغ رقمية مختلفة.
        numberingSystem: 'latn',
      });
    };
  }
})();

// Top-level error boundary: a render crash anywhere used to unmount the
// whole tree → silent WHITE PAGE with zero clue for the operator. Now the
// error message + stack render on screen so it can be reported instantly.
class RootErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('App crash:', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div dir="rtl" style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 760, margin: '0 auto' }}>
        <h2 style={{ color: '#DC2626' }}>⚠️ حدث خطأ في الواجهة</h2>
        <p>أرسل لقطة لهذه الرسالة ليتم الإصلاح فوراً:</p>
        <pre style={{
          background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8,
          padding: 16, whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', fontSize: 12,
        }}>
          {String(this.state.error?.message || this.state.error)}
          {'\n\n'}
          {String(this.state.error?.stack || '').split('\n').slice(0, 8).join('\n')}
        </pre>
        <button onClick={() => { this.setState({ error: null }); window.location.href = '/overview'; }}
          style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }}>
          العودة للرئيسية
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>,
)
