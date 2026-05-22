// Central uploads-hub service.
//
// Single API for the /uploads page that:
//   1. Reports the last-upload status of every supported snapshot
//      source (filename, when, row counts, freshness flag).
//   2. Exposes one unified upload() function that picks the right
//      parser + persister based on the source id, so the page can
//      drop any file into any card without duplicating per-source
//      logic.
//
// Snapshot sources covered:
//   internal_settlement   — استحقاق المتاجر (الداخلي)
//   receivables           — مديونيات العملاء
//   merchants             — متاجر المنصّة (stores.xlsx)
//   zoho_customers        — Zoho ملخص أرصدة العملاء
//   zoho_vendors          — Zoho ملخص أرصدة الموردين
//
// Each source declares its "expected cadence" (in days) so the
// hub can flag stale data without hard-coding thresholds in the UI.

import { supabase }                       from './supabase.js';
import * as XLSX                          from 'xlsx';
import {
  parseInternalSettlement, parseZohoCustomerBalances, parseZohoVendorBalances,
  uploadBalanceSnapshot, uploadVendorBalanceSnapshot,
} from './reconciliationService.js';
import { parseReceivablesFile, uploadReceivablesSnapshot } from './customerReceivablesService.js';
import { parseStoresFile,      uploadMerchantsSnapshot   } from './merchantsService.js';

const DAY_MS = 86_400_000;

// Per-source metadata. `cadenceDays` drives the stale indicator.
// `link` is where the operator can drill down for richer workflow
// (the hub itself is fire-and-forget upload, not browse).
// `origin` drives a small badge on each card so the operator
// can scan at a glance "هذا من لمحه" vs "هذا من Zoho" without
// reading the title.
export const UPLOAD_SOURCES = [
  {
    id:           'internal_settlement',
    label:        'استحقاق المتاجر',
    origin:       'lamha',
    subtitle:     'ملف من المنصة الداخلية: المتجر + الرصيد',
    accent:       '#3B82F6',
    cadenceDays:  7,
    link:         '/reconciliation',
  },
  {
    id:           'receivables',
    label:        'كشف فواتير العملاء (تفصيلي)',
    origin:       'zoho',
    subtitle:     'Reports → الذمم المدينة → تفاصيل الفاتورة',
    accent:       '#10B981',
    cadenceDays:  7,
    link:         '/receivables',
  },
  {
    id:           'merchants',
    label:        'متاجر المنصّة (stores.xlsx)',
    origin:       'lamha',
    subtitle:     'كشف المتاجر — هاتف، حالة، شحنات، رصيد محفظة',
    accent:       '#8B5CF6',
    cadenceDays:  30,
    link:         '/merchants',
  },
  {
    id:           'zoho_customers',
    label:        'أرصدة العملاء',
    origin:       'zoho',
    subtitle:     'Reports → الذمم المدينة → ملخص أرصدة العملاء',
    accent:       '#F59E0B',
    cadenceDays:  7,
    link:         '/reconciliation',
  },
  {
    id:           'zoho_vendors',
    label:        'أرصدة الموردين',
    origin:       'zoho',
    subtitle:     'Reports → الذمم الدائنة → ملخص أرصدة الموردين',
    accent:       '#F97316',
    cadenceDays:  7,
    link:         '/reconciliation?tab=vendors',
  },
];

// Origin badge metadata — used by the UI to render the small
// "لمحه" / "Zoho" pill on each upload card.
export const ORIGIN_BADGES = {
  lamha: { label: 'لمحه', color: '#0EA5E9' },
  zoho:  { label: 'Zoho', color: '#7C3AED' },
};

