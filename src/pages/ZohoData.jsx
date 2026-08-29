// «زوهو API» /zoho-data — تصفّح احترافي لكل مرايا Zoho Books:
// فواتير/دفعات العملاء · المصاريف (فيها الرواتب بحساب «أجور الموظفين») ·
// فواتير/دفعات الموردين · القيود اليومية. قراءة فقط — المرايا تتغذى من
// zoho-sync (دلتا) ولا تُعدَّل هنا أبداً.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, Search, Database, Download, Landmark, Link2, ShieldCheck, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { Card, Btn, Spinner, Empty, toast, PageHeader, Modal } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { ZOHO_MIRRORS, loadZohoMirror, syncZohoDocs, currentPnlPeriod,
  loadZohoInvoiceDashboard, zohoStatusAr, loadZohoOverdueCampaign, loadZohoWebhookHealth,
  loadZohoFinancialDashboard, setZohoFinancialAccountLink,
  getZohoAuthUrl, downloadZohoDocument, fetchZohoDocument,
  markZohoInvoicesSent, pushZohoInvoicesToZatca, finalizeAndPushZohoInvoices,
  previewZohoBankMissing, recordZohoBankExport, verifyZohoBankExport,
  listZohoUnreviewedBankTransactions, getZohoBankMatchCandidates, approveZohoBankMatch,
  loadZohoWebhookFailures, retryZohoWebhook } from '../lib/pnlService.js';
