import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Module-level guard for webhook auto-imports. React StrictMode in dev
// double-invokes useEffect; using sessionStorage or useRef as the
// "already consumed" marker breaks because the second run can't see the
// state from the first. A module-level Set persists across the entire
// session (until full page reload) so the same import is never
// processed twice — even though useEffect runs twice.
const CONSUMED_WEBHOOK_IMPORTS = new Set();
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, Sparkles, CheckCircle2, Calendar,
  Truck, AlertCircle, ArrowLeft, ArrowRight, Building2, FileCheck,
} from 'lucide-react';
import { Card, Btn, Select, Spinner, Badge, toast, PageHeader } from '../components/UI.jsx';
import { Upload as UploadIcon } from 'lucide-react';
import { detectColumns, mapRows, auditAll, buildSummary, detectHeaderRow, buildHeaders, detectCarrierFromFile, getFieldSchema } from '../engine/audit.js';
import { parseAramexInvoice } from '../engine/aramexInvoiceParser.js';
import { aiAnalyzeFile, aiMapColumns } from '../engine/openrouter.js';
import { loadSettings, getActiveContract } from '../data/carriers.js';
import { saveAuditToDB, applyCrossAuditDuplicates, findSamePeriodAudits } from '../lib/coreService.js';
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
  codPaymentMethod:{ label: 'طريقة دفع COD' },
  posAmount:       { label: 'مبلغ POS' },
  posFee:          { label: 'رسوم POS (بطاقة)' },
  excessFee:       { label: 'رسوم الوزن الزائد' },
  tax:             { label: 'الضريبة (مبلغ)' },
  taxRate:         { label: 'نسبة الضريبة % (VAT%)' },
  serviceType:     { label: 'نوع الخدمة (Road/Air)' },
  subCarrier:      { label: 'الناقل الفرعي (لوسطاء مثل بوليصة)' },
  billingType:     { label: 'نوع الفاتورة (محلي/دولي/تحصيل — رموز أرامكس)' },
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
    <Card style={{ maxWidth: 620, margin: '0 auto', padding: 30, border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: 'var(--accent-dim)',
          border: '1px solid color-mix(in srgb, var(--accent) 18%, transparent)',
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
        background: 'linear-gradient(180deg, var(--accent-dim), #fff)',
        border: '1px solid color-mix(in srgb, var(--accent) 18%, transparent)',
        borderRadius: 12,
        display: 'flex', gap: 10,
      }}>
        <Sparkles size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }}/>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>
          ما تحتاج تختار الشركة — النظام يتعرف عليها من بنية الملف (الأعمدة + نمط AWB). إذا فشل في التعرف نطلب منك تحديدها يدوياً.
        </div>
      </div>

      <Btn variant="primary" size="full" onClick={onNext}>
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
    <Card style={{ maxWidth: 760, margin: '0 auto', padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-md)' }}>
      {/* Header */}
      <div style={{
        padding: '18px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: 'var(--accent-dim)',
          border: '1px solid color-mix(in srgb, var(--accent) 18%, transparent)',
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
            border: `1.5px dashed ${drag ? 'var(--accent)' : uploading ? 'var(--border2)' : 'var(--border2)'}`,
            borderRadius: 16,
            padding: '52px 24px',
            textAlign: 'center',
            cursor: uploading ? 'wait' : 'pointer',
            background: drag
              ? 'var(--accent-dim)'
              : uploading
                ? 'var(--surface)'
                : 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
            boxShadow: drag ? '0 14px 34px rgba(37,99,235,.14)' : 'inset 0 1px 0 rgba(255,255,255,.8)',
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
                background: 'var(--accent-dim)',
                border: '1px solid color-mix(in srgb, var(--accent) 18%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Upload size={28} color="var(--accent)"/>
              </div>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 15, color: 'var(--text)' }}>
                اسحب وأفلت ملف Excel هنا
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                أو اضغط للاختيار · يقبل <code style={{ fontFamily: 'var(--font-mono)' }}>.xlsx</code> و <code style={{ fontFamily: 'var(--font-mono)' }}>.xls</code> و <code style={{ fontFamily: 'var(--font-mono)' }}>.pdf</code> (فاتورة أرامكس)
              </div>
              {hasAi && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  marginTop: 14, padding: '5px 11px',
                  background: 'var(--accent-dim)',
                  border: '1px solid color-mix(in srgb, var(--accent) 18%, transparent)',
                  borderRadius: 10,
                  fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 600,
                }}>
                  <Sparkles size={11}/> AI يتعرف على الأعمدة تلقائياً
                </div>
              )}
            </>
          )}
          <input id="fu-input" type="file" accept=".xlsx,.xls,.pdf" style={{ display: 'none' }}
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
            { icon: <Sparkles     size={14}/>, label: 'AI يخمّن الأعمدة', hint: 'أو التعرّف التلقائي بالأنماط' },
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

        <Btn variant="ghost" size="full" onClick={onBack}>
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
  // Pass the carrier object so getFieldSchema resolves the correct kind
  // (aramex/smsa/jt/imile/delivernow) from id+name regardless of what
  // the DB id happens to be (e.g. 'jnt' for J&T, or a legacy UUID for
  // Aramex).
  const schema = getFieldSchema(carrier || carrierId, carriers);
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
          ? 'color-mix(in srgb, var(--accent) 6%, transparent)'
          : !carrierId
            ? 'rgba(251,146,60,.08)'
            : 'rgba(251,191,36,.06)',
        border: `1px solid ${detectedOk
          ? 'color-mix(in srgb, var(--accent) 30%, transparent)'
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
        <span style={{ background:'color-mix(in srgb, var(--accent) 10%, transparent)', border:'1px solid color-mix(in srgb, var(--accent) 25%, transparent)', color:'var(--accent)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20 }}>
          {rowCount} سطر بيانات
        </span>
        <span style={{ background:'color-mix(in srgb, var(--accent) 8%, transparent)', border:'1px solid var(--border)', color:'var(--muted)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20 }}>
          {mappedCount}/{visibleFields.length} أعمدة معيّنة
        </span>
        {carrier && (
          <span style={{ background:'color-mix(in srgb, var(--accent) 10%, transparent)', border:'1px solid color-mix(in srgb, var(--accent) 30%, transparent)', color:'var(--accent)', fontSize:10, fontFamily:'var(--font-mono)', padding:'3px 10px', borderRadius:20, fontWeight: 700 }}>
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
              background: isMapped ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : required ? 'rgba(248,113,113,.04)' : 'transparent',
              border: `1px solid ${isMapped?'color-mix(in srgb, var(--accent) 20%, transparent)':required&&!isMapped?'rgba(248,113,113,.20)':'transparent'}`,
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
                  borderColor: isMapped?'color-mix(in srgb, var(--accent) 30%, transparent)':undefined }}
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
              background: Object.values(colMap).includes(h) ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--card)',
              border: `1px solid ${Object.values(colMap).includes(h)?'color-mix(in srgb, var(--accent) 28%, transparent)':'var(--border)'}`,
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
          // Gate on the CARRIER'S OWN required fields (requiredMissing uses
          // the per-carrier schema) — the old hardcoded weight+delivery pair
          // blocked flat-priced carriers (Webek: no weight column at all)
          // and unpriced exports (Delex: no delivery column either).
          disabled={!carrierId || requiredMissing > 0}
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
  const location = useLocation();
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
  // When the file came from the Webhook page (via "حفظ كمراجعة"), we
  // carry the originating webhook_events row id so AuditResults can
  // mark it processed + linked after the user approves.
  const [sourceWebhookEventId, setSourceWebhookEventId] = useState(null);
  // اعتماد بنقرة (فواتير-1): علم من الوارد — يشغّل «تأكيد» خطوة 3 آلياً
  // ويوسم المسودة ليعتمدها AuditResults إذا اجتازت البوابة. أي عائق
  // (أعمدة ناقصة/مراجعة سابقة لنفس الفترة) يطفئ العلم ويترك المسار يدوياً.
  const [autoApproveFlag, setAutoApproveFlag] = useState(false);
  const autoConfirmFiredRef = useRef(false);

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
        // ── PDF branch: Aramex detailed shipment invoice ──────────
        // The operator only receives PDF (Excel is on-request). We parse
        // the per-shipment lines and feed them through the SAME rawRows +
        // colMap pipeline the xlsx path uses, so preview + audit are
        // unchanged downstream.
        const isPdf = /\.pdf$/i.test(file.name || '') || file.type === 'application/pdf';
        if (isPdf) {
          setAiStatus('جارٍ قراءة فاتورة PDF...');
          const { header, rows: ships } = await parseAramexInvoice(e.target.result);
          if (!ships.length) {
            toast('PDF غير مدعوم — حالياً فواتير أرامكس التفصيلية فقط', 'error');
            setUploading(false); return;
          }
          const H = { awb: 'رقم الشحنة', date: 'تاريخ الالتقاط', dest: 'الوجهة', weight: 'الوزن (كغ)', base: 'رسوم الشحن', fuel: 'الوقود+RSS', tax: 'الضريبة', svc: 'نوع الخدمة' };
          const aramexId = (carriers.find(c => /aramex|أرامكس|ارامكس/i.test(c.name))?.id) || 'c_1777506662790';
          setAllRawRows([Object.values(H), ...ships.map(s => [s.awb, s.shipDate, s.dest, s.weight, s.deliveryCharges, s.fuelSurcharge, s.tax, s.serviceType])]);
          setHeaders(Object.values(H));
          setRawRows(ships.map(s => ({ [H.awb]: s.awb, [H.date]: s.shipDate, [H.dest]: s.dest, [H.weight]: s.weight, [H.base]: s.deliveryCharges, [H.fuel]: s.fuelSurcharge, [H.tax]: s.tax, [H.svc]: s.serviceType })));
          setColMap({ awb: H.awb, shipDate: H.date, dest: H.dest, weight: H.weight, deliveryCharges: H.base, fuelSurcharge: H.fuel, tax: H.tax, serviceType: H.svc });
          setCarrierId(aramexId);
          setCarrierDetect({ carrierId: aramexId, confidence: 1, method: 'pdf-invoice' });
          setDetectedRow(1);
          toast(`فاتورة أرامكس${header.invoiceNo ? ` ${header.invoiceNo}` : ''}: ${ships.length} شحنة${header.total ? ` · ${header.total.toLocaleString('en-US')} ر.س` : ''}`, 'success');
          setStep(3);
          setUploading(false);
          return;
        }

        const wb = XLSX.read(e.target.result, { type:'array' });

        // ── Pick the right sheet ─────────────────────────────────
        // Some carriers (J&T) ship the file with a SUMMARY sheet first
        // and the actual line-level data on a second sheet (DETAILS).
        // If we blindly read Sheet 0 we'd only see the period totals.
        // Heuristic: prefer the sheet with the most data rows that has
        // at least 5 columns. Skip sheets whose name screams summary.
        const isSummaryName = (n) => /summary|total|ملخص|إجمالي/i.test(n);
        const candidates = wb.SheetNames.map(name => {
          const ws = wb.Sheets[name];
          // Recompute !ref from actual cell addresses — some exporters
          // (J&T's WestBr statement, certain ERP dumps) ship a stale
          // !ref that covers only the first few rows even though the
          // sheet has hundreds. sheet_to_json honours !ref, so without
          // this fix we'd silently drop everything past the bad ref.
          let mr = 0, mc = 0;
          for (const k of Object.keys(ws)) {
            if (k.startsWith('!')) continue;
            const a = XLSX.utils.decode_cell(k);
            if (a.r > mr) mr = a.r;
            if (a.c > mc) mc = a.c;
          }
          if (mr > 0 || mc > 0) {
            ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:mr,c:mc} });
          }
          const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null });
          const dataRows = rows.filter(r => r && r.some(v => v != null && v !== ''));
          const cols = Math.max(...rows.slice(0, 5).map(r => (r || []).length), 0);
          return { name, rows, dataRows: dataRows.length, cols, isSummary: isSummaryName(name) };
        });
        // Pick: non-summary with most rows; fall back to overall max.
        candidates.sort((a, b) => {
          if (a.isSummary !== b.isSummary) return a.isSummary ? 1 : -1;
          return b.dataRows - a.dataRows;
        });
        const chosen  = candidates[0] || { rows: [], name: wb.SheetNames[0] };
        const allRows = chosen.rows;

        if (!allRows.length) { toast('الملف فارغ', 'error'); setUploading(false); return; }
        if (wb.SheetNames.length > 1) {
          toast(`الورقة المختارة: ${chosen.name} (${chosen.dataRows} سطر)`, 'info');
        }
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

        // No AI here. Per-carrier schemas + regex column detection are
        // deterministic and 100% accurate for the four carriers we
        // support. The "✨ إعادة تحليل AI" button in Step 3 stays as
        // a manual escape hatch for files with unexpected layouts.
        setAiStatus('جارٍ قراءة الأعمدة...');

        // ── Carrier-aware regex detection ─────────────────────────
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

        if (!data.length) {
          toast('لم يتم العثور على بيانات في الملف', 'error');
          setAutoApproveFlag(false);   // م1: فشل القراءة يطفئ الآلية
          setUploading(false); return;
        }

        setDetectedRow(hdrIdx + 1);
        setHeaders(hdrs);
        setRawRows(data);
        // Use the just-detected carrier id directly — setCarrierId from
        // a few lines above is async and won't reflect in this closure.
        // Pass the full carriers list so getFieldSchema can resolve the
        // kind from id+name regardless of what id the DB uses.
        setColMap(detectColumns(hdrs, detected?.carrierId || null, carriers));
        setStep(3);
      } catch (err) {
        toast(`خطأ في قراءة الملف: ${err.message}`, 'error');
        setAutoApproveFlag(false);   // م1: فشل القراءة يطفئ الآلية
      }
      setUploading(false);
    };
    reader.readAsArrayBuffer(file);
    // MUST depend on `carriers`: with PageSlot the wizard mounts once at app
    // start (carriers still loading → []), and an empty-deps callback would
    // freeze that empty list forever, so detectCarrierFromFile(allRows, [])
    // always returns null ("ما قدرنا نتعرف على الشركة"). Re-create when the
    // list arrives. The webhook-import effect re-runs harmlessly (guarded by
    // CONSUMED_WEBHOOK_IMPORTS + sessionStorage clear).
  }, [carriers]);

  // ── Auto-import from /webhook ──────────────────────────────────
  // When the user clicks "حفظ كمراجعة" on the Webhook Events page we
  // stash the file as base64 in sessionStorage and route here. We
  // pick it up here, decode the bytes back into a File, and feed
  // them through the same pipeline that a manual upload uses.
  //
  // IMPORTANT: App.jsx renders every page inside a <PageSlot> that
  // toggles visibility/pointer-events but DOES NOT unmount inactive
  // pages. That means a one-shot useEffect on mount only fires once
  // per browser session — not every time the user lands on /upload.
  // We solve this by depending on `location.pathname`: every time the
  // user navigates here, the effect re-runs and re-checks for an
  // incoming webhook payload.
  //
  // The CONSUMED_WEBHOOK_IMPORTS Set (module-level) still prevents
  // double-processing across React StrictMode's double-invocation in
  // dev, and against rapid re-navigation back-and-forth.
  // Preselect the carrier when arriving via «رفع مراجعة لهذا الناقل»
  // (e.g. from /cod-settlements?carrier=X → /upload?carrier=X). The file
  // detector still overrides this if it recognizes a different carrier.
  useEffect(() => {
    if (location.pathname !== '/upload') return;
    const wanted = new URLSearchParams(location.search).get('carrier');
    if (wanted && carriers?.some(c => c.id === wanted)) setCarrierId(wanted);
  }, [location.pathname, location.search, carriers]);

  useEffect(() => {
    if (location.pathname !== '/upload') return;
    // Diagnostic logging — keep until the flow is rock-solid in prod.
    let raw;
    try { raw = sessionStorage.getItem('webhookImport'); } catch (e) {
      console.warn('[webhook-import] sessionStorage read failed:', e);
      return;
    }
    if (!raw) {
      console.info('[webhook-import] no pending import — manual upload mode');
      return;
    }
    console.info('[webhook-import] found pending import, length:', raw.length);

    let payload;
    try { payload = JSON.parse(raw); } catch (e) {
      console.warn('[webhook-import] JSON parse failed:', e);
      sessionStorage.removeItem('webhookImport');
      toast('استيراد Webhook غير صالح — تجاهل', 'error');
      return;
    }
    if (!payload?.base64 || !payload?.filename) {
      console.warn('[webhook-import] payload missing base64 or filename:', Object.keys(payload || {}));
      sessionStorage.removeItem('webhookImport');
      toast('استيراد Webhook ناقص — تجاهل', 'error');
      return;
    }

    const key = payload.eventId || `${payload.filename}_${payload.base64.length}`;
    if (CONSUMED_WEBHOOK_IMPORTS.has(key)) {
      console.info('[webhook-import] already consumed in this session:', key);
      // م8 (فحص عدائي): لا تترك الـpayload عالقاً ولا المستخدم بلا تفسير
      sessionStorage.removeItem('webhookImport');
      toast('هذا الحدث استُورد سابقاً في هذه الجلسة — افتح سجل المراجعات إن لم تجده', 'info');
      return;
    }
    CONSUMED_WEBHOOK_IMPORTS.add(key);
    sessionStorage.removeItem('webhookImport');
    console.info('[webhook-import] starting import for', payload.filename, '(', payload.base64.length, 'b64 chars)');

    try {
      // Decode base64 → Uint8Array → File
      const bin = atob(payload.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], payload.filename, {
        type: /\.(xlsx|xlsm)$/i.test(payload.filename)
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/octet-stream',
      });
      console.info('[webhook-import] reconstructed File, size:', file.size, 'type:', file.type);

      if (payload.carrierId) setCarrierId(payload.carrierId);
      if (payload.eventId)   setSourceWebhookEventId(payload.eventId);
      setAutoApproveFlag(!!payload.autoApprove);
      autoConfirmFiredRef.current = false;
      // م3 (فحص عدائي): الفترة كانت تعلق على آخر اختيار يدوي (PageSlot لا
      // يفصل §2.1) — فاتورة واردة اليوم تُعاد فترتها لتاريخ اليوم دائماً.
      const nowD = new Date();
      setMonth(nowD.getMonth() + 1);
      setYear(nowD.getFullYear());
      setStep(2);
      toast(`جارٍ معالجة الملف من Webhook: ${payload.filename}`, 'info');
      // Synchronous call so handleFile starts immediately. Internally
      // it uses FileReader.onload (async) which then setStep(3) on
      // success. Skipping setTimeout avoids losing the call when
      // StrictMode's first invocation gets torn down.
      handleFile(file);
      console.info('[webhook-import] handleFile dispatched');
    } catch (err) {
      console.error('[webhook-import] decode/dispatch failed:', err);
      CONSUMED_WEBHOOK_IMPORTS.delete(key);
      toast(`فشل استيراد الملف: ${err.message}`, 'error');
    }
  }, [handleFile, location.pathname]);

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
    // Soft same-carrier+period guard: warn before processing if a review
    // already exists for this carrier and month (the common "رفعت نفس
    // الشهر مرتين" mistake). Legitimate multi-invoice months can confirm.
    try {
      const priors = await findSamePeriodAudits(carrier.id, period);
      if (priors.length) {
        // في الوضع الآلي: مراجعة سابقة لنفس الفترة = خطر تكرار → أوقف
        // الآلية فوراً واترك القرار للإنسان (لا window.confirm بلا مستخدم).
        if (autoApproveFlag) {
          setAutoApproveFlag(false);
          toast(`⚠️ توجد ${priors.length} مراجعة سابقة لنفس الفترة — أُوقف الاعتماد الآلي، راجع يدوياً`, 'warn');
          return;
        }
        const p = priors[0];
        const when = p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB') : '—';
        const ok = window.confirm(
          `⚠️ يوجد ${priors.length} مراجعة سابقة لـ«${carrier.name}» لنفس الفترة (${period}).\n` +
          `الأحدث: ${p.file_name || p.id} · ${when} · ${p.row_count ?? '—'} شحنة.\n\n` +
          `إن كانت نفس الفاتورة فلا تكمل (تجنّب التكرار). متأكد تكمل؟`,
        );
        if (!ok) return;
      }
    } catch {
      // م12 (فحص عدائي): يدوياً الفشل غير قاتل؛ آلياً حارس معطّل = لا أتمتة
      if (autoApproveFlag) {
        setAutoApproveFlag(false);
        toast('تعذّر فحص المراجعات السابقة — أُوقف الاعتماد الآلي، أكمل يدوياً', 'warn');
        return;
      }
    }
    const forDate = `${year}-${String(month).padStart(2,'0')}-01`;
    // Unpriced operational exports (Delex): keep zero-billed delivered rows —
    // the contract prices them (priceFromContract), not the file.
    const keepUnbilled = !!carrier?.contracts?.some(c => c.priceFromContract);
    const mapped  = mapRows(rawRows, colMap, { keepUnbilled });
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
      // Marker: this audit lives in-memory only. AuditResults shows
      // an "اعتماد المراجعة" CTA that persists it (with review_status
      // = approved) the moment the user blesses the numbers. "رفض"
      // just discards. Nothing hits the audits table or the history
      // page until the user explicitly decides.
      isDraft: true,
      // If we came from the Webhook page, carry the source event id
      // so AuditResults can flip it to 'processed' on approval.
      sourceWebhookEventId,
      // اعتماد بنقرة: AuditResults يعتمد آلياً فقط إذا اجتازت البوابة
      autoApprove: autoApproveFlag,
    };
    toast(`جاهز للمراجعة — ${results.length} شحنة`, 'success');
    onComplete(audit);
  };

  // ── الاعتماد بنقرة: تشغيل «تأكيد» خطوة 3 آلياً ─────────────────────
  // يشتعل مرة واحدة (ref) حين تجهز الخطوة بعلَم autoApprove. شرط السلامة:
  // عمود مبلغ موجود (أو العقد يسعّر priceFromContract) وعمود AWB — وإلا
  // يطفأ العلم ويُترك المسار يدوياً. نفس handleConfirm اليدوي حرفياً.
  useEffect(() => {
    if (!autoApproveFlag || step !== 3 || autoConfirmFiredRef.current) return;
    if (!carrier || !rawRows.length || uploading) return;
    const priced = colMap?.deliveryCharges != null
      || carrier.contracts?.some(c => c.priceFromContract);
    if (colMap?.awb == null || !priced) {
      setAutoApproveFlag(false);
      toast('الأعمدة غير مكتملة للاعتماد الآلي — راجع الخريطة يدوياً', 'warn');
      return;
    }
    autoConfirmFiredRef.current = true;
    toast('⚡ تدقيق آلي جارٍ…', 'info');
    handleConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoApproveFlag, step, carrier, rawRows.length, colMap, uploading]);

  const stepLabels = [
    { n: 1, title: 'اختر الشركة', sub: 'الناقل والفترة'   },
    { n: 2, title: 'ارفع الملف',  sub: 'فاتورة Excel'      },
    { n: 3, title: 'راجع',         sub: 'الأعمدة والنتائج' },
  ];

  return (
    <div style={{ padding: '32px 42px 80px', maxWidth: 1180, margin: '0 auto' }}>

      <PageHeader
        icon={<UploadIcon size={22}/>}
        title="تدقيق فاتورة جديدة"
        subtitle="ارفع الفاتورة، دع النظام يقرأ الناقل والأعمدة، ثم اعتمد المراجعة بثقة"
        meta={`الخطوة ${step}/3 — ${step === 1 ? 'الفترة' : step === 2 ? 'الرفع' : 'المراجعة'} · الفترة ${period}`}
      />

      {/* ── STEP INDICATOR ────────────────────────────────────────────── */}
      <Card style={{ padding: '16px 18px', marginBottom: 22, maxWidth: 760, marginInline: 'auto', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', rowGap: 8 }}>
          {stepLabels.map((s, i) => {
            const done    = step > s.n;
            const current = step === s.n;
            return (
              <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 12,
                    background: done
                      ? 'linear-gradient(135deg, var(--green), var(--green2))'
                      : current
                        ? 'linear-gradient(135deg, var(--accent), var(--accent2))'
                        : 'var(--surface)',
                    border: `2px solid ${done || current ? 'transparent' : 'var(--border2)'}`,
                    color: done || current ? '#fff' : 'var(--muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14,
                    flexShrink: 0,
                    boxShadow: current ? '0 10px 24px rgba(37,99,235,.20)' : 'none',
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
                    background: step > s.n ? 'linear-gradient(90deg, var(--accent2), var(--accent))' : 'var(--border)',
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
          onUpload={(f) => {
            // م1 (فحص عدائي): إسقاط يدوي = إلغاء أي علم آلي عالق من محاولة
            // فاشلة — وإلا اعتُمد ملف يدوي لم يطلب أحد أتمتته.
            setAutoApproveFlag(false);
            handleFile(f);
          }} onBack={() => setStep(1)}
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