// ── Per-source last-upload loaders ──
// Each returns { lastAt, fileName, rowCount, matchedCount, total }
// or null if no upload exists yet.
async function lastInternal() {
  const { data } = await supabase
    .from('store_balance_snapshots').select('*')
    .eq('source', 'internal')
    .order('uploaded_at', { ascending: false }).limit(1);
  if (!data?.length) return null;
  const r = data[0];
  return {
    lastAt:       r.uploaded_at,
    fileName:     r.file_name,
    rowCount:     r.row_count,
    matchedCount: r.matched_count,
    total:        Number(r.total_balance) || 0,
  };
}
async function lastZohoCustomers() {
  const { data } = await supabase
    .from('store_balance_snapshots').select('*')
    .eq('source', 'zoho')
    .order('uploaded_at', { ascending: false }).limit(1);
  if (!data?.length) return null;
  const r = data[0];
  return {
    lastAt:       r.uploaded_at,
    fileName:     r.file_name,
    rowCount:     r.row_count,
    matchedCount: r.matched_count,
    total:        Number(r.total_balance) || 0,
  };
}
async function lastZohoVendors() {
  const { data } = await supabase
    .from('vendor_balance_snapshots').select('*')
    .order('uploaded_at', { ascending: false }).limit(1);
  if (!data?.length) return null;
  const r = data[0];
  return {
    lastAt:       r.uploaded_at,
    fileName:     r.file_name,
    rowCount:     r.row_count,
    matchedCount: r.matched_count,
    total:        Number(r.total_we_owe) || 0,
  };
}
async function lastReceivables() {
  // customer_receivables doesn't have a snapshots-header table,
  // so we read directly: latest uploaded_at + row count from that
  // snapshot.
  const { data: meta } = await supabase
    .from('customer_receivables')
    .select('snapshot_id, source_file, uploaded_at')
    .order('uploaded_at', { ascending: false }).limit(1);
  if (!meta?.length) return null;
  const top = meta[0];
  const { count } = await supabase
    .from('customer_receivables')
    .select('id', { count: 'exact', head: true })
    .eq('snapshot_id', top.snapshot_id);
  return {
    lastAt:       top.uploaded_at,
    fileName:     top.source_file,
    rowCount:     count || 0,
    matchedCount: null,
    total:        null,
  };
}
async function lastMerchants() {
  const { data: meta } = await supabase
    .from('merchants').select('snapshot_id, uploaded_at')
    .order('uploaded_at', { ascending: false }).limit(1);
  if (!meta?.length) return null;
  const top = meta[0];
  const { count } = await supabase
    .from('merchants')
    .select('id', { count: 'exact', head: true })
    .eq('snapshot_id', top.snapshot_id);
  return {
    lastAt:       top.uploaded_at,
    fileName:     null,                // merchants doesn't store file_name today
    rowCount:     count || 0,
    matchedCount: null,
    total:        null,
  };
}

const LOADERS = {
  internal_settlement: lastInternal,
  receivables:         lastReceivables,
  merchants:           lastMerchants,
  zoho_customers:      lastZohoCustomers,
  zoho_vendors:        lastZohoVendors,
};

// ── Overview API for the hub page ──
export async function loadUploadsOverview() {
  const now = Date.now();
  const results = await Promise.all(UPLOAD_SOURCES.map(async (src) => {
    const last = await LOADERS[src.id]?.().catch(() => null);
    const daysSince = last?.lastAt ? Math.floor((now - new Date(last.lastAt).getTime()) / DAY_MS) : null;
    const stale = daysSince == null ? null : daysSince > src.cadenceDays;
    return { ...src, last, daysSince, stale };
  }));
  return results;
}

// ── Auto-detect the source type from the file's content ──
// Reads the top ~15 rows and matches against each source's known
// signatures (title strings, column headers, value formats). Returns
// { sourceId, confidence, reasons } or null if nothing matches.
//
// The detector is intentionally generous — false negatives (asking
// the operator to pick) are fine; false positives (uploading to the
// wrong table) are not. So each check has a unique strong signal.
export function detectFileSource(rows) {
  if (!rows?.length) return null;
  const top = rows.slice(0, 15);
  const allCells = top.flatMap(r => (r || []).map(c => String(c ?? '')));
  const flatText = allCells.join('\n').toLowerCase();
  const reasons = [];

  // -- Zoho vendor balance — strongest signature: "اسم المورد" --
  if (flatText.includes('ملخص أرصدة الموردين') ||
      flatText.includes('vendor balance') ||
      allCells.some(c => c.trim() === 'اسم المورد')) {
    reasons.push('عمود "اسم المورد"');
    return { sourceId: 'zoho_vendors', confidence: 0.95, reasons };
  }

  // -- Zoho customer balance — "مبلغ الذمة المدينة" is unique --
  if (flatText.includes('ملخص أرصدة العملاء') ||
      flatText.includes('ملخص أرصده العملاء') ||
      flatText.includes('ملخص التزامات المستفيدين') ||
      flatText.includes('customer balance') ||
      allCells.some(c => c.trim() === 'مبلغ الذمة المدينة')) {
    reasons.push('بصمة تقرير Zoho — العملاء');
    return { sourceId: 'zoho_customers', confidence: 0.95, reasons };
  }

  // -- Merchants (stores.xlsx) — needs id + name + an ops column --
  for (const r of top) {
    if (!r) continue;
    const h = r.map(c => String(c || '').toLowerCase());
    const hasId   = h.some(c => c.includes('رقم المتجر') || c.includes('store id'));
    const hasName = h.some(c => c.includes('اسم المتجر') || c.includes('store name'));
    const hasOps  = h.some(c => c.includes('عدد الشحنات') || c.includes('نوع الربط') || c.includes('shipment count'));
    if (hasId && hasName && hasOps) {
      reasons.push('أعمدة كشف المتاجر (رقم/اسم/شحنات)');
      return { sourceId: 'merchants', confidence: 0.9, reasons };
    }
  }

  // -- Customer receivables — "تفاصيل" title + اسم العملاء + تاريخ --
  if (flatText.includes('تفاصيل الفاتورة') || flatText.includes('تفاصيل فواتير')) {
    reasons.push('عنوان "تفاصيل الفاتورة"');
    return { sourceId: 'receivables', confidence: 0.9, reasons };
  }
  if (allCells.some(c => /اسم\s*العملاء|اسم\s*العميل/.test(c)) &&
      allCells.some(c => /تاريخ.*فاتورة|تاريخ\s*الفاتوره/i.test(c))) {
    reasons.push('عمود اسم العملاء + تاريخ الفاتورة');
    return { sourceId: 'receivables', confidence: 0.85, reasons };
  }

  // -- Internal store settlement — exactly 2 cols: المتجر + الرصيد,
  //    NO Zoho keywords, NO date column. Checked last because the
  //    column names ("المتجر","الرصيد") are too generic to be
  //    diagnostic by themselves.
  const firstRow = top.find(r => r && (r[0] || r[1]));
  if (firstRow) {
    const cells = firstRow.map(c => String(c || '').trim());
    const isStoreHeader   = cells[0] === 'المتجر' || /^متجر$/.test(cells[0]);
    const isBalanceHeader = cells[1] === 'الرصيد' || /^رصيد$/.test(cells[1]);
    if (isStoreHeader && isBalanceHeader && cells.length <= 4) {
      reasons.push('عمودان فقط: المتجر + الرصيد (نمط النظام الداخلي)');
      return { sourceId: 'internal_settlement', confidence: 0.85, reasons };
    }
  }

  return null;
}

