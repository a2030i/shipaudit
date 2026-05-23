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
// Zoho's Arabic export ("ملخص أرصدة العملاء") has its quirks:
//   1. Row 0 is a multi-line title with the company name + date
//      range — skip it.
//   2. The header columns are "اسم العملاء" (plural form, not the
//      "اسم العميل" we might guess) and "مبلغ الذمة المدينة"
//      (literally "Receivable amount", not "closing balance").
//   3. Balance values are formatted as strings like "SAR20,322.59"
//      with a "SAR" prefix and thousands commas. Numeric parsing
//      requires stripping both before Number().
//   4. The last data row is a totals row labelled "الإجمالي" — skip
//      it or we'll double-count the grand total as a customer.
//   5. Trailing empty rows at the bottom.
// English-edition headers (Customer Name + Closing Balance) also
// accepted for users on the English locale.
function parseZohoAmount(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  // Strip "SAR" / "ر.س" / commas / whitespace / Arabic comma /
  // surrounding parens (Zoho uses parens for negatives in some
  // editions).
  let s = String(raw).trim();
  const negative = /^\(.*\)$/.test(s);
  if (negative) s = s.slice(1, -1);
  s = s.replace(/sar/gi, '')
       .replace(/ر\.?\s*س\.?/g, '')
       .replace(/[,،]/g, '')
       .replace(/\s/g, '')
       .trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const ZOHO_TOTAL_LABELS = ['الإجمالي', 'الاجمالي', 'total', 'grand total', 'المجموع'];

export function parseZohoCustomerBalances(rows) {
  if (!rows?.length) return { rows: [], errors: ['ملف فارغ'] };
  // Find the header row by scanning the first 15 rows for the
  // customer-name column (English or Arabic).
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').toLowerCase());
    if (r.some(c => c.includes('customer name'))
        || r.some(c => c.includes('اسم العميل'))
        || r.some(c => c.includes('اسم العملاء'))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) return { rows: [], errors: ['لم نجد صف العنوان "اسم العملاء" — تأكّد من التصدير'] };
  const head = rows[headerRow] || [];
  const nameIdx = findIdx(head, ['customer name', 'اسم العملاء', 'اسم العميل', 'name']);
  // "مبلغ الذمة المدينة" = Zoho-Arabic for "AR amount" (what we
  // need). Also accept Closing/Outstanding Balance for English.
  const balIdx  = findIdx(head, [
    'مبلغ الذمة المدينة', 'مبلغ الذمم المدينة',
    'closing balance', 'outstanding balance',
    'الرصيد المتبقي', 'الرصيد الختامي', 'balance',
  ]);
  if (nameIdx < 0 || balIdx < 0) {
    return { rows: [], errors: [`أعمدة مطلوبة غير موجودة. الأعمدة المتاحة: ${head.filter(Boolean).join(' · ')}`] };
  }
  const out = [];
  let skippedTotal = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = String(r[nameIdx] ?? '').trim();
    if (!name) continue;
    // Skip totals row(s) — they'd otherwise be parsed as a customer
    // with a huge balance and double-count everything.
    const nameLower = name.toLowerCase();
    if (ZOHO_TOTAL_LABELS.some(t => nameLower === t.toLowerCase())) {
      skippedTotal++;
      continue;
    }
    const bal = parseZohoAmount(r[balIdx]);
    if (bal == null) continue;
    out.push({ raw_name: name, balance: +bal.toFixed(2) });
  }
  return { rows: out, errors: [] };
}

