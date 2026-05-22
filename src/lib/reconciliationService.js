// Store-balance reconciliation service.
//
// Two upload paths feed the same store_balances table:
//   • parseInternalSettlement(rows)  — the platform's internal
//     استحقاق المتاجر export (cols: المتجر, الرصيد)
//   • parseZohoCustomerBalances(rows) — Zoho Books "Customer Balances"
//     export (cols: Customer Name, Closing Balance / Outstanding)
//
// Each row gets matched to a merchants.store_id at upload time using
// the same normalize_arabic_name + bulk_match_customers infrastructure
// we built earlier — so an unsubmitted Zoho name like "Konhub LLC"
// can still resolve to the right merchant even though Zoho doesn't
// know about platform store_ids.
//
// loadReconciliation() returns one row per store from the
// balance_reconciliation() RPC, sorted by largest discrepancy first.

import { supabase } from './supabase.js';

// ── shared chunked insert helper ──
const INSERT_CHUNK = 500;

// ── header resolution ─────────────────────────────────────────
// Tolerant lookup: we look up each field by a list of header
// synonyms so re-orderings or minor renaming don't break parsing.
function findIdx(headerRow, keys) {
  const lc = (s) => String(s ?? '').trim().toLowerCase();
  const lower = headerRow.map(lc);
  for (const k of keys) {
    const i = lower.findIndex(c => c.includes(lc(k)));
    if (i >= 0) return i;
  }
  return -1;
}

// ── Parse the internal store_settlement.xlsx ──
// Columns are simple: المتجر | الرصيد.
// Sign convention from the file: negative = store owes us (مدين),
// positive = we owe the store (دائن). We preserve the sign as-is.
export function parseInternalSettlement(rows) {
  if (!rows?.length) return { rows: [], errors: ['ملف فارغ'] };
  const head = rows[0] || [];
  const nameIdx = findIdx(head, ['المتجر', 'store name', 'merchant']);
  const balIdx  = findIdx(head, ['الرصيد', 'balance']);
  if (nameIdx < 0 || balIdx < 0) {
    return { rows: [], errors: [`أعمدة مطلوبة غير موجودة. الأعمدة المتاحة: ${head.join(', ')}`] };
  }
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = String(r[nameIdx] ?? '').trim();
    const bal  = Number(r[balIdx]);
    if (!name) continue;
    if (!Number.isFinite(bal)) continue;
    out.push({ raw_name: name, balance: +bal.toFixed(2) });
  }
  return { rows: out, errors: [] };
}

// ── Parse a Zoho Customer Balances export ──
// Zoho exports vary slightly across editions but the canonical
// English headers are: "Customer Name", "Closing Balance" /
// "Outstanding Balance" / "Balance". We accept any of those.
// If the user's Zoho is Arabic-localized we'll add the
// translations once we see a sample.
export function parseZohoCustomerBalances(rows) {
  if (!rows?.length) return { rows: [], errors: ['ملف فارغ'] };
  // Some Zoho exports have a logo/title row at the top. Find the
  // actual header row by scanning for one that contains the
  // "Customer Name" column.
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').toLowerCase());
    if (r.some(c => c.includes('customer name')) || r.some(c => c.includes('اسم العميل'))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) return { rows: [], errors: ['لم نجد صف العنوان "Customer Name" — تأكّد من التصدير'] };
  const head = rows[headerRow] || [];
  const nameIdx = findIdx(head, ['customer name', 'اسم العميل', 'name']);
  // Try several balance column names. Zoho also has "Invoice
  // Balance" which we DON'T want (that's per-invoice).
  const balIdx  = findIdx(head, ['closing balance', 'outstanding balance', 'الرصيد المتبقي', 'الرصيد الختامي', 'balance']);
  if (nameIdx < 0 || balIdx < 0) {
    return { rows: [], errors: [`أعمدة مطلوبة غير موجودة. الأعمدة المتاحة: ${head.join(', ')}`] };
  }
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = String(r[nameIdx] ?? '').trim();
    const bal  = Number(r[balIdx]);
    if (!name) continue;
    if (!Number.isFinite(bal)) continue;
    out.push({ raw_name: name, balance: +bal.toFixed(2) });
  }
  return { rows: out, errors: [] };
}

