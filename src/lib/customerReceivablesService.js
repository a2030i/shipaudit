// Customer receivables (AR) service.
//
// READ-ONLY view over the Zoho Books mirror. Legacy uploaded snapshots
// remain supported as a fallback/import tool, but Zoho is the source of
// truth for customer receivables now.
//
// When the merchants directory has been imported AND the customer→
// store map has been populated (see merchantsService.autoLinkCustomers),
// loadLatestReceivables overlays each customer with:
//   storeId, phone, billingType, status, shipmentCount,
//   lastShipmentAt, walletBalance
// so the UI can colour-code anomalies (prepaid-with-debt, postpaid
// long-overdue, dormant-with-debt) and the collection-campaign export
// has the contact info.
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
import { loadLatestMerchants } from './merchantsService.js';

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

  // Auto-link the new customers to merchants right after upload, so the
  // overlay + collection campaigns pick them up WITHOUT a manual «ربط
  // تلقائي» click. autoLinkCustomers skips existing manual links and uses
  // the segment-aware bulk_match RPC, so compound Zoho names like «مؤسسة X
  // - متجر Y» link to merchant «متجر Y» correctly. Non-fatal: the snapshot
  // is already saved; linking is enrichment, so a failure here must not
  // surface as an upload error. Dynamic import avoids a circular dep.
  let linkedCount = 0;
  try {
    const names = [...new Set(parsed.rows.map(r => r.customer).filter(Boolean))];
    const { autoLinkCustomers } = await import('./merchantsService.js');
    const res = await autoLinkCustomers(names, null, { userId });
    linkedCount = [...res.values()].filter(l => l?.storeId).length;
  } catch (e) {
    console.info('[receivables] post-upload auto-link skipped:', e.message);
  }

  return {
    snapshotId,
    snapshotDate,
    customerCount: inserts.filter(r => r.is_summary).length,
    invoiceCount:  inserts.filter(r => !r.is_summary).length,
    total: +total.toFixed(2),
    linkedCount,
  };
}

const PAGE = 1000;
async function loadAll(table, columns, filters = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    // STABLE order required — without it Postgres may return overlapping
    // rows across .range() pages once a table exceeds 1000, double-counting.
    // 'id' exists on every table passed here (customer_receivables).
    let q = supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + PAGE - 1);
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

function emptyReceivables() {
  return {
    snapshot: null,
    customers: [],
    activeCustomers: [],
    excludedCustomers: [],
    aging: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
    total: 0,
    customerCount: 0,
    excludedTotal: 0,
  };
}

