// «زوهو API» /zoho-data — تصفّح احترافي لكل مرايا Zoho Books:
// فواتير/دفعات العملاء · المصاريف (فيها الرواتب بحساب «أجور الموظفين») ·
// فواتير/دفعات الموردين · القيود اليومية. قراءة فقط — المرايا تتغذى من
// zoho-sync (دلتا) ولا تُعدَّل هنا أبداً.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw, Search, Database, Download, Landmark, Link2, ShieldCheck, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { Card, Btn, Spinner, Empty, toast, PageHeader, Modal } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { ZOHO_MIRRORS, loadZohoMirror, syncZohoDocs, currentPnlPeriod,
  loadZohoInvoiceDashboard, zohoStatusAr, loadZohoOverdueCampaign, loadZohoWebhookHealth,
  loadZohoFinancialDashboard, syncZohoFinancial, setZohoFinancialAccountLink,
  getZohoAuthUrl, downloadZohoDocument, fetchZohoDocument } from '../lib/pnlService.js';
import { mergePdfBlobs, downloadBlob } from '../lib/pdfMerge.js';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (p) => {
  const [y, m] = p.split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${names[+m - 1] || m} ${y}`;
};
// آخر 12 شهراً كخيارات
const monthOptions = () => {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};

// أعمدة العرض لكل نوع (label + مفتاح + نوع القيمة)
const COLS = {
  invoices: [
    ['التاريخ', 'date'], ['الرقم', 'invoice_number', 'mono'], ['العميل', 'customer_name', 'main'],
    ['الحالة', 'status'], ['المبلغ', 'total', 'money'], ['المتبقي', 'balance', 'money-warn'],
  ],
  payments: [
    ['التاريخ', 'date'], ['العميل', 'customer_name', 'main'], ['الطريقة', 'mode'],
    ['الفواتير', 'invoice_numbers', 'mono'], ['المبلغ', 'amount', 'money-green'],
  ],
  expenses: [
    ['التاريخ', 'date'], ['الحساب', 'account_name', 'main'], ['المورد', 'vendor_name'],
    ['الوصف', 'description'], ['المبلغ', 'total', 'money'],
  ],
  bills: [
    ['التاريخ', 'date'], ['الرقم', 'bill_number', 'mono'], ['المورد', 'vendor_name', 'main'],
    ['الاستحقاق', 'due_date'], ['الحالة', 'status'], ['المبلغ', 'total', 'money'], ['المتبقي', 'balance', 'money-warn'],
  ],
  vendor_payments: [
    ['التاريخ', 'date'], ['المورد', 'vendor_name', 'main'], ['الطريقة', 'mode'],
    ['المرجع', 'reference_number', 'mono'], ['المبلغ', 'amount', 'money'],
  ],
  journals: [
    ['التاريخ', 'date'], ['القيد', 'entry_number', 'mono'], ['المرجع', 'reference_number', 'mono'],
    ['الملاحظات', 'notes', 'main'], ['المبلغ', 'total', 'money'],
  ],
  bank_accounts: [
    ['الحساب', 'account_name', 'main'], ['الرمز', 'account_code', 'mono'],
    ['العملة', 'currency_code'], ['الرصيد الدفتري', 'book_balance', 'money'],
    ['رصيد التغذية البنكية', 'bank_balance', 'money-warn'], ['غير مصنّفة', 'uncategorized_count'],
  ],
  chart_accounts: [
    ['الحساب', 'account_name', 'main'], ['الرمز', 'account_code', 'mono'],
    ['النوع', 'account_type_formatted'], ['الحالة', 'status'], ['الرصيد', 'current_balance', 'money'],
  ],
  vendor_credits: [
    ['التاريخ', 'date'], ['الرقم', 'credit_number', 'mono'], ['المورد', 'vendor_name', 'main'],
    ['الحالة', 'status'], ['الإجمالي', 'total', 'money'], ['المتبقي', 'balance', 'money-warn'],
  ],
};

// «منذ X» بالعربية من طابع زمني ISO
function agoAr(iso) {
  if (!iso) return null;
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'الآن';
  if (sec < 3600) return `منذ ${Math.floor(sec / 60)} دقيقة`;
  if (sec < 86400) return `منذ ${Math.floor(sec / 3600)} ساعة`;
  return `منذ ${Math.floor(sec / 86400)} يوم`;
}
const KIND_AR = { invoice: 'فاتورة', payment: 'دفعة', creditnote: 'إشعار خصم/إرجاع' };

export default function ZohoData({ isActive = true }) {
  const { can, user } = useAuth();
  const location = useLocation();
  const [type, setType] = useState('invoices');
  const [periodTo, setPeriodTo] = useState('');   // '' = نفس «من» (شهر واحد)
  const [dash, setDash] = useState(null);
  const [health, setHealth] = useState(null);       // صحة مزامنة زوهو (webhook + دوري)
  const [financial, setFinancial] = useState(null); // البنوك والخزائن والموردون + قدرات API
  const [financialBusy, setFinancialBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [selectedInvoices, setSelectedInvoices] = useState(() => new Set());
  const [bulkPdf, setBulkPdf] = useState({ busy: false, done: 0, total: 0 });
  const [mapTarget, setMapTarget] = useState(null);
  const [campaign, setCampaign] = useState(null);   // صفوف حملة المتأخرين (تحميل كسول)
  const [waOpen, setWaOpen] = useState(false);
  const [waMode, setWaMode] = useState('customer'); // 'customer' (مجمّع) | 'invoice' (لكل فاتورة)

  // حملة تحصيل المتأخرين — من zoho_overdue_campaign (هواتف من دليل المتاجر)
  const loadCampaign = async () => {
    if (campaign) return campaign;
    const rows = await loadZohoOverdueCampaign();
    setCampaign(rows);
    return rows;
  };
  const openWhatsApp = async () => {
    try {
      const rows = await loadCampaign();
      if (!rows.length) { toast('لا فواتير متأخرة حالياً 🎉', 'info'); return; }
      setWaMode('customer'); setWaOpen(true);
    } catch (e) { toast(`فشل تجهيز الحملة: ${e.message}`, 'error'); }
  };
  // حملة سداد لكل فاتورة (من الجدول المفلتر) — قالب فيه اسم المتجر وتاريخ الفاتورة والمتبقي.
  // الهواتف من حملة المتأخرين (customer→phone). الفاتورة بلا هاتف معروف تُستبعَد.
  const openInvoiceCampaign = async () => {
    try {
      await loadCampaign();   // يحمّل خريطة الهواتف (customer→phone)
      setWaMode('invoice'); setWaOpen(true);
    } catch (e) { toast(`فشل تجهيز الحملة: ${e.message}`, 'error'); }
  };
  const exportCampaign = async () => {
    try {
      const rows = await loadCampaign();
      if (!rows.length) { toast('لا فواتير متأخرة حالياً 🎉', 'info'); return; }
      const aoa = [
        ['حملة تحصيل — فواتير زوهو المتأخرة', '', '', new Date().toISOString().slice(0, 10)],
        [],
        ['العميل (زوهو)', 'المتجر', 'الهاتف', 'المستحق', 'عدد الفواتير', 'أقدم فاتورة', 'العمر (يوم)', 'الفواتير (رقم + مبلغ)'],
        ...rows.map(r => [r.customerName, r.storeName || '', r.phone || '', r.owed, r.invCount, r.oldest || '', r.ageDays, r.invoiceList]),
        [],
        ['الإجمالي', '', '', +rows.reduce((s, r) => s + r.owed, 0).toFixed(2), rows.reduce((s, r) => s + r.invCount, 0)],
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 32 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 60 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'حملة تحصيل');
      await persistAndDownloadExport({
        wb: rtl(wb), fileName: `حملة_تحصيل_زوهو_${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'zoho_campaign', rowCount: rows.length,
        total: +rows.reduce((s, r) => s + r.owed, 0).toFixed(2), userId: user?.id || null,
      });
      toast(`صُدّرت حملة لـ${rows.length} عميلاً متأخراً ✓`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };
  const waRecipients = useMemo(() => (campaign || [])
    .filter(r => r.phone && r.owed > 0.5)
    .map(r => {
      const name = (r.storeName || r.customerName || '').trim();
      return {
        to: normalizeSaudiPhone(r.phone), name, amount: r.owed, count: r.invCount,
        // متغيّرات القالب: {{1}} الاسم · {{2}} المبلغ · {{3}} عدد الفواتير
        vars: [name, Number(r.owed).toLocaleString('en-US', { maximumFractionDigits: 2 }), String(r.invCount)],
      };
    }), [campaign]);
  const [period, setPeriod] = useState(currentPnlPeriod());
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');       // فلتر الحالة
  const [amtMin, setAmtMin] = useState('');        // نطاق المبلغ
  const [amtMax, setAmtMax] = useState('');
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedType = params.get('type');
    const incomingQ = params.get('q');
    if (requestedType && ZOHO_MIRRORS[requestedType]) setType(requestedType);
    if (incomingQ) {
      setQ(incomingQ);
      setPeriod('');
      setPeriodTo('');
    }
  }, [location.search]);

  // إعادة ضبط الفلاتر عند تغيير النوع (الحالات تختلف)
  useEffect(() => {
    setStatus(''); setAmtMin(''); setAmtMax(''); setSort({ col: 'date', dir: 'desc' });
    setSelectedInvoices(new Set());
  }, [type]);

  const load = useCallback(async (t, pFrom, pTo) => {
    setRows(null);
    try {
      // «من» فقط = شهر واحد · «من+إلى» = نطاق · كلاهما فارغ = كل الفترات
      setRows(await loadZohoMirror(t, {
        periodFrom: pFrom || null,
        periodTo:   (pTo || pFrom) || null,
      }));
    }
    catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setRows([]); }
  }, []);
  useEffect(() => { if (isActive) load(type, period, periodTo); }, [isActive, type, period, periodTo, load]);

  // لوحة الفواتير (كل الأشهر) — تُحمَّل مرة عند دخول تبويب الفواتير
  useEffect(() => {
    if (!isActive || type !== 'invoices') { setDash(null); return; }
    let live = true;
    loadZohoInvoiceDashboard().then(d => { if (live) setDash(d); }).catch(() => {});
    return () => { live = false; };
  }, [isActive, type]);

  // صحة المزامنة (نبضة الـwebhook + آخر مزامنة دورية) — تحديث عند الدخول + كل دقيقة
  useEffect(() => {
    if (!isActive) return;
    let live = true;
    const tick = () => loadZohoWebhookHealth().then(h => { if (live) setHealth(h); }).catch(() => {});
    tick();
    const iv = setInterval(tick, 60_000);
    return () => { live = false; clearInterval(iv); };
  }, [isActive]);

  const loadFinancial = useCallback(async () => {
    try { setFinancial(await loadZohoFinancialDashboard()); }
    catch (e) { console.info('zoho financial dashboard:', e.message); }
  }, []);
  useEffect(() => { if (isActive) loadFinancial(); }, [isActive, loadFinancial]);

  const doSync = async () => {
    setBusy(true);
    try {
      const r = await syncZohoDocs();
      const parts = Object.entries(r.results || r).filter(([k]) => k !== 'ok')
        .map(([k, v]) => {
          const mirrorKey = ({ customerpayments: 'payments', vendorpayments: 'vendor_payments', bankaccounts: 'bank_accounts', chartofaccounts: 'chart_accounts', vendorcredits: 'vendor_credits' })[k] || k;
          return `${ZOHO_MIRRORS[mirrorKey]?.label?.replace(/^[^\s]+\s/, '') || k}: ${v}`;
        });
      toast(`مزامنة: ${parts.join(' · ')}`, 'success');
      load(type, period, periodTo);
      loadFinancial();
    } catch (e) { toast(`فشل المزامنة: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const doFinancialSync = async () => {
    setFinancialBusy(true);
    try {
      const r = await syncZohoFinancial({ force: true });
      const authNeeded = Object.values(r.results || {}).filter(v => String(v).includes('إعادة تفويض')).length;
      toast(authNeeded ? 'تم تحديث المتاح، وتوجد صلاحيات تحتاج إعادة تفويض زوهو' : 'تحدّثت البنوك والخزائن من زوهو ✓', authNeeded ? 'info' : 'success');
      await Promise.all([loadFinancial(), load(type, period, periodTo)]);
    } catch (e) { toast(`فشل تحديث الحسابات المالية: ${e.message}`, 'error'); }
    setFinancialBusy(false);
  };

  const reauthorize = async () => {
    try {
      const r = await getZohoAuthUrl();
      if (!r?.ok || !r.url) throw new Error(r?.error || 'تعذّر إنشاء رابط زوهو');
      window.location.assign(r.url);
    } catch (e) { toast(`تعذّر بدء إعادة التفويض: ${e.message}`, 'error'); }
  };

  const downloadDocument = async (row) => {
    setDownloadingId(row.zoho_id);
    try {
      const reference = type === 'invoices' ? row.invoice_number : row.bill_number;
      await downloadZohoDocument({ type, zohoId: row.zoho_id, reference });
      toast(type === 'invoices' ? 'نُزّلت الفاتورة PDF ✓' : 'نُزّل مرفق فاتورة المورد ✓', 'success');
    } catch (e) {
      toast(type === 'bills'
        ? `تعذّر تنزيل المرفق: ${e.message}`
        : `تعذّر تنزيل PDF: ${e.message}`, 'error');
    }
    setDownloadingId(null);
  };

  const cfg = ZOHO_MIRRORS[type];
  const cols = COLS[type];
  const referenceType = type === 'bank_accounts' || type === 'chart_accounts';
  const downloadableType = type === 'invoices' || type === 'bills';

  // الحالات المتاحة فعلياً في البيانات المحمّلة (ديناميكي لكل نوع)
  const statuses = useMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map(r => r.status).filter(Boolean))].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let list = rows;
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(s)));
    if (status) list = list.filter(r => r.status === status);
    const min = amtMin === '' ? null : Number(amtMin);
    const max = amtMax === '' ? null : Number(amtMax);
    if (min != null || max != null) {
      list = list.filter(r => {
        const v = Number(r[cfg.amount]) || 0;
        return (min == null || v >= min) && (max == null || v <= max);
      });
    }
    // الترتيب بالعمود المختار (نصّي أو رقمي)
    const { col, dir } = sort;
    const numeric = ['total', 'amount', 'balance', 'book_balance', 'bank_balance', 'current_balance', 'uncategorized_count'].includes(col);
    return [...list].sort((a, b) => {
      let av = a[col], bv = b[col];
      if (numeric) { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = String(av ?? ''); bv = String(bv ?? ''); }
      const cmp = numeric ? av - bv : av.localeCompare(bv, 'ar');
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, q, status, amtMin, amtMax, sort, cfg]);
  const displayed = useMemo(() => filtered.slice(0, 800), [filtered]);
  const displayedInvoiceIds = useMemo(() => type === 'invoices'
    ? displayed.map(r => String(r.zoho_id)) : [], [type, displayed]);
  const allDisplayedSelected = displayedInvoiceIds.length > 0
    && displayedInvoiceIds.every(id => selectedInvoices.has(id));

  const toggleInvoice = (id) => setSelectedInvoices(current => {
    const next = new Set(current);
    const key = String(id);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  useEffect(() => {
    const visible = new Set(displayedInvoiceIds);
    setSelectedInvoices(current => {
      const next = new Set([...current].filter(id => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [displayedInvoiceIds]);
  const toggleDisplayedInvoices = () => setSelectedInvoices(current => {
    const next = new Set(current);
    if (allDisplayedSelected) displayedInvoiceIds.forEach(id => next.delete(id));
    else displayedInvoiceIds.forEach(id => next.add(id));
    return next;
  });

  const downloadSelectedInvoices = async () => {
    const selectedRows = filtered.filter(r => selectedInvoices.has(String(r.zoho_id)));
    if (!selectedRows.length) return;
    setBulkPdf({ busy: true, done: 0, total: selectedRows.length });
    try {
      const blobs = [];
      // تسلسلي عمداً: Zoho Books يحدّ عدد الطلبات، والدمج يحافظ على ترتيب العرض.
      for (let i = 0; i < selectedRows.length; i += 1) {
        const { blob } = await fetchZohoDocument({ type: 'invoices', zohoId: selectedRows[i].zoho_id });
        blobs.push(blob);
        setBulkPdf({ busy: true, done: i + 1, total: selectedRows.length });
      }
      const merged = await mergePdfBlobs(blobs);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(merged, `فواتير_زوهو_${date}_${selectedRows.length}.pdf`);
      toast(`نُزّلت ${selectedRows.length} فاتورة في ملف PDF واحد ✓`, 'success');
    } catch (e) {
      toast(`تعذّر تجهيز ملف PDF الموحّد: ${e.message}`, 'error');
    } finally {
      setBulkPdf({ busy: false, done: 0, total: 0 });
    }
  };

  const filtersActive = !!(q.trim() || status || amtMin || amtMax);
  const toggleSort = (col) => setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'date' ? 'desc' : 'asc' });
  const total = useMemo(() => +filtered.reduce((s, r) => s + (Number(r[cfg.amount]) || 0), 0).toFixed(2), [filtered, cfg]);
  const totalBalance = useMemo(() => +filtered.reduce((s, r) => s + (Number(r.balance) || 0), 0).toFixed(2), [filtered]);

  // خريطة هاتف كل عميل (من حملة المتأخرين) — لربط كل فاتورة برقم صاحبها
  const phoneByCustomer = useMemo(() => {
    const m = new Map();
    (campaign || []).forEach(r => { if (r.phone) m.set(r.customerName, { phone: r.phone, store: r.storeName }); });
    return m;
  }, [campaign]);
  // مستلِمو حملة «لكل فاتورة» — من الجدول المفلتر (يحترم الفترة/الحالة/المبلغ المختارة).
  // كل فاتورة = مستلِم بمعرّف فريد (storeId=zoho_id) فتُرسَل رسالة لكل فاتورة عند تفعيل
  // «رسالة لكل …» في المودال (الافتراضي رسالة/رقم — أأمن ضد الحظر، §1.29).
  const unpaidInvCount = useMemo(() =>
    type === 'invoices' ? filtered.filter(r => Number(r.balance) > 0.5).length : 0, [type, filtered]);
  const invoiceWaRecipients = useMemo(() => {
    if (type !== 'invoices') return [];
    return filtered
      .filter(r => Number(r.balance) > 0.5)
      .map(r => {
        const info = phoneByCustomer.get(r.customer_name);
        if (!info?.phone) return null;
        const store = (info.store || r.customer_name || '').trim();
        const amt = +(Number(r.balance) || 0).toFixed(2);
        return {
          to: normalizeSaudiPhone(info.phone), name: store, amount: amt, storeId: r.zoho_id,
          // القالب: {{1}} اسم المتجر · {{2}} تاريخ الفاتورة · {{3}} المبلغ المتبقي
          vars: [store, r.date || '', Number(amt).toLocaleString('en-US', { maximumFractionDigits: 2 })],
          fields: { name: store, invoice_date: r.date, invoice_number: r.invoice_number,
            remaining: amt, amount: amt },
        };
      })
      .filter(Boolean);
  }, [type, filtered, phoneByCustomer]);

  const exportXlsx = () => {
    if (!filtered.length) return;
    const aoa = [
      [`زوهو API — ${cfg.label.replace(/^[^\s]+\s/, '')}${period ? ` — ${monthLabel(period)}${periodTo && periodTo !== period ? ` حتى ${monthLabel(periodTo)}` : ''}` : ''}`],
      [],
      cols.map(c => c[0]),
      ...filtered.map(r => cols.map(c => c[1] === 'status' ? zohoStatusAr(r[c[1]]) : (r[c[1]] ?? ''))),
      [],
      ['الإجمالي', ...Array(cols.length - 2).fill(''), total],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = cols.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سجلات');
    XLSX.writeFile(rtl(wb), `زوهو_${type}_${period || 'الكل'}.xlsx`);
    toast(`صُدّر ${filtered.length} سجلاً ✓`, 'success');
  };

  if (!can('zoho.view') && !can('money.pnl')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «الوضع المالي»"/></div>;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<Database size={22}/>} iconColor="#0EA5E9"
        title="زوهو: الفواتير والربط"
        subtitle="بيانات Zoho Books، حالة الربط، وتفعيل قراءة البنوك والخزائن"
        actions={
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {can('zoho.configure') ? (
              <Btn size="sm" variant="primary" icon={<ShieldCheck size={14}/>} onClick={reauthorize}>
                إعادة ربط زوهو
              </Btn>
            ) : null}
            <Btn size="sm" variant="ghost" icon={busy ? <Spinner size={13}/> : <RefreshCw size={14}/>} disabled={busy} onClick={doSync}>
              تحديث بيانات زوهو
            </Btn>
          </div>
        }/>

      <FinancialControlPanel
        data={financial}
        busy={financialBusy}
        canConfigure={can('zoho.configure')}
        onSync={doFinancialSync}
        onReauthorize={reauthorize}
        onOpenAccount={() => setType('bank_accounts')}
      />

      {/* مبدّل الأنواع */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(ZOHO_MIRRORS).map(([id, m]) => (
          <Btn key={id} size="sm" variant={type === id ? 'primary' : 'outline'} onClick={() => setType(id)}>
            {m.label}
          </Btn>
        ))}
      </div>

      {/* ── مؤشر صحة المزامنة: نبضة webhook اللحظية + آخر مزامنة دورية ── */}
      {health && (() => {
        const wAgo = agoAr(health.webhookLastAt);
        const fresh = health.webhookLastAt && (Date.now() - new Date(health.webhookLastAt).getTime()) < 6 * 3600_000;
        const col = fresh ? 'var(--green)' : (health.webhookReady ? 'var(--gold)' : 'var(--muted)');
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14,
            padding: '8px 12px', borderRadius: 9, fontSize: 11.5,
            background: `color-mix(in srgb, ${col} 7%, transparent)`,
            border: `1px solid color-mix(in srgb, ${col} 28%, var(--border))` }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0 }}/>
            <span style={{ fontWeight: 700, color: col }}>
              {health.webhookLastAt ? 'مزامنة لحظية نشطة' : 'بانتظار أول إشعار'}
            </span>
            <span style={{ color: 'var(--muted)' }}>
              {health.webhookLastAt
                ? <>آخر إشعار زوهو: <b style={{ color: 'var(--text)' }}>{wAgo}</b>{health.webhookLastKind ? ` (${KIND_AR[health.webhookLastKind] || health.webhookLastKind})` : ''}</>
                : 'فعّل التحديث الفوري في زوهو (Webhooks)'}
            </span>
            {health.lastSyncAt && (
              <span style={{ marginInlineStart: 'auto', color: 'var(--muted2)' }}>
                مزامنة دورية: {agoAr(health.lastSyncAt)}
              </span>
            )}
          </div>
        );
      })()}

      {/* لوحة الفواتير — نظرة شهرية + أعلى المدينين + حملة المتأخرين */}
      {/* النقر على مدين = كامل دينه عبر كل الشهور — كان فلتر الشهر يبقى مفعّلاً
          فيُخفي فواتير خارج الشهر ويُظهر «متبقٍّ» أقل من الحقيقي (بلاغ 2026-07-15) */}
      {type === 'invoices' && dash && (
        <InvoiceDashboard dash={dash} onPick={(name) => { setQ(name); setPeriod(''); setPeriodTo(''); }}
          onShowOverdue={() => {
            // المتأخرات موزّعة على أشهر قديمة — افتح كل الفترات وفلترها
            setPeriod(''); setPeriodTo(''); setStatus('overdue'); setQ('');
          }}
          campaign={dash.overdueCnt > 0 && can('collections.view') ? {
            onWhatsApp: openWhatsApp, onExport: exportCampaign,
          } : null}/>
      )}

      {/* الفلاتر */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {cfg.dateField !== false ? <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <select value={period} onChange={e => { setPeriod(e.target.value); if (!e.target.value) setPeriodTo(''); }} title="من شهر"
            style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12.5 }}>
            <option value="">كل الفترات (حتى 5000)</option>
            {monthOptions().map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          {period && (
            <>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>حتى</span>
              <select value={periodTo} onChange={e => setPeriodTo(e.target.value)} title="إلى شهر (اختياري — لنطاق عدة أشهر)"
                style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12.5 }}>
                <option value="">نفس الشهر</option>
                {monthOptions().filter(m => m >= period).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </>
          )}
        </div> : null}
        {statuses.length > 0 && (
          <select value={status} onChange={e => setStatus(e.target.value)} title="الحالة"
            style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12.5 }}>
            <option value="">كل الحالات</option>
            {statuses.map(s => <option key={s} value={s}>{zohoStatusAr(s)}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input value={amtMin} onChange={e => setAmtMin(e.target.value)} type="number" placeholder="مبلغ من"
            style={{ width: 90, padding: '7px 8px', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}/>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
          <input value={amtMax} onChange={e => setAmtMax(e.target.value)} type="number" placeholder="إلى"
            style={{ width: 90, padding: '7px 8px', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}/>
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={14} style={{ position: 'absolute', right: 12, top: 9, color: 'var(--muted)' }}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="بحث بالعميل/المورد/الرقم/أي حقل…"
            style={{ width: '100%', padding: '8px 36px 8px 12px', borderRadius: 8, fontSize: 13 }}/>
        </div>
        {filtersActive && (
          <Btn size="sm" variant="ghost" onClick={() => { setQ(''); setStatus(''); setAmtMin(''); setAmtMax(''); }}>
            مسح الفلاتر
          </Btn>
        )}
        {type === 'invoices' && can('collections.view') && (
          <Btn size="sm" variant="accent" onClick={openInvoiceCampaign} disabled={!unpaidInvCount}
            title="حملة واتساب لكل فاتورة في العرض الحالي — قالب فيه اسم المتجر وتاريخ الفاتورة والمتبقي">
            📲 حملة لكل فاتورة ({unpaidInvCount})
          </Btn>
        )}
        <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportXlsx} disabled={!filtered.length}>
          تصدير
        </Btn>
      </div>
      {rows != null && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          عرض <b style={{ color: 'var(--text)' }}>{filtered.length}</b>{filtersActive ? ` من ${rows.length}` : ''} سجل ·
          الإجمالي <b style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmt(total)}</b> ر.س
          {cfg.amount === 'balance' || COLS[type].some(c => c[1] === 'balance')
            ? <> · المتبقي <b style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{fmt(totalBalance)}</b> ر.س</> : null}
        </div>
      )}

      {type === 'invoices' && filtered.length > 0 && (
        <div className="zoho-invoice-selection" role="toolbar" aria-label="تحديد فواتير PDF">
          <label className="zoho-invoice-select-all">
            <input type="checkbox" checked={allDisplayedSelected} onChange={toggleDisplayedInvoices}/>
            <span>تحديد كل الفواتير المعروضة</span>
          </label>
          <span className="zoho-invoice-selection-count">المحدد: {selectedInvoices.size}</span>
          {selectedInvoices.size > 0 && (
            <Btn size="sm" variant="ghost" onClick={() => setSelectedInvoices(new Set())} disabled={bulkPdf.busy}>
              إلغاء التحديد
            </Btn>
          )}
          <Btn size="sm" variant="ghost" icon={bulkPdf.busy ? <Spinner size={12}/> : <Download size={13}/>}
            onClick={downloadSelectedInvoices} disabled={!selectedInvoices.size || bulkPdf.busy}
            title="تحميل الفواتير المحددة مرتبة في ملف PDF واحد">
            {bulkPdf.busy ? `تجهيز ${bulkPdf.done} من ${bulkPdf.total}` : `تحميل PDF موحّد (${selectedInvoices.size})`}
          </Btn>
        </div>
      )}

      {rows == null ? <Card style={{ padding: 50, textAlign: 'center' }}><Spinner size={24}/></Card>
        : !filtered.length ? (
          <Card><Empty icon="📭" title="لا سجلات"
            sub={rows.length ? 'جرّب بحثاً مختلفاً' : 'اضغط «مزامنة من زوهو» — أو أعد الموافقة بالصلاحيات الموسّعة إن كان النوع جديداً'}/></Card>
        ) : (
          <Card className="zoho-records-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="m-flow" style={{ maxHeight: 640, overflowY: 'auto' }}>
              <table className="m-cards" style={{ width: '100%', fontSize: 12.5 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
                  <tr>{type === 'invoices' ? <th style={{ padding: '10px 12px' }}>تحديد</th> : null}{cols.map(c => {
                    const active = sort.col === c[1];
                    return (
                      <th key={c[0]} onClick={() => toggleSort(c[1])} title="ترتيب"
                        style={{ padding: '10px 12px', fontSize: 11, color: active ? 'var(--accent)' : 'var(--muted)',
                          whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                        {c[0]}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    );
                  })}{downloadableType ? <th style={{ padding: '10px 12px' }}>المستند</th> : null}
                  {referenceType && can('zoho.configure') ? <th style={{ padding: '10px 12px' }}>الربط</th> : null}</tr>
                </thead>
                <tbody>
                  {displayed.map(r => (
                    <tr key={r.zoho_id} style={{ borderTop: '1px solid var(--border)' }}>
                      {type === 'invoices' ? (
                        <td data-label="تحديد" style={{ padding: '9px 12px' }}>
                          <input type="checkbox" checked={selectedInvoices.has(String(r.zoho_id))}
                            onChange={() => toggleInvoice(r.zoho_id)}
                            aria-label={`تحديد الفاتورة ${r.invoice_number || r.zoho_id}`}/>
                        </td>
                      ) : null}
                      {cols.map(([label, key, kind]) => (
                        <td key={key} data-label={kind === 'main' ? '' : label}
                          style={{
                            padding: '9px 12px',
                            ...(kind === 'mono' ? { fontFamily: 'var(--font-mono)', fontSize: 11 } : {}),
                            ...(kind === 'main' ? { fontWeight: 600 } : {}),
                            ...(kind?.startsWith('money') ? {
                              fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap',
                              color: kind === 'money-green' ? 'var(--green)'
                                   : kind === 'money-warn' ? (Number(r[key]) > 0.5 ? 'var(--gold)' : 'var(--muted2)')
                                   : 'var(--text)',
                            } : {}),
                            ...(key === 'description' || key === 'notes' ? { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
                          }}>
                          {kind?.startsWith('money') ? fmt(r[key])
                            : key === 'status' ? <StatusPill status={r[key]}/>
                            : (r[key] ?? '—')}
                        </td>
                      ))}
                      {downloadableType ? (
                        <td data-label="المستند" style={{ padding: '9px 12px' }}>
                          <Btn size="sm" variant="ghost" icon={downloadingId === r.zoho_id ? <Spinner size={12}/> : <Download size={13}/>}
                            disabled={downloadingId === r.zoho_id} onClick={() => downloadDocument(r)}
                            title={type === 'invoices' ? 'تنزيل نسخة PDF الرسمية من زوهو' : 'تنزيل المرفق الأصلي إن كان موجوداً'}>
                            {type === 'invoices' ? 'PDF' : 'المرفق'}
                          </Btn>
                        </td>
                      ) : null}
                      {referenceType && can('zoho.configure') ? (
                        <td data-label="الربط" style={{ padding: '9px 12px' }}>
                          <Btn size="sm" variant="ghost" icon={<Link2 size={13}/>} onClick={() => setMapTarget({
                            row: r,
                            sourceType: type === 'bank_accounts' ? 'bank_account' : 'chart_account',
                            existing: (financial?.links || []).find(l => l.source_type === (type === 'bank_accounts' ? 'bank_account' : 'chart_account') && l.zoho_account_id === r.zoho_id) || null,
                          })}>ربط</Btn>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 800 && (
              <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--muted)' }}>
                عرض أول 800 من {filtered.length} — ضيّق الفترة أو ابحث، والتصدير يشمل الكل
              </div>
            )}
          </Card>
        )}

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>
        قراءة فقط — أي تعديل يتم في Zoho Books نفسه ثم «مزامنة». الرواتب: نوع «المصاريف» ← حساب «أجور الموظفين».
      </div>

      <WhatsAppSendModal
        open={waOpen}
        onClose={() => setWaOpen(false)}
        recipients={waOpen ? (waMode === 'invoice' ? invoiceWaRecipients : waRecipients) : []}
        bucketLabel={waMode === 'invoice' ? 'سداد لكل فاتورة' : 'فواتير زوهو المتأخرة'}
      />

      <FinancialAccountLinkModal
        target={mapTarget}
        dashboard={financial}
        onClose={() => setMapTarget(null)}
        onSaved={async () => {
          setMapTarget(null);
          await loadFinancial();
          toast('حُفظ الربط المالي ✓', 'success');
        }}
      />
    </div>
  );
}

function FinancialControlPanel({ data, busy, canConfigure, onSync, onReauthorize, onOpenAccount }) {
  if (!data) {
    return <Card style={{ padding: 18, marginBottom: 14, textAlign: 'center' }}><Spinner size={18}/></Card>;
  }
  const bank = data.bank_summary || {};
  const vendor = data.vendor_summary || {};
  const bills = data.bills_summary || {};
  const creditDocs = data.vendor_credits || {};
  const positions = Array.isArray(data.vendor_positions) ? data.vendor_positions : [];
  const usage = data.api_usage || null;
  const capabilities = data.capabilities || {};
  const needsAuth = Object.values(capabilities).some(c => c?.status === 'needs_reauthorization');
  const unknown = Object.values(capabilities).some(c => c?.status === 'unknown');
  const usagePct = usage?.configured_budget
    ? Math.min(100, (Number(usage.api_calls || 0) / Number(usage.configured_budget)) * 100) : null;
  const vendorKpis = [
    { label: 'فواتير موردين مفتوحة', value: `${fmt(bills.open_balance)} ر.س`, sub: `${Number(bills.open_count || 0)} فاتورة · ${Number(bills.overdue_count || 0)} متأخرة بقيمة ${fmt(bills.overdue_balance)}`, tone: 'var(--red)' },
    { label: 'إجمالي ذمم الموردين', value: `${fmt(vendor.outstanding_payable)} ر.س`, sub: `${Number(vendor.payable_vendors || 0)} مورّد له رصيد إجمالي`, tone: 'var(--gold)' },
    { label: 'رصيد لنا لدى الموردين', value: `${fmt(vendor.unused_credits)} ر.س`, sub: `${Number(vendor.credit_vendors || 0)} مورّد · سلف ودفعات زائدة وأرصدة`, tone: 'var(--green)' },
    { label: 'صافي المطلوب دفعه', value: `${fmt(vendor.net_payable)} ر.س`, sub: `بعد طرح ما لنا من إجمالي ما علينا · ${Number(vendor.vendors || 0)} مورّد`, tone: Number(vendor.net_payable) > 0.5 ? 'var(--gold)' : 'var(--green)' },
  ];
  const bankKpis = [
    { label: 'حسابات مالية في زوهو', value: Number(bank.count || 0).toLocaleString('en-US'), sub: `${Number(bank.operating_treasury_count || 0)} منها خزائن تشغيلية داخلية`, tone: 'var(--accent)' },
    { label: 'البنوك المربوطة فعلياً', value: `${Number(bank.linked_bank_count || 0)}/${Number(bank.expected_bank_count || 3)}`, sub: Number(bank.linked_bank_count || 0) < Number(bank.expected_bank_count || 3) ? 'الناقص يظهر كحساب غير مربوط — بلا تخمين' : 'اكتملت البنوك التشغيلية', tone: Number(bank.linked_bank_count || 0) < Number(bank.expected_bank_count || 3) ? 'var(--gold)' : 'var(--green)' },
    { label: 'الرصيد الدفتري لكل الحسابات', value: `${fmt(bank.book_balance)} ر.س`, sub: 'يشمل البنوك والخزائن وبوابات الدفع', tone: 'var(--green)' },
    { label: 'الرصيد البنكي الفعلي', value: bank.bank_balance == null ? 'غير متصل' : `${fmt(bank.bank_balance)} ر.س`, sub: bank.bank_balance == null ? 'زوهو لا يستقبل تغذية مصرفية حيّة حالياً' : `${Number(bank.feed_available_count || 0)} حساب بتغذية بنكية`, tone: bank.bank_balance == null ? 'var(--muted)' : 'var(--accent)' },
  ];
  const vendorTone = (n) => Number(n) > 0.5 ? 'var(--gold)' : Number(n) < -0.5 ? 'var(--green)' : 'var(--muted)';
  const bankKind = (b) => ({
    bank: 'بنك مربوط', operating_treasury: 'خزينة تشغيلية', cod_treasury: 'خزينة ناقل', cash: 'نقد/صندوق', unclassified: 'غير مصنّف',
  }[b.display_kind] || 'غير مصنّف');
  return (
    <Card style={{ padding: 16, marginBottom: 14, borderColor: 'color-mix(in srgb, var(--accent) 24%, var(--border))' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 11,
            color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))' }}><Landmark size={19}/></span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>الرقابة المالية المباشرة</div>
            <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>أرصدة الموردين والحسابات كما سجّلها Zoho Books — قراءة ومطابقة فقط</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {(needsAuth || unknown) && canConfigure ? (
            <Btn size="sm" variant="accent" icon={<ShieldCheck size={14}/>} onClick={onReauthorize}>
              إعادة ربط زوهو وتفعيل البنوك
            </Btn>
          ) : null}
          <Btn size="sm" variant="ghost" icon={busy ? <Spinner size={13}/> : <RefreshCw size={14}/>} disabled={busy} onClick={onSync}>
            تحديث البنوك والخزائن
          </Btn>
        </div>
      </div>

      {needsAuth ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 9, marginBottom: 12,
          color: 'var(--gold)', background: 'color-mix(in srgb, var(--gold) 9%, transparent)', fontSize: 11.5 }}>
          <AlertTriangle size={15}/><span>ربط زوهو يعمل للفواتير، لكن قراءة البنوك غير مفعّلة. اضغط «إعادة ربط زوهو وتفعيل البنوك»؛ سيفتح Zoho للموافقة ثم يعيدك إلى هذه الصفحة.</span>
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>ما علينا للموردين وما لنا عندهم</div>
        <div style={{ color: 'var(--muted2)', fontSize: 10.5 }}>فواتير الموردين ليست هي رصيد المورد النهائي؛ القيود والسلف تغيّر صافي الرصيد · آخر مزامنة {agoAr(vendor.synced_at || bills.synced_at) || 'غير معروفة'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(185px,1fr))', gap: 9 }}>
        {vendorKpis.map(k => (
          <div key={k.label} style={{ padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface2)' }}>
            <div style={{ color: 'var(--muted)', fontSize: 10.5 }}>{k.label}</div>
            <div style={{ color: k.tone, fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 800, marginTop: 4 }}>{k.value}</div>
            <div style={{ color: 'var(--muted2)', fontSize: 10.5, marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, color: 'var(--muted2)', fontSize: 10.5 }}>
        إشعارات الموردين الدائنة المفتوحة وحدها: <b style={{ color: 'var(--text)' }}>{fmt(creditDocs.open_balance)} ر.س</b> في {Number(creditDocs.open_count || 0)} مستند؛ لذلك لا يجوز تسميتها كامل «الرصيد لنا».
      </div>

      {positions.length ? (
        <div className="m-flow" style={{ marginTop: 11, maxHeight: 340, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
          <table className="m-cards" style={{ width: '100%', fontSize: 11.5 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}><tr>
              <th style={{ padding: '8px 10px' }}>المورد</th>
              <th style={{ padding: '8px 10px' }}>ذمم علينا</th>
              <th style={{ padding: '8px 10px' }}>رصيد لنا</th>
              <th style={{ padding: '8px 10px' }}>الصافي</th>
              <th style={{ padding: '8px 10px' }}>القرار</th>
            </tr></thead>
            <tbody>{positions.map(v => {
              const net = Number(v.net_payable) || 0;
              return <tr key={v.zoho_id} style={{ borderTop: '1px solid var(--border)' }}>
                <td data-label="" style={{ padding: '8px 10px', fontWeight: 700 }}>{v.vendor_name || 'مورد بلا اسم'}</td>
                <td data-label="ذمم علينا" style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', color: Number(v.gross_payable) > 0.5 ? 'var(--gold)' : 'var(--muted2)' }}>{fmt(v.gross_payable)}</td>
                <td data-label="رصيد لنا" style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', color: Number(v.credit_balance) > 0.5 ? 'var(--green)' : 'var(--muted2)' }}>{fmt(v.credit_balance)}</td>
                <td data-label="الصافي" style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontWeight: 800, color: vendorTone(net) }}>{fmt(Math.abs(net))}</td>
                <td data-label="القرار" style={{ padding: '8px 10px', color: vendorTone(net), fontWeight: 700 }}>{net > 0.5 ? 'مطلوب دفعه' : net < -0.5 ? 'رصيد لصالحنا' : 'مصفّى'}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      ) : null}

      <div style={{ height: 1, background: 'var(--border)', margin: '16px 0 12px' }}/>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>البنوك والخزائن وبوابات الدفع</div>
        <div style={{ color: 'var(--muted2)', fontSize: 10.5 }}>الرصيد الدفتري لا يصبح رصيد بنك فعلياً إلا بوجود تغذية مصرفية أو كشف مربوط · آخر مزامنة {agoAr(data.banks?.[0]?.synced_at) || 'غير معروفة'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(185px,1fr))', gap: 9 }}>
        {bankKpis.map(k => (
          <div key={k.label} style={{ padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface2)' }}>
            <div style={{ color: 'var(--muted)', fontSize: 10.5 }}>{k.label}</div>
            <div style={{ color: k.tone, fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 800, marginTop: 4 }}>{k.value}</div>
            <div style={{ color: 'var(--muted2)', fontSize: 10.5, marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {(data.banks || []).length ? (
        <div className="m-flow" style={{ marginTop: 11, overflowX: 'auto' }}>
          <table className="m-cards" style={{ width: '100%', fontSize: 11.5 }}>
            <thead><tr>
              <th style={{ padding: '8px 10px' }}>الحساب</th>
              <th style={{ padding: '8px 10px' }}>التصنيف</th>
              <th style={{ padding: '8px 10px' }}>دفتر زوهو</th>
              <th style={{ padding: '8px 10px' }}>الرصيد البنكي الفعلي</th>
              <th style={{ padding: '8px 10px' }}>غير مصنّفة</th>
              <th style={{ padding: '8px 10px' }}>الحالة</th>
            </tr></thead>
            <tbody>{data.banks.map(b => {
              const linked = !!b.internal_bank_name;
              const mismatch = b.internal_vs_book != null && Math.abs(Number(b.internal_vs_book)) > 0.5;
              return <tr key={b.zoho_id} style={{ borderTop: '1px solid var(--border)' }}>
                <td data-label="" style={{ padding: '8px 10px', fontWeight: 700 }}>{b.account_name}<div style={{ color: 'var(--muted2)', fontSize: 10 }}>{b.internal_bank_name || 'غير مربوط'}</div></td>
                <td data-label="التصنيف" style={{ padding: '8px 10px', color: b.display_kind === 'unclassified' ? 'var(--gold)' : 'var(--text)' }}>{bankKind(b)}</td>
                <td data-label="دفتر زوهو" style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>{fmt(b.book_balance)}</td>
                <td data-label="الرصيد البنكي الفعلي" style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', color: b.feed_available ? 'var(--text)' : 'var(--muted2)' }}>{b.feed_available ? fmt(b.bank_balance) : 'غير متصل'}</td>
                <td data-label="غير مصنّفة" style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', color: Number(b.uncategorized_count) ? 'var(--gold)' : 'var(--muted2)' }}>{Number(b.uncategorized_count || 0).toLocaleString('en-US')}</td>
                <td data-label="الحالة" style={{ padding: '8px 10px', color: !linked || mismatch ? 'var(--gold)' : 'var(--green)', fontWeight: 700 }}>
                  {!linked ? (b.display_kind === 'operating_treasury' ? 'خزينة غير مربوطة' : 'يحتاج تصنيف') : mismatch ? `فرق ${fmt(b.internal_vs_book)}` : 'متطابق'}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 11, fontSize: 11 }}>
        <button type="button" onClick={onOpenAccount} style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--accent)', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
          فتح كل الحسابات وتصنيفها وربطها ←
        </button>
        <span style={{ color: 'var(--muted)' }}>
          {usage ? `استهلاك API اليوم: ${Number(usage.api_calls || 0).toLocaleString('en-US')}${usage.configured_budget ? ` من ${Number(usage.configured_budget).toLocaleString('en-US')} (${usagePct.toFixed(0)}%)` : ''}` : 'يبدأ قياس استهلاك API مع أول مزامنة جديدة'}
        </span>
      </div>
    </Card>
  );
}

function FinancialAccountLinkModal({ target, dashboard, onClose, onSaved }) {
  const [kind, setKind] = useState('bank');
  const [bankName, setBankName] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!target) return;
    const existing = target.existing || {};
    setKind(existing.link_kind || (target.sourceType === 'bank_account' ? 'bank' : 'cod_treasury'));
    setBankName(existing.internal_bank_name || '');
    setCarrierId(existing.carrier_id || '');
    setNotes(existing.notes || '');
  }, [target]);
  if (!target) return null;
  const isBank = target.sourceType === 'bank_account';
  const save = async () => {
    if (kind === 'bank' && !bankName.trim()) { toast('اختر اسم البنك الداخلي', 'error'); return; }
    if (kind === 'cod_treasury' && !carrierId) { toast('اختر شركة الشحن المرتبطة بالخزينة', 'error'); return; }
    setSaving(true);
    try {
      await setZohoFinancialAccountLink({
        sourceType: target.sourceType,
        zohoAccountId: target.row.zoho_id,
        linkKind: kind,
        internalBankName: kind === 'bank' ? bankName : null,
        carrierId: kind === 'cod_treasury' ? carrierId : null,
        notes,
      });
      await onSaved();
    } catch (e) { toast(`فشل حفظ الربط: ${e.message}`, 'error'); }
    setSaving(false);
  };
  const remove = async () => {
    setSaving(true);
    try {
      await setZohoFinancialAccountLink({ sourceType: target.sourceType, zohoAccountId: target.row.zoho_id, linkKind: null });
      await onSaved();
    } catch (e) { toast(`فشل إزالة الربط: ${e.message}`, 'error'); }
    setSaving(false);
  };
  const fieldStyle = { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' };
  return (
    <Modal title={`ربط حساب زوهو — ${target.row.account_name}`} onClose={onClose} width={560}>
      <div className="m-flow" style={{ display: 'grid', gap: 14 }}>
        <div style={{ padding: 11, borderRadius: 9, background: 'var(--surface2)', color: 'var(--muted)', fontSize: 11.5 }}>
          الربط تسمية ومطابقة داخل لمحة فقط، ولا يعدّل الحساب أو رصيده داخل زوهو.
        </div>
        {!isBank ? (
          <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 700 }}>وظيفة الحساب
            <select value={kind} onChange={e => setKind(e.target.value)} style={fieldStyle}>
              <option value="cod_treasury">خزينة تحصيل لشركة شحن</option>
              <option value="cash">صندوق/نقد عام</option>
            </select>
          </label>
        ) : null}
        {kind === 'bank' ? (
          <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 700 }}>الحساب البنكي الداخلي
            <input value={bankName} onChange={e => setBankName(e.target.value)} list="zoho-internal-banks" placeholder="مثال: بنك الإنماء" style={fieldStyle}/>
            <datalist id="zoho-internal-banks">{(dashboard?.internal_banks || []).map(b => <option key={b} value={b}/>)}</datalist>
          </label>
        ) : null}
        {kind === 'cod_treasury' ? (
          <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 700 }}>شركة الشحن
            <select value={carrierId} onChange={e => setCarrierId(e.target.value)} style={fieldStyle}>
              <option value="">اختر الشركة…</option>
              {(dashboard?.carriers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        ) : null}
        <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 700 }}>ملاحظة اختيارية
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="سبب الربط أو مرجعه" style={fieldStyle}/>
        </label>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <div>{target.existing ? <Btn variant="danger" size="sm" disabled={saving} onClick={remove}>إزالة الربط</Btn> : null}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
            <Btn variant="accent" disabled={saving} icon={saving ? <Spinner size={13}/> : <Link2 size={14}/>} onClick={save}>حفظ الربط</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// شارة حالة ملوّنة معرّبة
const STATUS_TONE = {
  paid: 'green', unpaid: 'gold', overdue: 'red', draft: 'muted',
  sent: 'accent', partially_paid: 'gold', partiallypaid: 'gold', void: 'muted', voided: 'muted',
};
function StatusPill({ status }) {
  if (!status) return <span style={{ color: 'var(--muted2)' }}>—</span>;
  const tone = STATUS_TONE[String(status).toLowerCase().trim()] || 'muted';
  const col = { green: 'var(--green)', gold: 'var(--gold)', red: 'var(--red)', accent: 'var(--accent)', muted: 'var(--muted)' }[tone];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      color: col, background: `color-mix(in srgb, ${col} 13%, transparent)`, whiteSpace: 'nowrap',
    }}>{zohoStatusAr(status)}</span>
  );
}

// لوحة نظرة عامة على فواتير العملاء — أرقامها كل الفترات (مستقلة عن الفلاتر أدناه)
function InvoiceDashboard({ dash, onPick, onShowOverdue, campaign }) {
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const ml = (ym) => { const [y, m] = String(ym).split('-'); return `${names[+m - 1] || m} ${y}`; };
  const kpis = [
    { label: 'إجمالي غير المدفوع (باقٍ)', val: dash.openAr, sub: `${dash.openCnt} فاتورة مفتوحة`, tone: 'gold' },
    { label: 'متأخّرة عن السداد', val: dash.overdueAmt, sub: `${dash.overdueCnt} فاتورة — اضغط لعرضها`, tone: 'red', onClick: onShowOverdue, isOverdue: true },
    { label: 'مسودّات', val: dash.draftTotal, sub: `${dash.draftCnt} فاتورة لم تُرسَل`, tone: 'muted' },
  ];
  const toneCol = { gold: 'var(--gold)', red: 'var(--red)', muted: 'var(--muted)' };
  return (
    <Card style={{ padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginBottom: 8 }}>
        نظرة عامة — <b>كل الفترات</b> (لا تتأثر بفلاتر الجدول أدناه)
      </div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
        {kpis.map(k => (
          <div key={k.label} onClick={k.onClick}
            style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)',
              cursor: k.onClick ? 'pointer' : 'default' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 19, fontWeight: 800, fontFamily: 'var(--font-mono)', color: toneCol[k.tone] }}>{fmt(k.val)}</div>
            <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 2 }}>{k.sub}</div>
            {k.isOverdue && campaign && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                <Btn size="sm" variant="accent" onClick={campaign.onWhatsApp}>📲 حملة واتساب</Btn>
                <Btn size="sm" variant="ghost" onClick={campaign.onExport}>📞 ملف الحملة</Btn>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
        {/* شهرياً */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>غير المدفوع شهرياً</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {dash.monthly.slice(0, 7).map(m => {
              const rem = Number(m.remaining) || 0, tot = Number(m.total) || 1;
              const pct = Math.min(100, Math.round((rem / tot) * 100));
              return (
                <div key={m.ym} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                  <span style={{ width: 78, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{ml(m.ym)}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: rem > 0.5 ? 'var(--gold)' : 'var(--green)' }}/>
                  </div>
                  <span style={{ width: 78, textAlign: 'left', fontFamily: 'var(--font-mono)', fontWeight: 700,
                    color: rem > 0.5 ? 'var(--gold)' : 'var(--muted2)' }}>{fmt(rem)}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* أعلى المدينين */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>أكثر العملاء عليهم مبالغ لك (غير مسدّد)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {dash.debtors.slice(0, 8).map((d, i) => (
              <button key={d.cust} onClick={() => onPick(d.cust)} title="اعرض فواتير هذا العميل"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', border: 'none',
                  background: 'transparent', cursor: 'pointer', textAlign: 'right', borderRadius: 6, width: '100%' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ width: 16, color: 'var(--muted2)', fontSize: 11 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.cust}</span>
                <span style={{ fontSize: 10, color: 'var(--muted2)' }}>{d.open_cnt}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: 'var(--gold)', whiteSpace: 'nowrap' }}>{fmt(d.owed)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
