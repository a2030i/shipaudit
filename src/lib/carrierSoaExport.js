// كشف حساب رسمي لشركة الشحن (SOA) → Excel — مستند النزاع/المطالبة.
//
// يحاكي soaExport.js (كشف العميل) لكن على carrier_operations:
//   ترويسة (الشركة، كما في تاريخ) → جدول الحركات الأقدم أولاً برصيد جارٍ
//   → الإجماليات → قسم COD المعلّق → سطر توقيع.
//
// المحاسبة (§2.4): DR = نحن مدينون للشركة (فاتورة شحن) · CR = الشركة
// مدينة لنا (تحصيل COD / إشعار / دفعة). الرصيد الجاري = تراكم DR − CR؛
// موجب = مستحق لشركة الشحن علينا، سالب = مستحق لنا عليها.
//
// بيانات فقط بلا معادلات — يفتح في أي أداة جداول.

import * as XLSX from 'xlsx';
import { rtl } from './xlsxRtl.js';
import { supabase } from './supabase.js';
import { loadCarrierNetBalances } from './codSettlementService.js';
import { persistAndDownloadExport } from './internalExportsService.js';

const fmtMoney = (n) =>
  (n == null || Number.isNaN(n)) ? ''
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DOC_LABEL = {
  INV: 'فاتورة مراجعة', RV: 'فاتورة شحن', DR: 'فاتورة',
  COD: 'تحصيل COD', DG: 'إشعار دائن', AB: 'إشعار', PAY: 'دفعة سداد', CN: 'إشعار دائن',
};

// كل عمليات الناقل — paginated بترتيب ثابت (doc_date ثم id — قاعدة §6:
// أي .range() يُكرّر صفحات لازم .order('id') قبله).
async function loadAllOps(carrierId) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('carrier_operations')
      .select('doc_date, doc_type, doc_no, reference_no, description, amount_dr, amount_cr, status, due_date')
      .eq('carrier_id', carrierId)
      .order('doc_date', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export async function exportCarrierSOA({ carrierId, carrierName, persist = false, userId = null }) {
  // loadCarrierNetBalances يرجع Map<carrier_id, net> (لا مصفوفة)
  const [ops, codBalances] = await Promise.all([
    loadAllOps(carrierId),
    loadCarrierNetBalances().catch(() => new Map()),
  ]);

  const aoa = [];
  const today = new Date().toISOString().slice(0, 10);

  // ── الترويسة ──────────────────────────────────────────────
  aoa.push(['كشف حساب شركة شحن']);
  aoa.push([]);
  aoa.push(['شركة الشحن', carrierName || carrierId]);
  aoa.push(['كما في تاريخ', today]);
  aoa.push(['العملة', 'ريال سعودي (SAR)']);
  aoa.push([]);

  // ── جدول الحركات برصيد جارٍ ────────────────────────────────
  aoa.push(['التاريخ', 'النوع', 'رقم المستند', 'البيان', 'مدين علينا (ر.س)', 'دائن لنا (ر.س)', 'الرصيد الجاري (ر.س)', 'الحالة']);
  let balance = 0, totalDr = 0, totalCr = 0;
  if (!ops.length) {
    aoa.push(['', '', '', 'لا توجد حركات', '', '', '', '']);
  } else {
    for (const op of ops) {
      const dr = Number(op.amount_dr) || 0;
      const cr = Number(op.amount_cr) || 0;
      totalDr += dr; totalCr += cr;
      balance = +(balance + dr - cr).toFixed(2);
      aoa.push([
        op.doc_date || '',
        DOC_LABEL[op.doc_type] || op.doc_type || '',
        op.doc_no || op.reference_no || '',
        op.description || '',
        dr > 0 ? fmtMoney(dr) : '',
        cr > 0 ? fmtMoney(cr) : '',
        fmtMoney(balance),
        op.status === 'paid' ? 'مسدَّدة' : op.status === 'partial' ? 'جزئية' : op.status === 'audited' ? 'مدقَّقة' : '',
      ]);
    }
  }
  aoa.push([]);

  // ── الإجماليات ─────────────────────────────────────────────
  aoa.push(['إجمالي المدين (فواتير علينا)', `${fmtMoney(totalDr)} ر.س`]);
  aoa.push(['إجمالي الدائن (تحصيل/إشعارات/دفعات)', `${fmtMoney(totalCr)} ر.س`]);
  aoa.push([
    balance >= 0 ? 'الرصيد المستحق لشركة الشحن' : 'الرصيد المستحق لنا على الشركة',
    `${fmtMoney(Math.abs(balance))} ر.س`,
  ]);
  aoa.push([]);

  // ── COD المعلّق (متوقّع لم يُورَّد بعد) ─────────────────────
  const codNet = Number(codBalances?.get?.(carrierId) ?? 0);
  if (Math.abs(codNet) > 0.5) {
    aoa.push(['تحصيلات COD المعلّقة']);
    aoa.push([
      codNet > 0 ? 'COD متوقّع لم يُحوَّل لنا بعد' : 'COD مُحوَّل زائد عن المتوقّع',
      `${fmtMoney(Math.abs(codNet))} ر.س`,
    ]);
    aoa.push(['ملاحظة', 'صافي كشف تسويات COD (المتوقّع من نظامنا − المُحوَّل فعلاً) — خارج الرصيد الدفتري أعلاه']);
    aoa.push([]);
  }

  // ── التوقيع ────────────────────────────────────────────────
  aoa.push([]);
  aoa.push(['اعتُمد بواسطة:', '____________________']);
  aoa.push(['تاريخ الاعتماد:', '____________________']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 12 },  // التاريخ
    { wch: 14 },  // النوع
    { wch: 20 },  // رقم المستند
    { wch: 44 },  // البيان
    { wch: 16 },  // مدين
    { wch: 16 },  // دائن
    { wch: 17 },  // الرصيد
    { wch: 10 },  // الحالة
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'كشف الحساب');
  const safeName = String(carrierName || carrierId).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const fileName = `كشف_حساب_ناقل_${safeName}_${today}.xlsx`;

  if (persist) {
    // من مركز التقارير: تخزين + سجل + تنزيل (قاعدة §1.13)
    await persistAndDownloadExport({ wb, fileName, kind: 'carrier_soa', rowCount: ops.length, total: balance, userId });
  } else {
    XLSX.writeFile(rtl(wb), fileName);
  }

  return { rowCount: ops.length, balance };
}