async function loadOpenZohoInvoices() {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('zoho_invoices')
      .select('zoho_id, invoice_number, customer_name, date, total, balance, status, synced_at')
      .gt('balance', 0.5)
      .order('zoho_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function latestZohoInvoicesSyncAt() {
  const { data } = await supabase
    .from('zoho_sync_state')
    .select('last_sync')
    .eq('entity', 'invoices')
    .maybeSingle();
  return data?.last_sync || null;
}

async function buildReceivablesFromRows({ all, snapshot }) {
  if (!all?.length) return emptyReceivables();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const byCustomer = new Map();
  for (const r of all) {
    const name = r.customer_name;
    if (!name) continue;
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
        invoiceNumber: r.invoice_number || null,
        status: r.status || null,
      });
      if (r.invoice_date && (!c.oldestInvoiceDate || r.invoice_date < c.oldestInvoiceDate)) {
        c.oldestInvoiceDate = r.invoice_date;
      }
    }
  }

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
    const breakdown = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const inv of c.invoices) {
      if (!inv.date) continue;
      const d = Math.floor((today - new Date(inv.date)) / 86_400_000);
      breakdown[ageBucket(d)] += Number(inv.amount) || 0;
    }
    for (const k of Object.keys(breakdown)) breakdown[k] = +breakdown[k].toFixed(2);
    c.bucketAmounts = breakdown;
  }

  const statuses           = await loadCustomerStatuses();
  const defaultCreditLimit = await loadDefaultCreditLimit();
  let writeoffs = new Map();
  try {
    const { loadApprovedWriteoffsByCustomer } = await import('./writeoffsService.js');
    writeoffs = await loadApprovedWriteoffsByCustomer();
  } catch { /* ignore */ }

  for (const c of byCustomer.values()) {
    const s = statuses.get(c.name);
    c.status          = s?.status || 'normal';
    c.notes           = s?.notes  || null;
    c.creditLimit     = s?.creditLimit != null ? s.creditLimit : defaultCreditLimit;
    c.isCustomLimit   = s?.creditLimit != null;
    c.creditLimitNote = s?.creditLimitNote || null;
    const writtenOff  = writeoffs.get(c.name) || 0;
    c.totalGross      = c.total;
    c.writtenOff      = +writtenOff.toFixed(2);
    c.total           = +(c.totalGross - writtenOff).toFixed(2);
    c.creditUsedPct   = c.creditLimit > 0 ? +((c.total / c.creditLimit) * 100).toFixed(1) : 0;
    c.overLimit       = c.total > c.creditLimit + 0.01;
  }

  try {
    const [{ data: linkRows }, merchantsResult] = await Promise.all([
      supabase.from('customer_merchant_links').select('customer_name, store_id, confidence, match_method'),
      loadLatestMerchants(),
    ]);
    const latestMerchants = merchantsResult?.merchants || [];
    const linkByName = new Map((linkRows || []).map(r => [r.customer_name, r]));
    const merchantById = new Map(latestMerchants.map(m => [m.store_id, m]));
    for (const c of byCustomer.values()) {
      const link = linkByName.get(c.name);
      if (!link?.store_id) {
        c.merchant = null;
        c.merchantMatch = link ? { method: link.match_method, confidence: link.confidence } : null;
        continue;
      }
      const m = merchantById.get(link.store_id);
      if (!m) {
        c.merchant = null;
        c.merchantMatch = { method: link.match_method, confidence: link.confidence };
        continue;
      }
      c.merchant = {
        storeId:           m.store_id,
        storeName:         m.store_name,
        phone:             m.phone,
        billingType:       m.billing_type,
        platformStatus:    m.status,
        profileStatus:     m.profile_status,
        vatRegistered:     m.vat_registered === true,
        zatcaCompleted:    m.zatca_completed === true,
        verificationStatus:m.verification_status,
        integrationType:   m.integration_type,
        shipmentCount:     m.shipment_count,
        lastShipmentAt:    m.last_shipment_at,
        createdAtPlatform: m.created_at_platform,
        lastTopupAt:       m.last_topup_at,
        walletBalance:     Number(m.wallet_balance) || 0,
      };
      c.merchantMatch = { method: link.match_method, confidence: link.confidence };
    }
  } catch (e) {
    console.info('[receivables] merchant overlay skipped:', e.message);
  }

  const customers = [...byCustomer.values()].sort((a, b) => b.total - a.total);
  const activeCustomers   = customers.filter(c => c.status !== 'excluded');
  const excludedCustomers = customers.filter(c => c.status === 'excluded');
  const total = +activeCustomers.reduce((s, c) => s + c.total, 0).toFixed(2);
  const excludedNameSet = new Set(excludedCustomers.map(c => c.name));
  const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const r of all) {
    if (r.is_summary || !r.invoice_date) continue;
    if (excludedNameSet.has(r.customer_name)) continue;
    const days = Math.floor((today - new Date(r.invoice_date)) / 86_400_000);
    aging[ageBucket(days)] += Number(r.balance_amount) || 0;
  }
  for (const k of Object.keys(aging)) aging[k] = +aging[k].toFixed(2);

  return {
    snapshot,
    customers,
    activeCustomers,
    excludedCustomers,
    aging,
    total,
    customerCount: activeCustomers.length,
    excludedTotal: +excludedCustomers.reduce((s, c) => s + c.total, 0).toFixed(2),
  };
}

async function loadZohoReceivables() {
  const invoices = await loadOpenZohoInvoices();
  const all = invoices
    .filter(r => r.customer_name)
    .map(r => ({
      id: r.zoho_id,
      customer_name: r.customer_name,
      invoice_date: r.date,
      balance_amount: Number(r.balance) || 0,
      is_summary: false,
      invoice_number: r.invoice_number,
      status: r.status,
    }));
  if (!all.length) return emptyReceivables();
  const syncAt = await latestZohoInvoicesSyncAt();
  const rowsSyncAt = invoices.reduce((max, r) => (
    !r.synced_at || (max && r.synced_at <= max) ? max : r.synced_at
  ), null);
  return buildReceivablesFromRows({
    all,
    snapshot: {
      id: 'zoho_live',
      date: new Date().toISOString().slice(0, 10),
      periodFrom: null,
      periodTo: null,
      sourceFile: 'Zoho Books API',
      uploadedAt: syncAt || rowsSyncAt || new Date().toISOString(),
      source: 'zoho',
    },
  });
}

