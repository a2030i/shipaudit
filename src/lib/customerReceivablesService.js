// Customer receivables (AR) service.
//
// READ-ONLY view layered over snapshots the user uploads from their
// external billing system. The app does NOT bill — it just shows the
// uploaded snapshot's aggregates + lets the CFO drill in.
//
// API:
//   parseReceivablesFile(allRows)
//     → { periodFrom, periodTo, rows:[{ customer, date, amount, isSummary }] }
//
//   uploadReceivablesSnapshot({ parsed, sourceFile, userId })
//     → { snapshotId, customerCount, invoiceCount, total }
//
//   loadLatestReceivables()
//     → { snapshot: { id, date, periodFrom, periodTo, sourceFile },
//         customers: [{ name, total, invoiceCount, oldestInvoiceDate,
//                       daysOutstanding, agingBucket, invoices:[...] }],
//         aging: { d0_30, d31_60, d61_90, d90_plus },
//         total, customerCount }
//
//   loadReceivablesSnapshots()
//     → list of past snapshots (id, date, total, customerCount, sourceFile)
//
//   deleteReceivablesSnapshot(snapshotId)
//     → drops the snapshot entirely

import { supabase } from './supabase.js';

// Arabic month abbreviations → 1-12. Covers what the user's export
// uses ("12 أبر 2026" etc.). Full names also accepted for safety.
const AR_MONTHS = {
  'ينا': 1,  'يناير': 1,
  'فبر': 2,  'فبراير': 2,
  'مار': 3,  'مارس': 3,
  'أبر': 4,  'ابر': 4,  'أبريل': 4,  'ابريل': 4,
  'ماي': 5,  'مايو': 5,
  'يون': 6,  'يونيو': 6,
  'يول': 7,  'يوليو': 7,
  'أغس': 8,  'اغس': 8,  'أغسطس': 8, 'اغسطس': 8,
  'سبت': 9,  'سبتمبر': 9,
  'أكت': 10, 'اكت': 10, 'أكتوبر': 10, 'اكتوبر': 10,
  'نوف': 11, 'نوفمبر': 11,
  'ديس': 12, 'ديسمبر': 12,
};

// Parse an Arabic date like "12 أبر 2026" → "2026-04-12" (ISO).
// Returns null if the string can't be parsed.
function parseArabicDate(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Pattern: DD <month-ar> YYYY  (with optional Arabic-Indic digits)
  const m = trimmed.match(/^(\d{1,2})\s+([؀-ۿa-zA-Z]+)\s+(\d{4})$/);
  if (!m) {
    // Fall back to a JS Date if the parser format already looks ISO-ish.
    const d = new Date(trimmed);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  const day = parseInt(m[1], 10);
  const month = AR_MONTHS[m[2]] || AR_MONTHS[m[2].toLowerCase()];
  const year = parseInt(m[3], 10);
  if (!month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// "SAR1,234.56" → 1234.56 ; "-SAR50" → -50 ; "" → 0
function parseSarAmount(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  const cleaned = String(s).replace(/SAR/gi, '').replace(/[,\s ]/g, '').trim();
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Extract "من 11 ينا 2026 إلى 30 أبر 2026" from the title row → { from, to }.
function parsePeriodFromTitle(titleStr) {
  if (!titleStr) return { from: null, to: null };
  const flat = String(titleStr).replace(/\s+/g, ' ');
  const m = flat.match(/من\s+(\d{1,2}\s+\S+\s+\d{4})\s+إلى\s+(\d{1,2}\s+\S+\s+\d{4})/);
  if (!m) return { from: null, to: null };
  return { from: parseArabicDate(m[1]), to: parseArabicDate(m[2]) };
}

// Parse the Excel rows (as 2D array from xlsx) into structured data.
// Returns: { periodFrom, periodTo, rows:[...] }
//
// Each `rows` entry: { customer, invoiceDate, balance, isSummary }
//   - isSummary=true → the per-customer total row (no invoice_date)
//   - isSummary=false → an individual unpaid invoice
//
// The grand-total row ("الإجمالي") is filtered out.
export function parseReceivablesFile(allRows) {
  if (!Array.isArray(allRows) || allRows.length < 3) {
    throw new Error('الملف فارغ أو غير معتاد');
  }

  // Find the title + the header row. The title is a free-form cell with
  // 'تفاصيل الفاتورة' in it; the header has 'اسم العملاء'/'الرصيد'.
  let titleStr = '';
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i];
    if (!row) continue;
    for (const cell of row) {
      const s = String(cell ?? '');
      if (s.includes('تفاصيل') && !titleStr) titleStr = s;
    }
    const hasCustomerHeader = row.some(c => /اسم.*العم/i.test(String(c ?? '')));
    const hasBalanceHeader  = row.some(c => /الرصيد|الإجمالي.*المعلّق/.test(String(c ?? '')));
    if (hasCustomerHeader && hasBalanceHeader) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    throw new Error(
      'الملف لا يطابق صيغة كشف فواتير العملاء — يلزم وجود رأس فيه ' +
      '"اسم العملاء" + "الرصيد".',
    );
  }
  const header = allRows[headerIdx];
  // Columns are usually [customer, date, balance] but the parser
  // resolves them by header text so a different ordering still works.
  const customerCol = header.findIndex(c => /اسم.*العم/i.test(String(c ?? '')));
  const dateCol     = header.findIndex(c => /تاريخ/i.test(String(c ?? '')));
  const balanceCol  = header.findIndex(c => /الرصيد/i.test(String(c ?? '')));
  if (customerCol < 0 || balanceCol < 0) {
    throw new Error('لم نجد عمود اسم العملاء أو الرصيد');
  }

  const { from: periodFrom, to: periodTo } = parsePeriodFromTitle(titleStr);

  const rows = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r) continue;
    const customer = String(r[customerCol] ?? '').trim();
    if (!customer) continue;
    // Drop the grand-total footer row.
    if (/^الإجمالي$/.test(customer)) continue;

    const dateStr = dateCol >= 0 ? String(r[dateCol] ?? '').trim() : '';
    const balance = parseSarAmount(r[balanceCol]);
    if (balance === 0 && !dateStr) continue; // empty row

    const isSummary = !dateStr;
    const invoiceDate = dateStr ? parseArabicDate(dateStr) : null;

    rows.push({
      customer,
      invoiceDate,           // null for summary rows
      balance,
      isSummary,
    });
  }

  return { periodFrom, periodTo, rows };
}

