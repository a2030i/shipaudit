import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

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