// ── Resolve every raw_name to a merchant store_id ──
// Internal export names mostly match merchants.store_name exactly,
// but some have whitespace / prefix variations — so we ALSO send the
// unmatched ones through bulk_match_customers for fuzzy fallback.
async function resolveStoreIds(parsed) {
  if (!parsed.length) return parsed;

  // Step 1: exact match against latest merchants snapshot, normalized.
  const { data: latestSnap } = await supabase
    .from('merchants').select('snapshot_id').order('uploaded_at', { ascending: false }).limit(1);
  if (!latestSnap?.length) {
    // No merchants snapshot uploaded — leave all unmatched.
    return parsed.map(r => ({ ...r, store_id: null, match_method: 'unmatched', match_confidence: 0 }));
  }
  const snapshotId = latestSnap[0].snapshot_id;

  // Pull every store name from the latest snapshot
  const { data: merchants } = await supabase
    .from('merchants').select('store_id, store_name').eq('snapshot_id', snapshotId);

  // Normalize using the SAME rules pg_trgm uses server-side
  const norm = (s) => String(s ?? '')
    .toLowerCase()
    .replace(/[ًٌٍَُِّْٰ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/^\s*(?:متجر|شركة|مؤسسة|مؤسسه|شركه|m1|l1)\s+/i, '')
    .replace(/[\s\-_|/\\.،,]+/g, ' ')
    .trim();

  const byNorm = new Map();
  for (const m of (merchants || [])) {
    const k = norm(m.store_name);
    if (k && !byNorm.has(k)) byNorm.set(k, m.store_id);
  }

  const resolved = [];
  const unmatched = [];
  for (const r of parsed) {
    const k = norm(r.raw_name);
    const sid = byNorm.get(k);
    if (sid) {
      resolved.push({ ...r, store_id: sid, match_method: 'exact', match_confidence: 1.0 });
    } else {
      unmatched.push(r);
    }
  }

  // Step 2: fall back to trigram fuzzy match for the unmatched
  if (unmatched.length) {
    const names = unmatched.map(r => r.raw_name);
    const { data: fuzzy } = await supabase.rpc('bulk_match_customers', {
      p_names:     names,
      p_threshold: 0.78,
    });
    const fuzzyMap = new Map((fuzzy || []).map(m => [m.customer_name, m]));
    for (const r of unmatched) {
      const m = fuzzyMap.get(r.raw_name);
      if (m) resolved.push({ ...r, store_id: m.store_id, match_method: 'fuzzy', match_confidence: Number(m.confidence) });
      else   resolved.push({ ...r, store_id: null,         match_method: 'unmatched', match_confidence: 0 });
    }
  }

  return resolved;
}

// ── Upload helper used by both internal + Zoho paths ──
export async function uploadBalanceSnapshot({ source, parsed, fileName, userId }) {
  if (!['internal','zoho'].includes(source)) throw new Error('source غير صالح');
  if (!parsed?.length) throw new Error('لا توجد صفوف صالحة');

  const resolved = await resolveStoreIds(parsed);
  const matchedCount = resolved.filter(r => r.store_id).length;
  const totalBalance = +resolved.reduce((s, r) => s + (Number(r.balance) || 0), 0).toFixed(2);

  // Create the snapshot header
  const { data: snap, error: e1 } = await supabase
    .from('store_balance_snapshots')
    .insert({
      source,
      file_name:     fileName || null,
      row_count:     resolved.length,
      matched_count: matchedCount,
      total_balance: totalBalance,
      uploaded_by:   userId || null,
    })
    .select()
    .single();
  if (e1) throw e1;

  // Insert the rows (chunked)
  const payload = resolved.map(r => ({
    snapshot_id:      snap.id,
    source,
    raw_name:         r.raw_name,
    store_id:         r.store_id,
    balance:          r.balance,
    match_method:     r.match_method,
    match_confidence: r.match_confidence,
  }));
  for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
    const chunk = payload.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from('store_balances').insert(chunk);
    if (error) throw error;
  }
  return { snapshotId: snap.id, rowCount: resolved.length, matched: matchedCount, totalBalance };
}

export async function listBalanceSnapshots() {
  const { data, error } = await supabase
    .from('store_balance_snapshots')
    .select('*')
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteBalanceSnapshot(id) {
  if (!id) throw new Error('id مطلوب');
  const { error } = await supabase.from('store_balance_snapshots').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}

// ── The 3-way reconciliation view ──
export async function loadReconciliation() {
  const { data, error } = await supabase.rpc('balance_reconciliation');
  if (error) throw error;
  const rows = (data || []).map(r => ({
    storeId:           r.store_id,
    storeName:         r.store_name || r.internal_raw_name || r.zoho_raw_name || r.store_id,
    internal:          Number(r.internal_balance)    || 0,
    zoho:              Number(r.zoho_balance)        || 0,
    receivables:       Number(r.receivables_balance) || 0,
    maxDiff:           Number(r.max_diff)            || 0,
    internalRawName:   r.internal_raw_name,
    zohoRawName:       r.zoho_raw_name,
  }));
  return rows;
}
