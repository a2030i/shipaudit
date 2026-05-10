import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Card, Btn, Select, Spinner, Badge, toast } from '../components/UI.jsx';
import { detectColumns, mapRows, auditAll, buildSummary, detectHeaderRow, buildHeaders } from '../engine/audit.js';
import { aiAnalyzeFile, aiMapColumns } from '../engine/openrouter.js';
import { loadSettings, getActiveContract } from '../data/carriers.js';
import { saveAuditToDB, applyCrossAuditDuplicates } from '../lib/coreService.js';
import { useAuth } from '../lib/auth.jsx';

const MONTHS = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
];
const buildPeriod = (m, y) => `${MONTHS[m - 1]} ${y}`;

const FIELD_META = {
  awb:             { label: 'رقم الشحنة AWB',         required: false },
  shipDate:        { label: 'تاريخ الشحن',             required: false },
  dest:            { label: 'الدولة',                  required: true  },
  weight:          { label: 'الوزن (كغ)',               required: true  },
  deliveryCharges: { label: 'رسوم الشحن',              required: true  },
  rss:             { label: 'RSS',                     required: false },
  fuelSurcharge:   { label: 'رسوم الوقود',             required: false },
  serviceType:     { label: 'نوع الخدمة (Road/Air)',   required: false },
  codAmount:       { label: 'COD',                    required: false },
  billingType:     { label: 'نوع الفوترة (ZDOI محلي · ZIBI/ZOBI دولي)', required: false },
};

// ── Step 1 ─────────────────────────────────────────────────────────────────────
function Step1({ carriers, carrierId, setCarrierId, month, setMonth, year, setYear, onNext }) {
  const carrier  = carriers.find(c => c.id === carrierId);
  const contract = carrier
    ? getActiveContract(carrier, `${year}-${String(month).padStart(2,'0')}-01`)
    : null;

  return (
    <Card style={{ maxWidth: 500, margin: '0 auto' }}>
      <h3 style={{ fontFamily:'var(--font-mono)', color:'var(--accent)', marginBottom:20, fontSize:14 }}>
        الخطوة 1 — اختر الشركة والفترة
      </h3>

      <div style={{ marginBottom:16 }}>
        <Select label="شركة الشحن" value={carrierId} onChange={e => setCarrierId(e.target.value)}>
          <option value="">اختر شركة...</option>
          {carriers.map(c => <option key={c.id} value={c.id}>{c.logo} {c.name}</option>)}
        </Select>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
        <Select label="الشهر" value={month} onChange={e => setMonth(+e.target.value)}>
          {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
        </Select>
        <Select label="السنة" value={year} onChange={e => setYear(+e.target.value)}>
          {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>

      {carrier && (
        <div style={{ background:'var(--surface)', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:12 }}>
          <div style={{ color:'var(--muted)', marginBottom:4 }}>العقد الساري:</div>
          {contract
            ? <span style={{ color:'var(--green)', fontFamily:'var(--font-mono)' }}>{contract.label} — {contract.startDate}</span>
            : <span style={{ color:'var(--red)' }}>⚠️ لا يوجد عقد ساري لهذه الفترة</span>
          }
        </div>
      )}

      <Btn variant="primary" onClick={onNext} disabled={!carrierId} style={{ width:'100%', justifyContent:'center' }}>
        التالي ←
      </Btn>
    </Card>
  );
}

// ── Step 2 — Upload + AI Analysis ─────────────────────────────────────────────
function Step2({ carrierName, period, onUpload, onBack, uploading, aiStatus }) {
  const [drag, setDrag] = useState(false);

  const handle = useCallback(file => { if (file) onUpload(file); }, [onUpload]);

  return (
    <Card style={{ maxWidth: 520, margin: '0 auto' }}>
      <h3 style={{ fontFamily:'var(--font-mono)', color:'var(--accent)', marginBottom:6, fontSize:14 }}>
        الخطوة 2 — رفع الملف
      </h3>
      <p style={{ color:'var(--muted)', fontSize:12, marginBottom:20 }}>{carrierName} · {period}</p>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
        onClick={() => !uploading && document.getElementById('fu-input').click()}
        style={{
          border:`2px dashed ${drag?'var(--accent)':'var(--border2)'}`,
          borderRadius:14, padding:'48px 20px', textAlign:'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: drag ? 'rgba(56,189,248,.05)' : 'var(--surface)',
          transition:'all .2s', marginBottom:16,
        }}
      >
        {uploading ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
            <Spinner size={36}/>
            <div style={{ color:'var(--muted)', fontSize:13 }}>{aiStatus || 'جارٍ قراءة الملف...'}</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize:42, marginBottom:10 }}>📂</div>
            <div style={{ fontWeight:600, marginBottom:5, fontSize:14 }}>اسحب وأفلت ملف Excel هنا</div>
            <div style={{ color:'var(--muted)', fontSize:12 }}>أو اضغط للاختيار · xlsx / xls</div>
            <div style={{ color:'var(--muted)', fontSize:11, marginTop:10, fontFamily:'var(--font-mono)' }}>
              ✨ AI سيقرأ الملف ويعيّن الأعمدة تلقائياً
            </div>
          </>
        )}
        <input id="fu-input" type="file" accept=".xlsx,.xls" style={{ display:'none' }}
          onChange={e => handle(e.target.files[0])}/>
      </div>

      <Btn variant="ghost" onClick={onBack} style={{ width:'100%', justifyContent:'center' }}>← رجوع</Btn>
    </Card>
  );
}

