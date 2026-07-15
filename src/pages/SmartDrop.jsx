// الرفع الذكي — ONE entry point for every carrier file. The operator drops
// a file without thinking about its type; we sniff content (not just the
// extension), name the detected route, and hand the bytes to the right
// screen through the SAME sessionStorage stash + pathname-listener pattern
// the webhook import flow already uses (§1.5/§1.5b):
//   - فاتورة (audit)        → stash 'webhookImport'     → /upload
//   - تحصيل COD (remittance) → stash 'webhookCodImport'  → /cod-settlements
//   - كشف حساب (statement)   → stash 'statementImport'   → /aramex-statements
// Nothing is parsed twice: the destination page does the real processing.

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { UploadCloud, FileText, Banknote, BookOpen, X } from 'lucide-react';
import { Card, Btn, Spinner, toast, PageHeader } from '../components/UI.jsx';
import { detectHeaderRow, buildHeaders, detectColumns, detectCarrierFromFile } from '../engine/audit.js';
import { sniffStatementCarrier } from '../engine/smsaStatementParser.js';
import { looksLikeAramexInvoice } from '../engine/aramexInvoiceParser.js';

const fileToB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = rej;
  r.readAsDataURL(file);
});

export default function SmartDrop({ carriers = [] }) {
  const navigate = useNavigate();
  const [drag, setDrag]       = useState(false);
  const [busy, setBusy]       = useState(false);
  const [verdict, setVerdict] = useState(null); // { kind, label, carrierId, carrierName, go, alternatives }

  const findCarrier = useCallback((pred) => carriers.find(pred) || null, [carriers]);

  const analyze = useCallback(async (file) => {
    if (!file) return;
    setBusy(true);
    setVerdict(null);
    try {
      const b64 = await fileToB64(file);
      const stashAndGo = (key, extra, path) => () => {
        sessionStorage.setItem(key, JSON.stringify({ base64: b64, filename: file.name, ...extra }));
        navigate(path);
      };

      const routes = {
        audit:     (carrierId) => stashAndGo('webhookImport',    carrierId ? { carrierId } : {}, '/upload'),
        cod:       (carrierId) => stashAndGo('webhookCodImport', { carrierId }, '/cod-settlements'),
        statement: (carrierId) => stashAndGo('statementImport',  carrierId ? { carrierId } : {}, `/aramex-statements${carrierId ? `?carrier=${carrierId}` : ''}`),
      };

      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const buf1 = await file.arrayBuffer();
        const sniff = await sniffStatementCarrier(buf1);
        if (sniff) {
          const c = sniff === 'smsa'
            ? findCarrier(x => x.id === 'smsa')
            : findCarrier(x => /aramex|أرامكس|ارامكس/i.test(x.name));
          setVerdict({
            kind: 'statement', icon: <BookOpen size={18}/>,
            label: `كشف حساب ${c?.name || sniff}`,
            note: 'سيُحلَّل وتُعرض الفروقات قبل الحفظ في الدفتر',
            go: routes.statement(c?.id),
          });
          return;
        }
        const buf2 = await file.arrayBuffer();
        if (await looksLikeAramexInvoice(buf2)) {
          const c = findCarrier(x => /aramex|أرامكس|ارامكس/i.test(x.name));
          setVerdict({
            kind: 'audit', icon: <FileText size={18}/>,
            label: `فاتورة أرامكس تفصيلية (PDF)`,
            note: 'ستُدقَّق شحنة-بشحنة ضد العقد',
            go: routes.audit(c?.id),
          });
          return;
        }
        setVerdict({ kind: 'unknown', label: 'PDF غير معروف', choose: routes });
        return;
      }

      // Spreadsheet — peek at the structure.
      const wb   = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
      const hdrI = detectHeaderRow(rows);
      const hdrs = buildHeaders(rows[hdrI] || []);
      const det  = detectCarrierFromFile(rows, carriers);
      const cid  = det && det.confidence >= 0.5 ? det.carrierId : null;
      const cName = cid ? (carriers.find(c => c.id === cid)?.name || cid) : null;
      const colMap = detectColumns(hdrs, cid, carriers);

      if (colMap.deliveryCharges) {
        setVerdict({
          kind: 'audit', icon: <FileText size={18}/>,
          label: `فاتورة شحنات${cName ? ` — ${cName}` : ''}`,
          note: 'فيها رسوم شحن لكل شحنة → تدقيق ضد العقد',
          go: routes.audit(cid),
          choose: routes, carrierId: cid,
        });
      } else if (colMap.awb || colMap.codAmount) {
        setVerdict({
          kind: 'cod', icon: <Banknote size={18}/>,
          label: `ملف تحصيل COD${cName ? ` — ${cName}` : ''}`,
          note: 'أرقام شحنات ومبالغ بدون رسوم شحن → تسوية تحصيل',
          go: cid ? routes.cod(cid) : null,
          needCarrier: !cid, routes, choose: routes, carrierId: cid,
        });
      } else {
        setVerdict({ kind: 'unknown', label: 'لم أتعرّف على نوع الملف', choose: routes, carrierId: cid });
      }
    } catch (e) {
      toast(`تعذّر تحليل الملف: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [carriers, findCarrier, navigate]);

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 760, margin: '0 auto' }}>
      <PageHeader
        icon={<UploadCloud size={22}/>}
        title="رفع ملف"
        subtitle="اسحب أي ملف من أي شركة — فاتورة، تحصيل، أو كشف حساب — والنظام يتعرّف ويوجّه"
      />

      {/* Plain div, NOT <Card> — Card swallows unknown props, so the
          onDragOver/onDrop handlers never reached the DOM and drag-drop
          silently did nothing. */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); analyze(e.dataTransfer.files?.[0]); }}
        onClick={() => document.getElementById('smart-drop-input')?.click()}
        style={{
          padding: 48, textAlign: 'center', cursor: 'pointer',
          borderRadius: 'var(--r-lg)',
          border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border)'}`,
          background: drag ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'var(--card)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <input id="smart-drop-input" type="file" accept=".xlsx,.xls,.pdf"
          style={{ display: 'none' }}
          onChange={e => { analyze(e.target.files?.[0]); e.target.value = ''; }}/>
        {busy ? <Spinner size={26}/> : (
          <>
            <UploadCloud size={40} color="var(--accent)" style={{ marginBottom: 12 }}/>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>اسحب الملف هنا أو اضغط للاختيار</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              xlsx · xls · pdf — فاتورة / تحصيل COD / كشف حساب
            </div>
          </>
        )}
      </div>

      {verdict && (
        <Card style={{ marginTop: 16, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            {verdict.icon}
            <div style={{ fontSize: 15, fontWeight: 700 }}>{verdict.label}</div>
            <button onClick={() => setVerdict(null)} style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={16}/></button>
          </div>
          {verdict.note && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>{verdict.note}</div>}

          {verdict.needCarrier ? (
            <>
              <div style={{ fontSize: 12.5, marginBottom: 8 }}>لمن هذا التحصيل؟</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {carriers.map(c => (
                  <Btn key={c.id} size="sm" variant="ghost" onClick={verdict.routes.cod(c.id)}>{c.name}</Btn>
                ))}
              </div>
            </>
          ) : verdict.go ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn variant="primary" onClick={verdict.go}>متابعة ←</Btn>
              {verdict.choose && (
                <>
                  {verdict.kind !== 'audit' && <Btn size="sm" variant="ghost" onClick={verdict.choose.audit(verdict.carrierId)}>بل هي فاتورة للتدقيق</Btn>}
                  {verdict.kind !== 'cod' && verdict.carrierId && <Btn size="sm" variant="ghost" onClick={verdict.choose.cod(verdict.carrierId)}>بل هي تحصيل COD</Btn>}
                  {verdict.kind !== 'statement' && <Btn size="sm" variant="ghost" onClick={verdict.choose.statement(verdict.carrierId)}>بل هي كشف حساب</Btn>}
                </>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn size="sm" variant="ghost" onClick={verdict.choose.audit(verdict.carrierId)}><FileText size={13}/> فاتورة — تدقيق</Btn>
              <Btn size="sm" variant="ghost" onClick={verdict.choose.statement(verdict.carrierId)}><BookOpen size={13}/> كشف حساب</Btn>
              {verdict.carrierId && <Btn size="sm" variant="ghost" onClick={verdict.choose.cod(verdict.carrierId)}><Banknote size={13}/> تحصيل COD</Btn>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
