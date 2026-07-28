// مركز التقارير — نقطة دخول واحدة لكل التقارير الرسمية (§3.2 من خطة الوكلاء).
//
// كل تقرير: بطاقة + معاملات (شهر/ناقل) + توليد Excel يمرّ عبر
// persistAndDownloadExport (تخزين + سجل + تنزيل — قاعدة §1.13) فيبقى
// قابلاً لإعادة التحميل من «السحبات السابقة» أسفل الصفحة.

import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { FileBarChart, Truck, Landmark, Download, RefreshCw, CalendarRange, Receipt } from 'lucide-react';
import { Card, Btn, Spinner, Empty, Select, toast, PageHeader } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadMonthlyReport } from '../lib/monthlyReportService.js';
import { loadCarriers } from '../lib/coreService.js';
import { persistAndDownloadExport, loadExportHistory, downloadExportFile } from '../lib/internalExportsService.js';
import { quarters } from '../lib/zohoReportsService.js';

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
};

export default function ReportsCenter({ isActive = true }) {
  const { user, can } = useAuth();
  const [months, setMonths] = useState([]);
  const [monthlyData, setMonthlyData] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(null);          // معرّف التقرير قيد التوليد
  // معاملات البطاقات
  const [pMonth, setPMonth] = useState('');        // للتقرير الشهري
  const [pCarrier, setPCarrier] = useState('');    // لكشف الناقل
  const [pReconMonth, setPReconMonth] = useState(''); // للمطابقة البنكية ('' = الكل)
  // تقارير زوهو الرسمية (الإقرار الضريبي ربعي · قائمة الدخل لأي فترة)
  const [pQuarter, setPQuarter] = useState('');
  const [pPnlFrom, setPPnlFrom] = useState('');
  const [pPnlTo, setPPnlTo]     = useState('');

  const loadHistory = useCallback(() => {
    loadExportHistory({ limit: 40 }).then(setHistory).catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    if (!isActive || monthlyData) return;
    loadMonthlyReport().then(r => {
      setMonthlyData(r);
      setMonths(r.months || []);
      setPMonth(cur => cur || r.months?.[0] || '');
    }).catch(e => toast(`تعذّر تحميل الأشهر: ${e.message}`, 'error'));
    loadCarriers().then(rows => {
      setCarriers(rows || []);
      setPCarrier(cur => cur || rows?.[0]?.id || '');
    }).catch(() => {});
    loadHistory();
  }, [isActive, monthlyData, loadHistory]);

  const run = async (id, fn) => {
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
    const { exportVatReturn } = await import('../lib/zohoReportsService.js');
    const r = await exportVatReturn({ from: q.from, to: q.to, userId: user?.id });
    const due = r.totals.netDue ?? (r.totals.outputTax - r.totals.inputTax);
    toast(`صدر الإقرار — ضريبة مخرجات ${fmt(r.totals.outputTax)} · مدخلات ${fmt(r.totals.inputTax)} · المستحق ${fmt(due)} ر.س`, 'success');
  });

  // ── قائمة الدخل لأي فترة ──
  const genPnl = () => run('pnl', async () => {
    const { exportPnlRange } = await import('../lib/zohoReportsService.js');
    const r = await exportPnlRange({ from: pPnlFrom, to: pPnlTo, userId: user?.id });
    toast(`صدرت قائمة الدخل — ${r.rowCount} بند${r.net != null ? ` · الصافي ${fmt(r.net)} ر.س` : ''}`, 'success');
  });

  if (!can('carriers.view')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية"/></div>;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<FileBarChart size={24}/>} title="مركز التقارير"
        subtitle="تقارير رسمية بمعاملات — كل تقرير يُخزَّن تلقائياً ويُعاد تحميله من السجل أدناه"/>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 26 }}>
        {/* التقرير الشهري */}
        <ReportCard icon={<CalendarRange size={18}/>} color="var(--green)"
          title="التقرير الشهري للناقلين"
          desc="مفوتر · تحصيل COD · إشعارات · مدفوعات · صافي — لكل ناقل في الشهر المختار">
          <Select value={pMonth} onChange={e => setPMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
          <Btn variant="accent" size="full" disabled={busy === 'monthly' || !pMonth} icon={busy === 'monthly' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genMonthly}>
            توليد التقرير
          </Btn>
        </ReportCard>

        {/* كشف حساب ناقل */}
        <ReportCard icon={<Truck size={18}/>} color="#3B82F6"
          title="كشف حساب ناقل رسمي"
          desc="كل الحركات برصيد جارٍ + COD المعلّق + سطر توقيع — مستند النزاع والمطالبة">
          <Select value={pCarrier} onChange={e => setPCarrier(e.target.value)}>
            {carriers.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
          </Select>
          <Btn variant="accent" size="full" disabled={busy === 'soa' || !pCarrier} icon={busy === 'soa' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genCarrierSoa}>
            توليد الكشف
          </Btn>
        </ReportCard>

        {/* المطابقة البنكية */}
        <ReportCard icon={<Landmark size={18}/>} color="var(--gold)"
          title="المطابقة البنكية (بنك × دفتر)"
          desc="3 أوراق: مطابَق · حركة بنك بلا سداد مسجّل (الخطر) · سداد مسجّل لم يظهر في البنك">
          <Select value={pReconMonth} onChange={e => setPReconMonth(e.target.value)}>
            <option value="">كل الفترات</option>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
          <Btn variant="accent" size="full" disabled={busy === 'recon'} icon={busy === 'recon' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genRecon}>
            توليد المطابقة
          </Btn>
        </ReportCard>

        {/* الإقرار الضريبي — من زوهو بخانات نموذج الهيئة */}
        <ReportCard icon={<Receipt size={18}/>} color="var(--brand)"
          title="الإقرار الضريبي (القيمة المضافة)"
          desc="من زوهو مباشرةً بخانات نموذج الهيئة (1..16): المخرجات · المدخلات · الصافي المستحق">
          <Select value={pQuarter} onChange={e => setPQuarter(e.target.value)}>
            {QUARTERS.map(q => <option key={q.key} value={q.key}>{q.label}</option>)}
          </Select>
          <Btn variant="accent" size="full" disabled={busy === 'vat'} icon={busy === 'vat' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genVat}>
            توليد الإقرار
          </Btn>
        </ReportCard>

        {/* قائمة الدخل من زوهو لأي فترة */}
        <ReportCard icon={<FileBarChart size={18}/>} color="var(--accent3)"
          title="قائمة الدخل (الأرباح والخسائر)"
          desc="من زوهو بأساس الاستحقاق — بنفس أقسامه وحساباته حرفياً، لأي فترة تختارها">
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="date" value={pPnlFrom} onChange={e => setPPnlFrom(e.target.value)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5 }}/>
            <input type="date" value={pPnlTo} onChange={e => setPPnlTo(e.target.value)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5 }}/>
          </div>
          <Btn variant="accent" size="full" disabled={busy === 'pnl' || !pPnlFrom || !pPnlTo}
            icon={busy === 'pnl' ? <Spinner size={13}/> : <Download size={14}/>} onClick={genPnl}>
            توليد القائمة
          </Btn>
        </ReportCard>
      </div>

      {/* سجل السحبات — مشترك مع صفحة التصدير الداخلي */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>📁 التقارير الصادرة سابقاً</div>
        <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={loadHistory}/>
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
                {history.map(h => (
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
                        }}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