// Save a parsed snapshot to the DB. Each save creates a new snapshot_id.
export async function uploadReceivablesSnapshot({ parsed, sourceFile, userId }) {
  if (!parsed?.rows?.length) throw new Error('لا توجد صفوف للحفظ');
  const snapshotId   = `ar_${Date.now()}`;
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const inserts = parsed.rows.map(r => ({
    snapshot_id:    snapshotId,
    snapshot_date:  snapshotDate,
    period_from:    parsed.periodFrom || null,
    period_to:      parsed.periodTo   || null,
    customer_name:  r.customer,
    invoice_date:   r.invoiceDate,
    balance_amount: r.balance,
    is_summary:     !!r.isSummary,
    source_file:    sourceFile || null,
    uploaded_by:    userId || null,
  }));
  // Chunked insert — 1K rows at a time is plenty for AR files.
  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase
      .from('customer_receivables').insert(inserts.slice(i, i + CHUNK));
    if (error) throw error;
  }
  const total = inserts
    .filter(r => r.is_summary)
    .reduce((s, r) => s + Number(r.balance_amount || 0), 0);
  return {
    snapshotId,
    snapshotDate,
    customerCount: inserts.filter(r => r.is_summary).length,
    invoiceCount:  inserts.filter(r => !r.is_summary).length,
    total: +total.toFixed(2),
  };
}

