// تقارير زوهو الرسمية: الإقرار الضريبي (زاتكا) + قائمة الدخل.
//
// المصدر زوهو مباشرةً عبر الدالة الطرفية `zoho-reports` — لا المرايا
// المحلية: هي تحمل الإجمالي الشامل فقط بلا تفصيل ضريبي، وقسمة تقديرية
// ÷1.15 تُخرج إقراراً خاطئاً (الصفرية/المعفاة تُحسب غلطاً). زوهو هو مصدر
// الحقيقة الضريبية، وهو من يصنّف كل فاتورة على خانتها.
//
// ✅ مُتحقَّق حياً (2026-07-28): `reports/vatsummary` يُرجِع **نموذج الإقرار
// السعودي بخاناته المرقّمة** (1..16) بأوصافه العربية الرسمية:
//   output_boxes (المخرجات/المبيعات) · input_boxes (المدخلات/المشتريات)
//   net_vat_due_boxes (خانة 13 = صافي الضريبة المستحقة)
// المسارات الأخرى (salesbytax/purchasesbytax) غير متاحة في هذه المؤسسة،
// و`taxsummary` يرجع فارغاً — **لا تستبدل vatsummary بها**.

import { supabase } from './supabase.js';
import * as XLSX from 'xlsx';
import { rtl } from './xlsxRtl.js';
import { persistAndDownloadExport } from './internalExportsService.js';
import { reconcileVatReturn } from './vatReconciliation.js';

const FN = 'zoho-reports';

