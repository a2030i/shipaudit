import { useState, useMemo, useCallback } from 'react';
import { Upload, FileText, AlertCircle, Search, Trash2, Save } from 'lucide-react';
import { Card, Btn, Spinner, Empty, Badge, toast } from '../components/UI.jsx';
import { parseAramexStatement } from '../engine/aramexStatementParser.js';
import { saveCarrierStatement } from '../lib/carrierStatementsService.js';
import { useAuth } from '../lib/auth.jsx';

// ─── Doc-type & shipment-type labels ──────────────────────────────────────
const DOC_TYPE_META = {
  RV: { label: 'فاتورة',       color: 'var(--accent)' },
  DR: { label: 'مدين إضافي',   color: 'var(--gold)'   },
  DG: { label: 'إشعار دائن',   color: 'var(--green)'  },
  AB: { label: 'تعديل',        color: 'var(--muted)'  },
};
const SHIPMENT_TYPE_LABEL = {
  domestic:           'محلي',
  domestic_other:     'محلي (DCF)',
  international_in:   'دولي وارد',
  international_out:  'دولي صادر',
};

const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CarrierStatements() {
  const { user } = useAuth();
  const [state, setState] = useState('idle');     // idle | processing | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);      // { header, operations, totals, fileName }
  const [drag, setDrag] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [savedDiff, setSavedDiff] = useState(null); // { added, updated, reviewing, unchanged }

  const processFile = useCallback(async (file) => {
    if (!file) return;
    setState('processing');
    setErrorMsg('');
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseAramexStatement(buf);
      setResult({ ...parsed, fileName: file.name });
      setState('done');
      toast(`تم استخراج ${parsed.operations.length} عملية`, 'success');
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'تعذّر قراءة كشف الحساب');
      setState('error');
    }
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  };
  const handlePick = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };
  const reset = () => {
    setState('idle');
    setResult(null);
    setSearch('');
    setFilter('all');
    setErrorMsg('');
    setSavedDiff(null);
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const { diff } = await saveCarrierStatement({
        carrierId:   'aramex',
        carrierName: 'أرامكس',
        fileName:    result.fileName,
        parsed:      result,
        userId:      user?.id,
      });
      setSavedDiff(diff);
      toast(
        `تم الحفظ — ${diff.added} جديدة، ${diff.updated} محدّثة، ${diff.reviewing} تحت المراجعة`,
        'success',
      );
    } catch (e) {
      console.error(e);
      toast(`فشل الحفظ: ${e.message}`, 'error');
    }
    setSaving(false);
  };

  // ── Derived ────────────────────────────────────────────────────────────
  const breakdown = useMemo(() => {
    if (!result) return { rv: 0, dr: 0, dg: 0, ab: 0 };
    return result.operations.reduce((acc, o) => {
      acc[o.docType.toLowerCase()] = (acc[o.docType.toLowerCase()] ?? 0) + 1;
      return acc;
    }, { rv: 0, dr: 0, dg: 0, ab: 0 });
  }, [result]);

  const filtered = useMemo(() => {
    if (!result) return [];
    let out = result.operations;
    if (filter !== 'all') out = out.filter(o => o.docType === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(o =>
        String(o.docNo).toLowerCase().includes(q)
        || String(o.referenceNo).toLowerCase().includes(q)
      );
    }
    return out;
  }, [result, filter, search]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px 24px', maxWidth: 1300, margin: '0 auto' }}>
      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginBottom: 4 }}>
        📑 كشف حساب <span style={{ color: 'var(--accent)' }}>أرامكس</span>
      </h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 24 }}>
        ارفع ملف PDF كشف الحساب الشهري لأرامكس ليتم استخراج كل العمليات (فواتير، خصومات، إشعارات).
      </p>

      {/* IDLE — drop zone */}
      {state === 'idle' && (
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('cs-file').click()}
          style={{
            border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border2)'}`,
            borderRadius: 14, padding: '64px 24px', textAlign: 'center',
            background: drag ? 'rgba(56,189,248,.05)' : 'var(--surface)',
            cursor: 'pointer', transition: 'all .2s',
          }}
        >
          <Upload size={42} color="var(--muted)" style={{ marginBottom: 12 }}/>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>اسحب ملف كشف الحساب هنا</div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            ملفات PDF من أرامكس (Statement of Account)
          </div>
          <input id="cs-file" type="file" accept=".pdf" style={{ display: 'none' }} onChange={handlePick}/>
        </div>
      )}

      {state === 'processing' && (
        <Card style={{ padding: 64, textAlign: 'center' }}>
          <Spinner size={36}/>
          <div style={{ color: 'var(--muted)', marginTop: 12, fontSize: 13 }}>جارٍ قراءة الكشف...</div>
        </Card>
      )}

      {state === 'error' && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle size={22} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>تعذّر قراءة الملف</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>{errorMsg}</div>
              <Btn variant="primary" onClick={reset}>محاولة أخرى</Btn>
            </div>
          </div>
        </Card>
      )}

      {state === 'done' && result && (
        <>
          {/* Header card */}
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 18 }}>
              <KV label="العميل"           value={result.header.customer || '—'}/>
              <KV label="رقم الحساب"        value={result.header.accountNumber || '—'} mono/>
              <KV label="الفترة"            value={`${result.header.periodFrom || '—'} ← ${result.header.periodTo || '—'}`} mono/>
              <KV label="مدة الاستحقاق"     value={result.header.creditTerms || '—'}/>
              <KV label="الرقم الضريبي"      value={result.header.vatNo || '—'} mono/>
              <KV label="الملف"              value={result.fileName}/>
            </div>
          </Card>

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px,1fr))', gap: 12, marginBottom: 14 }}>
            <Stat label="الرصيد الإجمالي"   value={fmt(result.totals.totalBalance)} suffix="ر.س" color="var(--accent)" big/>
            <Stat label="حتى 30 يوم"       value={fmt(result.totals.aging?.d0_30)}  suffix="ر.س" color="var(--green)"/>
            <Stat label="31 إلى 60 يوم"   value={fmt(result.totals.aging?.d31_60)} suffix="ر.س" color="var(--gold)"/>
            <Stat label="61 إلى 90 يوم"   value={fmt(result.totals.aging?.d61_90)} suffix="ر.س" color="var(--warn)"/>
            <Stat label="فوق 90 يوم"      value={fmt(result.totals.aging?.over90)} suffix="ر.س" color="var(--red)"/>
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {!savedDiff && (
              <Btn variant="primary" icon={saving ? <Spinner size={12}/> : <Save size={14}/>}
                onClick={handleSave} disabled={saving}>
                {saving ? 'جارٍ الحفظ...' : 'حفظ في الدفتر'}
              </Btn>
            )}
            <Btn variant="ghost" icon={<Trash2 size={14}/>} onClick={reset}>كشف جديد</Btn>
            <span style={{ color: 'var(--muted)', fontSize: 11, marginRight: 8, fontFamily: 'var(--font-mono)' }}>
              العمليات ({result.operations.length}) — RV {breakdown.rv} | DR {breakdown.dr} | DG {breakdown.dg} | AB {breakdown.ab}
            </span>
          </div>

          {savedDiff && (
            <div style={{
              background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.25)',
              borderRadius: 9, padding: '10px 14px', marginBottom: 12, fontSize: 12,
              color: 'var(--green)', display: 'flex', gap: 14, flexWrap: 'wrap',
            }}>
              <span>✓ تم الحفظ في الدفتر</span>
              <span>✚ {savedDiff.added} جديدة</span>
              <span>✎ {savedDiff.updated} محدّثة</span>
              {savedDiff.reviewing > 0 && (
                <span style={{ color: 'var(--gold)' }}>
                  ⚠ {savedDiff.reviewing} تحت المراجعة (مبلغ تغيّر بعد التسديد/التدقيق)
                </span>
              )}
              <span style={{ color: 'var(--muted)' }}>· {savedDiff.unchanged} بدون تغيير</span>
            </div>
          )}

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {[
              { k: 'all', l: `الكل (${result.operations.length})` },
              { k: 'RV',  l: `فواتير (${breakdown.rv})` },
              { k: 'DR',  l: `مدين (${breakdown.dr})` },
              { k: 'DG',  l: `دائن (${breakdown.dg})` },
              { k: 'AB',  l: `تعديلات (${breakdown.ab})` },
            ].map(t => (
              <button key={t.k} onClick={() => setFilter(t.k)} style={{
                background: filter === t.k ? 'var(--accent)20' : 'transparent',
                border: `1px solid ${filter === t.k ? 'var(--accent)' : 'var(--border)'}`,
                color: filter === t.k ? 'var(--accent)' : 'var(--muted)',
                borderRadius: 7, padding: '5px 13px', cursor: 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600,
              }}>{t.l}</button>
            ))}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={14} style={{ position: 'absolute', right: 12, top: 11, color: 'var(--muted)' }}/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث برقم المستند أو المرجع..."
              style={{ width: '100%', padding: '9px 36px 9px 12px', borderRadius: 9, fontSize: 13 }}
            />
          </div>

          {/* Table */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {filtered.length === 0
                ? <Empty icon="🔍" title="لا توجد عمليات مطابقة"/>
                : (
                  <table style={{ fontSize: 12, width: '100%' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
                      <tr>
                        <th style={{ minWidth: 60 }}>النوع</th>
                        <th style={{ minWidth: 110 }}>رقم المستند</th>
                        <th style={{ minWidth: 200 }}>المرجع</th>
                        <th style={{ minWidth: 90 }}>تاريخ المستند</th>
                        <th style={{ minWidth: 90 }}>تاريخ الاستحقاق</th>
                        <th style={{ minWidth: 110 }}>مدين</th>
                        <th style={{ minWidth: 110 }}>دائن</th>
                        <th style={{ minWidth: 110 }}>الرصيد</th>
                        <th style={{ minWidth: 100 }}>نوع الشحنة</th>
                        <th style={{ minWidth: 90 }}>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((o, i) => {
                        const meta = DOC_TYPE_META[o.docType] ?? DOC_TYPE_META.RV;
                        return (
                          <tr key={i}>
                            <td>
                              <span style={{
                                background: `${meta.color}20`, border: `1px solid ${meta.color}40`,
                                color: meta.color, fontSize: 10, fontWeight: 700,
                                padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
                                whiteSpace: 'nowrap',
                              }}>
                                {o.docType} · {meta.label}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
                              {o.docNo}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                              {o.referenceNo}
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{o.docDate || '—'}</td>
                            <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{o.dueDate || '—'}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: o.dr > 0 ? 'var(--red)' : 'var(--muted3)' }}>
                              {o.dr > 0 ? fmt(o.dr) : ''}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: o.cr < 0 ? 'var(--green)' : 'var(--muted3)' }}>
                              {o.cr < 0 ? fmt(Math.abs(o.cr)) : ''}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmt(o.balance)}</td>
                            <td style={{ fontSize: 11 }}>
                              {o.shipmentType ? SHIPMENT_TYPE_LABEL[o.shipmentType] : '—'}
                            </td>
                            <td>
                              <Badge status="unknown" label={o.docType === 'RV' ? '⏳ معلّقة' : '—'}/>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              }
            </div>
          </Card>

          <p style={{ marginTop: 14, color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            <FileText size={12} style={{ display: 'inline', marginLeft: 4 }}/>
            المرحلة 1A — العمليات تُستخرج وتُعرض فقط (ما تنحفظ في DB بعد). المراحل التالية: حفظ + رفع الفواتير + التدقيق التلقائي.
          </p>
        </>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────
function KV({ label, value, mono }) {
  return (
    <div>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 3 }}>{label}</div>
      <div style={{
        fontSize: 13, fontWeight: 600,
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</div>
    </div>
  );
}

function Stat({ label, value, suffix, color, big }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 11, padding: '13px 16px',
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        color, fontSize: big ? 22 : 16,
        fontFamily: 'var(--font-mono)', fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        {value}
        {suffix && <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4 }}> {suffix}</span>}
      </div>
    </div>
  );
}
