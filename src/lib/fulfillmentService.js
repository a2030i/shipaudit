// fulfillmentService.js — تدقيق فواتير شركاء التجهيز/التخزين (3PL).
//
// مسار موازٍ منفصل عن تدقيق الشحن (لا يلمس carriers/carrier_operations).
// المورّد الأول: ديسباتش — رسم تجهيز per-order (سعر لكل متجر) + تخزين مجاني.
// نموذج الفاتورة: ورقة SHIPPING (الطلبات) · SUMMARY (المفوتر) · FEES (العقد) · COD.
//
// التدقيق = عدّ الطلبات × سعر المتجر + كشف التكرار (per-AWB) + (Phase 2) تقاطع
// مع سجل الطلبات الداخلي. الأمان: dedup_key كامل، delete-then-insert (فخّ 42P10 §6).

import { supabase } from './supabase.js';
import * as XLSX from 'xlsx';

const norm = (s) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim();
const num  = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const nowIso = () => new Date().toISOString();

// ─── تصنيف المدينة (للعرض؛ السعر موحّد per-order حالياً) ───
function classifyDest(dest) {
  const d = String(dest || '').toLowerCase();
  if (/riyadh/.test(d) && !/out/.test(d)) return 'Riyadh';
  if (/out.?riyadh/.test(d)) return 'Out Riyadh';
  if (/international|bahrain|kuwait|oman|qatar|emirates|uae/.test(d)) return 'International';
  return dest || 'Other';
}