// ── Unified upload() — dispatches by source id ──
// Returns a normalized result: { rowCount, matched, total, message }.
// All file parsing happens here so the page only has to hand us a
// File object + source id.
export async function uploadFile({ sourceId, file, userId }) {
  if (!file)     throw new Error('لا يوجد ملف');
  if (!sourceId) throw new Error('نوع المصدر مطلوب');

  const buffer = await file.arrayBuffer();
  const wb     = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws     = wb.Sheets[wb.SheetNames[0]];
  const rows   = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  switch (sourceId) {
    case 'internal_settlement': {
      const parsed = parseInternalSettlement(rows);
      if (parsed.errors.length) throw new Error(parsed.errors.join(' · '));
      const r = await uploadBalanceSnapshot({ source: 'internal', parsed: parsed.rows, fileName: file.name, userId });
      return { rowCount: r.rowCount, matched: r.matched, total: r.totalBalance, message: `${r.rowCount} متجر · ${r.matched} مطابق` };
    }
    case 'zoho_customers': {
      const parsed = parseZohoCustomerBalances(rows);
      if (parsed.errors.length) throw new Error(parsed.errors.join(' · '));
      const r = await uploadBalanceSnapshot({ source: 'zoho', parsed: parsed.rows, fileName: file.name, userId });
      return { rowCount: r.rowCount, matched: r.matched, total: r.totalBalance, message: `${r.rowCount} عميل · ${r.matched} مطابق` };
    }
    case 'zoho_vendors': {
      const parsed = parseZohoVendorBalances(rows);
      if (parsed.errors.length) throw new Error(parsed.errors.join(' · '));
      const r = await uploadVendorBalanceSnapshot({ parsed: parsed.rows, fileName: file.name, userId });
      return { rowCount: r.rowCount, matched: r.matched, total: r.totalWeOwe, message: `${r.rowCount} مورّد · ${r.matched} مطابق` };
    }
    case 'receivables': {
      // parseReceivablesFile expects raw rows (header detection inside)
      const parsed = parseReceivablesFile(rows);
      if (parsed.errors?.length) throw new Error(parsed.errors.join(' · '));
      const r = await uploadReceivablesSnapshot({ parsed, sourceFile: file.name, userId });
      return { rowCount: r.invoiceCount, matched: r.customerCount, total: r.total, message: `${r.customerCount} عميل · ${r.invoiceCount} فاتورة · ${r.total} ر.س` };
    }
    case 'merchants': {
      const parsed = parseStoresFile(rows);
      if (parsed.errors?.length) throw new Error(parsed.errors.join(' · '));
      const r = await uploadMerchantsSnapshot({ parsed, sourceFile: file.name, userId });
      return { rowCount: r.count, matched: null, total: null, message: `${r.count} متجر (${r.active} نشط · ${r.prepaid} دفع مسبق · ${r.postpaid} دفع لاحق)` };
    }
    default:
      throw new Error(`نوع مصدر غير معروف: ${sourceId}`);
  }
}