// ── Step 3 — Review & Confirm ──────────────────────────────────────────────────
function Step3({ headers, colMap, setColMap, onConfirm, onBack, aiLoading, onAiMap,
                 detectedRow, aiNotes, missingFields, rowCount }) {

  const mappedCount     = Object.values(colMap).filter(Boolean).length;
  const requiredMissing = Object.entries(FIELD_META)
    .filter(([f, { required }]) => required && !colMap[f]).length;

  return (
    <Card style={{ maxWidth: 640, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <h3 style={{ fontFamily:'var(--font-mono)', color:'var(--accent)', fontSize:14 }}>
          الخطوة 3 — مراجعة النتائج
        </h3>
        <Btn size="sm" variant="gold" onClick={onAiMap} disabled={aiLoading}>
          {aiLoading ? <><Spinner size={13}/> AI يحلل...</> : '✨ إعادة تحليل AI'}
        </Btn>
      </div>

      {/* Status pills */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
        {detectedRow != null && (
          <span style={{ background:'rgba(52,211,153,.1)', border:'1px solid rgba(52,211,153,.25)', color:'var(--green)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20 }}>
            ✓ عناوين في الصف {detectedRow}
          </span>
        )}
        <span style={{ background:'rgba(56,189,248,.1)', border:'1px solid rgba(56,189,248,.25)', color:'var(--accent)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20 }}>
          {rowCount} سطر بيانات
        </span>
        <span style={{ background:'rgba(56,189,248,.08)', border:'1px solid var(--border)', color:'var(--muted)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20 }}>
          {mappedCount}/{Object.keys(FIELD_META).length} أعمدة معيّنة
        </span>
        {aiLoading && (
          <span style={{ color:'var(--gold)', fontSize:11, display:'flex', alignItems:'center', gap:5 }}>
            <Spinner size={11} color="var(--gold)"/> يحلل...
          </span>
        )}
      </div>

      {/* AI notes */}
      {aiNotes && (
        <div style={{ background:'rgba(251,191,36,.08)', border:'1px solid rgba(251,191,36,.2)', borderRadius:8, padding:'9px 13px', marginBottom:14, fontSize:12, color:'var(--gold)' }}>
          ✨ {aiNotes}
        </div>
      )}

      {/* Column mapping */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', marginBottom:8, letterSpacing:.5 }}>
          تعيين الأعمدة — عدّل إذا احتجت
        </div>
        {Object.entries(FIELD_META).map(([field, { label, required }]) => {
          const isMapped = !!colMap[field];
          const isNull   = missingFields?.includes(field);
          return (
            <div key={field} style={{
              display:'grid', gridTemplateColumns:'180px 1fr', gap:10,
              marginBottom:7, alignItems:'center',
              padding:'6px 10px', borderRadius:8,
              background: isMapped ? 'rgba(52,211,153,.04)' : required ? 'rgba(248,113,113,.04)' : 'transparent',
              border: `1px solid ${isMapped?'rgba(52,211,153,.14)':required&&!isMapped?'rgba(248,113,113,.14)':'transparent'}`,
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color: isMapped?'var(--green)':required?'var(--red)':'var(--muted3)' }}>
                  {isMapped ? '✓' : required ? '!' : '○'}
                </span>
                <span style={{ fontSize:12, color: isMapped?'var(--text)':'var(--muted)' }}>
                  {label}
                  {required && !isMapped && (
                    <span style={{ color:'var(--red)', fontSize:9, marginRight:4 }}>إلزامي</span>
                  )}
                  {isNull && !isMapped && (
                    <span style={{ color:'var(--muted)', fontSize:9, marginRight:4 }}>غير موجود</span>
                  )}
                </span>
              </div>
              <select
                value={colMap[field] || ''}
                onChange={e => setColMap({ ...colMap, [field]: e.target.value || null })}
                style={{ padding:'5px 9px', borderRadius:7, fontSize:12, cursor:'pointer',
                  borderColor: isMapped?'rgba(52,211,153,.3)':undefined }}
              >
                <option value="">— غير محدد —</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      {/* Columns from file */}
      <div style={{ background:'var(--surface)', borderRadius:9, padding:'9px 13px', marginBottom:14 }}>
        <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', marginBottom:6 }}>
          أعمدة الملف الأصلية:
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
          {headers.map(h => (
            <span key={h} style={{
              background: Object.values(colMap).includes(h) ? 'rgba(56,189,248,.12)' : 'var(--card)',
              border: `1px solid ${Object.values(colMap).includes(h)?'rgba(56,189,248,.28)':'var(--border)'}`,
              color: Object.values(colMap).includes(h) ? 'var(--accent)' : 'var(--muted)',
              borderRadius:5, padding:'2px 8px', fontSize:10, fontFamily:'var(--font-mono)',
            }}>{h}</span>
          ))}
        </div>
      </div>

      {requiredMissing > 0 && (
        <div style={{ background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.2)', borderRadius:8, padding:'8px 13px', marginBottom:12, fontSize:11, color:'var(--red)' }}>
          ⚠️ {requiredMissing} حقل إلزامي لم يُعيَّن
        </div>
      )}

      <div style={{ display:'flex', gap:9 }}>
        <Btn variant="ghost" onClick={onBack} style={{ flex:1, justifyContent:'center' }}>← رجوع</Btn>
        <Btn variant="primary" onClick={onConfirm}
          disabled={!colMap.dest || !colMap.weight || !colMap.deliveryCharges}
          style={{ flex:2, justifyContent:'center' }}>
          تأكيد وبدء التدقيق ←
        </Btn>
      </div>
    </Card>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function UploadWizard({ carriers, onComplete }) {
  const { user } = useAuth();
  const now = new Date();
  const [step,         setStep]        = useState(1);
  const [carrierId,    setCarrierId]   = useState(carriers[0]?.id || '');
  const [month,        setMonth]       = useState(now.getMonth() + 1);
  const [year,         setYear]        = useState(now.getFullYear());
  const [headers,      setHeaders]     = useState([]);
  const [rawRows,      setRawRows]     = useState([]);
  const [allRawRows,   setAllRawRows]  = useState([]); // 2D array for re-analysis
  const [colMap,       setColMap]      = useState({});
  const [uploading,    setUploading]   = useState(false);
  const [aiStatus,     setAiStatus]    = useState('');
  const [aiLoading,    setAiLoading]   = useState(false);
  const [detectedRow,  setDetectedRow] = useState(null);
  const [aiNotes,      setAiNotes]     = useState('');
  const [missingFields,setMissingFields] = useState([]);

  const carrier = carriers.find(c => c.id === carrierId);
  const period  = buildPeriod(month, year);

  // Apply AI result to state
  const applyAiResult = (result, allRows) => {
    if (!result) return;
    const { headerRow, colMap: aiMap, missingFields: missing, notes } = result;

    const hdrIdx = Math.min(headerRow, allRows.length - 2);
    const hdrs   = buildHeaders(allRows[hdrIdx]);
    const data   = allRows
      .slice(hdrIdx + 1)
      .filter(row => row && row.some(v => v !== null && v !== '' && v !== undefined))
      .map(row => {
        const obj = {};
        hdrs.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });

    setDetectedRow(hdrIdx + 1);
    setHeaders(hdrs);
    setRawRows(data);

    // Merge AI map with fallback regex map
    const regexMap = detectColumns(hdrs);
    const merged = { ...regexMap };
    for (const [field, col] of Object.entries(aiMap || {})) {
      if (col && hdrs.includes(col)) merged[field] = col;
      else if (col === null)          merged[field] = null;
    }
    setColMap(merged);
    setMissingFields(missing || []);
    setAiNotes(notes || '');
  };

  const handleFile = useCallback((file) => {
    setUploading(true);
    setAiStatus('جارٍ قراءة الملف...');
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const wb      = XLSX.read(e.target.result, { type:'array' });
        const ws      = wb.Sheets[wb.SheetNames[0]];
        const allRows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null });

        if (!allRows.length) { toast('الملف فارغ', 'error'); setUploading(false); return; }
        setAllRawRows(allRows);

        const settings = loadSettings();

        if (settings.openrouterKey) {
          // ── AI full analysis ──────────────────────────────────────
          setAiStatus('✨ AI يقرأ الملف ويحدد الأعمدة...');
          try {
            const result = await aiAnalyzeFile(allRows);
            if (result) {
              applyAiResult(result, allRows);
              toast('AI حلّل الملف وعيّن الأعمدة ✓', 'success');
              setStep(3);
              setUploading(false);
              return;
            }
          } catch (aiErr) {
            toast(`AI: ${aiErr.message} — سيتم التعيين اليدوي`, 'warn');
          }
        }

        // ── Fallback: smart regex detection ───────────────────────
        const hdrIdx = detectHeaderRow(allRows);
        const hdrs   = buildHeaders(allRows[hdrIdx]);
        const data   = allRows
          .slice(hdrIdx + 1)
          .filter(row => row && row.some(v => v !== null && v !== '' && v !== undefined))
          .map(row => {
            const obj = {};
            hdrs.forEach((h, i) => { obj[h] = row[i] ?? ''; });
            return obj;
          });

        if (!data.length) { toast('لم يتم العثور على بيانات في الملف', 'error'); setUploading(false); return; }

        setDetectedRow(hdrIdx + 1);
        setHeaders(hdrs);
        setRawRows(data);
        setColMap(detectColumns(hdrs));
        setStep(3);
      } catch (err) {
        toast(`خطأ في قراءة الملف: ${err.message}`, 'error');
      }
      setUploading(false);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleReAnalyze = async () => {
    if (!allRawRows.length) return;
    const settings = loadSettings();
    if (!settings.openrouterKey) { toast('أدخل OpenRouter API Key في الإعدادات', 'warn'); return; }
    setAiLoading(true);
    try {
      const result = await aiAnalyzeFile(allRawRows);
      if (result) {
        applyAiResult(result, allRawRows);
        toast('تم إعادة التحليل ✓', 'success');
      } else {
        toast('AI لم يتمكن من تحليل الملف', 'error');
      }
    } catch (err) {
      toast(`AI: ${err.message}`, 'error');
    }
    setAiLoading(false);
  };

  const handleConfirm = async () => {
    if (!carrier) return;
    const forDate = `${year}-${String(month).padStart(2,'0')}-01`;
    const mapped  = mapRows(rawRows, colMap);
    const results = auditAll(mapped, carrier, forDate);
    // Cross-month duplicate check — adds issues to AWBs that were already
    // billed in a prior audit for this same carrier + billing class.
    try { await applyCrossAuditDuplicates(results, carrier.id); }
    catch { /* best-effort — never block the audit on a ledger query */ }
    const summary = buildSummary(results);
    const audit   = {
      id: `a_${Date.now()}`,
      carrierId: carrier.id, carrierName: carrier.name,
      period, month, year, colMap, summary, results,
      createdAt: new Date().toISOString(),
    };
    // Surface duplicate-file errors to the user — saving silently used
    // to mean the same file could be saved twice without anyone noticing.
    try {
      await saveAuditToDB(audit, user?.id);
      toast(`تم تدقيق ${results.length} شحنة`, 'success');
      onComplete(audit);
    } catch (e) {
      if (e.code === 'DUPLICATE_AUDIT') {
        toast(e.message, 'error');
        return;
      }
      // Non-duplicate errors: still show + still hand the audit back so the
      // user doesn't lose the analysis. They can save manually later.
      toast(`فشل الحفظ: ${e.message}`, 'error');
      onComplete(audit);
    }
  };

  return (
    <div style={{ padding:'32px 24px', maxWidth:720, margin:'0 auto' }}>

      {/* Steps indicator */}
      <div style={{ display:'flex', alignItems:'center', gap:0, marginBottom:32, justifyContent:'center' }}>
        {[['1','اختر الشركة'],['2','ارفع الملف'],['3','مراجعة']].map(([n, lbl], i) => (
          <div key={n} style={{ display:'flex', alignItems:'center' }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
              <div style={{
                width:32, height:32, borderRadius:'50%',
                background: step>i?'var(--green)':step===i+1?'var(--accent)':'var(--surface)',
                border:`2px solid ${step>=i+1?'var(--accent)':'var(--border)'}`,
                color: step>=i+1?'#fff':'var(--muted)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13,
                transition:'all .3s',
              }}>
                {step > i+1 ? '✓' : n}
              </div>
              <span style={{ fontSize:10, color:step===i+1?'var(--accent)':'var(--muted)', whiteSpace:'nowrap' }}>{lbl}</span>
            </div>
            {i < 2 && (
              <div style={{ width:60, height:2, background:step>i+1?'var(--accent)':'var(--border)', margin:'0 4px', marginBottom:18, transition:'all .3s' }}/>
            )}
          </div>
        ))}
      </div>

      {step === 1 && (
        <Step1 carriers={carriers} carrierId={carrierId} setCarrierId={setCarrierId}
          month={month} setMonth={setMonth} year={year} setYear={setYear}
          onNext={() => setStep(2)}/>
      )}
      {step === 2 && (
        <Step2 carrierName={carrier?.name||''} period={period}
          onUpload={handleFile} onBack={() => setStep(1)}
          uploading={uploading} aiStatus={aiStatus}/>
      )}
      {step === 3 && (
        <Step3 headers={headers} colMap={colMap} setColMap={setColMap}
          onConfirm={handleConfirm} onBack={() => setStep(2)}
          aiLoading={aiLoading} onAiMap={handleReAnalyze}
          detectedRow={detectedRow} aiNotes={aiNotes}
          missingFields={missingFields} rowCount={rawRows.length}/>
      )}
    </div>
  );
}
