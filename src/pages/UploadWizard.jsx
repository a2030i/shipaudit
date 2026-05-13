import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, Sparkles, CheckCircle2, Calendar,
  Truck, AlertCircle, ArrowLeft, ArrowRight, Building2, FileCheck,
} from 'lucide-react';
import { Card, Btn, Select, Spinner, Badge, toast } from '../components/UI.jsx';
import { detectColumns, mapRows, auditAll, buildSummary, detectHeaderRow, buildHeaders, detectCarrierFromFile, getFieldSchema } from '../engine/audit.js';
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
  awb:             { label: 'رقم الشحنة AWB' },
  shipDate:        { label: 'تاريخ الشحن' },
  // dest is optional — many carriers (J&T, iMile) omit a literal
  // "country" column because every shipment is domestic. mapRows falls
  // back to Saudi Arabia when nothing is present.
  dest:            { label: 'الدولة' },
  destCity:        { label: 'المدينة' },
  weight:          { label: 'الوزن (كغ)' },
  deliveryCharges: { label: 'رسوم الشحن' },
  rss:             { label: 'RSS' },
  fuelSurcharge:   { label: 'رسوم الوقود' },
  codAmount:       { label: 'مبلغ COD' },
  codFee:          { label: 'رسوم COD' },
  posAmount:       { label: 'مبلغ POS' },
  posFee:          { label: 'رسوم POS (بطاقة)' },
  tax:             { label: 'الضريبة' },
  serviceType:     { label: 'نوع الخدمة (Road/Air)' },
  billingType:     { label: 'نوع الفوترة (ZDOI/ZIBI/ZOBI/ZDCF)' },
  signingStatus:   { label: 'حالة التسليم' },
};

// ── Helper: contract pricing summary ─────────────────────────────────────────
// Shows the first bracket + per-kg rate so the user instantly sees what
// the audit will be comparing against. Works for both array-tier and
// lookup-table contracts.
function ContractPreview({ contract }) {
  if (!contract) return null;
  const dests = Object.keys(contract.pricing || {});
  const primary = contract.pricing?.['Saudi Arabia'] || contract.pricing?.[dests[0]] || null;
  let firstLine = null;
  if (Array.isArray(primary)) {
    const base = primary[0];
    const next = primary[1];
    if (base?.upTo && base?.price != null) {
      firstLine = `حتى ${base.upTo} كغ → ${base.price} ر.س`;
      if (next?.pricePerUnit) firstLine += ` · زائد ${next.pricePerUnit} ر.س/كغ`;
    }
  } else if (primary?.mode === 'lookup' && primary.brackets?.length) {
    const sorted = [...primary.brackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    firstLine = `${sorted.length} شريحة وزن مدوّنة`;
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <DetailRow label="بداية العقد"  value={contract.startDate || '—'}/>
      <DetailRow label="نهاية العقد"  value={contract.endDate || 'مفتوح'}/>
      {firstLine && <DetailRow label="السعر الأساسي" value={firstLine} mono/>}
      {contract.fuelPct != null && <DetailRow label="رسوم الوقود" value={`${(contract.fuelPct * 100).toFixed(1)}%`}/>}
      {contract.rss != null && contract.rss > 0 && <DetailRow label="RSS" value={`${(contract.rss * 100).toFixed(1)}%`}/>}
      {dests.length > 0 && <DetailRow label="الوجهات" value={`${dests.length} وجهة`}/>}
    </div>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{
        color: 'var(--text)', fontWeight: 600,
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        fontSize: mono ? 11.5 : 12,
        textAlign: 'left',
      }}>{value}</span>
    </div>
  );
}

