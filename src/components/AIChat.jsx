import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Send, RefreshCw, Sparkles } from 'lucide-react';
import { Spinner, toast } from './UI.jsx';
import { buildAssistantContext, askAssistant } from '../engine/aiAssistant.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Floating AI assistant — WhatsApp-style.
//  Bottom-left corner (visual) on RTL layouts.
// ─────────────────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'كم رصيدي الإجمالي؟',
  'أي شركة لها أكبر مبلغ مستحق؟',
  'كم فاتورة متأخّرة عن السداد؟',
  'وش آخر كشف رفعته؟',
  'كم عملية متنازع عليها؟',
];

export default function AIChat() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]); // [{ role, content }]
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [context, setContext]   = useState(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const abortRef = useRef(null);
  const scrollRef = useRef(null);

  // (Re)build context whenever the panel opens.
  const refreshContext = useCallback(async () => {
    setCtxLoading(true);
    try {
      const ctx = await buildAssistantContext();
      setContext(ctx.contextText);
    } catch (e) {
      toast(`فشل تحميل السياق: ${e.message}`, 'error');
    }
    setCtxLoading(false);
  }, []);

  useEffect(() => { if (open && !context) refreshContext(); }, [open, context, refreshContext]);

  // Scroll to bottom when messages grow.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async (text) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || busy) return;
    const userMsg = { role: 'user', content: trimmed };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setBusy(true);
    try {
      const abort = new AbortController();
      abortRef.current = abort;
      const reply = await askAssistant([...messages, userMsg], context, abort.signal);
      setMessages(m => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      if (e.name !== 'AbortError') {
        toast(`AI: ${e.message}`, 'error');
        setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
      }
    }
    setBusy(false);
  };

  const reset = () => {
    setMessages([]);
    refreshContext();
  };

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="مساعد AI"
          style={{
            position: 'fixed',
            bottom: 22,
            left: 22, // bottom-left corner (visual)
            width: 58, height: 58, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent3, var(--accent)), var(--accent))',
            color: '#fff', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(56,189,248,.35)',
            zIndex: 950,
            transition: 'transform .15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.06)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <MessageCircle size={24} strokeWidth={2.2}/>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 22, left: 22,
          width: 380, maxWidth: 'calc(100vw - 28px)',
          height: 560, maxHeight: 'calc(100vh - 28px)',
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,.32)',
          display: 'flex', flexDirection: 'column',
          zIndex: 950,
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 14px',
            background: 'linear-gradient(135deg, var(--accent3, var(--accent)), var(--accent))',
            color: '#fff',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Sparkles size={18}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.1 }}>المحاسب الذكي</div>
              <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>
                {ctxLoading ? 'جارٍ تحميل البيانات...' : 'يرى أرصدتك وعملياتك المحفوظة'}
              </div>
            </div>
            <button onClick={reset} title="جلسة جديدة" style={{ ...iconBtn }}>
              <RefreshCw size={15}/>
            </button>
            <button onClick={() => setOpen(false)} title="إغلاق" style={{ ...iconBtn }}>
              <X size={16}/>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{
            flex: 1, padding: '12px 14px', overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 8,
            background: 'var(--bg)',
          }}>
            {messages.length === 0 && !ctxLoading && (
              <div style={{ textAlign: 'center', padding: '12px 6px', color: 'var(--muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>💼</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
                  أهلاً، أنا المحاسب الذكي
                </div>
                <div style={{ fontSize: 12, marginBottom: 14 }}>
                  أقدر أجاوب عن أرصدتك، عملياتك، الفواتير المعلّقة وأي شي مالي في النظام.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)} style={{
                      padding: '8px 12px', borderRadius: 9,
                      background: 'var(--card)', border: '1px solid var(--border)',
                      color: 'var(--text)', cursor: 'pointer', fontSize: 12,
                      textAlign: 'right', fontFamily: 'var(--font-sans)',
                      transition: 'all .12s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text)'; }}
                    >{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '8px 12px', borderRadius: 11,
                fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--card)',
                color:      m.role === 'user' ? '#fff' : 'var(--text)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                borderBottomRightRadius: m.role === 'user' ? 3 : 11,
                borderBottomLeftRadius:  m.role === 'user' ? 11 : 3,
              }}>
                {m.content}
              </div>
            ))}
            {busy && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center', color: 'var(--muted)', fontSize: 12 }}>
                <Spinner size={12}/> يفكر...
              </div>
            )}
          </div>

          {/* Composer */}
          <div style={{
            padding: '10px 12px', borderTop: '1px solid var(--border)',
            background: 'var(--card)', display: 'flex', gap: 8,
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="اسأل عن أي شي مالي..."
              disabled={busy || ctxLoading}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: 9, fontSize: 13,
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', fontFamily: 'inherit',
              }}
            />
            <button onClick={() => send()} disabled={busy || !input.trim()}
              style={{
                width: 38, height: 38, borderRadius: 9, border: 'none', cursor: 'pointer',
                background: 'var(--accent)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: busy || !input.trim() ? 0.5 : 1,
              }}>
              <Send size={16}/>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const iconBtn = {
  background: 'rgba(255,255,255,.15)', border: 'none',
  color: '#fff', cursor: 'pointer', padding: '6px',
  borderRadius: 7, display: 'flex', alignItems: 'center',
};
