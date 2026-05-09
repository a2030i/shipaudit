import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Send, RefreshCw, Sparkles, Paperclip, Save } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Spinner, toast } from './UI.jsx';
import { buildAssistantContext, askAssistant } from '../engine/aiAssistant.js';
import { parseAramexStatement } from '../engine/aramexStatementParser.js';
import { parseStatementWithAI } from '../engine/aiStatementParser.js';
import { saveCarrierStatement } from '../lib/carrierStatementsService.js';
import {
  detectHeaderRow, buildHeaders, detectColumns, mapRows, auditAll, buildSummary,
} from '../engine/audit.js';
import { aiAnalyzeFile } from '../engine/openrouter.js';
import { loadSettings } from '../data/carriers.js';
import { loadCarriers, saveAuditToDB } from '../lib/coreService.js';
import { useAuth } from '../lib/auth.jsx';

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
  const { user } = useAuth();
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]); // [{ role, content, attachment? }]
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [uploading, setUploading] = useState(false);
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

  // ── File attachment: PDF (statement) or Excel (per-shipment audit) ────────
  const handleFileAttach = async (file) => {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    setUploading(true);
    setMessages(m => [...m, { role: 'user', content: `📎 رفعت: ${file.name}` }]);
    try {
      const carriers = await loadCarriers();
      if (ext === 'pdf') await processStatementPdf(file, carriers);
      else if (ext === 'xlsx' || ext === 'xls') await processInvoiceExcel(file, carriers);
      else throw new Error('نوع الملف غير مدعوم — PDF كشف أو Excel فاتورة فقط');
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    }
    setUploading(false);
  };

  // ── PDF (carrier statement) — parse + offer save ──────────────────────────
  const processStatementPdf = async (file, carriers) => {
    setMessages(m => [...m, { role: 'assistant', content: '⏳ يقرأ الكشف...' }]);
    const buf = await file.arrayBuffer();
    let parsed;
    try { parsed = await parseAramexStatement(buf); } catch { parsed = null; }
    if (!parsed || parsed.operations.length === 0) {
      parsed = await parseStatementWithAI(buf, { carrierHint: 'كشف حساب' });
    }
    if (!parsed.operations.length) throw new Error('لم تُستخرج عمليات من الـ PDF');

    const carrier = carriers.find(c => /aramex|أرامكس|ارامكس/i.test(c.name) || /aramex/i.test(c.id))
      || carriers[0];

    const opCount = parsed.operations.length;
    const total   = parsed.totals?.totalBalance ?? 0;
    const period  = parsed.header?.periodFrom && parsed.header?.periodTo
      ? `${parsed.header.periodFrom} ← ${parsed.header.periodTo}` : '—';

    setMessages(m => {
      const trimmed = m.slice(0, -1); // drop the loading bubble
      return [...trimmed, {
        role: 'assistant',
        content: `✅ كشف حساب — ${opCount} عملية\nالفترة: ${period}\nالإجمالي: ${Number(total).toLocaleString('ar-SA', { minimumFractionDigits: 2 })} ر.س`,
        attachment: { kind: 'statement', file, parsed, carrierId: carrier?.id, carrierName: carrier?.name },
      }];
    });
  };

  // ── Excel (per-shipment invoice) — audit + offer save ─────────────────────
  const processInvoiceExcel = async (file, carriers) => {
    setMessages(m => [...m, { role: 'assistant', content: '⏳ يدقّق الفاتورة...' }]);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (!allRows.length) throw new Error('الملف فارغ');

    let headerRow = detectHeaderRow(allRows);
    let headers   = buildHeaders(allRows[headerRow]);
    let colMap    = detectColumns(headers);
    const settings = loadSettings();
    if (settings.openrouterKey) {
      try {
        const aiResult = await aiAnalyzeFile(allRows);
        if (aiResult) {
          headerRow = Math.min(aiResult.headerRow ?? headerRow, allRows.length - 2);
          headers   = buildHeaders(allRows[headerRow]);
          const merged = { ...detectColumns(headers) };
          for (const [field, col] of Object.entries(aiResult.colMap || {})) {
            if (col && headers.includes(col)) merged[field] = col;
            else if (col === null)             merged[field] = null;
          }
          colMap = merged;
        }
      } catch { /* AI is optional */ }
    }

    const data = allRows.slice(headerRow + 1)
      .filter(row => row && row.some(v => v !== null && v !== '' && v !== undefined))
      .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
    const mapped  = mapRows(data, colMap);

    // Pick the most-likely carrier — prefer Aramex if filename contains a doc_no-style number.
    const carrier = carriers.find(c => /aramex|أرامكس|ارامكس/i.test(c.name) || /aramex/i.test(c.id))
      || carriers[0];
    if (!carrier) throw new Error('لا توجد شركة شحن مُعرَّفة');

    const today = new Date().toISOString().slice(0, 10);
    const results = auditAll(mapped, carrier, today);
    const summary = buildSummary(results);
    if (!results.length) throw new Error('لم تُستخرج شحنات من الملف — تحقق من الأعمدة');

    const period = today.slice(0, 7);
    const auditDraft = {
      id:           `a_${Date.now()}`,
      carrierId:    carrier.id,
      carrierName:  carrier.name,
      period,
      fileName:     file.name,
      rowCount:     results.length,
      issueCount:   summary.mismatch,
      diff:         summary.totalDiff,
      colMap,
      summary,
      results,
      createdAt:    new Date().toISOString(),
    };

    setMessages(m => {
      const trimmed = m.slice(0, -1);
      return [...trimmed, {
        role: 'assistant',
        content:
          `✅ فاتورة ${carrier.name}\n` +
          `${results.length} شحنة · ✓ ${summary.ok} مطابق · ✗ ${summary.mismatch} فرق · ↓ ${summary.favorable} لصالحك\n` +
          `إجمالي الفروق: ${Number(summary.totalDiff).toLocaleString('ar-SA', { minimumFractionDigits: 2 })} ر.س`,
        attachment: { kind: 'audit', audit: auditDraft },
      }];
    });
  };

  const saveStatementFromChat = async (att) => {
    setBusy(true);
    try {
      await saveCarrierStatement({
        carrierId:   att.carrierId,
        carrierName: att.carrierName,
        fileName:    att.file.name,
        file:        att.file,
        parsed:      att.parsed,
        userId:      user?.id,
      });
      toast('تم حفظ الكشف في الدفتر', 'success');
      setMessages(m => [...m, { role: 'assistant', content: '✅ حُفِظ في الدفتر — تقدر تتابع من صفحة الدفتر.' }]);
      refreshContext();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(false);
  };

  const saveAuditFromChat = async (att) => {
    setBusy(true);
    try {
      await saveAuditToDB(att.audit, user?.id);
      toast('تم حفظ المراجعة', 'success');
      setMessages(m => [...m, { role: 'assistant', content: '✅ المراجعة محفوظة. اربطها بعملية من الدفتر لتتغيّر حالتها لمعتمدة.' }]);
      refreshContext();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(false);
  };

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="مساعد AI"
          className="ai-chat-fab"
          style={{
            position: 'fixed',
            bottom: 22,
            left: 22, // bottom-left corner (visual)
            width: 56, height: 56, borderRadius: '50%',
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
        <div className="ai-chat-panel" style={{
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
                {m.attachment?.kind === 'statement' && (
                  <button onClick={() => saveStatementFromChat(m.attachment)} disabled={busy}
                    style={chatActionBtn}>
                    <Save size={12}/> حفظ في الدفتر
                  </button>
                )}
                {m.attachment?.kind === 'audit' && (
                  <button onClick={() => saveAuditFromChat(m.attachment)} disabled={busy}
                    style={chatActionBtn}>
                    <Save size={12}/> حفظ المراجعة
                  </button>
                )}
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
            <button onClick={() => document.getElementById('ai-chat-file').click()}
              disabled={busy || uploading}
              title="رفع ملف (PDF كشف أو Excel فاتورة)"
              style={{
                width: 38, height: 38, borderRadius: 9, border: '1px solid var(--border)',
                background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: busy || uploading ? 0.5 : 1, flexShrink: 0,
              }}>
              {uploading ? <Spinner size={14}/> : <Paperclip size={16}/>}
            </button>
            <input id="ai-chat-file" type="file" accept=".pdf,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFileAttach(f); }}/>

            {/* Wrap the input in a form with autoComplete=off so Chrome stops
                offering to "save password" on this regular text field. The
                name keeps the field unique-looking to reduce false-positives. */}
            <form
              autoComplete="off"
              onSubmit={e => { e.preventDefault(); send(); }}
              style={{ flex: 1, display: 'flex' }}
            >
              <input
                name="ai-chat-message"
                type="text"
                autoComplete="off"
                spellCheck={false}
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
            </form>
            <button onClick={() => send()} disabled={busy || !input.trim()}
              style={{
                width: 38, height: 38, borderRadius: 9, border: 'none', cursor: 'pointer',
                background: 'var(--accent)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: busy || !input.trim() ? 0.5 : 1, flexShrink: 0,
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

const chatActionBtn = {
  marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 12px', borderRadius: 8, border: 'none',
  background: 'var(--green)', color: '#fff',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit',
};