// ── Step 1 — Period only (carrier is auto-detected from the uploaded file) ───
function Step1({ month, setMonth, year, setYear, onNext }) {
  return (
    <Card style={{ maxWidth: 580, margin: '0 auto', padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(45,212,191,.18), rgba(45,212,191,.06))',
          border: '1px solid rgba(45,212,191,.32)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Calendar size={18} color="var(--accent)"/>
        </div>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
            اختر فترة الفاتورة
          </h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
            الشهر والسنة اللي تغطيهم الفاتورة — الشركة نحدّدها من الملف
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
        <Select label="الشهر" value={month} onChange={e => setMonth(+e.target.value)}>
          {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
        </Select>
        <Select label="السنة" value={year} onChange={e => setYear(+e.target.value)}>
          {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>

      <div style={{
        padding: '12px 14px', marginBottom: 18,
        background: 'rgba(45,212,191,.06)',
        border: '1px solid rgba(45,212,191,.22)',
        borderRadius: 9,
        display: 'flex', gap: 10,
      }}>
        <Sparkles size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }}/>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>
          ما تحتاج تختار الشركة — النظام يتعرف عليها من بنية الملف (الأعمدة + نمط AWB). إذا فشل في التعرف نطلب منك تحديدها يدوياً.
        </div>
      </div>

      <Btn variant="primary" onClick={onNext} style={{ width: '100%', justifyContent: 'center', padding: '11px 20px', fontSize: 14 }}>
        التالي <ArrowLeft size={15}/>
      </Btn>
    </Card>
  );
}

// ── Step 2 — Upload + AI Analysis ─────────────────────────────────────────────
function Step2({ carrierName, carrierLogo, period, onUpload, onBack, uploading, aiStatus }) {
  const [drag, setDrag] = useState(false);
  const handle = useCallback(file => { if (file) onUpload(file); }, [onUpload]);
  const settings = loadSettings();
  const hasAi = !!settings.openrouterKey;

  return (
    <Card style={{ maxWidth: 720, margin: '0 auto', padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '18px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'color-mix(in srgb, var(--accent) 5%, transparent)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: 'linear-gradient(135deg, #1B1E54, #2DD4BF)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, fontSize: 18,
        }}>
          {carrierLogo || '📦'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {carrierName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            ارفع فاتورة الفترة: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{period}</span>
          </div>
        </div>
      </div>

      {/* Drop zone */}
      <div style={{ padding: '24px' }}>
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
          onClick={() => !uploading && document.getElementById('fu-input').click()}
          style={{
            border: `2px dashed ${drag ? 'var(--accent)' : uploading ? 'var(--border2)' : 'var(--border2)'}`,
            borderRadius: 14,
            padding: '52px 24px',
            textAlign: 'center',
            cursor: uploading ? 'wait' : 'pointer',
            background: drag
              ? 'rgba(45,212,191,.08)'
              : uploading
                ? 'var(--surface)'
                : 'linear-gradient(180deg, var(--surface) 0%, var(--card) 100%)',
            transition: 'all .2s',
          }}
        >
          {uploading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <Spinner size={36}/>
              <div style={{ color: 'var(--text2)', fontSize: 13.5, fontWeight: 600 }}>
                {aiStatus || 'جارٍ قراءة الملف...'}
              </div>
            </div>
          ) : (
            <>
              <div style={{
                width: 64, height: 64, margin: '0 auto 14px',
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(45,212,191,.18), rgba(27,30,84,.12))',
                border: '1px solid rgba(45,212,191,.32)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Upload size={28} color="var(--accent)"/>
              </div>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 15, color: 'var(--text)' }}>
                اسحب وأفلت ملف Excel هنا
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                أو اضغط للاختيار · يقبل <code style={{ fontFamily: 'var(--font-mono)' }}>.xlsx</code> و <code style={{ fontFamily: 'var(--font-mono)' }}>.xls</code>
              </div>
              {hasAi && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  marginTop: 14, padding: '5px 11px',
                  background: 'rgba(45,212,191,.10)',
                  border: '1px solid rgba(45,212,191,.28)',
                  borderRadius: 20,
                  fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 600,
                }}>
                  <Sparkles size={11}/> AI يتعرف على الأعمدة تلقائياً
                </div>
              )}
            </>
          )}
          <input id="fu-input" type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => handle(e.target.files[0])}/>
        </div>

        {/* Tips row */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10,
          marginTop: 18, marginBottom: 18,
        }}>
          {[
            { icon: <FileSpreadsheet size={14}/>, label: 'Excel فقط', hint: 'xlsx / xls' },
            { icon: <FileCheck    size={14}/>, label: 'كشف الفاتورة كاملاً', hint: 'بدون تعديل' },
            { icon: <Sparkles     size={14}/>, label: 'AI يخمّن الأعمدة', hint: 'أو نمط Regex' },
          ].map(t => (
            <div key={t.label} style={{
              padding: '10px 12px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 9,
              display: 'flex', gap: 9, alignItems: 'center',
            }}>
              <span style={{ color: 'var(--accent)', display: 'inline-flex', flexShrink: 0 }}>{t.icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{t.label}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 1 }}>{t.hint}</div>
              </div>
            </div>
          ))}
        </div>

        <Btn variant="ghost" onClick={onBack} style={{ width: '100%', justifyContent: 'center', padding: '10px 20px' }}>
          <ArrowRight size={14}/> رجوع
        </Btn>
      </div>
    </Card>
  );
}