async function callFn(payload) {
  const { data, error } = await supabase.functions.invoke(FN, { body: payload });
  if (error) {
    // رسالة الدالة أوضح من نص الخطأ العام
    let detail = '';
    try { detail = (await error.context?.json?.())?.error || ''; } catch { /* تجاهل */ }
    throw new Error(detail || error.message || 'تعذّر الاتصال بزوهو');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const n = (v) => Number(v) || 0;

// ── الإقرار الضريبي ────────────────────────────────────────────────────
// يرجع { from, to, output[], input[], net[], totals } — الخانات كما يصنّفها
// زوهو حرفياً (لا نعيد تصنيفها: التصنيف الضريبي مسؤولية المحاسب/زوهو).
export async function loadVatReturn({ from, to }) {
  const d = await callFn({ action: 'tax_report', from, to });
  const vat = d?.reports?.['reports/vatsummary'];
  if (!vat?.ok) {
    const why = vat?.message || vat?.error || 'تقرير الضريبة غير متاح لهذه المؤسسة';
    throw new Error(`زوهو: ${why}`);
  }
  const s = vat.data?.vat_summary || {};
  const box = (b) => ({
    boxNo: b.box_no ?? '',
    label: b.description || '',
    amount: n(b.amount),
    tax: n(b.tax_amount),
    adjustment: n(b.adjustment_amount),
  });
  const output = (s.output_boxes || []).map(box);
  const input  = (s.input_boxes  || []).map(box);
  const net    = (s.net_vat_due_boxes || []).map(box);

  // الإجماليات المعلنة من زوهو (خانة 6 للمخرجات، 12 للمدخلات، 13 للصافي)
  const pick = (arr, no) => arr.find(b => String(b.boxNo) === no) || null;
  const totals = {
    outputAmount: pick(output, '6')?.amount ?? output.reduce((t, b) => t + b.amount, 0),
    outputTax:    pick(output, '6')?.tax    ?? output.reduce((t, b) => t + b.tax, 0),
    inputAmount:  pick(input, '12')?.amount ?? input.reduce((t, b) => t + b.amount, 0),
    inputTax:     pick(input, '12')?.tax    ?? input.reduce((t, b) => t + b.tax, 0),
    netDue:       pick(net, '13')?.tax ?? null,
  };
  const reconciliation = reconcileVatReturn({ output, input, net, totals });
  return {
    from,
    to,
    output: reconciliation.output,
    input: reconciliation.input,
    net: reconciliation.net,
    totals: {
      ...totals,
      filingOutputTax: reconciliation.filing.outputTax,
      filingInputTax: reconciliation.filing.inputTax,
      filingNetDue: reconciliation.filing.netDue,
    },
    reconciliation,
  };
}

// المخرج الرسمي = PDF بهوية لمحة (طلب المستخدم 2026-07-28). Excel يبقى
// متاحاً للمحاسب عبر `exportVatReturn` — لكن الافتراضي في الواجهة هو PDF.
// نُخزّن نسخة Excel في السجل أيضاً كي يبقى المستند قابلاً لإعادة التحميل
// (الـPDF يُنتَج من نافذة الطباعة فلا يمر بالتخزين).
export async function printVatReturnPdf({ from, to, userId, orgName }) {
  const r = await loadVatReturn({ from, to });
  const { printVatReturn } = await import('./officialPdf.js');
  printVatReturn(r, { orgName });
  // أرشفة صامتة — فشلها لا يمنع المستند
  exportVatReturn({ from, to, userId, preloaded: r, silent: true }).catch(() => {});
  return r;
}

export async function printPnlPdf({ from, to, orgName }) {
  const data = await loadPnlRange({ from, to });
  const { printPnl } = await import('./officialPdf.js');
  printPnl(data, { orgName });
  return data;
}

export async function exportVatReturn({ from, to, userId, preloaded }) {
  const r = preloaded || await loadVatReturn({ from, to });
  const rows = [
    ['الإقرار الضريبي (ضريبة القيمة المضافة)'],
    [`الفترة: من ${from} إلى ${to}`],
    ['المصدر: زوهو بوكس — مع مطابقة حسابية مستقلة للخانتين 1 و7 حسب احتساب زاتكا'],
    [`أُنشئ: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`],
    [],
    ['المخرجات — المبيعات'],
    ['الخانة', 'البيان', 'المبلغ (قبل الضريبة)', 'ضريبة زوهو', 'ضريبة الإيداع', 'الفرق', 'التعديلات'],
    ...r.output.map(b => [b.boxNo, b.label, b.amount, b.tax, b.filingTax, b.taxVariance, b.adjustment]),
    [],
    ['المدخلات — المشتريات'],
    ['الخانة', 'البيان', 'المبلغ (قبل الضريبة)', 'ضريبة زوهو', 'ضريبة الإيداع', 'الفرق', 'التعديلات'],
    ...r.input.map(b => [b.boxNo, b.label, b.amount, b.tax, b.filingTax, b.taxVariance, b.adjustment]),
    [],
    ['صافي الضريبة'],
    ['الخانة', 'البيان', '', 'زوهو', 'الإيداع', 'الفرق', ''],
    ...r.net.map(b => [b.boxNo, b.label, '', b.tax, b.filingTax, b.taxVariance, '']),
    [],
    ['الخلاصة'],
    ['ضريبة المخرجات', '', r.totals.outputAmount, r.totals.outputTax, r.totals.filingOutputTax, r.reconciliation.variance.outputTax, ''],
    ['ضريبة المدخلات', '', r.totals.inputAmount, r.totals.inputTax, r.totals.filingInputTax, r.reconciliation.variance.inputTax, ''],
    ['الصافي المستحق للهيئة', '', '', r.totals.netDue ?? (r.totals.outputTax - r.totals.inputTax), r.totals.filingNetDue, r.reconciliation.variance.netDue, ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 8 }, { wch: 52 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الإقرار الضريبي');
  await persistAndDownloadExport({
    wb: rtl(wb), fileName: `الإقرار_الضريبي_${from}_${to}.xlsx`, kind: 'vat_return',
    rowCount: r.output.length + r.input.length, total: r.totals.filingNetDue ?? 0, userId,
  });
  return r;
}

// ── قائمة الدخل (الأرباح والخسائر) لأي فترة ───────────────────────────
// نُبقي بنية زوهو كما هي (أقسام وحسابات) بدل إعادة تصنيفها — التقرير
// الرسمي يجب أن يطابق ما يراه المحاسب في زوهو حرفياً.
export async function loadPnlRange({ from, to }) {
  const d = await callFn({ action: 'pnl_range', from, to });
  return { from, to, sections: d?.profit_and_loss || [] };
}

export async function exportPnlRange({ from, to, userId }) {
  const { sections } = await loadPnlRange({ from, to });
  const rows = [
    ['قائمة الدخل (الأرباح والخسائر)'],
    [`الفترة: من ${from} إلى ${to}`],
    ['المصدر: زوهو بوكس — أساس الاستحقاق (accrual)'],
    [`أُنشئ: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`],
    [],
    ['البند', 'المبلغ'],
  ];
  let grandNet = null;
  const walk = (secs, depth) => {
    for (const s of secs || []) {
      const name = s.name || s.total_label || '';
      const total = Number(s.total);
      if (name) rows.push([`${'    '.repeat(depth)}${name}`, Number.isFinite(total) ? total : '']);
      if (/صافي/.test(name) && Number.isFinite(total) && grandNet == null) grandNet = total;
      if (s.account_transactions?.length) walk(s.account_transactions, depth + 1);
    }
  };
  walk(sections, 0);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 52 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'قائمة الدخل');
  await persistAndDownloadExport({
    wb: rtl(wb), fileName: `قائمة_الدخل_${from}_${to}.xlsx`, kind: 'pnl_statement',
    rowCount: rows.length - 6, total: grandNet ?? 0, userId,
  });
  return { rowCount: rows.length - 6, net: grandNet };
}

const FINANCIAL_REPORT_LABELS = {
  balance_sheet: 'الميزانية العمومية', cash_flow: 'التدفق النقدي',
  trial_balance: 'ميزان المراجعة', general_ledger: 'دفتر الأستاذ العام',
};

// يحافظ على بنية Zoho كما أعادها، ويحوّلها إلى ورقة مراجعة قابلة للبحث دون
// إعادة تصنيف محاسبي محلي. المسار الخام يبقى في العمود الأول للتدقيق.
export async function exportZohoFinancialReport({ report, from, to, userId }) {
  const d = await callFn({ action: 'financial_report', report, from, to });
  const label = FINANCIAL_REPORT_LABELS[report] || report;
  const rows = [[label], [`الفترة: ${from} — ${to}`], ['المصدر: Zoho Books'], [], ['المسار', 'البيان', 'القيمة']];
  const walk = (value, path = '') => {
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${path}[${i}]`));
    if (value && typeof value === 'object') {
      const obj = value;
      const name = obj.name || obj.account_name || obj.display_name || obj.label || obj.description || '';
      const amount = obj.total ?? obj.amount ?? obj.balance ?? obj.debit ?? obj.credit;
      if (name || amount != null) rows.push([path, name, amount ?? '']);
      Object.entries(obj).forEach(([k, v]) => {
        if (!['name','account_name','display_name','label','description','total','amount','balance','debit','credit'].includes(k)) walk(v, path ? `${path}.${k}` : k);
      });
    }
  };
  walk(d.data || {});
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 44 }, { wch: 48 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, label.slice(0, 28));
  await persistAndDownloadExport({ wb: rtl(wb), fileName: `${label}_${from}_${to}.xlsx`,
    kind: report, rowCount: Math.max(0, rows.length - 5), total: 0, userId });
  return { rowCount: Math.max(0, rows.length - 5) };
}

// أول فترة ضريبية للمنشأة — لا إقرار قبلها (قرار المستخدم 2026-07-28).
export const FIRST_VAT_QUARTER = { year: 2026, q: 1 };

export const quarterRange = (y, q) => {
  const m0 = (q - 1) * 3;
  const endM = m0 + 3;
  return {
    from: `${y}-${String(m0 + 1).padStart(2, '0')}-01`,
    to:   `${y}-${String(endM).padStart(2, '0')}-${new Date(y, endM, 0).getDate()}`,
  };
};

// هل انتهى الربع فعلاً؟ إقرار ربع جارٍ = أرقام ناقصة → **لا يُعرَض ولا يُولَّد**.
export const isQuarterClosed = (y, q, today = new Date()) =>
  new Date(`${quarterRange(y, q).to}T23:59:59`) < today;

// أرباع الإقرار: **المنتهية فقط**، ولا تنزل قبل أول فترة ضريبية للمنشأة.
export function quarters(max = 12, today = new Date()) {
  const out = [];
  let y = today.getFullYear();
  let q = Math.floor(today.getMonth() / 3) + 1;
  while (out.length < max) {
    // لا ننزل قبل أول ربع ضريبي
    if (y < FIRST_VAT_QUARTER.year || (y === FIRST_VAT_QUARTER.year && q < FIRST_VAT_QUARTER.q)) break;
    if (isQuarterClosed(y, q, today)) {
      out.push({ key: `${y}-Q${q}`, label: `الربع ${q} — ${y}`, ...quarterRange(y, q) });
    }
    q -= 1;
    if (q === 0) { q = 4; y -= 1; }
  }
  return out;
}

// ── ضريبة الربع الجاري (حيّة) ──────────────────────────────────────────
// تُقرأ من كاش `vat_snapshots` الذي يحدّثه كرون `zoho-vat-refresh` كل 30
// دقيقة مع مزامنة زوهو — فالشاشات تعرضها فوراً بلا استدعاء API بطيء.
export async function loadCurrentVat() {
  const { data, error } = await supabase.rpc('vat_current_quarter');
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  const n = (v) => Number(v) || 0;
  return {
    quarter: r.quarter, from: r.period_from, to: r.period_to,
    outputTax: n(r.output_tax), inputTax: n(r.input_tax), netDue: n(r.net_due),
    sales: n(r.output_amount), isClosed: !!r.is_closed,
    fetchedAt: r.fetched_at, daysLeft: Number(r.days_left) || 0,
    prevNetDue: r.prev_net_due == null ? null : n(r.prev_net_due),
  };
}

// تحديث فوري بضغطة (لا ينتظر الكرون) — للمدير/صاحب صلاحية الوضع المالي.
export async function refreshCurrentVat() {
  const { data, error } = await supabase.functions.invoke('zoho-reports', {
    body: { action: 'refresh_vat' },
  });
  if (error) throw new Error(error.message || 'تعذّر التحديث من زوهو');
  if (data?.error) throw new Error(data.error);
  return data?.snapshot || null;
}
