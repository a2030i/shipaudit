// مركز التقارير — نقطة دخول واحدة لكل التقارير الرسمية (§3.2 من خطة الوكلاء).
//
// كل تقرير: بطاقة + معاملات (شهر/ناقل) + توليد Excel يمرّ عبر
// persistAndDownloadExport (تخزين + سجل + تنزيل — قاعدة §1.13) فيبقى
// قابلاً لإعادة التحميل من «السحبات السابقة» أسفل الصفحة.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { FileBarChart, Truck, Landmark, Download, RefreshCw, CalendarRange, Receipt, Activity, AlertTriangle } from 'lucide-react';
import { Card, Btn, Spinner, Empty, Select, toast, PageHeader } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadMonthlyReport } from '../lib/monthlyReportService.js';
import { loadCarriers } from '../lib/coreService.js';
import { persistAndDownloadExport, loadExportHistory, downloadExportFile } from '../lib/internalExportsService.js';
import { quarters, loadZohoFinancialHealth } from '../lib/zohoReportsService.js';

// أرباع جاهزة للإقرار الضريبي (ربعي في السعودية للأغلب)
const QUARTERS = quarters(8);

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
const monthLabel = (m) => {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${names[+mo - 1] || mo} ${y}`;
};
const KIND_LABEL = {
  monthly: 'تقرير شهري', carrier_soa: 'كشف حساب ناقل', bank_recon: 'مطابقة بنكية',
  cod: 'تحصيلات COD', invoicing: 'فوترة عملاء', weight: 'أوزان زائدة',
  vat_return: 'الإقرار الضريبي', pnl_statement: 'قائمة الدخل',
  balance_sheet: 'الميزانية العمومية', cash_flow: 'التدفق النقدي',
  trial_balance: 'ميزان المراجعة', general_ledger: 'دفتر الأستاذ العام',
};

function HealthMetric({ label, value, sub, tone = 'normal' }) {
  const color = tone === 'warn' ? 'var(--gold-ink)' : tone === 'ok' ? 'var(--green)' : 'var(--text)';
  return <div style={{ padding: 14, border: '1px solid var(--border2)', borderRadius: 13, background: 'var(--surface)', minWidth: 0 }}>
    <div style={{ color: 'var(--muted)', fontSize: 11.5, fontWeight: 800 }}>{label}</div>
    <div style={{ color, fontSize: 20, fontWeight: 900, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    <div style={{ color: 'var(--text2)', fontSize: 10.5, marginTop: 4, lineHeight: 1.6 }}>{sub}</div>
  </div>;
}

export default function ReportsCenter({ isActive = true }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, can } = useAuth();
  const canOperational = can('reports.view_operational');
  const canFinancial = can('reports.view_financial');
  const canBankReconciliation = can('reports.view_bank_reconciliation');
  const canExport = can('reports.export');
  const canViewAny = canOperational || canFinancial || canBankReconciliation;
  const [months, setMonths] = useState([]);
  const [monthlyData, setMonthlyData] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [history, setHistory] = useState(null);
  const [historyKind, setHistoryKind] = useState(() => searchParams.get('kind') || 'all');
  const [historyPage, setHistoryPage] = useState(() => Math.max(0, Number(searchParams.get('page')) || 0));
  const [busy, setBusy] = useState(null);          // معرّف التقرير قيد التوليد
  // معاملات البطاقات
  const [pMonth, setPMonth] = useState(() => searchParams.get('month') || '');
  const [pCarrier, setPCarrier] = useState(() => searchParams.get('carrier') || '');
  const [pReconMonth, setPReconMonth] = useState(() => searchParams.get('reconMonth') || '');
  // تقارير زوهو الرسمية (الإقرار الضريبي ربعي · قائمة الدخل لأي فترة)
  const [pQuarter, setPQuarter] = useState(() => searchParams.get('quarter') || '');
  const [pPnlFrom, setPPnlFrom] = useState(() => searchParams.get('from') || '');
  const [pPnlTo, setPPnlTo]     = useState(() => searchParams.get('to') || '');
  const [pFinReport, setPFinReport] = useState(() => searchParams.get('report') || 'balance_sheet');
  const [financialHealth, setFinancialHealth] = useState(undefined);

  const updateParam = (key, value, { resetPage = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    if (value == null || value === '' || value === 'all') next.delete(key);
    else next.set(key, String(value));
    if (resetPage) next.delete('page');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    setHistoryKind(searchParams.get('kind') || 'all');
    setHistoryPage(Math.max(0, Number(searchParams.get('page')) || 0));
    setPMonth(searchParams.get('month') || '');
    setPCarrier(searchParams.get('carrier') || '');
    setPReconMonth(searchParams.get('reconMonth') || '');
    setPQuarter(searchParams.get('quarter') || '');
    setPPnlFrom(searchParams.get('from') || '');
    setPPnlTo(searchParams.get('to') || '');
    setPFinReport(searchParams.get('report') || 'balance_sheet');
  }, [searchParams]);

  const loadHistory = useCallback(() => {
    loadExportHistory({ limit: 100 }).then(rows => { setHistory(rows); }).catch(() => setHistory([]));
  }, []);

  const filteredHistory = useMemo(() => (history || []).filter(row => historyKind === 'all' || row.kind === historyKind), [history, historyKind]);
  const HISTORY_PAGE_SIZE = 10;
  const historyPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const pagedHistory = filteredHistory.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE);

  useEffect(() => {
    if (!isActive) return;
    if ((canOperational || canBankReconciliation) && !monthlyData) {
      loadMonthlyReport().then(r => {
        setMonthlyData(r);
        setMonths(r.months || []);
        setPMonth(cur => cur || r.months?.[0] || '');
      }).catch(e => toast(`تعذّر تحميل الأشهر: ${e.message}`, 'error'));
    }
    if (canOperational && !carriers.length) {
      loadCarriers().then(rows => {
        setCarriers(rows || []);
        setPCarrier(cur => cur || rows?.[0]?.id || '');
      }).catch(() => {});
    }
    if (canExport && history == null) loadHistory();
    if (canFinancial && financialHealth === undefined) {
      loadZohoFinancialHealth().then(setFinancialHealth).catch(() => setFinancialHealth(false));
    }
  }, [isActive, monthlyData, carriers.length, history, loadHistory, canOperational, canBankReconciliation, canExport, canFinancial, financialHealth]);

  const run = async (id, fn) => {
    if (!canExport) {
      toast('تحتاج صلاحية إنشاء وتنزيل ملفات التقارير', 'error');
      return;
    }
    setBusy(id);
    try { await fn(); loadHistory(); }
    catch (e) { toast(`فشل التوليد: ${e.message}`, 'error'); }
    setBusy(null);
  };

  // ── مولّد التقرير الشهري (نفس أعمدة صفحة /monthly-report + ترويسة) ──
  const genMonthly = () => run('monthly', async () => {
    const rows = (monthlyData?.rows || []).filter(r => r.month === pMonth)
      .sort((a, b) => b.billed - a.billed);
    if (!rows.length) { toast('لا بيانات لهذا الشهر', 'info'); return; }
    const totals = rows.reduce((t, r) => ({
      billed: t.billed + r.billed, cod: t.cod + r.cod, creditNotes: t.creditNotes + r.creditNotes,
      payments: t.payments + r.payments, net: t.net + r.net,
    }), { billed: 0, cod: 0, creditNotes: 0, payments: 0, net: 0 });
    const aoa = [
      [`التقرير الشهري للناقلين — ${monthLabel(pMonth)}`],
      [`أُنشئ: ${new Date().toISOString().slice(0, 10)}`],
      [],
      ['الناقل', 'مفوتر', 'تحصيل COD', 'مبالغ مُرجَعة/خصومات', 'مدفوعات', 'COD ناقص الفواتير', 'المراجعات', 'فرق التدقيق'],
      ...rows.map(r => [r.carrierName, r.billed, r.cod, r.creditNotes, r.payments, r.net, r.auditCount, r.auditDiff]),
      [],
      ['الإجمالي', totals.billed, totals.cod, totals.creditNotes, totals.payments, totals.net, '', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 20 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 12 }, { wch: 13 }, { wch: 11 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, monthLabel(pMonth).slice(0, 28));
    await persistAndDownloadExport({
      wb, fileName: `تقرير_شهري_${pMonth}.xlsx`, kind: 'monthly',
      rowCount: rows.length, total: totals.billed, userId: user?.id,
    });
    toast(`صدر التقرير الشهري — ${rows.length} ناقل`, 'success');
  });

  // ── كشف حساب ناقل رسمي (مؤرشف) ──
  const genCarrierSoa = () => run('soa', async () => {
    const { exportCarrierSOA } = await import('../lib/carrierSoaExport.js');
    const c = carriers.find(x => x.id === pCarrier);
    const r = await exportCarrierSOA({ carrierId: pCarrier, carrierName: c?.name, persist: true, userId: user?.id });
    toast(`صدر كشف الحساب — ${r.rowCount} حركة · الرصيد ${fmt(r.balance)} ر.س`, 'success');
  });

  // ── المطابقة البنكية ──
  const genRecon = () => run('recon', async () => {
    const { generateBankReconReport } = await import('../lib/bankReconReport.js');
    const r = await generateBankReconReport({ month: pReconMonth || null, userId: user?.id });
    toast(`مطابَق ${r.matched} · حركة بنك بلا سداد مسجّل ${r.bankOnly} (${fmt(r.bankOnlyTotal)} ر.س) · سداد مسجّل لم يظهر في البنك ${r.payOnly}`,
      r.bankOnly ? 'info' : 'success');
  });

  // ── الإقرار الضريبي (من زوهو — خانات نموذج الهيئة حرفياً) ──
  const genVat = () => run('vat', async () => {
    const q = QUARTERS.find(x => x.key === pQuarter) || QUARTERS[0];
    const { printVatReturnPdf } = await import('../lib/zohoReportsService.js');
    const r = await printVatReturnPdf({ from: q.from, to: q.to, userId: user?.id });
    const due = r.totals.filingNetDue ?? r.totals.netDue ?? (r.totals.outputTax - r.totals.inputTax);
    const diff = r.reconciliation?.variance?.netDue || 0;
    toast(
      `مسودة الإقرار جاهزة — ${due < 0 ? 'رصيد دائن' : 'المستحق'} ${fmt(Math.abs(due))} ر.س`
      + (Math.abs(diff) > 0.01 ? ` · فرق زوهو/زاتكا ${fmt(diff)} ر.س موضح داخل التقرير` : '')
      + ' · اضغط «حفظ PDF» في النافذة',
      Math.abs(diff) > 0.01 ? 'info' : 'success',
    );
  });

  // ── قائمة الدخل لأي فترة ──
  const genPnl = () => run('pnl', async () => {
    const { printPnlPdf } = await import('../lib/zohoReportsService.js');
    await printPnlPdf({ from: pPnlFrom, to: pPnlTo });
    toast('قائمة الدخل جاهزة — اضغط «حفظ PDF» في النافذة', 'success');
  });
  const genFinancial = () => run('financial', async () => {
    if (!pPnlFrom || !pPnlTo) throw new Error('اختر تاريخ البداية والنهاية');
    const { exportZohoFinancialReport } = await import('../lib/zohoReportsService.js');
    const r = await exportZohoFinancialReport({ report: pFinReport, from: pPnlFrom, to: pPnlTo, userId: user?.id });
    toast(`تم توليد التقرير — ${r.rowCount} سطر`, 'success');
  });

  if (!canViewAny) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية عرض نوع واحد على الأقل من التقارير."/></div>;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<FileBarChart size={24}/>} title="مركز التقارير"
        subtitle="تقارير رسمية بمعاملات — كل تقرير يُخزَّن تلقائياً ويُعاد تحميله من السجل أدناه"/>

      {canFinancial && financialHealth ? <section aria-label="ملخص الصحة المالية من زوهو" style={{ marginBottom: 22, padding: 18, border: '1px solid var(--border)', borderRadius: 18, background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}><Activity size={18} color="var(--accent)"/><div style={{ display: 'grid', gap: 2 }}><b>الصورة المالية الحالية</b><small style={{ color: 'var(--muted)' }}>أرصدة وأعمار دين ومراقبة المصدر — من مرآة Zoho Books</small></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
          <HealthMetric label="ذمم العملاء" value={`${fmt(financialHealth.ar?.total)} ر.س`} sub={`${financialHealth.ar?.customers || 0} عميل · +90 يوم ${fmt(financialHealth.ar?.over_90)}`}/>
          <HealthMetric label="ذمم الموردين" value={`${fmt(financialHealth.ap?.total)} ر.س`} sub={`${financialHealth.ap?.vendors || 0} مورد · +90 يوم ${fmt(financialHealth.ap?.over_90)}`}/>
          <HealthMetric label="ضريبة القيمة المضافة" value={`${fmt(financialHealth.vat?.net_due)} ر.س`} sub={financialHealth.vat?.healthy ? `محدثة منذ ${financialHealth.vat?.age_minutes || 0} دقيقة` : 'التحديث متأخر — حدّث المصدر'} tone={financialHealth.vat?.healthy ? 'ok' : 'warn'}/>
          <HealthMetric label="استهلاك Zoho API اليوم" value={Number(financialHealth.api?.calls || 0).toLocaleString('en-US')} sub={`تنبيه عند ${Number(financialHealth.api?.warning_calls || 0).toLocaleString('en-US')} · تقييد ${financialHealth.api?.rate_limited || 0}`} tone={financialHealth.api?.status === 'healthy' ? 'ok' : 'warn'}/>
        </div>
      </section> : canFinancial && financialHealth === false ? (
        <section aria-label="تعذّر تحميل المصدر المالي" style={{ marginBottom: 22, padding: 18, border: '1px solid color-mix(in srgb, var(--red) 35%, var(--border))', borderRadius: 18, background: 'color-mix(in srgb, var(--red) 6%, var(--card))', display: 'flex', alignItems: 'center', gap: 12 }}>
          <AlertTriangle size={20} color="var(--red)"/>
          <div><b>المصدر غير متاح</b><small style={{ display: 'block', color: 'var(--muted)', marginTop: 3 }}>تعذّر قراءة ملخص Zoho المالي؛ لم نعرض أصفارًا بديلة. أعد المحاولة قبل اتخاذ قرار من المؤشرات.</small></div>
        </section>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 26 }}>
        {canOperational ? <>
        {/* التقرير الشهري */}
        <ReportCard icon={<CalendarRange size={18}/>} color="var(--green)"
          title="التقرير الشهري للناقلين"
          desc="مفوتر · تحصيل COD · إشعارات · مدفوعات · صافي — لكل ناقل في الشهر المختار">
          <Select value={pMonth} onChange={e => updateParam('month', e.target.value)}>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
          <Btn variant="accent" size="full" disabled={!canExport || busy === 'monthly' || !pMonth} icon={busy === 'monthly' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genMonthly}>
            توليد التقرير
          </Btn>
        </ReportCard>

        {/* كشف حساب ناقل */}
        <ReportCard icon={<Truck size={18}/>} color="#3B82F6"
          title="كشف حساب ناقل رسمي"
          desc="كل الحركات برصيد جارٍ + COD المعلّق + سطر توقيع — مستند النزاع والمطالبة">
          <Select value={pCarrier} onChange={e => updateParam('carrier', e.target.value)}>
            {carriers.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
          </Select>
          <Btn variant="accent" size="full" disabled={!canExport || busy === 'soa' || !pCarrier} icon={busy === 'soa' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genCarrierSoa}>
            توليد الكشف
          </Btn>
        </ReportCard>
        </> : null}

        {/* المطابقة البنكية */}
        {canBankReconciliation ? (
        <ReportCard icon={<Landmark size={18}/>} color="var(--gold)"
          title="المطابقة البنكية (بنك × دفتر)"
          desc="3 أوراق: مطابَق · حركة بنك بلا سداد مسجّل (الخطر) · سداد مسجّل لم يظهر في البنك">
          <Select value={pReconMonth} onChange={e => updateParam('reconMonth', e.target.value)}>
            <option value="">كل الفترات</option>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
          <Btn variant="accent" size="full" disabled={!canExport || busy === 'recon'} icon={busy === 'recon' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genRecon}>
            توليد المطابقة
          </Btn>
        </ReportCard>
        ) : null}

        {/* الإقرار الضريبي — من زوهو بخانات نموذج الهيئة */}
        {canFinancial ? <>
        <ReportCard icon={<Receipt size={18}/>} color="var(--brand)"
          title="مسودة الإقرار الضريبي PDF (القيمة المضافة)"
          desc="خانات نموذج الهيئة (1..16) من زوهو + مطابقة مستقلة لضريبة الخانتين 1 و7 قبل الإيداع">
          <Select value={pQuarter} onChange={e => updateParam('quarter', e.target.value)}>
            {QUARTERS.map(q => <option key={q.key} value={q.key}>{q.label}</option>)}
          </Select>
          <Btn variant="accent" size="full" disabled={!canExport || busy === 'vat'} icon={busy === 'vat' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genVat}>
            توليد الإقرار
          </Btn>
        </ReportCard>

        {/* قائمة الدخل من زوهو لأي فترة */}
        <ReportCard icon={<FileBarChart size={18}/>} color="var(--accent3)"
          title="قائمة الدخل PDF (الأرباح والخسائر)"
          desc="PDF رسمي بهوية لمحة — بنفس أقسام زوهو وحساباته حرفياً، لأي فترة تختارها">
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="date" value={pPnlFrom} onChange={e => updateParam('from', e.target.value)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5 }}/>
            <input type="date" value={pPnlTo} onChange={e => updateParam('to', e.target.value)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5 }}/>
          </div>
          <Btn variant="accent" size="full" disabled={!canExport || busy === 'pnl' || !pPnlFrom || !pPnlTo}
            icon={busy === 'pnl' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genPnl}>
            توليد القائمة
          </Btn>
        </ReportCard>

        <ReportCard icon={<FileBarChart size={18}/>} color="var(--gold)"
          title="التقارير المالية الرسمية من زوهو"
          desc="ميزانية عمومية · تدفق نقدي · ميزان مراجعة · دفتر أستاذ — مع حفظ نسخة في سجل التقارير">
          <Select value={pFinReport} onChange={e => updateParam('report', e.target.value)}>
            <option value="balance_sheet">الميزانية العمومية</option>
            <option value="cash_flow">التدفق النقدي</option>
            <option value="trial_balance">ميزان المراجعة</option>
            <option value="general_ledger">دفتر الأستاذ العام</option>
          </Select>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>يستخدم تاريخي قائمة الدخل أعلاه.</div>
          <Btn variant="accent" size="full" disabled={!canExport || busy === 'financial' || !pPnlFrom || !pPnlTo}
            icon={busy === 'financial' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genFinancial}>
            توليد التقرير المحدد
          </Btn>
        </ReportCard>
        </> : null}
      </div>

      {/* سجل السحبات — مشترك مع صفحة التصدير الداخلي */}
      {canExport ? <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>📁 التقارير الصادرة سابقاً</div>
        <select value={historyKind} onChange={e => updateParam('kind', e.target.value, { resetPage: true })}
          aria-label="فلترة التقارير الصادرة حسب النوع"
          style={{ marginInlineStart: 'auto', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
          <option value="all">كل الأنواع ({history?.length || 0})</option>
          {Object.entries(KIND_LABEL).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
        </select>
        <Btn size="sm" variant="ghost" title="تحديث سجل التقارير" icon={<RefreshCw size={13}/>} onClick={loadHistory}>تحديث سجل التقارير</Btn>
      </div>
      {history == null ? <Card style={{ padding: 30, textAlign: 'center' }}><Spinner size={20}/></Card>
        : !history.length ? <Card><Empty icon="📁" title="لا تقارير محفوظة بعد" sub="كل تقرير تولّده يُخزَّن هنا تلقائياً"/></Card>
        : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table className="m-cards" style={{ width: '100%', fontSize: 12.5 }}>
              <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
                {['التاريخ', 'النوع', 'الملف', 'صفوف', ''].map(h =>
                  <th key={h} style={{ padding: '9px 12px', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pagedHistory.map(h => (
                  <tr key={`${h.kind}_${h.id}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td data-label="التاريخ" style={{ padding: '9px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(h.pulledAt)}</td>
                    <td data-label="النوع" style={{ padding: '9px 12px' }}>{KIND_LABEL[h.kind] || 'تقرير'}</td>
                    <td data-label="" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.fileName}</td>
                    <td data-label="صفوف" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)' }}>{h.rowCount ?? '—'}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <Btn size="sm" variant="ghost" icon={<Download size={12}/>} disabled={!h.filePath}
                        title={h.filePath ? 'إعادة التحميل' : 'ملف قديم قبل التخزين'}
                        onClick={async () => {
                          try { await downloadExportFile(h); } catch (e) { toast(e.message, 'error'); }
                        }}>تحميل نسخة</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--muted)' }}>
              <span>عرض {pagedHistory.length} من {filteredHistory.length} · الأحدث أولاً</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Btn size="sm" variant="ghost" disabled={historyPage === 0} onClick={() => updateParam('page', Math.max(0, historyPage - 1) || '')}>السابق</Btn>
                <span>{historyPage + 1} / {historyPages}</span>
                <Btn size="sm" variant="ghost" disabled={historyPage + 1 >= historyPages} onClick={() => updateParam('page', Math.min(historyPages - 1, historyPage + 1))}>التالي</Btn>
              </span>
            </div>
          </Card>
        )}
      </> : (
        <Card style={{ padding: 18 }}>
          <Empty icon="🔒" title="العرض متاح دون تنزيل" sub="يمكنك قراءة التقارير المسموحة لك، لكن إنشاء الملفات وسجل التنزيلات يحتاجان صلاحية مستقلة."/>
        </Card>
      )}
    </div>
  );
}

function ReportCard({ icon, color, title, desc, children }) {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', background: `${color}18`, color }}>{icon}</span>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, minHeight: 38 }}>{desc}</div>
      {children}
    </Card>
  );
}