const PAGE = 1000;
async function loadAll(table, columns, filters = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    let q = supabase.from(table).select(columns).range(from, from + PAGE - 1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

function ageBucket(days) {
  if (days <= 30) return 'd0_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

// Returns the LATEST snapshot rolled up per customer + aging totals.
export async function loadLatestReceivables() {
  // 1) Find the most-recent snapshot_id
  const { data: latest, error: e1 } = await supabase
    .from('customer_receivables')
    .select('snapshot_id, snapshot_date, period_from, period_to, source_file, uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  if (e1) throw e1;
  if (!latest?.length) {
    return { snapshot: null, customers: [], aging: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }, total: 0, customerCount: 0 };
  }
  const snap = latest[0];

  // 2) Pull every row in that snapshot
  const all = await loadAll(
    'customer_receivables',
    'id, customer_name, invoice_date, balance_amount, is_summary',
    { snapshot_id: snap.snapshot_id },
  );

  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Group by customer.
  const byCustomer = new Map();
  for (const r of all) {
    const name = r.customer_name;
    if (!byCustomer.has(name)) {
      byCustomer.set(name, {
        name,
        total: 0,
        invoiceCount: 0,
        oldestInvoiceDate: null,
        daysOutstanding: 0,
        invoices: [],
      });
    }
    const c = byCustomer.get(name);
    if (r.is_summary) {
      c.total = Number(r.balance_amount) || 0;
    } else {
      c.invoiceCount++;
      c.invoices.push({
        id: r.id,
        date: r.invoice_date,
        amount: Number(r.balance_amount) || 0,
      });
      if (r.invoice_date) {
        if (!c.oldestInvoiceDate || r.invoice_date < c.oldestInvoiceDate) {
          c.oldestInvoiceDate = r.invoice_date;
        }
      }
    }
  }
  // If a customer had no summary row, fall back to summing their invoices.
  for (const c of byCustomer.values()) {
    if (!c.total && c.invoices.length) {
      c.total = +c.invoices.reduce((s, i) => s + i.amount, 0).toFixed(2);
    }
    if (c.oldestInvoiceDate) {
      const oldest = new Date(c.oldestInvoiceDate);
      c.daysOutstanding = Math.floor((today - oldest) / 86_400_000);
      c.agingBucket = ageBucket(c.daysOutstanding);
    }
    c.invoices.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Per-customer aging breakdown — so the UI can show "of this
    // customer's 17,037 SAR, only 7,533 is +90". When the user filters
    // by a bucket, we display this slice instead of the full total.
    const breakdown = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const inv of c.invoices) {
      if (!inv.date) continue;
      const d = Math.floor((today - new Date(inv.date)) / 86_400_000);
      breakdown[ageBucket(d)] += Number(inv.amount) || 0;
    }
    for (const k of Object.keys(breakdown)) breakdown[k] = +breakdown[k].toFixed(2);
    c.bucketAmounts = breakdown;
  }

  // Overlay the per-customer status tags so the UI can split between
  // the main view and the "متابعة خاصة" tab.
  const statuses = await loadCustomerStatuses();
  for (const c of byCustomer.values()) {
    const s = statuses.get(c.name);
    c.status = s?.status || 'normal';
    c.notes  = s?.notes  || null;
  }

  const customers = [...byCustomer.values()].sort((a, b) => b.total - a.total);
  // Totals + aging are calculated on the ACTIVE set only (excluded
  // customers are tracked separately so they don't inflate KPIs).
  const activeCustomers   = customers.filter(c => c.status !== 'excluded');
  const excludedCustomers = customers.filter(c => c.status === 'excluded');
  const total = +activeCustomers.reduce((s, c) => s + c.total, 0).toFixed(2);
  // Aging: bucket each INVOICE (not customer) by days outstanding, since
  // a customer may have invoices in multiple buckets.
  const excludedNameSet = new Set(excludedCustomers.map(c => c.name));
  const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const r of all) {
    if (r.is_summary || !r.invoice_date) continue;
    if (excludedNameSet.has(r.customer_name)) continue;
    const days = Math.floor((today - new Date(r.invoice_date)) / 86_400_000);
    const bucket = ageBucket(days);
    aging[bucket] += Number(r.balance_amount) || 0;
  }
  for (const k of Object.keys(aging)) aging[k] = +aging[k].toFixed(2);

  return {
    snapshot: {
      id:         snap.snapshot_id,
      date:       snap.snapshot_date,
      periodFrom: snap.period_from,
      periodTo:   snap.period_to,
      sourceFile: snap.source_file,
      uploadedAt: snap.uploaded_at,
    },
    customers,
    activeCustomers,
    excludedCustomers,
    aging,
    total,
    customerCount: activeCustomers.length,
    excludedTotal: +excludedCustomers.reduce((s, c) => s + c.total, 0).toFixed(2),
  };
}

// History list (one entry per past snapshot).
export async function loadReceivablesSnapshots() {
  // Aggregate per snapshot — Postgres can do it but Supabase JS makes
  // group-by awkward, so we pull headers via DISTINCT-friendly query.
  const { data, error } = await supabase
    .from('customer_receivables')
    .select('snapshot_id, snapshot_date, source_file, uploaded_at, balance_amount, is_summary');
  if (error) throw error;
  const byId = new Map();
  for (const r of data || []) {
    if (!byId.has(r.snapshot_id)) {
      byId.set(r.snapshot_id, {
        snapshotId:    r.snapshot_id,
        snapshotDate:  r.snapshot_date,
        sourceFile:    r.source_file,
        uploadedAt:    r.uploaded_at,
        customerCount: 0,
        total:         0,
      });
    }
    const s = byId.get(r.snapshot_id);
    if (r.is_summary) {
      s.customerCount++;
      s.total += Number(r.balance_amount) || 0;
    }
  }
  for (const s of byId.values()) s.total = +s.total.toFixed(2);
  return [...byId.values()].sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
}

export async function deleteReceivablesSnapshot(snapshotId) {
  if (!snapshotId) throw new Error('snapshotId مطلوب');
  const { data, error } = await supabase
    .from('customer_receivables')
    .delete()
    .eq('snapshot_id', snapshotId)
    .select('id');
  if (error) throw error;
  return data?.length || 0;
}

// ── Customer settings (excluded / priority tags) ──────────────────
// These flags persist across snapshots — the customer name is the
// natural key. Tagging "Foodie" as excluded once is enough; they stay
// excluded on every future snapshot until the user reverses it.

export async function loadCustomerStatuses() {
  const { data, error } = await supabase
    .from('customer_settings')
    .select('customer_name, status, notes, updated_at');
  if (error) throw error;
  const map = new Map();
  for (const r of data || []) {
    map.set(r.customer_name, {
      status:    r.status,
      notes:     r.notes,
      updatedAt: r.updated_at,
    });
  }
  return map;
}

export async function setCustomerStatus({ customerName, status, notes, userId }) {
  if (!customerName) throw new Error('customer name مطلوب');
  if (!['normal', 'excluded', 'priority'].includes(status)) {
    throw new Error(`status غير صالح: ${status}`);
  }
  // 'normal' = default → clear the row to keep the table small.
  if (status === 'normal' && !notes) {
    const { error } = await supabase
      .from('customer_settings')
      .delete()
      .eq('customer_name', customerName);
    if (error) throw error;
    return null;
  }
  const { data, error } = await supabase
    .from('customer_settings')
    .upsert({
      customer_name: customerName,
      status,
      notes:         notes || null,
      updated_by:    userId || null,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'customer_name' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