// ── Step 3 — Review & Confirm ──────────────────────────────────────────────────
function Step3({ headers, colMap, setColMap, onConfirm, onBack, aiLoading, onAiMap,
                 detectedRow, aiNotes, missingFields, rowCount,
                 carriers, carrierId, setCarrierId, carrierDetect }) {

  const carrier = carriers?.find(c => c.id === carrierId);
  const detectConfidence = carrierDetect?.confidence ?? 0;
  const detectedOk = !!carrierId && detectConfidence >= 0.5;
  // Resolve the per-carrier field schema. When no carrier is selected
  // yet, fall back to the default (every field). Required fields come
  // from the same schema so e.g. iMile's required list doesn't ask for
  // a Billing Type that doesn't exist in its files.
  const schema = getFieldSchema(carrierId);
  const visibleFields = schema.core;
  const requiredSet   = new Set(schema.required);
  const mappedCount   = visibleFields.filter(f => !!colMap[f]).length;
  const requiredMissing = visibleFields.filter(f => requiredSet.has(f) && !colMap[f]).length;

  return (
    <Card style={{ maxWidth: 640, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <h3 style={{ fontFamily:'var(--font-mono)', color:'var(--accent)', fontSize:14 }}>
          الخطوة 3 — مراجعة النتائج
        </h3>
        <Btn size="sm" variant="gold" onClick={onAiMap} disabled={aiLoading}>
          {aiLoading ? <><Spinner size={13}/> AI يحلل...</> : '✨ إعادة تحليل AI'}
        </Btn>
      </div>

      {/* Carrier identification result */}
      <div style={{
        marginBottom: 16,
        padding: '12px 14px',
        background: detectedOk
          ? 'rgba(45,212,191,.06)'
          : !carrierId
            ? 'rgba(251,146,60,.08)'
            : 'rgba(251,191,36,.06)',
        border: `1px solid ${detectedOk
          ? 'rgba(45,212,191,.30)'
          : !carrierId
            ? 'rgba(251,146,60,.30)'
            : 'rgba(251,191,36,.30)'}`,
        borderRadius: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: !carrierId ? 8 : 0 }}>
          {detectedOk
            ? <CheckCircle2 size={16} color="var(--accent)"/>
            : <AlertCircle size={16} color={!carrierId ? 'var(--warn)' : 'var(--gold)'}/>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            {carrierId ? (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
                  {carrier?.logo} {carrier?.name}
                  {carrierDetect && (
                    <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 500, marginInlineStart: 8 }}>
                      · ثقة {Math.round(detectConfidence * 100)}% ·{' '}
                      {carrierDetect.method === 'signature' ? 'بصمة محفوظة' : 'كشف تلقائي'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  لو الشركة خطأ، غيّرها من القائمة أدناه
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 700 }}>
                ما قدرنا نتعرف على الشركة — اختارها يدوياً
              </div>
            )}
          </div>
        </div>
        {(!detectedOk || !carrierId) && (
          <select
            value={carrierId || ''}
            onChange={e => setCarrierId(e.target.value)}
            style={{
              width: '100%', padding: '8px 11px', borderRadius: 8, fontSize: 13,
              marginTop: 8,
            }}>
            <option value="">— اختر الشركة —</option>
            {(carriers || []).map(c => (
              <option key={c.id} value={c.id}>{c.logo ? `${c.logo} ${c.name}` : c.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Status pills */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
        {detectedRow != null && (
          <span style={{ background:'rgba(52,211,153,.1)', border:'1px solid rgba(52,211,153,.25)', color:'var(--green)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20 }}>
            ✓ عناوين في الصف {detectedRow}
          </span>
        )}
        <span style={{ background:'rgba(45,212,191,.1)', border:'1px solid rgba(45,212,191,.25)', color:'var(--accent)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20 }}>
          {rowCount} سطر بيانات
        </span>
        <span style={{ background:'rgba(45,212,191,.08)', border:'1px solid var(--border)', color:'var(--muted)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20 }}>
          {mappedCount}/{visibleFields.length} أعمدة معيّنة
        </span>
        {carrier && (
          <span style={{ background:'rgba(45,212,191,.1)', border:'1px solid rgba(45,212,191,.30)', color:'var(--accent)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20, fontWeight: 700 }}>
            {carrier.logo} {carrier.name}
          </span>
        )}
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

      {/* Column mapping — only fields relevant for this carrier */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', marginBottom:8, letterSpacing:.5 }}>
          تعيين الأعمدة — عدّل إذا احتجت{carrier ? ` · ${visibleFields.length} حقل خاص بـ ${carrier.name}` : ''}
        </div>
        {visibleFields.map(field => {
          const meta = FIELD_META[field];
          if (!meta) return null;
          const { label } = meta;
          const required = requiredSet.has(field);
          const isMapped = !!colMap[field];
          const isNull   = missingFields?.includes(field);
          return (
            <div key={field} style={{
              display:'grid', gridTemplateColumns:'180px 1fr', gap:10,
              marginBottom:7, alignItems:'center',
              padding:'6px 10px', borderRadius:8,
              background: isMapped ? 'rgba(45,212,191,.05)' : required ? 'rgba(248,113,113,.04)' : 'transparent',
              border: `1px solid ${isMapped?'rgba(45,212,191,.20)':required&&!isMapped?'rgba(248,113,113,.20)':'transparent'}`,
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:12, color: isMapped?'var(--accent)':required?'var(--red)':'var(--muted3)' }}>
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
                  borderColor: isMapped?'rgba(45,212,191,.30)':undefined }}
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
              background: Object.values(colMap).includes(h) ? 'rgba(45,212,191,.12)' : 'var(--card)',
              border: `1px solid ${Object.values(colMap).includes(h)?'rgba(45,212,191,.28)':'var(--border)'}`,
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
          disabled={!carrierId || !colMap.weight || !colMap.deliveryCharges}
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
  // carrierId is now set automatically after the file is read.
  // Stays empty during step 1 (period picker).
  const [carrierId,    setCarrierId]   = useState('');
  const [carrierDetect, setCarrierDetect] = useState(null); // { confidence, method, reasons }
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

    // Merge AI map with fallback regex map (carrier-scoped so iMile
    // doesn't pick up Aramex's RSS column etc.)
    const regexMap = detectColumns(hdrs, carrierId);
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

        // ── Auto-detect carrier from file structure ──────────────
        // Skipped if the user is re-running with a manual override
        // (i.e. carrierId is already set from a prior attempt).
        const detected = detectCarrierFromFile(allRows, carriers);
        if (detected && detected.confidence >= 0.5) {
          setCarrierId(detected.carrierId);
          setCarrierDetect(detected);
          const dname = carriers.find(c => c.id === detected.carrierId)?.name;
          toast(`تم التعرف على الشركة: ${dname} (${Math.round(detected.confidence * 100)}%)`, 'success');
        } else {
          setCarrierDetect(detected); // may be a low-confidence guess
        }

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
        // Use the just-detected carrier id directly — setCarrierId from
        // a few lines above is async and won't reflect in this closure.
        setColMap(detectColumns(hdrs, detected?.carrierId || null));
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

  const stepLabels = [
    { n: 1, title: 'اختر الشركة', sub: 'الناقل والفترة'   },
    { n: 2, title: 'ارفع الملف',  sub: 'فاتورة Excel'      },
    { n: 3, title: 'راجع',         sub: 'الأعمدة والنتائج' },
  ];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative',
        padding: '22px 28px',
        marginBottom: 22,
        borderRadius: 'var(--r-lg)',
        background: 'linear-gradient(135deg, #1B1E54 0%, #262A6E 55%, #2DD4BF 130%)',
        color: '#fff',
        overflow: 'hidden',
        boxShadow: '0 10px 32px rgba(27,30,84,.25)',
      }}>
        <div style={{
          position: 'absolute', left: -40, top: -40, width: 220, height: 220,
          opacity: .08, pointerEvents: 'none',
        }}>
          <svg viewBox="0 0 64 64" fill="none">
            <path d="M32 6 L54 18 L54 46 L32 58 L10 46 L10 18 Z" fill="#fff"/>
          </svg>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: 3, textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>
            LAMHA · NEW AUDIT
          </div>
          <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 6, lineHeight: 1.2 }}>
            مراجعة فاتورة جديدة
          </h1>
          <p style={{ color: 'rgba(255,255,255,.78)', fontSize: 13, margin: 0 }}>
            ثلاث خطوات لاكتشاف فروق الفاتورة، الأوزان الزائدة، والشحنات المكررة.
          </p>
        </div>
      </div>

      {/* ── STEP INDICATOR ────────────────────────────────────────────── */}
      <Card style={{ padding: '18px 24px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'nowrap' }}>
          {stepLabels.map((s, i) => {
            const done    = step > s.n;
            const current = step === s.n;
            return (
              <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: done
                      ? 'linear-gradient(135deg, #14B8A6, #2DD4BF)'
                      : current
                        ? 'linear-gradient(135deg, #1B1E54, #2DD4BF)'
                        : 'var(--surface)',
                    border: `2px solid ${done || current ? 'transparent' : 'var(--border2)'}`,
                    color: done || current ? '#fff' : 'var(--muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14,
                    flexShrink: 0,
                    boxShadow: current ? '0 4px 16px rgba(45,212,191,.32)' : 'none',
                    transition: 'all .25s',
                  }}>
                    {done ? <CheckCircle2 size={18}/> : s.n}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700,
                      color: current ? 'var(--accent)' : done ? 'var(--text)' : 'var(--muted)',
                      whiteSpace: 'nowrap',
                    }}>{s.title}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 1, whiteSpace: 'nowrap' }}>
                      {s.sub}
                    </div>
                  </div>
                </div>
                {i < stepLabels.length - 1 && (
                  <div style={{
                    flex: 1, height: 2, minWidth: 30,
                    background: step > s.n ? 'linear-gradient(90deg, #14B8A6, #2DD4BF)' : 'var(--border)',
                    borderRadius: 2,
                    transition: 'background .3s',
                  }}/>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── ACTIVE STEP ───────────────────────────────────────────────── */}
      {step === 1 && (
        <Step1 month={month} setMonth={setMonth} year={year} setYear={setYear}
          onNext={() => setStep(2)}/>
      )}
      {step === 2 && (
        <Step2 carrierName={carrier?.name || 'سنحدّدها من الملف'} carrierLogo={carrier?.logo} period={period}
          onUpload={handleFile} onBack={() => setStep(1)}
          uploading={uploading} aiStatus={aiStatus}/>
      )}
      {step === 3 && (
        <Step3 headers={headers} colMap={colMap} setColMap={setColMap}
          onConfirm={handleConfirm} onBack={() => setStep(2)}
          aiLoading={aiLoading} onAiMap={handleReAnalyze}
          detectedRow={detectedRow} aiNotes={aiNotes}
          missingFields={missingFields} rowCount={rawRows.length}
          carriers={carriers} carrierId={carrierId} setCarrierId={setCarrierId}
          carrierDetect={carrierDetect}/>
      )}
    </div>
  );
}
