// "التقرير الشهري لكل ناقل" — one row per carrier for the selected month:
// مفوتر · تحصيل COD · إشعارات دائنة · مدفوعات · صافي الحركة · مراجعات + فروقاتها.
//
// Read-only. Pulls from the carrier ledger (carrier_operations) + audits via
// monthlyReportService. Exportable to Excel for sharing/filing.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { RefreshCw, CalendarRange, Download, TrendingUp, Printer } from 'lucide-react';
import { toast } from '../components/UI.jsx';
import {
  Button as Btn, DataTable, EmptyState as Empty, Money, PageHeader,
  Select, Spinner, StatStrip,
} from '../design-system/EnterpriseUI.jsx';
import { loadMonthlyReport } from '../lib/monthlyReportService.js';

const fmt = (n) => {
  if (n == null || Number.isNaN(n) || n === 0) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtExact = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m) => {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${names[+mo - 1] || mo} ${y}`;
};

export default function MonthlyReport({ isActive }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth]     = useState(() => searchParams.get('month'));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await loadMonthlyReport();
      setData(r);
      setMonth((cur) => {
        const requested = searchParams.get('month');
        if (requested && r.months.includes(requested)) return requested;
        return cur && r.months.includes(cur) ? cur : (r.months[0] || null);
      });
    } catch (e) {
      toast(`تعذّر تحميل التقرير: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [searchParams]);

  useEffect(() => { if (isActive && !data) refresh(); }, [isActive, data, refresh]);

  useEffect(() => {
    if (!data) return;
    const requested = searchParams.get('month');
    if (requested && data.months.includes(requested) && requested !== month) setMonth(requested);
  }, [data, month, searchParams]);

  const changeMonth = (nextMonth) => {
    setMonth(nextMonth);
    const next = new URLSearchParams(searchParams);
    if (nextMonth) next.set('month', nextMonth);
    else next.delete('month');
    setSearchParams(next, { replace: true });
  };

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
  const exportXlsx = useCallback(() => {
    if (!rows.length) return;
    const aoa = [
      ['الناقل','مفوتر','التغيّر عن السابق %','تحصيل COD','مبالغ مُرجَعة/خصومات','مدفوعات','COD ناقص الفواتير','المراجعات','فرق التدقيق','شحنات فيها فرق'],
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
    <div className="monthly-report-view">
      <PageHeader
        icon={<CalendarRange size={24}/>}
        title="التقرير الشهري للناقلين"
        subtitle="مفوتر · تحصيل · إشعارات · صافي · جودة التدقيق — لكل ناقل شهرياً"
        actions={
          <div className="no-print monthly-report-toolbar">
            <Btn variant="ghost" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''}/> تحديث التقرير الشهري
            </Btn>
            <Btn variant="primary" size="sm" onClick={exportXlsx} disabled={!rows.length}>
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
        <div className="no-print monthly-report-toolbar">
          <Select label="فترة التقرير" value={month || ''} onChange={event => changeMonth(event.target.value)}>
            {data.months.map(m => <option key={m} value={m}>{monthLabel(m)} — {fmtExact(monthNets.get(m))} ر.س صافي</option>)}
          </Select>
        </div>
      )}

      {rows.length ? <StatStrip items={[
        { key: 'billed', label: 'إجمالي المفوتر', value: <Money value={totals.billed}/> },
        { key: 'net', label: 'صافي الحركة', value: <Money value={totals.net}/> },
        { key: 'audits', label: 'المراجعات', value: totals.auditCount.toLocaleString('en-US') },
        { key: 'audit-diff', label: 'فرق التدقيق', value: <Money value={totals.auditDiff}/>, tone: Math.abs(totals.auditDiff) > 0.5 ? 'danger' : undefined },
      ]}/> : null}

      {!rows.length ? (
        <Empty icon={<TrendingUp size={32}/>} title="لا توجد بيانات لهذا الشهر" />
      ) : (
        <DataTable className="monthly-report-table" caption="التقرير الشهري للناقلين">
              <thead>
                <tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
                  {['الناقل','مفوتر','التغيّر','تحصيل COD','مبالغ مُرجَعة/خصومات','مدفوعات','COD ناقص الفواتير','المراجعات','فرق التدقيق'].map(h => (
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
                          style={{ marginRight: 6, background: 'rgba(220,38,38,.1)', color: 'var(--red)',
                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                          ⚠ زاد ولم يُدقَّق
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums' }}><bdi dir="ltr">{fmt(r.billed)}</bdi></td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', fontSize: 12,
                      color: delta == null ? 'var(--muted2)' : delta > 20 ? 'var(--red)' : delta < 0 ? 'var(--green2)' : 'var(--muted)' }}>
                      <bdi dir="ltr">{delta == null ? '—' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}%`}</bdi>
                    </td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', color: r.cod ? 'var(--green2)' : 'inherit' }}><bdi dir="ltr">{fmt(r.cod)}</bdi></td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', color: r.creditNotes ? 'var(--green2)' : 'inherit' }}><bdi dir="ltr">{fmt(r.creditNotes)}</bdi></td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums' }}><bdi dir="ltr">{fmt(r.payments)}</bdi></td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: r.net > 0 ? 'var(--text)' : 'var(--green2)' }}><bdi dir="ltr">{fmt(r.net)}</bdi></td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums' }}><bdi dir="ltr">{r.auditCount || '—'}</bdi></td>
                    <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', color: Math.abs(r.auditDiff) > 0.5 ? '#dc2626' : 'inherit' }}>
                      <bdi dir="ltr">{fmt(r.auditDiff)}</bdi>{r.mismatch ? <span style={{ fontSize: 11, color: '#dc2626' }}> · <bdi dir="ltr">{r.mismatch}</bdi> فرق</span> : ''}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)', fontWeight: 700 }}>
                  <td style={{ padding: '12px 14px' }}>الإجمالي ({rows.length})</td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}><bdi dir="ltr">{fmt(totals.billed)}</bdi></td>
                  <td style={{ padding: '12px 14px' }}></td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums', color: 'var(--green2)' }}><bdi dir="ltr">{fmt(totals.cod)}</bdi></td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums', color: 'var(--green2)' }}><bdi dir="ltr">{fmt(totals.creditNotes)}</bdi></td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}><bdi dir="ltr">{fmt(totals.payments)}</bdi></td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}><bdi dir="ltr">{fmt(totals.net)}</bdi></td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}><bdi dir="ltr">{totals.auditCount || '—'}</bdi></td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}><bdi dir="ltr">{fmt(totals.auditDiff)}</bdi></td>
                </tr>
              </tfoot>
        </DataTable>
      )}

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        <strong>مفوتر</strong>: إجمالي الفواتير المدينة (فواتير الكشف + الرسوم + فواتير المراجعة). <strong>COD ناقص الفواتير</strong> = المفوتر − (التحصيل + الإشعارات + المدفوعات).
        <strong> فرق التدقيق</strong>: مجموع فروقات المراجعات المعتمدة (موجب = أرامكس فوترت أكثر من العقد).
      </p>
    </div>
  );
}