// Returns open customer receivables rolled up per customer + aging totals.
// Zoho mirror is tried first; uploaded snapshots are a fallback only.
export async function loadLatestReceivables() {
  try {
    const live = await loadZohoReceivables();
    if (live.customerCount > 0) return live;
  } catch (e) {
    console.info('[receivables] Zoho mirror unavailable, falling back to legacy snapshot:', e.message);
  }
  return loadLegacySnapshotReceivables();
}

// Returns the LATEST legacy snapshot rolled up per customer + aging totals.
async function loadLegacySnapshotReceivables() {
  // 1) Find the most-recent snapshot_id
  const { data: latest, error: e1 } = await supabase
    .from('customer_receivables')
    .select('snapshot_id, snapshot_date, period_from, period_to, source_file, uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  if (e1) throw e1;
  if (!latest?.length) {
    return emptyReceivables();
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

  // Overlay the per-customer status tags + credit limits + approved
  // bad-debt write-offs. Each customer carries:
  //   creditLimit          — effective ceiling (override or global default)
  //   creditUsedPct        — total / creditLimit * 100
  //   overLimit            — boolean, true when current debt > limit
  //   isCustomLimit        — true when a per-customer override is set
  //   writtenOff           — sum of approved write-offs
  //   totalGross           — original snapshot total (untouched)
  //   total                — effective balance = totalGross − writtenOff
  const statuses           = await loadCustomerStatuses();
  const defaultCreditLimit = await loadDefaultCreditLimit();
  // Write-offs overlay — best-effort, no hard failure if the helper
  // isn't reachable. Customer-receivables stays usable even when
  // the write-off table is missing.
  let writeoffs = new Map();
  try {
    const { loadApprovedWriteoffsByCustomer } = await import('./writeoffsService.js');
    writeoffs = await loadApprovedWriteoffsByCustomer();
  } catch { /* ignore */ }
  for (const c of byCustomer.values()) {
    const s = statuses.get(c.name);
    c.status          = s?.status || 'normal';
    c.notes           = s?.notes  || null;
    c.creditLimit     = s?.creditLimit != null ? s.creditLimit : defaultCreditLimit;
    c.isCustomLimit   = s?.creditLimit != null;
    c.creditLimitNote = s?.creditLimitNote || null;
    // Apply approved write-offs: keep the original gross total
    // visible alongside the effective one so the UI can show
    // "5,000 ر.س مديونية − 3,000 ر.س شطب = 2,000 ر.س متبقي".
    const writtenOff  = writeoffs.get(c.name) || 0;
    c.totalGross      = c.total;
    c.writtenOff      = +writtenOff.toFixed(2);
    c.total           = +(c.totalGross - writtenOff).toFixed(2);
    c.creditUsedPct   = c.creditLimit > 0 ? +((c.total / c.creditLimit) * 100).toFixed(1) : 0;
    c.overLimit       = c.total > c.creditLimit + 0.01;
  }

  // Overlay the merchant directory (if uploaded). Joins via the
  // persistent customer_merchant_links table — auto-fuzzy + manual
  // overrides both come through here. Resilient: any failure in this
  // path leaves the receivables data untouched, no merchant fields
  // added, anomalies tab degrades gracefully.
  try {
    // Static imports for both halves — the previous dynamic
    // import(`./merchantsService.js`) inside an IIFE swallowed errors
    // silently, leaving merchantById empty in production. Result: every
    // customer's link.store_id check failed → all customers tagged as
    // unlinked even when 80+ were genuinely linked. Static import +
    // explicit destructure means a real error now surfaces in the catch
    // below instead of corrupting the overlay.
    const [{ data: linkRows }, merchantsResult] = await Promise.all([
      supabase.from('customer_merchant_links').select('customer_name, store_id, confidence, match_method'),
      loadLatestMerchants(),
    ]);
    const latestMerchants = merchantsResult?.merchants || [];
    const linkByName = new Map((linkRows || []).map(r => [r.customer_name, r]));
    const merchantById = new Map(latestMerchants.map(m => [m.store_id, m]));
    for (const c of byCustomer.values()) {
      const link = linkByName.get(c.name);
      if (!link?.store_id) {
        c.merchant = null;
        c.merchantMatch = link ? { method: link.match_method, confidence: link.confidence } : null;
        continue;
      }
      const m = merchantById.get(link.store_id);
      if (!m) {
        c.merchant = null;
        c.merchantMatch = { method: link.match_method, confidence: link.confidence };
        continue;
      }
      c.merchant = {
        storeId:           m.store_id,
        storeName:         m.store_name,
        phone:             m.phone,
        billingType:       m.billing_type,
        platformStatus:    m.status,
        profileStatus:     m.profile_status,
        vatRegistered:     m.vat_registered === true,
        zatcaCompleted:    m.zatca_completed === true,
        verificationStatus:m.verification_status,
        integrationType:   m.integration_type,
        shipmentCount:     m.shipment_count,
        lastShipmentAt:    m.last_shipment_at,
        // Operational signals — "is this store alive right now?". The
        // anomaly modal renders them so the operator can tell at a glance
        // whether to chase the debt (active store), suspend (idle), or
        // skip (already inactive in the platform).
        createdAtPlatform: m.created_at_platform,
        lastTopupAt:       m.last_topup_at,
        walletBalance:     Number(m.wallet_balance) || 0,
      };
      c.merchantMatch = { method: link.match_method, confidence: link.confidence };
    }
  } catch (e) {
    // No merchants snapshot or links table not populated yet — that's
    // fine, the receivables view still works without enrichment.
    console.info('[receivables] merchant overlay skipped:', e.message);
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
      source:     'legacy_snapshot',
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
    .select('customer_name, status, notes, credit_limit_sar, credit_limit_note, updated_at');
  if (error) throw error;
  const map = new Map();
  for (const r of data || []) {
    map.set(r.customer_name, {
      status:           r.status,
      notes:            r.notes,
      creditLimit:      r.credit_limit_sar != null ? Number(r.credit_limit_sar) : null,
      creditLimitNote:  r.credit_limit_note || null,
      updatedAt:        r.updated_at,
    });
  }
  return map;
}

// Load the global default credit limit (SAR) from app_settings.
// Cached in module scope after first read because it's tiny and
// almost never changes mid-session.
let _defaultCreditLimit = null;
export async function loadDefaultCreditLimit() {
  if (_defaultCreditLimit != null) return _defaultCreditLimit;
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', 'default_credit_limit_sar').maybeSingle();
  _defaultCreditLimit = Number(data?.value) || 10000;
  return _defaultCreditLimit;
}
export async function setDefaultCreditLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('قيمة غير صالحة');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'default_credit_limit_sar', value: String(n), updated_at: new Date().toISOString() },
            { onConflict: 'key' });
  if (error) throw error;
  _defaultCreditLimit = n;
  return n;
}