import { mergePdfBlobs, downloadBlob } from '../lib/pdfMerge.js';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import './ZohoData.css';
import useMobileLayout from '../lib/useMobileLayout.js';
import { useWindowedRows } from '../hooks/useWindowedRows.js';
import { ProgressiveListFooter } from '../components/MobileUX.jsx';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (p) => {
  const [y, m] = p.split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${names[+m - 1] || m} ${y}`;
};
const safeBankFilePart = value => String(value || 'Bank').trim()
  .replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_').slice(0, 70) || 'Bank';
const createMissingBankWorkbook = transactions => {
  const aoa = [
    ['Date', 'Description', 'Reference Number', 'Withdrawals', 'Deposits'],
    ...(transactions || []).map(row => {
      const deposit = Number(row.credit || 0);
      const withdrawal = Number(row.debit || 0);
      return [row.date || '', row.description || '', row.reference || '',
        withdrawal > 0 ? withdrawal : '', deposit > 0 ? deposit : ''];
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 13 }, { wch: 72 }, { wch: 26 }, { wch: 15 }, { wch: 15 }];
  ws['!autofilter'] = { ref: `A1:E${Math.max(1, aoa.length)}` };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Missing Transactions');
  return wb;
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

const ACCOUNT_TYPE_AR = {
  bank: 'حساب بنكي', cash: 'نقد وصندوق', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات',
  other_income: 'إيرادات أخرى', other_expense: 'مصروفات أخرى', cost_of_goods_sold: 'تكلفة المبيعات',
  accounts_receivable: 'ذمم العملاء', accounts_payable: 'ذمم الموردين', fixed_asset: 'أصول ثابتة',
  other_asset: 'أصول أخرى', other_current_asset: 'أصول متداولة أخرى',
  other_current_liability: 'التزامات متداولة أخرى', other_liability: 'التزامات أخرى',
  long_term_liability: 'التزامات طويلة الأجل', credit_card: 'بطاقة ائتمانية', stock: 'مخزون',
  payment_clearing: 'حساب تسوية مدفوعات',
};
const ACCOUNT_NAME_AR = {
  'dimension adjustments': 'تسويات الأبعاد', drawings: 'مسحوبات المالك',
  'input excise tax': 'ضريبة السلع الانتقائية للمدخلات', 'input vat': 'ضريبة القيمة المضافة للمدخلات',
  'output excise tax': 'ضريبة السلع الانتقائية للمخرجات', 'output vat': 'ضريبة القيمة المضافة للمخرجات',
  'accounts receivable': 'ذمم العملاء', 'accounts payable': 'ذمم الموردين',
  'undeposited funds': 'أموال غير مودعة', 'petty cash': 'العهدة النقدية',
  sales: 'المبيعات', purchases: 'المشتريات', 'retained earnings': 'الأرباح المبقاة',
  'opening balance adjustments': 'تسويات الرصيد الافتتاحي',
};
const accountTypeAr = value => {
  if (!value) return '—';
  const key = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ACCOUNT_TYPE_AR[key] || value;
};
const accountNameAr = value => ACCOUNT_NAME_AR[String(value || '').trim().toLowerCase()] || null;
const isArabic = value => /[\u0600-\u06ff]/.test(String(value || ''));
const isZohoTreasuryAccount = row => row?.display_kind === 'operating_treasury'
  || /^\s*خزينة(?:\s|$)/i.test(String(row?.account_name_ar || row?.account_name || ''));
const isZohoPaymentGatewayAccount = row => row?.display_kind === 'payment_gateway'
  || /moyassar|ميسر/i.test(String(row?.account_name_ar || row?.account_name || ''));
const isZohoClearingAccount = row => row?.display_kind === 'clearing'
  || /أموال غير مودعة|undeposited funds|حساب تسوية المتاجر|merchant settlement/i
    .test(String(row?.account_name_ar || row?.account_name || ''));
const financialDisplayKind = row => {
  if (isZohoPaymentGatewayAccount(row)) return 'payment_gateway';
  if (isZohoClearingAccount(row)) return 'clearing';
  if (isZohoTreasuryAccount(row)) return 'operating_treasury';
  return row?.display_kind || 'unclassified';
};
const financialKindAr = kind => ({
  bank: 'بنك مربوط', operating_treasury: 'خزينة تشغيلية', cod_treasury: 'خزينة ناقل',
  cash: 'نقد/صندوق', payment_gateway: 'بوابة دفع', clearing: 'حساب تسوية',
  unclassified: 'غير مصنّف',
}[kind] || 'غير مصنّف');

const WORKSPACE_SECTIONS = [
  { id: 'overview', label: 'نظرة عامة', types: [] },
  { id: 'customers', label: 'العملاء والفواتير', types: ['invoices', 'payments'] },
  { id: 'vendors', label: 'الموردون والمشتريات', types: ['bills', 'vendor_payments', 'purchase_orders', 'expenses', 'vendor_credits', 'items'] },
  { id: 'banks', label: 'البنوك والمطابقة', types: ['bank_accounts'] },
  { id: 'accounts', label: 'القيود والحسابات', types: ['journals', 'chart_accounts'] },
];
const WORKSPACE_SECTION_ALIASES = {
  bank_accounts: 'banks',
};
const sectionForType = type => WORKSPACE_SECTIONS.find(section => section.types.includes(type))?.id || 'overview';

// أعمدة العرض لكل نوع (label + مفتاح + نوع القيمة)
const COLS = {
  invoices: [
    ['التاريخ', 'date'], ['الرقم', 'invoice_number', 'mono'], ['العميل', 'customer_name', 'main'],
    ['الحالة', 'status'], ['حالة زاتكا', 'einvoice_status'], ['المبلغ', 'total', 'money'], ['المتبقي', 'balance', 'money-warn'],
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
  purchase_orders: [
    ['التاريخ', 'date'], ['الرقم', 'purchaseorder_number', 'mono'], ['المورد', 'vendor_name', 'main'],
    ['التسليم', 'delivery_date'], ['الحالة', 'status'], ['الإجمالي', 'total', 'money'],
  ],
  items: [
    ['الصنف/الخدمة', 'name', 'main'], ['الرمز', 'sku', 'mono'], ['النوع', 'item_type'],
    ['الحالة', 'status'], ['سعر البيع', 'rate', 'money'], ['تكلفة الشراء', 'purchase_rate', 'money'], ['الضريبة %', 'tax_percentage'],
  ],
  journals: [
    ['التاريخ', 'date'], ['القيد', 'entry_number', 'mono'], ['المرجع', 'reference_number', 'mono'],
    ['الملاحظات', 'notes', 'main'], ['المبلغ', 'total', 'money'],
  ],
  bank_accounts: [
    ['الحساب', 'account_name', 'main'], ['الرمز', 'account_code', 'mono'],
    ['التصنيف', 'display_kind', 'display-kind'], ['العملة', 'currency_code'], ['رصيد زوهو الدفتري', 'book_balance', 'money'],
    ['الرصيد الختامي للبنك', 'internal_balance', 'internal-balance'],
    ['الفرق عن زوهو', 'internal_vs_book', 'money-gap'], ['غير مصنّفة', 'uncategorized_count'],
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
  const navigate = useNavigate();
  const requestedSectionRaw = new URLSearchParams(location.search).get('tab');
  const requestedSection = WORKSPACE_SECTION_ALIASES[requestedSectionRaw] || requestedSectionRaw;
  const requestedType = new URLSearchParams(location.search).get('type');
  const requestedFocusRaw = new URLSearchParams(location.search).get('focus');
  const requestedFocus = ['draft', 'zatca'].includes(requestedFocusRaw) ? requestedFocusRaw : '';
  const initialSection = WORKSPACE_SECTIONS.some(item => item.id === requestedSection)
    ? requestedSection
    : 'overview';
  const initialTypes = WORKSPACE_SECTIONS.find(item => item.id === initialSection)?.types || [];
  const initialType = initialTypes.includes(requestedType) ? requestedType : initialTypes[0] || 'invoices';
  const [type, setType] = useState(initialType);
  const [section, setSection] = useState(initialSection);
  const [periodTo, setPeriodTo] = useState('');   // '' = نفس «من» (شهر واحد)
  const [dash, setDash] = useState(null);
  const [health, setHealth] = useState(null);       // صحة مزامنة زوهو (webhook + دوري)
  const [financial, setFinancial] = useState(null); // البنوك والخزائن والموردون + قدرات API
  const [downloadingId, setDownloadingId] = useState(null);
  const [selectedInvoices, setSelectedInvoices] = useState(() => new Set());
  const [bulkPdf, setBulkPdf] = useState({ busy: false, done: 0, total: 0 });
  const [invoiceOperation, setInvoiceOperation] = useState(null);
  const [operationResult, setOperationResult] = useState(null);
  const [bankMissing, setBankMissing] = useState(null);
  const [bankReview, setBankReview] = useState(null);
  const [webhookFailures, setWebhookFailures] = useState([]);
  const [retryingWebhook, setRetryingWebhook] = useState(null);
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
  const [invoiceFocus, setInvoiceFocus] = useState(requestedFocus);
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedType = params.get('type');
    const incomingQ = params.get('q');
    const incomingFocus = params.get('focus');
    if (requestedType && ZOHO_MIRRORS[requestedType]) {
      setType(requestedType);
      setSection(sectionForType(requestedType));
    }
    setInvoiceFocus(['draft', 'zatca'].includes(incomingFocus) ? incomingFocus : '');
    if (incomingFocus === 'draft' || incomingFocus === 'zatca') {
      setPeriod('');
      setPeriodTo('');
    }
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
    if (type !== 'invoices') setInvoiceFocus('');
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
  const refreshWebhookFailures = useCallback(() => {
    if (!can('zoho.retry_webhook')) return;
    loadZohoWebhookFailures().then(r => setWebhookFailures(r?.rows || [])).catch(() => {});
  }, [can]);
  useEffect(() => { if (isActive) refreshWebhookFailures(); }, [isActive, refreshWebhookFailures]);

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
          const mirrorKey = ({ customerpayments: 'payments', vendorpayments: 'vendor_payments', purchaseorders: 'purchase_orders', bankaccounts: 'bank_accounts', chartofaccounts: 'chart_accounts', vendorcredits: 'vendor_credits' })[k] || k;
          return `${ZOHO_MIRRORS[mirrorKey]?.label?.replace(/^[^\s]+\s/, '') || k}: ${v}`;
        });
      toast(`مزامنة: ${parts.join(' · ')}`, 'success');
      load(type, period, periodTo);
      loadFinancial();
    } catch (e) { toast(`فشل المزامنة: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const reauthorize = async () => {
    if (!can('zoho.manage_connection')) {
      toast('لا تملك صلاحية إعادة تفويض اتصال زوهو', 'error');
      return;
    }
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
  const openType = (nextType) => {
    const nextSection = sectionForType(nextType);
    const params = new URLSearchParams(location.search);
    params.set('tab', nextSection);
    params.set('type', nextType);
    setType(nextType);
    setSection(nextSection);
    navigate(`/zoho-data?${params.toString()}`);
  };

  useEffect(() => {
    const nextSection = WORKSPACE_SECTIONS.some(item => item.id === requestedSection)
      ? requestedSection
      : 'overview';
    setSection(nextSection);
    const types = WORKSPACE_SECTIONS.find(item => item.id === nextSection)?.types || [];
    const nextType = types.includes(requestedType) ? requestedType : types[0];
    if (nextType) setType(nextType);
  }, [requestedSection, requestedType]);
  const needsZohoAuth = Object.values(financial?.capabilities || {}).some(capability => capability?.status === 'needs_reauthorization');

  // الحالات المتاحة فعلياً في البيانات المحمّلة (ديناميكي لكل نوع)
  const statuses = useMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map(r => r.status).filter(Boolean))].sort();
  }, [rows]);

  const displayRows = useMemo(() => {
    if (!rows) return [];
    const localized = rows.map(row => ({
      ...row,
      account_name_ar: accountNameAr(row.account_name),
      account_type_ar: accountTypeAr(row.account_type || row.account_type_formatted),
    }));
    if (type !== 'bank_accounts') return localized;
    const financialBanks = new Map((financial?.banks || []).map(bank => [String(bank.zoho_id), bank]));
    return localized.map(row => ({ ...row, ...(financialBanks.get(String(row.zoho_id)) || {}) }));
  }, [rows, type, financial]);
  const zohoBankAccounts = useMemo(() => displayRows.filter(row => {
    const accountType = String(row.account_type || row.account_type_formatted || '').toLowerCase().replace(/[\s-]+/g, '_');
    return type === 'bank_accounts' && accountType === 'bank'
      && !isZohoTreasuryAccount(row) && !isZohoPaymentGatewayAccount(row);
  }), [displayRows, type]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let list = displayRows;
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(s)));
    if (status) list = list.filter(r => r.status === status);
    if (type === 'invoices' && invoiceFocus === 'draft') {
      list = list.filter(r => String(r.status || '').trim().toLowerCase() === 'draft');
    }
    if (type === 'invoices' && invoiceFocus === 'zatca') {
      list = list.filter(r => String(r.einvoice_status || '').trim().toLowerCase() === 'yet_to_be_pushed');
    }
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
    const numeric = ['total', 'amount', 'balance', 'book_balance', 'bank_balance', 'internal_balance', 'internal_vs_book', 'current_balance', 'uncategorized_count'].includes(col);
    return [...list].sort((a, b) => {
      let av = a[col], bv = b[col];
      if (numeric) { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = String(av ?? ''); bv = String(bv ?? ''); }
      const cmp = numeric ? av - bv : av.localeCompare(bv, 'ar');
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, displayRows, q, status, invoiceFocus, amtMin, amtMax, sort, cfg, type]);
  const isMobile = useMobileLayout();
  const {
    visible: displayed,
    count: displayedCount,
    total: displayedTotal,
    hasMore: hasMoreDisplayed,
    sentinelRef: displayedSentinelRef,
    loadMore: loadMoreDisplayed,
  } = useWindowedRows(filtered, { batch: isMobile ? 30 : 800 });
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

  const runInvoiceOperation = async (kind) => {
    const required = kind === 'sent'
      ? ['zoho.invoice_mark_sent']
      : kind === 'finalize'
        ? ['zoho.invoice_mark_sent', 'zoho.invoice_push_zatca']
        : ['zoho.invoice_push_zatca'];
    if (required.some(permission => !can(permission))) {
      toast('لا تملك صلاحية تنفيذ هذا الإجراء في زوهو', 'error');
      return;
    }
    const ids = [...selectedInvoices];
    if (!ids.length) return;
    const selectedRows = filtered.filter(r => selectedInvoices.has(String(r.zoho_id)));
    const eligible = kind === 'sent'
      ? selectedRows.filter(r => String(r.status).toLowerCase() === 'draft')
      : kind === 'finalize'
        ? selectedRows.filter(r => String(r.status).toLowerCase() === 'draft'
          || String(r.einvoice_status).toLowerCase() === 'yet_to_be_pushed')
        : selectedRows.filter(r => String(r.einvoice_status).toLowerCase() === 'yet_to_be_pushed');
    if (!eligible.length) {
      toast(kind === 'sent' ? 'المحدد لا يحتوي مسودات' : kind === 'finalize'
        ? 'المحدد لا يحتوي مسودات أو فواتير معلقة لزاتكا'
        : 'المحدد لا يحتوي فواتير جاهزة لزاتكا', 'info');
      return;
    }
    setInvoiceOperation(kind);
    try {
      const result = kind === 'sent'
        ? await markZohoInvoicesSent(eligible.map(r => r.zoho_id))
        : kind === 'finalize'
          ? await finalizeAndPushZohoInvoices(eligible.map(r => r.zoho_id))
          : await pushZohoInvoicesToZatca(eligible.map(r => r.zoho_id));
      setOperationResult({ kind, ...result });
      setSelectedInvoices(new Set());
      await load(type, period, periodTo);
      if (result.failed && !result.succeeded) {
        toast(`لم تنجح أي فاتورة (${result.failed}) — راجع سبب كل فاتورة`, 'error');
      } else if (result.failed) {
        toast(`نجحت ${result.succeeded} وتعذرت ${result.failed} — راجع النتيجة`, 'info');
      } else {
        toast(kind === 'sent' ? 'اكتمل تحويل المسودات' : kind === 'finalize'
          ? 'اكتملت دورة الاعتماد والإرسال إلى زاتكا'
          : 'اكتمل إرسال زاتكا عبر زوهو', 'success');
      }
    } catch (e) {
      toast(`تعذّر التنفيذ: ${e.message}`, 'error');
    } finally { setInvoiceOperation(null); }
  };

  const openBankMissingExport = async (row) => {
    if (!can('zoho.bank_import')) {
      toast('لا تملك صلاحية فحص وتصدير العمليات البنكية الناقصة', 'error');
      return;
    }
    setBankMissing({ row, busy: true, preview: null });
    try {
      const preview = await previewZohoBankMissing(row.zoho_id);
      setBankMissing({ row, busy: false, preview });
    } catch (e) {
      setBankMissing(null); toast(`تعذّر فحص العمليات الناقصة: ${e.message}`, 'error');
    }
  };

  const openBankReview = async (row) => {
    if (!can('bank.view')) {
      toast('لا تملك صلاحية عرض عمليات البنوك', 'error');
      return;
    }
    setBankReview({ row, busy: true, data: null });
    try {
      const data = await listZohoUnreviewedBankTransactions(row.zoho_id);
      setBankReview({ row, busy: false, data });
    } catch (e) {
      setBankReview(null);
      toast(`تعذّر جلب عمليات البنك من زوهو: ${e.message}`, 'error');
    }
  };

  const filtersActive = !!(q.trim() || status || invoiceFocus || amtMin || amtMax);
  const clearFilters = () => {
    setQ(''); setStatus(''); setInvoiceFocus(''); setAmtMin(''); setAmtMax('');
    const params = new URLSearchParams(location.search);
    params.delete('focus');
    params.delete('q');
    navigate(`/zoho-data${params.size ? `?${params.toString()}` : ''}`, { replace: true });
  };
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
      ...filtered.map(r => cols.map(c => c[1] === 'status' ? zohoStatusAr(r[c[1]])
        : c[1] === 'account_name' ? (r.account_name_ar || r.account_name || '')
        : c[1] === 'account_type_formatted' ? accountTypeAr(r.account_type || r.account_type_formatted)
        : (r[c[1]] ?? ''))),
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
    <div className="zoho-data-page workspace-page">
      <PageHeader icon={<Database size={22}/>} iconColor="#0EA5E9"
        title="زوهو والحسابات"
        subtitle="بيانات Zoho Books، حالة الربط، وتفعيل قراءة البنوك والخزائن"
        actions={
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {can('zoho.manage_connection') ? (
              <Btn size="sm" variant="primary" icon={<ShieldCheck size={14}/>} onClick={reauthorize}>
                إدارة صلاحيات وربط زوهو
              </Btn>
            ) : null}
            <Btn size="sm" variant="ghost" icon={busy ? <Spinner size={13}/> : <RefreshCw size={14}/>} disabled={busy} onClick={doSync}>
              تحديث بيانات زوهو
            </Btn>
          </div>
        }/>

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

      {webhookFailures.length > 0 && can('zoho.retry_webhook') ? (
        <Card style={{ padding: 12, marginBottom: 14, borderColor: 'color-mix(in srgb, var(--red) 30%, var(--border))' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>
            أحداث زوهو تحتاج إعادة معالجة ({webhookFailures.length})
          </div>
          {webhookFailures.slice(0, 8).map(e => <div key={e.event_key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 11.5 }}>
            <div style={{ flex: 1 }}><b>{KIND_AR[e.entity_type] || e.entity_type || 'حدث زوهو'}</b> · {e.entity_id || 'بلا معرف'}<div style={{ color: 'var(--muted)' }}>{e.last_error || `متوقف في حالة ${e.status}`}</div></div>
            <Btn size="sm" variant="ghost" disabled={retryingWebhook === e.event_key}
              icon={retryingWebhook === e.event_key ? <Spinner size={12}/> : <RefreshCw size={13}/>} onClick={async () => {
                setRetryingWebhook(e.event_key);
                try { await retryZohoWebhook(e.event_key); toast('أعيدت المزامنة والتحقق من الحدث', 'success'); refreshWebhookFailures(); }
                catch (err) { toast(`فشلت إعادة المعالجة: ${err.message}`, 'error'); }
                finally { setRetryingWebhook(null); }
              }}>إعادة مزامنة هذا الحدث</Btn>
          </div>)}
        </Card>
      ) : null}

      {section === 'overview' ? (
        <FinancialControlPanel
          data={financial}
          canManageConnection={can('zoho.manage_connection')}
          onReauthorize={reauthorize}
          onOpenAccount={() => openType('bank_accounts')}
          onOpenVendors={() => openType('bills')}
        />
      ) : null}

      {/* لوحة الفواتير — نظرة شهرية + أعلى المدينين + حملة المتأخرين */}
      {/* النقر على مدين = كامل دينه عبر كل الشهور — كان فلتر الشهر يبقى مفعّلاً
          فيُخفي فواتير خارج الشهر ويُظهر «متبقٍّ» أقل من الحقيقي (بلاغ 2026-07-15) */}
      {section !== 'overview' && type === 'invoices' && dash && (
        <InvoiceDashboard dash={dash} onPick={(name) => { setQ(name); setPeriod(''); setPeriodTo(''); }}
          onShowOverdue={() => {
            // المتأخرات موزّعة على أشهر قديمة — افتح كل الفترات وفلترها
            setPeriod(''); setPeriodTo(''); setStatus('overdue'); setQ('');
          }}
          campaign={dash.overdueCnt > 0 && can('collections.view') ? {
            onWhatsApp: openWhatsApp, onExport: exportCampaign,
          } : null}/>
      )}

      {section !== 'overview' ? <>
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
        {invoiceFocus && (
          <span className="zoho-active-focus" role="status">
            النتائج: {invoiceFocus === 'draft' ? 'الفواتير المسودة' : 'فواتير زاتكا المعلقة'}
          </span>
        )}
        {filtersActive && (
          <Btn size="sm" variant="ghost" onClick={clearFilters}>
            مسح الفلاتر
          </Btn>
        )}
        {type === 'invoices' && can('collections.view') && (
          <Btn size="sm" variant="accent" onClick={openInvoiceCampaign} disabled={!unpaidInvCount}
            title="حملة واتساب لكل فاتورة في العرض الحالي — قالب فيه اسم المتجر وتاريخ الفاتورة والمتبقي">
            📲 حملة لكل فاتورة ({unpaidInvCount})
          </Btn>
        )}
        {type === 'bank_accounts' && can('bank.view') && zohoBankAccounts.length ? (
          <Btn size="sm" variant="accent" icon={<Landmark size={13}/>} onClick={() => {
            const firstPending = zohoBankAccounts.find(row => Number(row.uncategorized_count) > 0) || zohoBankAccounts[0];
            openBankReview(firstPending);
          }} title="عرض العمليات غير المراجعة حيًا من زوهو لكل بنك">
            مراجعة عمليات جميع البنوك ({zohoBankAccounts.reduce((sum, row) => sum + Number(row.uncategorized_count || 0), 0)})
          </Btn>
        ) : null}
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
          {can('zoho.invoice_mark_sent') && can('zoho.invoice_push_zatca') ? (
            <Btn size="sm" variant="accent" disabled={!selectedInvoices.size || !!invoiceOperation}
              icon={invoiceOperation === 'finalize' ? <Spinner size={12}/> : <ShieldCheck size={13}/>}
              title="يفحص كل فاتورة حيًا في زوهو، يرسلها إلى زاتكا أولًا عبر زوهو ثم يحدّث حالة المستند، مع منع التكرار واستبعاد الأرصدة الافتتاحية"
              onClick={() => runInvoiceOperation('finalize')}>
              اعتماد وإرسال المحدد إلى زاتكا
            </Btn>
          ) : null}
          {can('zoho.invoice_mark_sent') && !can('zoho.invoice_push_zatca') ? (
            <Btn size="sm" variant="accent" disabled={!selectedInvoices.size || !!invoiceOperation}
              icon={invoiceOperation === 'sent' ? <Spinner size={12}/> : null}
              onClick={() => runInvoiceOperation('sent')}>
              تحويل المسودات المحددة إلى مرسلة
            </Btn>
          ) : null}
          {can('zoho.invoice_push_zatca') && !can('zoho.invoice_mark_sent') ? (
            <Btn size="sm" variant="accent" disabled={!selectedInvoices.size || !!invoiceOperation}
              icon={invoiceOperation === 'zatca' ? <Spinner size={12}/> : null}
              onClick={() => runInvoiceOperation('zatca')}>
              إرسال المحدد إلى زاتكا عبر زوهو
            </Btn>
          ) : null}
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
                  {referenceType && (can('zoho.configure') || (type === 'bank_accounts' && can('bank.view')))
                    ? <th style={{ padding: '10px 12px' }}>الإجراءات</th> : null}</tr>
                </thead>
                <tbody>
                  {displayed.map(r => {
                    const sourceType = type === 'bank_accounts' ? 'bank_account' : 'chart_account';
                    const treasuryAccount = isZohoTreasuryAccount(r);
                    const derivedKind = financialDisplayKind(r);
                    const accountTypeKey = String(r.account_type || r.account_type_formatted || '').toLowerCase().replace(/[\s-]+/g, '_');
                    const liveBankAccount = type === 'bank_accounts' && accountTypeKey === 'bank'
                      && !treasuryAccount && !isZohoPaymentGatewayAccount(r);
                    const linkableRow = (type === 'bank_accounts' && !['payment_gateway', 'clearing'].includes(derivedKind))
                      || (type === 'chart_accounts' && ['bank', 'cash'].includes(accountTypeKey));
                    const existingLink = referenceType
                      ? (financial?.links || []).find(l => l.source_type === sourceType && String(l.zoho_account_id) === String(r.zoho_id)) || null
                      : null;
                    const linkedCarrier = existingLink?.carrier_id
                      ? (financial?.carriers || []).find(c => String(c.id) === String(existingLink.carrier_id))?.name
                      : null;
                    const linkDescription = existingLink?.internal_bank_name
                      ? `مربوط مع ${existingLink.internal_bank_name}`
                      : linkedCarrier ? `مربوط مع ${linkedCarrier}`
                      : existingLink?.link_kind === 'cash' ? 'مصنّف صندوق/نقد'
                      : existingLink ? 'التصنيف محفوظ' : null;
                    return (
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
                                   : kind === 'money-gap' ? (Math.abs(Number(r[key])) > 0.5 ? 'var(--gold)' : 'var(--green)')
                                   : 'var(--text)',
                            } : {}),
                            ...(key === 'description' || key === 'notes' ? { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
                          }}>
                          {key === 'account_name' && r.account_name_ar && !isArabic(r.account_name) ? (
                            <div><b>{r.account_name_ar}</b><div dir="ltr" style={{ color: 'var(--muted2)', fontSize: 10, marginTop: 3 }}>{r.account_name}</div></div>
                          ) : key === 'account_type_formatted' ? accountTypeAr(r.account_type || r[key])
                          : kind === 'display-kind' ? financialKindAr(derivedKind)
                          : kind === 'internal-balance' && treasuryAccount ? (
                            <div><b style={{ color: 'var(--muted)' }}>لا ينطبق على الخزينة</b><div style={{ color: 'var(--muted2)', fontSize: 10, marginTop: 3 }}>هذا رصيد دفتري وليس كشف بنك</div></div>
                          ) : kind === 'money-gap' && treasuryAccount ? (
                            <span style={{ color: 'var(--muted2)' }}>لا ينطبق</span>
                          ) : kind === 'internal-balance' ? (
                            r[key] == null ? (
                              <div><b style={{ color: 'var(--muted2)' }}>غير مسجل</b><div style={{ color: 'var(--muted)', fontSize: 10, marginTop: 3 }}>ارفع كشف البنك أو سجّل رصيده</div></div>
                            ) : (
                              <div style={{ whiteSpace: 'nowrap' }}>
                                <b style={{ fontFamily: 'var(--font-mono)' }}>{fmt(r[key])}</b>
                                <div style={{ color: 'var(--muted)', fontSize: 10, marginTop: 3 }}>
                                  {r.internal_source === 'statement' ? 'من كشف البنك' : 'رصيد مدخل يدويًا'}
                                  {r.internal_as_of ? ` · حتى ${String(r.internal_as_of).slice(0, 10)}` : ''}
                                </div>
                              </div>
                            )
                          ) : kind?.startsWith('money') ? (r[key] == null ? '—' : fmt(r[key]))
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
                      {referenceType && (can('zoho.configure') || (liveBankAccount && can('bank.view'))) ? (
                        <td data-label="الإجراءات" style={{ padding: '9px 12px' }}>
                          {linkableRow && can('zoho.configure') ? <>
                            {linkDescription ? <div className="zoho-link-status"><Link2 size={12}/>{linkDescription}</div> : null}
                            <Btn size="sm" variant="ghost" icon={<Link2 size={13}/>} onClick={() => setMapTarget({
                              row: r,
                              sourceType,
                              existing: existingLink,
                            })}>{treasuryAccount ? (existingLink ? 'تعديل تصنيف الخزينة' : 'تصنيف الخزينة') : existingLink ? 'تعديل التصنيف' : type === 'bank_accounts' ? 'ربط الحساب ببنك داخلي' : 'تصنيف الحساب المالي'}</Btn>
                            {type === 'bank_accounts' && !treasuryAccount && existingLink?.link_kind === 'bank' && can('zoho.bank_import') ? (
                              <Btn size="sm" variant="accent" icon={<Download size={13}/>} onClick={() => openBankMissingExport(r)}>
                                فحص الفرق مع زوهو
                              </Btn>
                            ) : null}
                          </> : !liveBankAccount ? <span style={{ color: 'var(--muted2)', fontSize: 10.5 }}>
                            {derivedKind === 'payment_gateway' ? 'بوابة دفع — لا تُربط كبنك'
                              : derivedKind === 'clearing' ? 'حساب تسوية — لا يُربط كبنك'
                              : 'لا يحتاج ربطًا بنكيًا'}
                          </span> : null}
                          {liveBankAccount && can('bank.view') ? (
                            <Btn size="sm" variant={Number(r.uncategorized_count) ? 'accent' : 'ghost'}
                              icon={<Landmark size={13}/>} onClick={() => openBankReview(r)}>
                              غير المراجعة ({Number(r.uncategorized_count || 0).toLocaleString('en-US')})
                            </Btn>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
            <ProgressiveListFooter hasMore={hasMoreDisplayed} shown={displayedCount} total={displayedTotal} onLoadMore={loadMoreDisplayed} sentinelRef={displayedSentinelRef}/>
          </Card>
        )}

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>
        الكتابة محصورة في الإجراءات الظاهرة: دورة الفاتورة وإرسال زاتكا والمطابقة المؤكدة. كشوف البنوك تُفحص وتُصدّر فقط، ولا يرحّلها النظام إلى زوهو.
      </div>
      </> : null}

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
      <BankMissingExportModal state={bankMissing} onClose={() => setBankMissing(null)} onDownload={async () => {
        const rows = bankMissing?.preview?.transactions || [];
        if (!rows.length) return;
        setBankMissing(current => ({ ...current, busy: true }));
        try {
          const bankName = bankMissing.row.account_name || bankMissing.preview.bank || 'Bank';
          const fileName = `Zoho_Missing_${safeBankFilePart(bankName)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
          let recorded = null;
          try {
            recorded = await recordZohoBankExport({
              accountId: bankMissing.row.zoho_id,
              transactionIds: rows.map(row => row.id),
              fileName,
            });
          } catch (recordError) {
            const message = String(recordError?.message || recordError);
            if (!/unknown_action|zoho_bank_export_(?:batches|items)|schema cache/i.test(message)) throw recordError;
          }
          await persistAndDownloadExport({
            wb: createMissingBankWorkbook(rows), fileName, kind: 'zoho_bank_missing',
            rowCount: rows.length, userId: user?.id || null,
          });
          const preview = await previewZohoBankMissing(bankMissing.row.zoho_id);
          setBankMissing(current => ({ ...current, busy: false, preview,
            exportedBatch: recorded?.batch || preview?.latest_export || null }));
          toast(`نُزّل ملف نظيف يضم ${rows.length} عملية ناقصة — لم يُرسل شيء إلى زوهو`, 'success');
        } catch (e) {
          setBankMissing(current => ({ ...current, busy: false }));
          toast(`تعذّر تنزيل الملف: ${e.message}`, 'error');
        }
      }} onVerify={async () => {
        const batch = bankMissing?.preview?.latest_export || bankMissing?.exportedBatch;
        if (!batch?.id) return;
        setBankMissing(current => ({ ...current, busy: true }));
        try {
          const result = await verifyZohoBankExport({
            accountId: bankMissing.row.zoho_id,
            batchId: batch.id,
          });
          const preview = await previewZohoBankMissing(bankMissing.row.zoho_id);
          setBankMissing(current => ({ ...current, busy: false, preview,
            exportedBatch: result?.batch || preview?.latest_export || null }));
          const verified = Number(result?.batch?.seen_count || 0);
          const missing = Number(result?.batch?.missing_count || 0);
          const duplicates = Number(result?.batch?.duplicate_count || 0);
          toast(missing || duplicates
            ? `تحقق زوهو: ظهر ${verified}، مفقود ${missing}، يحتاج مراجعة ${duplicates}`
            : `تم التحقق: ظهرت كل العمليات (${verified}) في زوهو ✓`, missing || duplicates ? 'warning' : 'success');
        } catch (e) {
          setBankMissing(current => ({ ...current, busy: false }));
          toast(`تعذّر التحقق من زوهو: ${e.message}`, 'error');
        }
      }}/>
      <BankUnreviewedModal
        state={bankReview}
        accounts={zohoBankAccounts}
        canMatch={can('zoho.bank_match')}
        onClose={() => setBankReview(null)}
        onSelect={openBankReview}
        onMatched={async (row) => {
          await loadFinancial();
          await openBankReview(row);
        }}
      />
      <OperationResultModal result={operationResult} onClose={() => setOperationResult(null)}/>
    </div>
  );
}

function BankUnreviewedModal({ state, accounts, canMatch, onClose, onSelect, onMatched }) {
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [match, setMatch] = useState(null);
  useEffect(() => { setQ(''); setDirection(''); setMatch(null); }, [state?.row?.zoho_id]);
  if (!state) return null;
  const data = state.data;
  const rows = (data?.transactions || []).filter(row => {
    if (direction && row.direction !== direction) return false;
    const needle = q.trim().toLowerCase();
    return !needle || [row.reference, row.description, row.payee, row.date, row.amount]
      .some(value => String(value ?? '').toLowerCase().includes(needle));
  });
  const findMatches = async (transaction) => {
    if (match?.busy) return;
    setMatch({ source: transaction, busy: true, candidates: [], confirm: null });
    try {
      const result = await getZohoBankMatchCandidates(state.row.zoho_id, transaction.transaction_id);
      setMatch({ source: transaction, busy: false, candidates: result.candidates || [], confirm: null });
    } catch (e) {
      const denied = /access denied|zoho_refresh_failed/i.test(String(e?.message || ''));
      setMatch({
        source: transaction,
        busy: false,
        candidates: [],
        confirm: null,
        error: denied
          ? 'تعذّر الوصول إلى Zoho. أعد تفويض صلاحيات زوهو ثم حاول مجددًا.'
          : `تعذّر البحث عن مطابقة: ${e?.message || 'خطأ غير معروف'}`,
      });
    }
  };
  const approve = async () => {
    if (!match?.confirm) return;
    setMatch(current => ({ ...current, busy: true }));
    try {
      await approveZohoBankMatch({
        accountId: state.row.zoho_id,
        transactionId: match.source.transaction_id,
        matchTransactionId: match.confirm.transaction_id,
        matchTransactionType: match.confirm.transaction_type,
      });
      toast('اعتمدت المطابقة في زوهو ✓', 'success');
      setMatch(null);
      await onMatched(state.row);
    } catch (e) {
      setMatch(current => ({ ...current, busy: false }));
      toast(`تعذّر اعتماد المطابقة: ${e.message}`, 'error');
    }
  };
  return <Modal open title="مراجعة عمليات البنوك في زوهو" onClose={onClose} width={900} className="zoho-bank-review-modal" bodyClassName="zoho-bank-review-body">
    <div className="zoho-bank-review">
      <div className="zoho-bank-review-note">
        تعرض العمليات غير المراجعة داخل زوهو لكل بنك حقيقي. الاقتراح لا يغيّر شيئًا؛ الكتابة لا تتم إلا بعد اختيار المعاملة المقابلة ثم تأكيد المطابقة.
      </div>
      <label className="zoho-bank-review-field">
        البنك
        <select value={state.row.zoho_id} onChange={event => {
          const row = accounts.find(account => String(account.zoho_id) === event.target.value);
          if (row) onSelect(row);
        }}>
          {accounts.map(account => <option key={account.zoho_id} value={account.zoho_id}>
            {account.account_name} — {Number(account.uncategorized_count || 0).toLocaleString('en-US')} غير مراجعة
          </option>)}
        </select>
      </label>
      {state.busy && !data ? <div style={{ padding: 34, textAlign: 'center' }}><Spinner size={24}/></div> : <>
        <div className="zoho-bank-review-stats">
          <MiniValue label="غير مراجعة حيًا" value={data?.count || 0}/>
          <MiniValue label="إيداعات" value={`${fmt(data?.deposits || 0)} ر.س`}/>
          <MiniValue label="سحوبات" value={`${fmt(data?.withdrawals || 0)} ر.س`}/>
          <MiniValue label="آخر جلب" value={data?.fetched_at ? agoAr(data.fetched_at) : '—'}/>
        </div>
        {data && Number(data.account?.mirror_count || 0) !== Number(data.count || 0) ? (
          <div style={{ color: 'var(--gold)', fontSize: 11.5 }}>
            عدّاد آخر مزامنة: {Number(data.account?.mirror_count || 0)} · القراءة الحية الآن: {Number(data.count || 0)}. يعتمد القرار على القراءة الحية.
          </div>
        ) : null}
        <div className="zoho-bank-review-filters">
          <input value={q} onChange={event => setQ(event.target.value)} placeholder="ابحث بالمرجع أو الوصف أو المستفيد…"
            aria-label="البحث في عمليات البنك"/>
          <select value={direction} onChange={event => setDirection(event.target.value)} aria-label="تصفية حسب اتجاه العملية">
            <option value="">إيداعات وسحوبات</option><option value="credit">إيداعات</option><option value="debit">سحوبات</option>
          </select>
        </div>
        {rows.length ? <div className="zoho-bank-review-list" role="list" aria-label="عمليات البنك غير المراجعة">
          {rows.map(transaction => {
            const isCurrent = match?.source?.transaction_id === transaction.transaction_id;
            const isSearching = isCurrent && match?.busy;
            return <article className={`zoho-bank-transaction ${isCurrent ? 'is-current' : ''}`} key={transaction.transaction_id} role="listitem">
              <div className="zoho-bank-transaction-main">
                <div className="zoho-bank-transaction-heading">
                  <b dir="ltr">{transaction.reference || 'بلا مرجع'}</b>
                  <time dateTime={transaction.date || undefined}>{transaction.date || 'بلا تاريخ'}</time>
                </div>
                <p>{transaction.description || transaction.payee || 'عملية بنكية'}</p>
              </div>
              <div className="zoho-bank-transaction-meta">
                <span className={`zoho-bank-direction ${transaction.direction === 'credit' ? 'is-credit' : 'is-debit'}`}>
                  {transaction.direction === 'credit' ? 'إيداع' : 'سحب'}
                </span>
                <strong dir="ltr">{fmt(transaction.amount)} <small>ر.س</small></strong>
                <Btn size="sm" variant="ghost" disabled={!!match?.busy} onClick={() => findMatches(transaction)}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  {isSearching ? 'جارٍ البحث…' : 'البحث عن مطابقة'}
                </Btn>
              </div>
            </article>;
          })}
        </div> : <Empty icon="✓" title="لا توجد عمليات غير مراجعة" sub={q || direction ? 'لا توجد نتائج تطابق الفلتر' : 'كل عمليات هذا البنك مراجعة في زوهو'}/>}
      </>}
      {match ? <div className={`zoho-bank-match-panel ${match.error ? 'is-error' : ''}`} aria-live="polite">
        <div style={{ fontWeight: 800, marginBottom: 8 }}>اقتراحات مطابقة العملية {match.source.reference || match.source.transaction_id}</div>
        {match.error ? <div className="zoho-bank-match-error">
            <AlertTriangle size={18}/><span>{match.error}</span>
            <Btn size="sm" variant="ghost" onClick={() => findMatches(match.source)}>إعادة المحاولة</Btn>
          </div>
          : match.busy && !match.confirm ? <div style={{ padding: 18, textAlign: 'center' }}><Spinner size={20}/></div>
          : !match.candidates.length ? <div style={{ color: 'var(--gold)', fontSize: 12 }}>لم يجد زوهو معاملة محاسبية مقابلة. لا يوجد تصنيف تلقائي؛ راجع العملية يدويًا.</div>
          : <div style={{ display: 'grid', gap: 7 }}>{match.candidates.map(candidate => <button type="button" key={`${candidate.transaction_type}:${candidate.transaction_id}`}
              onClick={() => setMatch(current => ({ ...current, confirm: candidate }))}
              style={{ textAlign: 'right', padding: 10, borderRadius: 9, border: `1px solid ${match.confirm?.transaction_id === candidate.transaction_id ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--surface)', cursor: 'pointer' }}>
              <b>{candidate.party || candidate.description || candidate.transaction_type}</b>
              <span style={{ display: 'block', color: 'var(--muted)', fontSize: 11, marginTop: 3 }}>{candidate.date || 'بلا تاريخ'} · {candidate.reference || candidate.transaction_type} · {fmt(candidate.amount)} ر.س</span>
            </button>)}</div>}
        {match.confirm ? <div style={{ marginTop: 10, padding: 10, borderRadius: 9, border: '1px solid var(--gold)', color: 'var(--text)', fontSize: 12, lineHeight: 1.7 }}>
          ستُربط عملية البنك بمبلغ <b>{fmt(match.source.amount)} ر.س</b> مع <b>{match.confirm.party || match.confirm.reference || match.confirm.transaction_type}</b> داخل زوهو. هذا يغيّر حالة المطابقة ولا ينشئ فاتورة.
          <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
            <Btn variant="ghost" onClick={() => setMatch(current => ({ ...current, confirm: null }))} disabled={match.busy}>تغيير الاختيار</Btn>
            {canMatch ? <Btn variant="accent" onClick={approve} disabled={match.busy} icon={match.busy ? <Spinner size={13}/> : <ShieldCheck size={13}/>}>تأكيد المطابقة في زوهو</Btn>
              : <span style={{ color: 'var(--gold)' }}>تحتاج صلاحية «اعتماد مطابقة عمليات البنك في زوهو».</span>}
          </div>
        </div> : null}
      </div> : null}
      <div className="zoho-bank-review-footer"><Btn variant="ghost" onClick={onClose}>إغلاق</Btn></div>
    </div>
  </Modal>;
}

function BankMissingExportModal({ state, onClose, onDownload, onVerify }) {
  if (!state) return null;
  const p = state.preview;
  const liveAnchor = p?.zoho_anchor;
  const latestExport = p?.latest_export || state.exportedBatch || null;
  const batchStatus = {
    exported: 'تم تنزيل الملف — بانتظار رفعه في زوهو',
    verified: 'تم التحقق — كل العمليات ظهرت في زوهو',
    partial: 'تحقق جزئي — بقيت عمليات تحتاج مراجعة',
    needs_review: 'لم تظهر عمليات الدفعة بعد في زوهو',
    failed: 'فشل التحقق من الدفعة',
  }[latestExport?.status] || '';
  return (
    <Modal open title={`مزامنة كشف البنك مع Zoho — ${state.row.account_name || ''}`} onClose={onClose}>
      {state.busy && !p ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner size={22}/></div> : <>
        <div className="zoho-bank-export-steps" aria-label="خطوات مزامنة كشف البنك">
          <div className="is-done"><b>1</b><span>فحص الفرق</span></div>
          <div className={latestExport ? 'is-done' : ''}><b>2</b><span>تنزيل الناقص ورفعه</span></div>
          <div className={latestExport?.status === 'verified' ? 'is-done' : ''}><b>3</b><span>التحقق بعد الرفع</span></div>
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: 'var(--surface2)', color: 'var(--muted)', fontSize: 12, marginBottom: 12, lineHeight: 1.7 }}>
          فحص قراءة فقط: يقارن النظام <b>كل العمليات المحلية ضمن الفترة المحفوظة</b> بما هو موجود فعليًا في Zoho، بما فيها الفجوات التاريخية، ثم يجهز Excel بالناقص فقط. لن يرسل أو يعدّل أي عملية في Zoho.
        </div>
        {!p?.zoho_anchor ? (
          <div style={{ padding: '9px 11px', borderRadius: 9, marginBottom: 12, color: 'var(--gold)',
            background: 'color-mix(in srgb, var(--gold) 8%, transparent)', fontSize: 11.5 }}>
            لم نجد عملية بنكية في Zoho ضمن فترة السجل المحلي. ستظهر كل العمليات المحلية كناقصة إلى أن ترفعها يدويًا وتعيد التحقق.
          </div>
        ) : null}
        {liveAnchor ? (
          <div style={{ padding: '11px 12px', borderRadius: 10, marginBottom: 12,
            border: '1px solid color-mix(in srgb, var(--green) 32%, var(--border))',
            background: 'color-mix(in srgb, var(--green) 7%, var(--surface))', fontSize: 12, lineHeight: 1.75 }}>
            <b style={{ display: 'block', color: 'var(--green)', marginBottom: 3 }}>أحدث عملية مقروءة من Zoho — للمعلومية فقط</b>
            <span dir="ltr" style={{ fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{liveAnchor.reference || liveAnchor.transaction_id || 'بلا مرجع'}</span>
            <span style={{ color: 'var(--muted)' }}> · {liveAnchor.date || 'بلا تاريخ'}</span>
            <span style={{ display: 'block', color: 'var(--muted)', marginTop: 3 }}>
              هذه ليست نقطة بداية ولا تستبعد ما قبلها. فُحصت كل العمليات المحلية من {p?.local_period_from || 'بداية السجل'} إلى {p?.local_period_to || 'نهايته'}: محليًا {p?.local_scanned || 0}، وفي Zoho {p?.zoho_checked_count || 0}.
            </span>
            {p?.manual_anchor_ignored ? <span style={{ display: 'block', color: 'var(--gold)', marginTop: 3 }}>
              تم تجاهل نقطة البداية اليدوية القديمة؛ المطابقة تعتمد بيانات Zoho الحية وكامل الفترة المحلية.
            </span> : null}
          </div>
        ) : null}
        {p?.count ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginBottom: 12 }}>
          <MiniValue label="عمليات ناقصة" value={p?.count || 0}/><MiniValue label="إيداعات" value={`${fmt(p?.deposits || 0)} ر.س`}/><MiniValue label="سحوبات" value={`${fmt(p?.withdrawals || 0)} ر.س`}/>
        </div> : null}
        {latestExport ? <div className={`zoho-bank-export-batch status-${latestExport.status || 'exported'}`}>
          <div><b>{batchStatus}</b><span>{latestExport.file_name}</span></div>
          <div className="zoho-bank-export-counts">
            <span>الدفعة {latestExport.row_count || 0}</span>
            <span>ظهر {latestExport.seen_count || 0}</span>
            <span>مفقود {latestExport.missing_count || 0}</span>
            <span>مكرر {latestExport.duplicate_count || 0}</span>
          </div>
        </div> : null}
        {p?.count ? <div className="m-flow" style={{ maxHeight: 330, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
          <table className="m-cards" style={{ width: '100%', fontSize: 11.5 }}>
            <thead><tr><th style={{ padding: 8 }}>التاريخ</th><th style={{ padding: 8 }}>المرجع والوصف</th><th style={{ padding: 8 }}>الاتجاه</th><th style={{ padding: 8 }}>المبلغ</th></tr></thead>
            <tbody>{(p?.transactions || []).map(t => {
              const incoming = Number(t.credit) > 0;
              return <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td data-label="التاريخ" style={{ padding: 8, whiteSpace: 'nowrap' }}>{t.date}</td>
                <td data-label="" style={{ padding: 8, minWidth: 0 }}>
                  <b dir="ltr" style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10.5, overflowWrap: 'anywhere' }}>{t.reference || 'بلا مرجع'}</b>
                  <span style={{ display: 'block', color: 'var(--muted)', marginTop: 4, lineHeight: 1.55 }}>{t.description || 'عملية بنكية'}</span>
                </td>
                <td data-label="الاتجاه" style={{ padding: 8, color: incoming ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{incoming ? 'إيداع' : 'سحب'}</td>
                <td data-label="المبلغ" style={{ padding: 8, fontFamily: 'var(--font-mono)', fontWeight: 800, whiteSpace: 'nowrap' }}>{fmt(incoming ? t.credit : t.debit)} ر.س</td>
              </tr>;
            })}</tbody>
          </table>
        </div> : null}
        {!p?.count && !p?.anchor_required ? <div style={{ textAlign: 'center', color: 'var(--green)', fontWeight: 800, fontSize: 14, padding: '26px 14px' }}>كل العمليات المقروءة موجودة في Zoho — لا يوجد ملف للتنزيل ✓</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <Btn variant="ghost" onClick={onClose}>إغلاق</Btn>
          {latestExport && latestExport.status !== 'verified' ? <Btn variant="ghost" disabled={state.busy}
            icon={state.busy ? <Spinner size={13}/> : <Landmark size={13}/>} onClick={onVerify}>تحقق بعد الرفع في زوهو</Btn> : null}
          {p?.count ? <Btn variant="accent" disabled={state.busy} icon={state.busy ? <Spinner size={13}/> : <Download size={13}/>} onClick={onDownload}>تنزيل Excel للرفع إلى Zoho ({p.count})</Btn> : null}
        </div>
      </>}
    </Modal>
  );
}

function OperationResultModal({ result, onClose }) {
  if (!result) return null;
  const outcomeAr = { succeeded: 'نجحت', failed: 'فشلت', skipped: 'تم تجاوزها', excluded: 'مستبعدة' };
  const stageAr = { read: 'قراءة الفاتورة', live_check: 'الفحص الحي من زوهو', mark_sent: 'التحويل إلى مرسلة',
    post_sent_check: 'التحقق بعد التحويل', readiness: 'فحص جاهزية زاتكا', zatca_push: 'الإرسال إلى زاتكا' };
  const title = result.kind === 'sent' ? 'نتيجة تحويل المسودات'
    : result.kind === 'finalize' ? 'نتيجة الاعتماد والإرسال إلى زاتكا'
      : result.kind === 'zatca' ? 'نتيجة إرسال زاتكا' : 'نتيجة استيراد البنك';
  return <Modal open title={title} onClose={onClose}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
      <MiniValue label="نجح" value={result.succeeded ?? result.count ?? 0}/><MiniValue label="تجاوز" value={result.skipped || 0}/><MiniValue label="فشل" value={result.failed || 0}/>
    </div>
    {(result.results || []).map((r, i) => <div key={`${r.invoice_id || i}`} style={{ padding: 9, borderTop: '1px solid var(--border)', fontSize: 12 }}>
      <b>{r.number || r.invoice_id}</b> — <span style={{ color: r.outcome === 'failed' ? 'var(--red)' : r.outcome === 'succeeded' ? 'var(--green)' : 'var(--gold)' }}>{outcomeAr[r.outcome] || r.outcome}</span>
      {r.stage ? <div style={{ color: 'var(--muted)', marginTop: 3 }}>المرحلة: {stageAr[r.stage] || r.stage}</div> : null}
      {r.marked_sent ? <div style={{ color: 'var(--green)', marginTop: 3 }}>حُوّلت من مسودة إلى مرسلة ✓</div> : null}
      {r.pushed ? <div style={{ color: 'var(--green)', marginTop: 3 }}>أُرسلت إلى زاتكا عبر زوهو ✓</div> : null}
      {r.warning ? <div style={{ color: 'var(--gold)', marginTop: 3 }}>تم الإرسال إلى زاتكا، وتنبيه حالة المستند: {r.warning}</div> : null}
      {r.retryable ? <div style={{ color: 'var(--gold)', marginTop: 3 }}>العطل مؤقت في بوابة زوهو؛ بقيت الفاتورة معلقة ويمكن إعادة المحاولة بأمان.</div> : null}
      {r.reason === 'already_pushed' ? <div style={{ color: 'var(--muted)', marginTop: 3 }}>مرسلة إلى زاتكا مسبقًا — لم تُكرر</div> : null}
      {r.reason === 'opening_balance' ? <div style={{ color: 'var(--gold)', marginTop: 3 }}>رصيد افتتاحي — مستبعد من زاتكا</div> : null}
      {r.error ? <div style={{ color: 'var(--red)', marginTop: 3 }}>{r.error}</div> : null}
    </div>)}
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}><Btn variant="ghost" onClick={onClose}>إغلاق النتيجة</Btn></div>
  </Modal>;
}

function MiniValue({ label, value }) {
  return <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface2)' }}><div style={{ color: 'var(--muted)', fontSize: 10 }}>{label}</div><div style={{ fontWeight: 800, marginTop: 3 }}>{value}</div></div>;
}

function FinancialControlPanel({ data, canManageConnection, onReauthorize, onOpenAccount, onOpenVendors }) {
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
  const explicitBankCount = Array.isArray(data.internal_banks) ? data.internal_banks.length : 0;
  const expectedBankCount = Math.max(explicitBankCount, Number(bank.linked_bank_count || 0));
  const missingBanks = Math.max(0, expectedBankCount - Number(bank.linked_bank_count || 0));
  const linkedBankRows = (data.banks || []).filter(row => financialDisplayKind(row) === 'bank');
  const missingClosingBalances = linkedBankRows.filter(row => row.internal_balance == null);
  const linkedClosingComplete = linkedBankRows.length > 0 && missingClosingBalances.length === 0;
  const safeInternalBalance = linkedClosingComplete
    ? linkedBankRows.reduce((sum, row) => sum + Number(row.internal_balance || 0), 0)
    : null;
  const safeInternalVsBook = linkedClosingComplete
    ? linkedBankRows.reduce((sum, row) => sum + Number(row.internal_vs_book || 0), 0)
    : null;
  const vendorKpis = [
    { label: 'فواتير موردين مفتوحة', value: `${fmt(bills.open_balance)} ر.س`, sub: `${Number(bills.open_count || 0)} فاتورة · ${Number(bills.overdue_count || 0)} متأخرة بقيمة ${fmt(bills.overdue_balance)}`, tone: 'var(--red)' },
    { label: 'إجمالي ذمم الموردين', value: `${fmt(vendor.outstanding_payable)} ر.س`, sub: `${Number(vendor.payable_vendors || 0)} مورّد له رصيد إجمالي`, tone: 'var(--gold)' },
    { label: 'رصيد لنا لدى الموردين', value: `${fmt(vendor.unused_credits)} ر.س`, sub: `${Number(vendor.credit_vendors || 0)} مورّد · سلف ودفعات زائدة وأرصدة`, tone: 'var(--green)' },
    { label: 'صافي المطلوب دفعه', value: `${fmt(vendor.net_payable)} ر.س`, sub: `بعد طرح ما لنا من إجمالي ما علينا · ${Number(vendor.vendors || 0)} مورّد`, tone: Number(vendor.net_payable) > 0.5 ? 'var(--gold)' : 'var(--green)' },
  ];
  const bankKpis = [
    { label: 'حسابات مالية في زوهو', value: Number(bank.count || 0).toLocaleString('en-US'), sub: `${Number(bank.operating_treasury_count || 0)} منها خزائن تشغيلية داخلية`, tone: 'var(--accent)' },
    { label: 'البنوك المربوطة فعلياً', value: `${Number(bank.linked_bank_count || 0)}/${expectedBankCount}`, sub: Number(bank.linked_bank_count || 0) < expectedBankCount ? 'الناقص يظهر كحساب غير مربوط — بلا تخمين' : 'اكتملت البنوك التشغيلية', tone: Number(bank.linked_bank_count || 0) < expectedBankCount ? 'var(--gold)' : 'var(--green)' },
    { label: 'الرصيد الدفتري لكل الحسابات', value: `${fmt(bank.book_balance)} ر.س`, sub: 'يشمل البنوك والخزائن وبوابات الدفع', tone: 'var(--green)' },
    { label: 'أحدث أرصدة ختامية مربوطة', value: safeInternalBalance == null ? 'غير مكتملة' : `${fmt(safeInternalBalance)} ر.س`, sub: safeInternalBalance == null ? `ناقص رصيد ختامي صالح: ${missingClosingBalances.map(row => row.internal_bank_name || row.account_name).join('، ') || 'ارفع كشف البنك أو سجّل الرصيد'}` : `الفرق عن دفتر زوهو ${fmt(safeInternalVsBook)} ر.س`, tone: safeInternalBalance == null ? 'var(--red)' : Math.abs(Number(safeInternalVsBook)) > 0.5 ? 'var(--gold)' : 'var(--green)' },
  ];
  const vendorTone = (n) => Number(n) > 0.5 ? 'var(--gold)' : Number(n) < -0.5 ? 'var(--green)' : 'var(--muted)';
  const bankKind = (b) => financialKindAr(financialDisplayKind(b));
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
          {(needsAuth || unknown) && canManageConnection ? (
            <Btn size="sm" variant="accent" icon={<ShieldCheck size={14}/>} onClick={onReauthorize}>
              إعادة تفويض صلاحيات زوهو
            </Btn>
          ) : null}
        </div>
      </div>

      {needsAuth ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 9, marginBottom: 12,
          color: 'var(--gold)', background: 'color-mix(in srgb, var(--gold) 9%, transparent)', fontSize: 11.5 }}>
          <AlertTriangle size={15}/><span>ربط زوهو يعمل للفواتير، لكن قراءة البنوك غير مفعّلة. اختر «إعادة تفويض صلاحيات زوهو»؛ سيفتح Zoho للموافقة ثم يعيدك إلى هذه الصفحة.</span>
        </div>
      ) : null}

      {missingBanks > 0 ? (
        <div className="zoho-link-alert">
          <div>
            <strong>بقي ربط {missingBanks} {missingBanks === 1 ? 'حساب بنكي' : 'حسابات بنكية'}</strong>
            <span>حدّد البنك الداخلي المقابل لكل حساب لمنع المطابقة الخاطئة.</span>
          </div>
          <Btn size="sm" variant="accent" icon={<Link2 size={14}/>} onClick={onOpenAccount}>
            أكمل ربط الحسابات
          </Btn>
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
            <tbody>{positions.slice(0, 5).map(v => {
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
      {positions.length > 5 ? (
        <button type="button" className="zoho-overview-link" onClick={onOpenVendors}>عرض جميع الموردين والفواتير ←</button>
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
              <th style={{ padding: '8px 10px' }}>رصيد زوهو</th>
              <th style={{ padding: '8px 10px' }}>الرصيد الختامي للبنك</th>
              <th style={{ padding: '8px 10px' }}>الفرق</th>
              <th style={{ padding: '8px 10px' }}>غير مصنّفة</th>
              <th style={{ padding: '8px 10px' }}>الحالة</th>
            </tr></thead>
            <tbody>{data.banks.filter(b => b.internal_bank_name || b.display_kind === 'unclassified').slice(0, 5).map(b => {
              const linked = !!b.internal_bank_name;
              const mismatch = b.internal_vs_book != null && Math.abs(Number(b.internal_vs_book)) > 0.5;
              return <tr key={b.zoho_id} style={{ borderTop: '1px solid var(--border)' }}>
                <td data-label="" style={{ padding: '8px 10px', fontWeight: 700 }}>{b.account_name}<div style={{ color: 'var(--muted2)', fontSize: 10 }}>{b.internal_bank_name || 'غير مربوط'}</div></td>
                <td data-label="التصنيف" style={{ padding: '8px 10px', color: b.display_kind === 'unclassified' ? 'var(--gold)' : 'var(--text)' }}>{bankKind(b)}</td>
                <td data-label="رصيد زوهو" style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>{fmt(b.book_balance)}</td>
                <td data-label="الرصيد الختامي للبنك" style={{ padding: '8px 10px' }}>
                  {b.internal_balance == null ? <span style={{ color: 'var(--muted2)' }}>غير مسجل</span> : <>
                    <b style={{ fontFamily: 'var(--font-mono)' }}>{fmt(b.internal_balance)}</b>
                    <div style={{ color: 'var(--muted2)', fontSize: 10, marginTop: 2 }}>
                      {b.internal_source === 'statement' ? 'من كشف البنك' : 'مدخل يدويًا'}{b.internal_as_of ? ` · ${String(b.internal_as_of).slice(0, 10)}` : ''}
                    </div>
                  </>}
                </td>
                <td data-label="الفرق" style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', color: mismatch ? 'var(--gold)' : b.internal_vs_book == null ? 'var(--muted2)' : 'var(--green)' }}>{b.internal_vs_book == null ? '—' : fmt(b.internal_vs_book)}</td>
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
        <button type="button" onClick={onOpenAccount} className="zoho-overview-link">
          عرض جميع الحسابات والبنوك ←
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
    setKind(existing.link_kind || (isZohoTreasuryAccount(target.row) ? 'cod_treasury' : target.sourceType === 'bank_account' ? 'bank' : 'cod_treasury'));
    setBankName(existing.internal_bank_name || '');
    setCarrierId(existing.carrier_id || '');
    setNotes(existing.notes || '');
  }, [target]);
  if (!target) return null;
  const treasuryAccount = isZohoTreasuryAccount(target.row);
  const isBank = target.sourceType === 'bank_account' && !treasuryAccount;
  const currentBankName = String(target.existing?.internal_bank_name || '').trim();
  const allInternalBanks = [...new Set([
    ...(Array.isArray(dashboard?.internal_banks) ? dashboard.internal_banks : []),
    currentBankName,
  ].map(name => String(name || '').trim()).filter(Boolean))];
  const usedByOtherAccount = new Set((dashboard?.links || [])
    .filter(link => link.link_kind === 'bank'
      && !(link.source_type === target.sourceType && String(link.zoho_account_id) === String(target.row.zoho_id)))
    .map(link => String(link.internal_bank_name || '').trim().toLocaleLowerCase('ar'))
    .filter(Boolean));
  const internalBanks = allInternalBanks.filter(name => !usedByOtherAccount.has(name.toLocaleLowerCase('ar')));
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
    <Modal title={`${treasuryAccount ? 'تصنيف خزينة زوهو' : 'ربط حساب زوهو'} — ${target.row.account_name}`} onClose={onClose} width={560}>
      <div className="m-flow" style={{ display: 'grid', gap: 14 }}>
        <div style={{ padding: 11, borderRadius: 9, background: 'var(--surface2)', color: 'var(--muted)', fontSize: 11.5 }}>
          الربط تسمية ومطابقة داخل لمحة فقط، ولا يعدّل الحساب أو رصيده داخل زوهو.
        </div>
        {!isBank ? (
          <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 700 }}>{treasuryAccount ? 'وظيفة الخزينة' : 'وظيفة الحساب'}
            <select value={kind} onChange={e => setKind(e.target.value)} style={fieldStyle}>
              <option value="cod_treasury">خزينة تحصيل لشركة شحن</option>
              <option value="cash">صندوق/نقد عام</option>
            </select>
          </label>
        ) : null}
        {kind === 'bank' ? (
          <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 700 }}>الحساب البنكي الداخلي
            <select value={bankName} onChange={e => setBankName(e.target.value)} style={fieldStyle} required>
              <option value="">اختر الحساب البنكي الداخلي…</option>
              {internalBanks.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <span style={{ color: 'var(--muted)', fontSize: 10.5, fontWeight: 500 }}>
              اختر البنك الداخلي الذي يقابل حساب زوهو «{target.row.account_name}». البنوك المرتبطة بحساب آخر لا تظهر هنا.
            </span>
            {!internalBanks.length ? (
              <span style={{ color: 'var(--red)', fontSize: 10.5 }}>لا توجد حسابات بنكية داخلية مسجلة بعد.</span>
            ) : null}
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
            <Btn variant="accent" disabled={saving || (kind === 'bank' && !internalBanks.length)} icon={saving ? <Spinner size={13}/> : <Link2 size={14}/>} onClick={save}>حفظ تصنيف الحساب</Btn>
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
  active: 'green', inactive: 'muted', categorized: 'green', uncategorized: 'gold',
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