// ─── المحلّل: يقرأ workbook فاتورة ديسباتش ───
export function parseDispatchInvoice(wb) {
  const SH = wb.Sheets['SHIPPING'];
  if (!SH) throw new Error('الفاتورة لا تحوي ورقة SHIPPING — ليست بصيغة ديسباتش');
  const sh = XLSX.utils.sheet_to_json(SH, { header: 1, raw: true, defval: '' });
  const H = sh[0] || [];
  const ci = (n) => H.findIndex((x) => String(x).trim() === n);
  const cAwb = ci('AWB_NO'), cRef = ci('REFRENCE No'), cDest = ci('DESTINATION'), cStat = ci('MAINSTATUS'), cCod = ci('COD AMOUN');

  const orders = []; const seen = new Set(); const dupAwbs = [];
  const byCity = {}; const byStatus = {};
  for (let i = 1; i < sh.length; i++) {
    const r = sh[i]; if (!r) continue;
    const awb = String(r[cAwb] ?? '').trim(); if (!awb) continue;
    const dest = classifyDest(r[cDest]); const status = String(r[cStat] ?? '').trim();
    if (seen.has(awb)) dupAwbs.push(awb); else seen.add(awb);
    orders.push({ awb, ref: String(r[cRef] ?? '').trim(), dest, status, cod: num(r[cCod]) });
    byCity[dest] = (byCity[dest] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  // SUMMARY — اسم المتجر + الإجمالي المفوتر
  let store = null, billedTotal = null;
  const su = XLSX.utils.sheet_to_json(wb.Sheets['SUMMARY'] || {}, { header: 1, raw: false, defval: '' });
  for (const r of su) {
    const j = (r || []).map((x) => String(x).trim());
    const inv = j.find((c) => /INVOICE\s*$/i.test(c));
    if (inv && !store) store = inv.replace(/\s*INVOICE\s*$/i, '').trim();
    const idx = j.findIndex((c) => /TOTAL WITH VAT/i.test(c));
    if (idx >= 0) { const v = j.slice(idx + 1).find((x) => /[0-9]/.test(x)); if (v != null) billedTotal = num(v); }
  }
  return { store, orders, byCity, byStatus, dupAwbs, billedTotal };
}

// استخرج الفترة YYYY-MM من اسم الملف (مثل "... 5-2026")
export function periodFromName(fileName) {
  const m = String(fileName || '').match(/(\d{1,2})\s*-\s*(\d{4})/);
  if (m) return `${m[2]}-${String(m[1]).padStart(2, '0')}`;
  return null;
}

// ─── مرجعيات ───
export async function loadWarehouses() {
  const { data, error } = await supabase.from('fulfillment_warehouses').select('*').eq('active', true).order('name');
  if (error) throw error; return data || [];
}
export async function loadContracts(warehouseId) {
  let q = supabase.from('fulfillment_contracts').select('*');
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  const { data, error } = await q;
  if (error) throw error; return data || [];
}
export async function findContract(warehouseId, storeName) {
  const contracts = await loadContracts(warehouseId);
  const n = norm(storeName);
  return contracts.find((c) => c.store_name_normalized === n)
      || contracts.find((c) => norm(c.store_name) === n) || null;
}

// ─── التدقيق: عدّ × سعر المتجر + تكرار + (تقاطع مع سجل سابق) ───
export async function auditFulfillmentInvoice({ warehouseId, parsed, fileName }) {
  const contract = await findContract(warehouseId, parsed.store);
  const rate = contract ? Number(contract.per_order_fee) : null;
  const vat  = contract ? Number(contract.vat_pct) / 100 : 0.15;
  const n = parsed.orders.length;

  // تكرار عبر فواتير سابقة لنفس المورّد (نفس AWB + نفس fulfillment) — كشف لا منع
  const awbs = parsed.orders.map((o) => o.awb);
  const crossDup = new Set();
  for (let i = 0; i < awbs.length; i += 300) {
    const chunk = awbs.slice(i, i + 300);
    const { data } = await supabase.from('fulfillment_order_ledger')
      .select('awb').eq('warehouse_id', warehouseId).eq('line_kind', 'fulfillment').in('awb', chunk);
    (data || []).forEach((r) => crossDup.add(String(r.awb)));
  }

  const seen = new Set();
  const lines = parsed.orders.map((o) => {
    let flag = 'ok';
    if (!contract) flag = 'missing_contract';
    else if (seen.has(o.awb) || crossDup.has(o.awb)) flag = 'dup';
    seen.add(o.awb);
    const expected = (flag === 'dup' || !contract) ? 0 : rate;
    return { ...o, invoiced: rate ?? 0, expected, diff: +( (rate ?? 0) - expected ).toFixed(2), flag };
  });

  const expectedPreVat = +(lines.reduce((s, l) => s + l.expected, 0)).toFixed(2);
  const expectedWithVat = +(expectedPreVat * (1 + vat)).toFixed(2);
  const billed = parsed.billedTotal;
  const dupCount = lines.filter((l) => l.flag === 'dup').length;
  return {
    contract, store: parsed.store, period: periodFromName(fileName),
    orders: n, rate, vat,
    byCity: parsed.byCity, byStatus: parsed.byStatus,
    expectedPreVat, expectedWithVat, billed,
    diff: billed != null ? +(billed - expectedWithVat).toFixed(2) : null,
    dupCount, missingContract: !contract, lines,
  };
}

// ─── الحفظ: header + lines + ledger (delete-then-insert idempotent عبر file) ───
export async function saveFulfillmentInvoice({ warehouseId, parsed, audit, fileName, userId }) {
  const invoiceId = `ffi_${Date.now()}`;
  const period = audit.period || periodFromName(fileName);
  // header
  const { error: e1 } = await supabase.from('fulfillment_invoices').insert({
    id: invoiceId, warehouse_id: warehouseId, store_name: parsed.store, period, file_name: fileName,
    order_count: audit.orders, total_invoiced: audit.billed, total_expected: audit.expectedWithVat,
    drift: audit.diff, mismatch_count: 0, dup_count: audit.dupCount,
    review_status: 'draft', created_by: userId ?? null,
  });
  if (e1) throw e1;
  // lines (دفعات)
  const lineRows = audit.lines.map((l) => ({
    invoice_id: invoiceId, awb: l.awb, order_ref: l.ref, dest: l.dest, ship_status: l.status,
    line_kind: 'fulfillment', invoiced: l.invoiced, expected: l.expected, diff: l.diff, flag: l.flag,
  }));
  for (let i = 0; i < lineRows.length; i += 500) {
    const { error } = await supabase.from('fulfillment_invoice_lines').insert(lineRows.slice(i, i + 500));
    if (error) throw error;
  }
  // ledger (لكشف التكرار مستقبلاً)
  const ledgerRows = parsed.orders.map((o) => ({
    invoice_id: invoiceId, warehouse_id: warehouseId, store_name: parsed.store,
    awb: o.awb, order_ref: o.ref, period, line_kind: 'fulfillment',
  }));
  for (let i = 0; i < ledgerRows.length; i += 500) {
    await supabase.from('fulfillment_order_ledger').insert(ledgerRows.slice(i, i + 500));
  }
  return { invoiceId, count: lineRows.length };
}

export async function loadFulfillmentInvoices({ warehouseId = null } = {}) {
  let q = supabase.from('fulfillment_invoices').select('*').order('created_at', { ascending: false });
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  const { data, error } = await q;
  if (error) throw error; return data || [];
}

// بنود فاتورة (الطلبات) — للتصدير المحاسبي
export async function loadInvoiceLines(invoiceId) {
  const { data, error } = await supabase.from('fulfillment_invoice_lines')
    .select('*').eq('invoice_id', invoiceId).order('id', { ascending: true });
  if (error) throw error; return data || [];
}

export async function deleteFulfillmentInvoice(invoiceId) {
  if (!invoiceId) throw new Error('invoiceId مطلوب');
  await supabase.from('fulfillment_order_ledger').delete().eq('invoice_id', invoiceId);
  const { error } = await supabase.from('fulfillment_invoices').delete().eq('id', invoiceId).select('id');
  if (error) throw error;
  return { ok: true };
}