// Per-customer credit limit override. Pass `value = null` to clear
// the override and fall back to the global default.
// Statement of Account (كشف حساب) — single-customer financial
// statement covering the latest receivables snapshot. Returns the
// data structure the Excel exporter renders against:
//
//   header:   customer name, phone, store id, credit limit, dates
//   lines:    array of { date, description, debit, credit, balance }
//             ordered oldest first with a running balance column
//   summary:  total invoices, total written off, effective balance
//   aging:    bucketed breakdown of the open balance
//
// All amounts in SAR. Uses Zoho open invoices plus any approved write-offs
// to date, with a legacy snapshot fallback for old environments.
export async function loadCustomerSOA(customerName) {
  if (!customerName?.trim()) throw new Error('اسم العميل مطلوب');

  let snapshotId = 'zoho_live';
  let invoiceLines = [];
  try {
    const { data: zohoInvoices, error: zohoError } = await supabase
      .from('zoho_invoices')
      .select('invoice_number, date, balance')
      .eq('customer_name', customerName)
      .gt('balance', 0.5)
      .order('date', { ascending: true });
    if (zohoError) throw zohoError;
    invoiceLines = (zohoInvoices || [])
      .filter(r => r.date)
      .map(r => ({
        date:        r.date,
        description: `فاتورة ${r.invoice_number || r.date}`,
        debit:       Number(r.balance) || 0,
        credit:      0,
      }));
  } catch (e) {
    console.info('[receivables] SOA Zoho invoices unavailable, falling back to legacy snapshot:', e.message);
  }

  if (!invoiceLines.length) {
    const { data: latest } = await supabase
      .from('customer_receivables').select('snapshot_id')
      .order('uploaded_at', { ascending: false }).limit(1);
    snapshotId = latest?.[0]?.snapshot_id;
    if (!snapshotId) throw new Error('لا توجد فواتير مفتوحة في زوهو ولا كشوف فواتير مرفوعة');

    const { data: invoices } = await supabase
      .from('customer_receivables')
      .select('invoice_date, balance_amount, is_summary')
      .eq('snapshot_id', snapshotId)
      .eq('customer_name', customerName);
    invoiceLines = (invoices || [])
      .filter(r => !r.is_summary && r.invoice_date)
      .map(r => ({
        date:        r.invoice_date,
        description: `فاتورة ${r.invoice_date}`,
        debit:       Number(r.balance_amount) || 0,
        credit:      0,
      }));
  }

  // Approved write-offs as credit lines
  const { data: writeoffs } = await supabase
    .from('bad_debt_writeoffs')
    .select('amount, reason, reviewed_at, requested_at')
    .eq('customer_name', customerName)
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: true });
  const writeoffLines = (writeoffs || []).map(w => ({
    date:        (w.reviewed_at || w.requested_at)?.slice(0, 10),
    description: `شطب دين — ${w.reason || ''}`.trim(),
    debit:       0,
    credit:      Number(w.amount) || 0,
  }));

  // Merge + sort by date, then compute running balance
  const allLines = [...invoiceLines, ...writeoffLines]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let running = 0;
  for (const ln of allLines) {
    running += (ln.debit - ln.credit);
    ln.balance = +running.toFixed(2);
  }

  // Customer metadata — phone + credit limit from settings/merchants
  const { data: settingsRow } = await supabase
    .from('customer_settings')
    .select('credit_limit_sar, credit_limit_note, status')
    .eq('customer_name', customerName).maybeSingle();
  const defaultLimit = await loadDefaultCreditLimit();
  const creditLimit  = settingsRow?.credit_limit_sar != null
    ? Number(settingsRow.credit_limit_sar)
    : defaultLimit;

  // Try to pull phone via the customer_merchant_links → merchants
  // chain. Best-effort, no hard failure.
  let phone = null, storeId = null;
  try {
    const { data: link } = await supabase
      .from('customer_merchant_links').select('store_id')
      .eq('customer_name', customerName).maybeSingle();
    if (link?.store_id) {
      storeId = link.store_id;
      const { data: latestMer } = await supabase
        .from('merchants').select('snapshot_id')
        .order('uploaded_at', { ascending: false }).limit(1);
      if (latestMer?.[0]?.snapshot_id) {
        const { data: m } = await supabase
          .from('merchants').select('phone, store_name')
          .eq('snapshot_id', latestMer[0].snapshot_id)
          .eq('store_id', link.store_id).maybeSingle();
        if (m?.phone) phone = m.phone;
      }
    }
  } catch { /* ignore */ }

  // Aging buckets — recompute from the current invoice lines using
  // the same rules as the receivables overview.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const aging = { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const ln of invoiceLines) {
    const d = new Date(ln.date);
    const days = Math.floor((today - d) / 86_400_000);
    const amt  = ln.debit;
    if      (days <= 30) aging.current  += amt;
    else if (days <= 60) aging.d31_60   += amt;
    else if (days <= 90) aging.d61_90   += amt;
    else                 aging.d90_plus += amt;
  }
  for (const k of Object.keys(aging)) aging[k] = +aging[k].toFixed(2);

  const totalInvoices  = invoiceLines.reduce((s, r) => s + r.debit, 0);
  const totalWrittenOff = writeoffLines.reduce((s, r) => s + r.credit, 0);
  const effectiveBalance = +(totalInvoices - totalWrittenOff).toFixed(2);

  return {
    header: {
      customerName,
      phone,
      storeId,
      creditLimit,
      creditLimitNote: settingsRow?.credit_limit_note || null,
      asOf:        today.toISOString().slice(0, 10),
      snapshotId,
    },
    lines: allLines,
    summary: {
      invoiceCount:     invoiceLines.length,
      writeoffCount:    writeoffLines.length,
      totalInvoices:    +totalInvoices.toFixed(2),
      totalWrittenOff:  +totalWrittenOff.toFixed(2),
      effectiveBalance,
      overLimit:        effectiveBalance > creditLimit + 0.01,
    },
    aging,
  };
}

export async function setCustomerCreditLimit({ customerName, value, note = null, userId = null }) {
  if (!customerName) throw new Error('اسم العميل مطلوب');
  // Read existing row so we can preserve status/notes on update
  const { data: existing } = await supabase
    .from('customer_settings').select('*').eq('customer_name', customerName).maybeSingle();
  const payload = {
    customer_name:       customerName,
    status:              existing?.status   || 'normal',
    notes:               existing?.notes    || null,
    credit_limit_sar:    value == null ? null : Number(value),
    credit_limit_note:   note?.trim() || null,
    updated_by:          userId || null,
    updated_at:          new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('customer_settings')
    .upsert(payload, { onConflict: 'customer_name' })
    .select()
    .single();
  if (error) throw error;
  return data;
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
