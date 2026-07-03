// تقرير المطابقة البنكية — يقاطع كشف البنك المحفوظ (bank_transactions)
// مع قيود السداد في دفتر الشركات (carrier_operations doc_type='PAY').
//
// ثلاث أوراق:
//   1) مطابَق         — تحويل بنكي وجد قيده الدفتري (±0.5 ر.س، ±3 أيام)
//   2) بنك بلا قيد    — خرجت فلوس من البنك ولا قيد PAY لها (الخطر الأكبر:
//                        سداد لم يُسجَّل → رصيد الناقل الدفتري أعلى من الحقيقة)
//   3) قيد بلا أثر    — قيد PAY دفتري لا تحويل بنكي يطابقه (سداد وهمي/مكرر؟)
//
// - التحويلات المرفوضة (rejected — ذهبت ورجعت بنفس المرجع §1.15) تُستبعَد.
// - مبلغ المطابقة = مدين البنك الصافي (بعد فصل الرسوم) لأن قيد PAY يسجّل
//   ما وصل الناقل فعلاً لا ما خُصم شاملاً رسوم البنك.

import * as XLSX from 'xlsx';
import { supabase } from './supabase.js';
import { annotateRejected } from '../engine/bankStatementProcessor.js';
import { loadBankTransactions } from './bankTransactionsService.js';
import { persistAndDownloadExport } from './internalExportsService.js';

const r2 = (x) => Math.round(x * 100) / 100;
const fmtMoney = (n) => (n == null || Number.isNaN(n)) ? ''
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayMs = 86_400_000;
const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const da = new Date(String(a).slice(0, 10)), db = new Date(String(b).slice(0, 10));
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.abs(Math.round((da - db) / dayMs));
};

// المدفوعات مصدرها جدول payments (createPaymentRecord) لا قيود PAY في
// carrier_operations (لا يكتبها أحد — فحص الوكلاء #9: كل تحويل بنكي كان
// يظهر «بلا قيد»). نُطبِّع الحقول لأسماء القيد (amount_cr/doc_date/doc_no)
// فيبقى منطق المطابقة أدناه بلا تغيير.
async function loadPayOps(month) {
  const PAGE = 1000; const rows = []; let from = 0;
  while (true) {
    let q = supabase.from('payments')
      .select('id, carrier_id, paid_at, payment_ref, notes, amount')
      .order('paid_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })          // قاعدة §6: ترتيب فريد قبل range
      .range(from, from + PAGE - 1);
    if (month) q = q.gte('paid_at', `${month}-01`).lte('paid_at', `${month}-31`);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows.map(p => ({
    id: p.id, carrier_id: p.carrier_id,
    doc_date: p.paid_at, doc_no: p.payment_ref, reference_no: p.payment_ref,
    description: p.notes, amount_cr: Number(p.amount) || 0,
  }));
}

// month = 'YYYY-MM' أو null (كل الفترات). يرجع ملخّصاً + يولّد Excel مؤرشفاً.
export async function generateBankReconReport({ month = null, userId = null } = {}) {
  const [bankAll, payOps] = await Promise.all([
    loadBankTransactions(),
    loadPayOps(month),
  ]);
  annotateRejected(bankAll);   // علّم أزواج المرفوض ليُستبعَدوا

  // تحويلات صادرة صالحة للمطابقة: مدين > 0، غير مرفوضة، ضمن الشهر إن حُدّد
  const bankDebits = bankAll.filter(t => {
    if (t.rejected) return false;
    const d = Number(t.debit) || 0;
    if (d <= 0.5) return false;
    if (month && String(t.txn_date || '').slice(0, 7) !== month) return false;
    return true;
  });

  // مطابقة واحد-لواحد جشعة: نفس المبلغ ±0.5 وأقرب تاريخ ≤3 أيام.
  const usedPay = new Set();
  const matched = [], bankOnly = [];
  for (const b of bankDebits) {
    const amt = Number(b.debit) || 0;
    let best = null, bestDays = Infinity;
    for (let i = 0; i < payOps.length; i++) {
      if (usedPay.has(i)) continue;
      const p = payOps[i];
      if (Math.abs((Number(p.amount_cr) || 0) - amt) > 0.5) continue;
      const dd = daysBetween(b.txn_date, p.doc_date);
      if (dd == null || dd > 3) continue;
      if (dd < bestDays) { bestDays = dd; best = i; }
    }
    if (best != null) { usedPay.add(best); matched.push({ b, p: payOps[best], days: bestDays }); }
    else bankOnly.push(b);
  }
  const payOnly = payOps.filter((_, i) => !usedPay.has(i));

  // ── بناء المصنّف ──
  const wb = XLSX.utils.book_new();
  const title = month ? `المطابقة البنكية — ${month}` : 'المطابقة البنكية — كل الفترات';

  const wsMatched = XLSX.utils.aoa_to_sheet([
    [title], [`تحويلات مطابَقة (${matched.length})`], [],
    ['تاريخ البنك', 'مرجع البنك', 'المبلغ (ر.س)', 'تاريخ القيد', 'رقم القيد', 'فرق الأيام', 'بيان القيد'],
    ...matched.map(({ b, p, days }) => [
      String(b.txn_date || '').slice(0, 10), b.reference || '', fmtMoney(b.debit),
      p.doc_date || '', p.doc_no || p.reference_no || '', days, p.description || '',
    ]),
  ]);
  wsMatched['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 9 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsMatched, 'مطابَق');

  const wsBankOnly = XLSX.utils.aoa_to_sheet([
    [title], [`⚠ خرجت من البنك ولا قيد سداد لها (${bankOnly.length}) — الخطر الأكبر`],
    ['ملاحظة: قد تكون مصاريف تشغيلية/رواتب لا تخص الناقلين — راجع الوصف'], [],
    ['التاريخ', 'المرجع', 'المبلغ (ر.س)', 'الوصف'],
    ...bankOnly.map(b => [
      String(b.txn_date || '').slice(0, 10), b.reference || '', fmtMoney(b.debit),
      (b.description || '').slice(0, 120),
    ]),
  ]);
  wsBankOnly['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsBankOnly, 'بنك بلا قيد');

  const wsPayOnly = XLSX.utils.aoa_to_sheet([
    [title], [`قيود سداد دفترية بلا أثر بنكي (${payOnly.length}) — تحقّق من مصدرها`], [],
    ['تاريخ القيد', 'الناقل', 'رقم القيد', 'المبلغ (ر.س)', 'البيان'],
    ...payOnly.map(p => [
      p.doc_date || '', p.carrier_id || '', p.doc_no || p.reference_no || '',
      fmtMoney(p.amount_cr), (p.description || '').slice(0, 100),
    ]),
  ]);
  wsPayOnly['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsPayOnly, 'قيد بلا أثر بنكي');

  const totalBankOnly = r2(bankOnly.reduce((s, b) => s + (Number(b.debit) || 0), 0));
  const fileName = `مطابقة_بنكية_${month || 'الكل'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  await persistAndDownloadExport({
    wb, fileName, kind: 'bank_recon',
    rowCount: matched.length + bankOnly.length + payOnly.length,
    total: totalBankOnly, userId,
  });

  return {
    matched: matched.length,
    bankOnly: bankOnly.length, bankOnlyTotal: totalBankOnly,
    payOnly: payOnly.length,
  };
}