// ── Resolve every raw_name to a merchant store_id ──
// Three-tier matching, cheapest first:
//   Tier 1: customer_merchant_links — the operator has already
//           linked customer_name → store_id from receivables work.
//           Zoho customer names match receivables names 1:1 in
//           practice, so this tier covers most rows for free.
//   Tier 2: exact match against normalize_arabic_name(merchants.
//           store_name). Catches internal-system files where the
//           store name IS the platform store name.
//   Tier 3: bulk_match_customers RPC (pg_trgm + segment splitting)
//           for anything still unmatched. Threshold 0.78.
async function resolveStoreIds(parsed) {
  if (!parsed.length) return parsed;

  // ── Tier 1: existing customer_merchant_links ──────────────
  // Pull all manual + auto links the operator has built. If a Zoho
  // name has already been resolved before (via the receivables
  // upload), we trust that mapping. Manual links especially must
  // never be overridden by a fresh fuzzy pass.
  const { data: links } = await supabase
    .from('customer_merchant_links')
    .select('customer_name, store_id, match_method, confidence')
    .not('store_id', 'is', null);
  const linkMap = new Map((links || []).map(l => [l.customer_name, l]));

  const resolved = [];
  const remaining = [];
  for (const r of parsed) {
    const link = linkMap.get(r.raw_name);
    if (link?.store_id) {
      resolved.push({
        ...r,
        store_id:         link.store_id,
        match_method:     `link-${link.match_method || 'auto'}`,
        match_confidence: Number(link.confidence) || 1.0,
      });
    } else {
      remaining.push(r);
    }
  }
  if (!remaining.length) return resolved;

  // ── Tier 2: exact match against latest merchants snapshot ──
  const { data: latestSnap } = await supabase
    .from('merchants').select('snapshot_id').order('uploaded_at', { ascending: false }).limit(1);
  if (latestSnap?.length) {
    const snapshotId = latestSnap[0].snapshot_id;
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

    const stillUnmatched = [];
    for (const r of remaining) {
      const k = norm(r.raw_name);
      const sid = byNorm.get(k);
      if (sid) {
        resolved.push({ ...r, store_id: sid, match_method: 'exact', match_confidence: 1.0 });
      } else {
        stillUnmatched.push(r);
      }
    }
    remaining.length = 0;
    remaining.push(...stillUnmatched);
  }
  if (!remaining.length) return resolved;

  // ── Tier 3: trigram fuzzy match (bulk_match_customers RPC) ──
  const names = remaining.map(r => r.raw_name);
  const { data: fuzzy } = await supabase.rpc('bulk_match_customers', {
    p_names:     names,
    p_threshold: 0.78,
  });
  const fuzzyMap = new Map((fuzzy || []).map(m => [m.customer_name, m]));
  for (const r of remaining) {
    const m = fuzzyMap.get(r.raw_name);
    if (m) resolved.push({ ...r, store_id: m.store_id, match_method: 'fuzzy', match_confidence: Number(m.confidence) });
    else   resolved.push({ ...r, store_id: null,         match_method: 'unmatched', match_confidence: 0 });
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

// ── Unmatched rows from the latest snapshot per source ──
// The balance_reconciliation() RPC hides anything without a
// store_id (it can't join on null). That makes the operator blind
// to "Zoho has 3K SAR for X but we don't know which store X is".
// This loader surfaces those names so they can be linked manually.
export async function loadUnmatchedBalances() {
  // Latest snapshot id per source (one query each — only 2 rows total)
  const [intRes, zohoRes] = await Promise.all([
    supabase.from('store_balance_snapshots')
      .select('id').eq('source', 'internal')
      .order('uploaded_at', { ascending: false }).limit(1),
    supabase.from('store_balance_snapshots')
      .select('id').eq('source', 'zoho')
      .order('uploaded_at', { ascending: false }).limit(1),
  ]);
  const ids = [intRes.data?.[0]?.id, zohoRes.data?.[0]?.id].filter(Boolean);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('store_balances')
    .select('source, raw_name, balance, match_method, snapshot_id')
    .in('snapshot_id', ids)
    .is('store_id', null)
    .order('balance', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data || []).map(r => ({
    source:    r.source,
    rawName:   r.raw_name,
    balance:   Number(r.balance) || 0,
    method:    r.match_method,
  }));
}

// Manually link an unmatched raw_name → store_id. Persists into
// customer_merchant_links (so future uploads auto-match) AND
// backfills the existing store_balances rows so the current
// reconciliation table shows the row immediately without a re-upload.
export async function linkUnmatchedToStore({ rawName, storeId, userId = null }) {
  if (!rawName?.trim()) throw new Error('اسم العميل مطلوب');
  if (!storeId)         throw new Error('اختر متجراً');

  // 1. Write the link (manual = highest priority, never overwritten
  //    by future auto-link runs)
  const { error: e1 } = await supabase
    .from('customer_merchant_links')
    .upsert({
      customer_name: rawName,
      store_id:      storeId,
      confidence:    1.0,
      match_method:  'manual',
      linked_by:     userId,
      linked_at:     new Date().toISOString(),
    }, { onConflict: 'customer_name' });
  if (e1) throw e1;

  // 2. Backfill every store_balances row carrying this raw_name
  //    that's still unmatched. Future uploads pick up the link
  //    automatically via the Tier 1 lookup in resolveStoreIds.
  const { error: e2 } = await supabase
    .from('store_balances')
    .update({
      store_id:         storeId,
      match_method:     'link-manual',
      match_confidence: 1.0,
    })
    .eq('raw_name', rawName)
    .is('store_id', null);
  if (e2) throw e2;

  return { ok: true };
}

// Searchable list of merchants from the latest snapshot — used by
// the manual-link picker when linking a Zoho-source unmatched row
// (it needs a Lamha merchant to anchor to). We pull the whole
// snapshot once and the UI filters client-side. By default we
// EXCLUDE merchants already linked to a customer (so the operator
// only sees fresh candidates), but the caller can request the full
// list if needed.
export async function loadMerchantsForPicker({ includeLinked = false } = {}) {
  const [latestRes, linksRes] = await Promise.all([
    supabase.from('merchants').select('snapshot_id').order('uploaded_at', { ascending: false }).limit(1),
    supabase.from('customer_merchant_links').select('store_id').not('store_id', 'is', null),
  ]);
  const latest = latestRes.data;
  if (!latest?.length) return [];

  const linkedIds = new Set((linksRes.data || []).map(r => r.store_id));

  const { data } = await supabase
    .from('merchants')
    .select('store_id, store_name, phone, status')
    .eq('snapshot_id', latest[0].snapshot_id)
    .order('store_name');
  return (data || [])
    .filter(m => includeLinked || !linkedIds.has(m.store_id))
    .map(m => ({
      storeId:   m.store_id,
      storeName: m.store_name,
      phone:     m.phone,
      status:    m.status,
      isLinked:  linkedIds.has(m.store_id),
    }));
}

// Unmatched Zoho-side raw names from the latest Zoho snapshot — used
// as candidates when the operator is linking a Lamha-internal row
// (the operator picks the Zoho equivalent). Returns just the row's
// raw_name + balance + store_id (null because unmatched). Excludes
// rows that are ALREADY matched (have store_id) — those are linked
// already and shouldn't reappear here.
export async function loadUnmatchedZohoForPicker() {
  // Latest Zoho snapshot
  const { data: latest } = await supabase
    .from('store_balance_snapshots')
    .select('id')
    .eq('source', 'zoho')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  if (!latest?.length) return [];
  const { data } = await supabase
    .from('store_balances')
    .select('raw_name, balance, match_method')
    .eq('snapshot_id', latest[0].id)
    .is('store_id', null)
    .order('raw_name');
  return (data || []).map(r => ({
    rawName: r.raw_name,
    balance: Number(r.balance) || 0,
    method:  r.match_method,
  }));
}

// Pair an internal-source unmatched row with a Zoho-source unmatched
// row — the operator's saying "these two ARE the same entity". We
// still need a store_id to anchor both into the reconciliation, so
// we fuzzy-match the internal name to a merchant; if found, both
// rows + a customer_merchant_links entry get the resolved store_id.
// If no merchant matches we error out — the operator needs to add
// the store to merchants first.
export async function linkInternalRowToZohoRow({
  internalRawName, zohoRawName, userId = null,
}) {
  if (!internalRawName?.trim()) throw new Error('اسم الصف الداخلي مطلوب');
  if (!zohoRawName?.trim())     throw new Error('اسم الصف من Zoho مطلوب');

  // Try fuzzy match the internal name to merchants (uses the same
  // pg_trgm-backed RPC the customer auto-link already uses).
  const { data: matches } = await supabase.rpc('bulk_match_customers', {
    p_names:     [internalRawName],
    p_threshold: 0.65,    // looser since the operator already
                          // confirmed the pair; we just need *a*
                          // merchant to anchor on
  });
  const match = (matches || [])[0];
  if (!match?.store_id) {
    throw new Error('لم نجد متجراً مطابقاً في كشف /merchants — أضف المتجر هناك أولاً ثم ارجع');
  }

  const storeId = match.store_id;

  // 1. Write the Zoho-name link (so future uploads auto-match)
  const { error: e1 } = await supabase
    .from('customer_merchant_links')
    .upsert({
      customer_name: zohoRawName,
      store_id:      storeId,
      confidence:    1.0,
      match_method:  'manual',
      linked_by:     userId,
      linked_at:     new Date().toISOString(),
    }, { onConflict: 'customer_name' });
  if (e1) throw e1;

  // 2. Backfill both rows in store_balances
  const { error: e2 } = await supabase
    .from('store_balances')
    .update({
      store_id:         storeId,
      match_method:     'link-manual-pair',
      match_confidence: 1.0,
    })
    .in('raw_name', [internalRawName, zohoRawName])
    .is('store_id', null);
  if (e2) throw e2;

  return { ok: true, storeId, storeName: match.store_name };
}

// ─────────────────────────────────────────────────────────────────
// VENDOR (carrier-side) reconciliation
// ─────────────────────────────────────────────────────────────────
//
// Parses the Zoho "ملخص أرصدة الموردين" export, matches each vendor
// row to one of our carriers (or marks as "other"), and the
// vendor_reconciliation() RPC compares per-carrier against our
// carrier_operations open balance.

// ── Parse vendor balance file ───────────────────────────────────
// Zoho format:
//   - Row 0: title block (multi-line)
//   - Row 1: headers "اسم المورد" / "الرصيد الختامي"
//   - Row 2+: data with values like "SAR1,747.98 Cr" or "SAR3.79 Dr"
//   - Last data row is "الإجمالي" (totals) — skip
//
// Cr (Credit) = we owe the vendor   → +ve in our signed model
// Dr (Debit)  = the vendor owes us  → -ve
function parseVendorAmount(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  // Pull off a trailing Cr/Dr indicator (case-insensitive, accept
  // RTL-mirror variants and Arabic letters too).
  let sign = 1;
  const drMatch = /\b(dr|د\.م)\b\s*$/i.exec(s);
  const crMatch = /\b(cr|د\.ك)\b\s*$/i.exec(s);
  if (drMatch) { sign = -1; s = s.replace(drMatch[0], ''); }
  else if (crMatch) { sign = 1; s = s.replace(crMatch[0], ''); }
  s = s.replace(/sar/gi, '')
       .replace(/ر\.?\s*س\.?/g, '')
       .replace(/[,،]/g, '')
       .replace(/\s/g, '')
       .trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return sign * n;
}

const VENDOR_TOTAL_LABELS = ['الإجمالي', 'الاجمالي', 'total', 'grand total', 'المجموع'];

export function parseZohoVendorBalances(rows) {
  if (!rows?.length) return { rows: [], errors: ['ملف فارغ'] };
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').toLowerCase());
    if (r.some(c => c.includes('اسم المورد')) ||
        r.some(c => c.includes('vendor name'))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) return { rows: [], errors: ['لم نجد صف العنوان "اسم المورد"'] };
  const head = rows[headerRow] || [];
  const nameIdx = findIdx(head, ['اسم المورد', 'vendor name', 'name']);
  const balIdx  = findIdx(head, ['الرصيد الختامي', 'closing balance', 'outstanding balance', 'balance']);
  if (nameIdx < 0 || balIdx < 0) {
    return { rows: [], errors: [`أعمدة مطلوبة غير موجودة: ${head.filter(Boolean).join(' · ')}`] };
  }
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = String(r[nameIdx] ?? '').trim();
    if (!name) continue;
    if (VENDOR_TOTAL_LABELS.some(t => name.toLowerCase() === t.toLowerCase())) continue;
    const bal = parseVendorAmount(r[balIdx]);
    if (bal == null) continue;
    out.push({ raw_name: name, balance: +bal.toFixed(2) });
  }
  return { rows: out, errors: [] };
}

// ── Match Zoho vendor names to our carriers ────────────────────
// The carriers table is small (~9 rows) so we do this client-side
// with a hand-curated alias map for the common variants Zoho prints
// (ايمايل vs آي مايل, اراميكس vs ارامكس, "شركة جي ان تي اكسبرس
// السعودية ال ال سي" vs jnt). Anything not in the alias map falls
// back to a contains() check on the carrier name, then unmatched.
const CARRIER_ALIASES = {
  // raw token (normalized) → carrier_id
  'اراميكس':   'c_1777506662790',
  'ارامكس':    'c_1777506662790',
  'aramex':    'c_1777506662790',
  'ايمايل':    'imile',
  'imile':     'imile',
  'اي مايل':   'imile',
  'آي مايل':   'imile',
  'ديلكس':     'delex',
  'delex':     'delex',
  'ديلفر ناو': 'delivernow',
  'ديليفر ناو':'delivernow',
  'delivernow':'delivernow',
  'سمسا':      'smsa',
  'سمسا اكسبرس':'smsa',
  'سمسا فروع':  'smsa',
  'smsa':      'smsa',
  'ويبك':      'webek',
  'webek':     'webek',
  'wepik':     'webek',
  'بوليصة':    'boleeseh',
  'بوليصه':    'boleeseh',
  'boleeseh':  'boleeseh',
  'اطاق':      'aatak',
  'أطاق':      'aatak',
  'aatak':     'aatak',
  'جي ان تي':  'jnt',
  'جي اند تي': 'jnt',
  'j&t':       'jnt',
  'jnt':       'jnt',
  'jt express':'jnt',
};

function normalizeForVendorMatch(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[ًٌٍَُِّْٰ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[\s\-_|/\\.،,]+/g, ' ')
    .trim();
}

async function resolveCarrierIds(parsed) {
  // Load carriers list once
  const { data: carriers } = await supabase.from('carriers').select('id, name');
  const carrierIds = new Set((carriers || []).map(c => c.id));

  // Pre-normalize alias map keys
  const aliasMap = new Map();
  for (const [k, v] of Object.entries(CARRIER_ALIASES)) {
    aliasMap.set(normalizeForVendorMatch(k), v);
  }
  // Pre-normalize carrier names → id (fallback path)
  const nameMap = new Map();
  for (const c of (carriers || [])) {
    nameMap.set(normalizeForVendorMatch(c.name), c.id);
  }

  return parsed.map(r => {
    const norm = normalizeForVendorMatch(r.raw_name);
    // Try each alias key as a substring of the normalized name
    let carrier_id = null;
    let method     = 'unmatched';
    for (const [aliasKey, cid] of aliasMap) {
      if (norm.includes(aliasKey)) {
        if (carrierIds.has(cid)) { carrier_id = cid; method = 'alias'; break; }
      }
    }
    // Fallback: substring against actual carrier name
    if (!carrier_id) {
      for (const [carrierNorm, cid] of nameMap) {
        if (carrierNorm && norm.includes(carrierNorm)) {
          carrier_id = cid; method = 'name'; break;
        }
      }
    }
    return {
      ...r,
      carrier_id,
      match_method:     method,
      match_confidence: carrier_id ? 1.0 : 0,
    };
  });
}

export async function uploadVendorBalanceSnapshot({ parsed, fileName, userId }) {
  if (!parsed?.length) throw new Error('لا توجد صفوف صالحة');
  const resolved = await resolveCarrierIds(parsed);
  const matchedCount = resolved.filter(r => r.carrier_id).length;
  const totalWeOwe     = +resolved.filter(r => r.balance > 0).reduce((s, r) => s + r.balance,     0).toFixed(2);
  const totalOwedToUs  = +resolved.filter(r => r.balance < 0).reduce((s, r) => s + Math.abs(r.balance), 0).toFixed(2);

  const { data: snap, error: e1 } = await supabase
    .from('vendor_balance_snapshots')
    .insert({
      file_name:         fileName || null,
      row_count:         resolved.length,
      matched_count:     matchedCount,
      total_we_owe:      totalWeOwe,
      total_owed_to_us:  totalOwedToUs,
      uploaded_by:       userId || null,
    })
    .select()
    .single();
  if (e1) throw e1;

  const payload = resolved.map(r => ({
    snapshot_id:      snap.id,
    raw_name:         r.raw_name,
    carrier_id:       r.carrier_id,
    balance:          r.balance,
    match_method:     r.match_method,
    match_confidence: r.match_confidence,
  }));
  for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
    const chunk = payload.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from('vendor_balances').insert(chunk);
    if (error) throw error;
  }
  return { snapshotId: snap.id, rowCount: resolved.length, matched: matchedCount, totalWeOwe, totalOwedToUs };
}

export async function listVendorSnapshots() {
  const { data, error } = await supabase
    .from('vendor_balance_snapshots')
    .select('*')
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteVendorSnapshot(id) {
  if (!id) throw new Error('id مطلوب');
  const { error } = await supabase.from('vendor_balance_snapshots').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}

export async function loadVendorReconciliation() {
  const { data, error } = await supabase.rpc('vendor_reconciliation');
  if (error) throw error;
  return (data || []).map(r => ({
    carrierId:       r.carrier_id,
    carrierName:     r.carrier_name || r.carrier_id,
    internalBalance: Number(r.internal_balance) || 0,
    zohoBalance:     Number(r.zoho_balance) || 0,
    diff:            Number(r.diff) || 0,
    zohoRawNames:    r.zoho_raw_names || [],
  }));
}

export async function loadVendorOthers() {
  const { data, error } = await supabase.rpc('vendor_balance_others');
  if (error) throw error;
  return (data || []).map(r => ({
    rawName:  r.raw_name,
    balance:  Number(r.balance) || 0,
    rank:     Number(r.rank_order) || 0,
  }));
}

// ─────────────────────────────────────────────────────────────────
// CUSTOMER reconciliation (existing) — section starts here
// ─────────────────────────────────────────────────────────────────

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
