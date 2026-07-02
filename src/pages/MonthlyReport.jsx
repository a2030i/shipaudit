// "التقرير الشهري لكل ناقل" — one row per carrier for the selected month:
// مفوتر · تحصيل COD · إشعارات دائنة · مدفوعات · صافي الحركة · مراجعات + فروقاتها.
//
// Read-only. Pulls from the carrier ledger (carrier_operations) + audits via
// monthlyReportService. Exportable to Excel for sharing/filing.

import { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { RefreshCw, CalendarRange, Download, TrendingUp, Printer } from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { loadMonthlyReport } from '../lib/monthlyReportService.js';

const fmt = (n) => {
  if (n == null || Number.isNaN(n) || n === 0) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const monthLabel = (m) => {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${names[+mo - 1] || mo} ${y}`;
};

export default function MonthlyReport({ isActive }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth]     = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await loadMonthlyReport();
      setData(r);
      setMonth((cur) => (cur && r.months.includes(cur) ? cur : (r.months[0] || null)));
    } catch (e) {
      toast(`تعذّر تحميل التقرير: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive && !data) refresh(); }, [isActive, data, refresh]);

  const rows = useMemo(() => {
    if (!data || !month) return [];
    return data.rows
      .filter(r => r.month === month)
      .sort((a, b) => b.billed - a.billed || b.net - a.net);
  }, [data, month]);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    billed: t.billed + r.billed, cod: t.cod + r.cod, creditNotes: t.creditNotes + r.creditNotes,
    payments: t.payments + r.payments, net: t.net + r.net,
    auditCount: t.auditCount + r.auditCount, auditDiff: t.auditDiff + r.auditDiff, mismatch: t.mismatch + r.mismatch,
  }), { billed:0, cod:0, creditNotes:0, payments:0, net:0, auditCount:0, auditDiff:0, mismatch:0 }), [rows]);

  // ── اتجاه شهر-بشهر (كله من data المحمّلة سلفاً — صفر استعلامات) ──
  // months مرتّبة الأحدث أولاً (months[0] هو الافتراضي) → السابق = i+1.
  const prevMonth = useMemo(() => {
    if (!data || !month) return null;
    const i = data.months.indexOf(month);
    return i >= 0 && i + 1 < data.months.length ? data.months[i + 1] : null;
  }, [data, month]);
  const prevBilled = useMemo(() => {
    if (!data || !prevMonth) return new Map();
    return new Map(data.rows.filter(r => r.month === prevMonth).map(r => [r.carrierId, r.billed]));
  }, [data, prevMonth]);
  // % تغيّر المفوتر عن الشهر السابق + إشارة «زاد ولم يُدقَّق» (نمط سمسا:
  // الفوترة ترتفع بلا أي مراجعة معتمدة = فرق محتمل يتراكم بصمت).
  const deltaOf = (r) => {
    const prev = prevBilled.get(r.carrierId);
    if (!prev || prev <= 0) return null;
    return +(((r.billed - prev) / prev) * 100).toFixed(1);
  };
  const unauditedGrowth = (r, delta) =>
    delta != null && delta > 10 && !r.auditCount && r.billed > 1000;

  // صافي كل شهر — يظهر مصغّراً تحت اسم الشهر في المبدّل
  const monthNets = useMemo(() => {
    const m = new Map();
    for (const r of (data?.rows || [])) m.set(r.month, (m.get(r.month) || 0) + r.net);
    return m;
  }, [data]);
  const fmtCompact = (n) => Math.abs(n) >= 1e6 ? `${(n/1e6).toFixed(1)}م` : Math.abs(n) >= 1e3 ? `${(n/1e3).toFixed(0)}ك` : `${Math.round(n)}`;

  const exportXlsx = useCallback(() => {
    if (!rows.length) return;
    const aoa = [
      ['الناقل','مفوتر','التغيّر عن السابق %','تحصيل COD','إشعارات دائنة','مدفوعات','صافي الحركة','المراجعات','فرق التدقيق','شحنات مفروقة'],
      ...rows.map(r => [r.carrierName, r.billed, deltaOf(r) ?? '', r.cod, r.creditNotes, r.payments, r.net, r.auditCount, r.auditDiff, r.mismatch]),
      [],
      ['الإجمالي', totals.billed, '', totals.cod, totals.creditNotes, totals.payments, totals.net, totals.auditCount, totals.auditDiff, totals.mismatch],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:18},{wch:13},{wch:15},{wch:13},{wch:14},{wch:12},{wch:13},{wch:11},{wch:12},{wch:13}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, monthLabel(month).replace(/\s/g,'_').slice(0,28));
    XLSX.writeFile(rtl(wb), `تقرير_شهري_${month}.xlsx`);
    toast('تم تصدير التقرير', 'success');
  }, [rows, totals, month]);

  if (loading && !data) return <div style={{ padding: 48, textAlign: 'center' }}><Spinner/></div>;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader
        icon={<CalendarRange size={24}/>}
        title="التقرير الشهري للناقلين"
        subtitle="مفوتر · تحصيل · إشعارات · صافي · جودة التدقيق — لكل ناقل شهرياً"
        actions={
          <div className="no-print" style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''}/> تحديث
            </Btn>
            <Btn variant="ghost" size="sm" onClick={exportXlsx} disabled={!rows.length}>
              <Download size={14}/> تصدير Excel
            </Btn>
            {/* ورقة الإدارة/الشريك — @media print يخفي كل ما عدا التقرير */}
            <Btn variant="ghost" size="sm" onClick={() => window.print()} disabled={!rows.length}>
              <Printer size={14}/> طباعة
            </Btn>
          </div>
        }
      />

      {/* سطر يظهر في الطباعة فقط — عنوان الورقة المطبوعة */}
      <div style={{ display: 'none' }} className="print-only-title">
        التقرير الشهري للناقلين — {monthLabel(month)} · أُنشئ {new Date().toISOString().slice(0, 10)}
      </div>

      {/* Month selector */}
      {data?.months?.length > 0 && (
        <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {data.months.map(m => (
            <button key={m} onClick={() => setMonth(m)}
              style={{
                padding: '6px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                border: '1px solid', borderColor: m === month ? '#10B981' : 'var(--border)',
                background: m === month ? 'color-mix(in srgb,#10B981 14%,transparent)' : 'var(--card)',
                color: m === month ? '#10B981' : 'var(--text)',
                textAlign: 'center',
              }}>
              {monthLabel(m)}
              {/* صافي الشهر مصغّراً — يعطي شكل الاتجاه قبل النقر */}
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 500, marginTop: 1,
                color: m === month ? '#10B981' : 'var(--muted)' }}>
                {monthNets.has(m) ? `${fmtCompact(monthNets.get(m))} صافي` : ''}
              </div>
            </button>
          ))}
        </div>
      )}

      {!rows.length ? (
        <Empty icon={<TrendingUp size={32}/>} title="لا توجد بيانات لهذا الشهر" />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle, #f8fafc)', textAlign: 'right' }}>
                  {['الناقل','مفوتر','التغيّر','تحصيل COD','إشعارات دائنة','مدفوعات','صافي الحركة','المراجعات','فرق التدقيق'].map(h => (
                    <th key={h} style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const delta = deltaOf(r);
                  const warn  = unauditedGrowth(r, delta);
                  return (
                  <tr key={r.carrierId} style={{ borderTop: '1px solid var(--border)', background: warn ? 'rgba(220,38,38,.04)' : undefined }}>
                    <td style={{ padding: '11px 14px', fontWeight: 600 }}>
                      {r.carrierName}
                      {warn && (
                        <span title="المفوتر زاد عن الشهر السابق ولا توجد أي مراجعة معتمدة — فروقات محتملة تتراكم بصمت"
                          style={{ marginRight: 6, background: 'rgba(220,38,38,.1)', color: '#DC2626',
                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                          ⚠ زاد ولم يُدقَّق
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.billed)}</td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', fontSize: 12,
                      color: delta == null ? 'var(--muted2)' : delta > 20 ? '#DC2626' : delta < 0 ? '#059669' : 'var(--muted)' }}>
                      {delta == null ? '—' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}%`}
                    </td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', color: r.cod ? '#059669' : 'inherit' }}>{fmt(r.cod)}</td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', color: r.creditNotes ? '#059669' : 'inherit' }}>{fmt(r.creditNotes)}</td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.payments)}</td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: r.net > 0 ? 'var(--text)' : '#059669' }}>{fmt(r.net)}</td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums' }}>{r.auditCount || '—'}</td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', color: Math.abs(r.auditDiff) > 0.5 ? '#dc2626' : 'inherit' }}>
                      {fmt(r.auditDiff)}{r.mismatch ? <span style={{ fontSize: 11, color: '#dc2626' }}> · {r.mismatch} فرق</span> : ''}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-subtle, #f8fafc)', fontWeight: 700 }}>
                  <td style={{ padding: '12px 14px' }}>الإجمالي ({rows.length})</td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.billed)}</td>
                  <td style={{ padding: '12px 14px' }}></td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums', color: '#059669' }}>{fmt(totals.cod)}</td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums', color: '#059669' }}>{fmt(totals.creditNotes)}</td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.payments)}</td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.net)}</td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}>{totals.auditCount || '—'}</td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.auditDiff)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        <strong>مفوتر</strong>: إجمالي الفواتير المدينة (RV/DR/INV). <strong>صافي الحركة</strong> = المفوتر − (التحصيل + الإشعارات + المدفوعات).
        <strong> فرق التدقيق</strong>: مجموع فروقات المراجعات المعتمدة (موجب = أرامكس فوترت أكثر من العقد).
      </p>
    </div>
  );
}
