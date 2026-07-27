// رفع كشف حساب الناقل كمودال مباشر — من داخل الدفتر (بلا تحويل لصفحة الكشوف).
// يعيد استخدام نفس محلّلات صفحة الكشوف (sniff/smsa/aramex/AI) و saveCarrierStatement،
// بمعاينة مختصرة (عدد العمليات + الرصيد). للحالات الخاصة (تعدّد حسابات الشركة/
// مراجعة صف-بصف) تبقى صفحة «كشوف الحساب الخارجية» الكاملة.
import { useState, useCallback, useRef } from 'react';
import { Upload, Save, Sparkles, FileText } from 'lucide-react';
import { Modal, Btn, Spinner, toast } from './UI.jsx';
import { parseAramexStatement } from '../engine/aramexStatementParser.js';
import { parseSmsaStatement, sniffStatementCarrier } from '../engine/smsaStatementParser.js';
import { parseStatementWithAI } from '../engine/aiStatementParser.js';
import { saveCarrierStatement } from '../lib/carrierStatementsService.js';
import { useAuth } from '../lib/auth.jsx';

const fmt = n => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isFast = s => /aramex|أرامكس|ارامكس/i.test(String(s ?? ''));

export default function StatementUploadModal({ open, onClose, carrierId, carrierName, onSaved }) {
  const { user } = useAuth();
  const [state, setState] = useState('idle');   // idle|processing|done|saving|saved|error
  const [aiStatus, setAiStatus] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [diff, setDiff] = useState(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const processFile = useCallback(async (file) => {
    if (!file) return;
    setState('processing'); setErr(''); setAiStatus(''); setResult(null); setDiff(null);
    try {
      // شمّ المُصدِر ثم توجيه للمحلّل الصحيح (نفس منطق صفحة الكشوف)
      const sniff = await sniffStatementCarrier(await file.arrayBuffer());
      const wantSmsa   = sniff === 'smsa'   || /smsa|سمسا/i.test(carrierId) || /smsa|سمسا/i.test(carrierName);
      const wantAramex = sniff === 'aramex' || isFast(carrierId) || isFast(carrierName);
      let parsed, parserUsed;
      if (wantSmsa) {
        parsed = await parseSmsaStatement(await file.arrayBuffer()); parserUsed = 'smsa';
        if (!parsed.operations.length) { setAiStatus('✨ قارئ سمسا لم يلتقط شيئاً — يجرّب AI…'); parsed = await parseStatementWithAI(await file.arrayBuffer(), { carrierHint: carrierName }); parserUsed = 'ai'; }
      } else if (wantAramex) {
        parsed = await parseAramexStatement(await file.arrayBuffer()); parserUsed = 'aramex';
        if (!parsed.operations.length) { setAiStatus('✨ القارئ السريع لم يلتقط شيئاً — يجرّب AI…'); parsed = await parseStatementWithAI(await file.arrayBuffer(), { carrierHint: carrierName }); parserUsed = 'ai'; }
      } else {
        setAiStatus('✨ AI يقرأ الكشف ويستخرج العمليات…');
        parsed = await parseStatementWithAI(await file.arrayBuffer(), { carrierHint: carrierName }); parserUsed = 'ai';
      }
      setResult({ ...parsed, fileName: file.name, file, carrierId, carrierName, parserUsed });
      setState('done');
      toast(`تم استخراج ${parsed.operations.length} عملية${parserUsed === 'ai' ? ' عبر AI' : ''}`, 'success');
    } catch (e) {
      console.error(e); setErr(e.message || 'تعذّر قراءة كشف الحساب'); setState('error');
    }
    setAiStatus('');
  }, [carrierId, carrierName]);

  const save = async () => {
    if (!result) return;
    setState('saving');
    try {
      const { diff: d } = await saveCarrierStatement({
        carrierId, carrierName, fileName: result.fileName, file: result.file, parsed: result, userId: user?.id,
      });
      setDiff(d); setState('saved');
      toast(`تم الحفظ — ${d.added} جديدة · ${d.updated} محدّثة · ${d.reviewing} تحت المراجعة`, 'success');
      onSaved?.();
    } catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); setState('done'); }
  };

  if (!open) return null;
  const ops = result?.operations || [];
  const total = ops.reduce((s, o) => s + (Number(o.amountDr || o.amount || 0) - Number(o.amountCr || 0)), 0);

  return (
    <Modal title={`رفع كشف حساب — ${carrierName}`} onClose={onClose} width={520}>
      {state === 'saved' ? (
        <div>
          <div style={{ fontSize: 13, color: 'var(--green2)', background: 'color-mix(in srgb, var(--green) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--green) 28%, transparent)', borderRadius: 8, padding: '12px 14px', lineHeight: 1.9 }}>
            ✅ حُفظ الكشف في دفتر «{carrierName}».<br/>
            <b>{diff?.added || 0}</b> عملية جديدة · <b>{diff?.updated || 0}</b> محدّثة · <b>{diff?.reviewing || 0}</b> تحت المراجعة{diff?.frozen ? ` · ${diff.frozen} مثبّتة (مسدَّدة)` : ''}
          </div>
          <div style={{ marginTop: 16, textAlign: 'left' }}><Btn variant="primary" onClick={() => { onClose?.(); }}>تم</Btn></div>
        </div>
      ) : state === 'done' ? (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {[['العمليات', ops.length, 'var(--brand)'], ['صافي الكشف', fmt(total), 'var(--accent)'],
              ['المُصدِر', result?.parserUsed === 'ai' ? 'AI ✨' : (result?.parserUsed === 'smsa' ? 'سمسا' : 'سريع'), 'var(--muted)']].map(([l, v, c]) => (
              <div key={l} style={{ flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{l}</div>
                <div style={{ fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-mono)', color: c }}>{v}</div>
              </div>
            ))}
          </div>
          {result?.header?.accountNumber && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>رقم الحساب: {result.header.accountNumber}</div>}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>
            <FileText size={12} style={{ verticalAlign: -1 }}/> {result?.fileName} — راجع التفاصيل صفاً-بصف من «كشوف الحساب الكاملة» إن لزم.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
            <Btn variant="accent" icon={<Save size={14}/>} onClick={save}>حفظ في الدفتر ({ops.length})</Btn>
            <Btn variant="ghost" onClick={() => { setState('idle'); setResult(null); }}>ملف آخر</Btn>
            <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          </div>
        </div>
      ) : state === 'processing' || state === 'saving' ? (
        <div style={{ padding: '30px 10px', textAlign: 'center' }}>
          <Spinner/>
          <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--muted)' }}>{state === 'saving' ? 'يحفظ في الدفتر…' : (aiStatus || 'يحلّل الكشف…')}</div>
        </div>
      ) : (
        <div>
          <div onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer?.files?.[0]; if (f) processFile(f); }}
            style={{ border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 14, padding: '38px 20px',
              textAlign: 'center', cursor: 'pointer', background: drag ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'var(--bg)' }}>
            <Upload size={30} style={{ color: 'var(--muted)' }}/>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10 }}>اسحب كشف حساب «{carrierName}» هنا</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>PDF · يُحلَّل تلقائياً <Sparkles size={11} style={{ verticalAlign: -1 }}/></div>
          </div>
          {state === 'error' && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--red)' }}>⚠️ {err}</div>}
          <input ref={inputRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }}/>
        </div>
      )}
    </Modal>
  );
}
