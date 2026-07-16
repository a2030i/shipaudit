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
    const rawBal = r[balIdx];
    const bal = typeof rawBal === 'number'
      ? rawBal
      : Number(String(rawBal ?? '').replace(/[,،\s]/g, '').trim());
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
  let s = String(raw).trim();
  // Surrounding parens = negative in some Zoho editions: (597.00)
  const parenNeg = /^\(.*\)$/.test(s);
  if (parenNeg) s = s.slice(1, -1);
  // Trailing Dr/Cr suffix (newer Zoho exports: "SAR20,322.59 Dr")
  // Dr = Debit = customer owes us → positive
  // Cr = Credit = we owe the customer → negative
  let sign = parenNeg ? -1 : 1;
  if (/\bCr\b\s*$/i.test(s)) { sign = -sign; s = s.replace(/\bCr\b\s*$/i, ''); }
  else                         { s = s.replace(/\bDr\b\s*$/i, ''); }
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

  // Single source of truth: the resolve_snapshot_names() RPC runs all three
  // tiers (links → exact via normalize_arabic_name → bulk_match_customers
  // fuzzy) in Postgres. The SAME RPC is called server-side by the
  // zoho-intake edge function, so client and server can NEVER drift (the
  // old client-side 3-tier copy mirrored these rules by hand — §1.14).
  const names = parsed.map(r => r.raw_name);
  const { data: matches, error } = await supabase.rpc('resolve_snapshot_names', {
    p_names:     names,
    p_threshold: 0.78,
  });
  if (error) throw error;
  const byName = new Map((matches || []).map(m => [m.raw_name, m]));
  return parsed.map(r => {
    const m = byName.get(r.raw_name);
    return {
      ...r,
      store_id:         m?.store_id ?? null,
      match_method:     m?.match_method || 'unmatched',
      match_confidence: Number(m?.match_confidence) || 0,
    };
  });
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
// snapshot once and the UI filters client-side.
//
// Default behaviour: return EVERY merchant, with `isLinked` flagging
// the ones already attached to another customer. The previous
// default (hide-already-linked) was wrong — when a Zoho row needs
// to join an existing pair anchored on a merchant, that merchant
// must be selectable from the picker. The UI shows a 🔗 badge so
// the operator knows it's part of an existing pair.
export async function loadMerchantsForPicker({ includeLinked = true } = {}) {
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

// Zoho-side candidates for the internal-row link picker. Returns
// BOTH unmatched rows (store_id=null) AND rows already linked to a
// merchant (store_id set). The already-linked ones get a flag so
// the UI can show a badge like "مرتبط بمتجر #1537" — clicking them
// is still legitimate (it means "this internal row is the same
// entity as this Zoho row, which is anchored on merchant X").
// linkInternalRowToZohoRow uses the picked row's existing store_id
// when present instead of generating a synthetic anchor.
export async function loadUnmatchedZohoForPicker() {
  const { data: latest } = await supabase
    .from('store_balance_snapshots')
    .select('id')
    .eq('source', 'zoho')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  if (!latest?.length) return [];
  const { data } = await supabase
    .from('store_balances')
    .select('raw_name, balance, match_method, store_id')
    .eq('snapshot_id', latest[0].id)
    .order('raw_name');
  return (data || []).map(r => ({
    rawName:        r.raw_name,
    balance:        Number(r.balance) || 0,
    method:         r.match_method,
    existingStoreId: r.store_id || null,   // null = still unmatched
  }));
}

// Backfill every unmatched store_balances row whose raw_name is an
// EXACT match (after trim) for a merchant.store_name in the latest
// snapshot. Useful when an internal-settlement file was uploaded
// BEFORE the merchants snapshot, so the original auto-link pass
// missed rows that are now trivially linkable.
//
// Returns { count, storeIds[] } — the UI shows a toast with the
// count and refreshes the reconciliation table.
export async function autolinkBalancesByExactName() {
  const { data, error } = await supabase.rpc('autolink_balances_by_exact_name');
  if (error) throw error;
  const row = (data || [])[0] || { linked_count: 0, store_ids: [] };
  return {
    count:    Number(row.linked_count) || 0,
    storeIds: row.store_ids || [],
  };
}

// Pair an internal-source unmatched row with a Zoho-source unmatched
// row — the operator's saying "these two ARE the same entity".
//
// Two paths:
//   A) Fuzzy-match the internal name to merchants. If a merchant
//      resolves at threshold 0.65, anchor both rows on that
//      merchant.store_id.
//   B) No merchant matches → generate a SYNTHETIC anchor of the
//      form "manual:<uuid>". balance_reconciliation() groups by
//      store_id text equality and LEFT JOINs merchants for the
//      display name, so a synthetic id reconciles the pair just
//      fine; the row shows under the raw_name fallback (see
//      loadReconciliation's storeName coalesce chain).
//
// Path B is preferred over erroring because the operator's intent
// is unambiguous — the two names are the same entity. Forcing them
// to first add a merchant row would be friction for a customer that
// genuinely isn't in the platform directory (e.g. one-off cash sales,
// renamed-but-not-resynced stores).
export async function linkInternalRowToZohoRow({
  internalRawName, zohoRawName, userId = null,
  // Optional override — when the picker shows an already-linked
  // Zoho row, the UI passes that row's existing store_id here so
  // we reuse it instead of creating a new anchor. Without this,
  // a chain like "Zoho already → merchant #1537, internal pairs
  // with Zoho" would create a synthetic anchor and the internal
  // row would NOT appear under #1537 in /reconciliation.
  existingStoreId = null,
}) {
  if (!internalRawName?.trim()) throw new Error('اسم الصف الداخلي مطلوب');
  if (!zohoRawName?.trim())     throw new Error('اسم الصف من Zoho مطلوب');

  let storeId, storeName, syntheticAnchor = false;

  if (existingStoreId) {
    // Path 0 (preferred): the picked Zoho row is already anchored
    // on a merchant. Reuse that store_id so the internal row joins
    // the existing pair under that merchant.
    storeId = existingStoreId;
    const { data: merchantRow } = await supabase
      .from('merchants').select('store_name').eq('store_id', storeId).limit(1).maybeSingle();
    storeName = merchantRow?.store_name || internalRawName;
  } else {
    // Path A: fuzzy-match the internal name against merchants
    // (pg_trgm-backed RPC).
    const { data: matches } = await supabase.rpc('bulk_match_customers', {
      p_names:     [internalRawName],
      p_threshold: 0.65,
    });
    const match = (matches || [])[0];
    if (match?.store_id) {
      storeId   = match.store_id;
      storeName = match.store_name;
    } else {
      // Path B: synthetic anchor. crypto.randomUUID() is available
      // in every browser we support (and in Node 19+).
      const uid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      storeId   = `manual:${uid}`;
      storeName = internalRawName;
      syntheticAnchor = true;
    }
  }

  // 1. Write the Zoho-name link (so future Zoho uploads auto-match
  //    to the same anchor). Works for both paths — the only
  //    difference is whether store_id points at a real merchant or
  //    a synthetic id.
  const { error: e1 } = await supabase
    .from('customer_merchant_links')
    .upsert({
      customer_name: zohoRawName,
      store_id:      storeId,
      confidence:    1.0,
      match_method:  syntheticAnchor ? 'manual-pair' : 'manual',
      linked_by:     userId,
      linked_at:     new Date().toISOString(),
    }, { onConflict: 'customer_name' });
  if (e1) throw e1;

  // 2. Backfill the internal row so it joins the anchor. We DON'T
  //    filter on store_id IS NULL here for the Path 0 case because
  //    the Zoho row is already anchored and we just need to bring
  //    the internal row alongside it. For Paths A/B the internal
  //    row is unmatched, the Zoho row is unmatched, and both get
  //    updated; the WHERE-IS-NULL guard from the old version is
  //    redundant once we pre-checked the picker.
  const { error: e2 } = await supabase
    .from('store_balances')
    .update({
      store_id:         storeId,
      match_method:     'link-manual-pair',
      match_confidence: 1.0,
    })
    .in('raw_name', [internalRawName, zohoRawName])
    .is('store_id', null);   // only the still-unmatched side gets touched
  if (e2) throw e2;

  return { ok: true, storeId, storeName, syntheticAnchor, reusedExisting: !!existingStoreId };
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

// ── الموردون من المرآة الحيّة (zoho_contacts، v11) ─────────────────
// الرصيد الصافي للمورد = المستحق علينا − السلف/الإشعارات الدائنة لنا —
// نفس دلالة إشارة ملف «أرصدة الموردين» الإيميلي (موجب = ندين له).
// مُتحقَّق 2026-07-03: 36/37 مورداً مطابق بالريال مع آخر ملف؛ الوحيد
// المختلف سببه أن الملف أقدم من الحي. يجعل الملف الإيميلي قابلاً للإيقاف.
let VENDOR_LIVE_CACHE = null; // { at, rows } — يخدم recon+others معاً
async function loadVendorContactsLive() {
  if (VENDOR_LIVE_CACHE && Date.now() - VENDOR_LIVE_CACHE.at < 60_000) return VENDOR_LIVE_CACHE.rows;
  const { data, error } = await supabase
    .from('zoho_contacts')
    .select('contact_name, outstanding_payable, unused_credits_payable')
    .eq('contact_type', 'vendor');
  if (error) throw error;
  const rows = (data || []).map(r => ({
    raw_name: r.contact_name,
    balance:  +((Number(r.outstanding_payable) || 0) - (Number(r.unused_credits_payable) || 0)).toFixed(2),
  }));
  VENDOR_LIVE_CACHE = { at: Date.now(), rows };
  return rows;
}

export async function loadVendorReconciliation() {
  // المرآة الحيّة أولاً؛ إن كانت فارغة (مزامنة لم تجرِ بعد) → snapshot RPC
  try {
    const vendors = await loadVendorContactsLive();
    if (vendors.length) {
      const [resolved, intRes] = await Promise.all([
        resolveCarrierIds(vendors),
        supabase.rpc('carrier_internal_balances'),
      ]);
      const internal = new Map((intRes.data || []).map(r => [r.carrier_id, {
        name: r.carrier_name, bal: Number(r.internal_balance) || 0,
      }]));
      // تجميع أرصدة زوهو حسب الناقل المطابَق
      const byCarrier = new Map();
      for (const v of resolved) {
        if (!v.carrier_id) continue;
        const cur = byCarrier.get(v.carrier_id) || { bal: 0, names: [] };
        cur.bal += v.balance;
        cur.names.push(v.raw_name);
        byCarrier.set(v.carrier_id, cur);
      }
      const ids = new Set([...byCarrier.keys(), ...internal.keys()]);
      const out = [...ids].map(id => {
        const z = byCarrier.get(id);
        const i = internal.get(id);
        const zohoBalance = +((z?.bal) || 0).toFixed(2);
        const internalBalance = +((i?.bal) || 0).toFixed(2);
        return {
          carrierId: id,
          carrierName: i?.name || id,
          internalBalance,
          zohoBalance,
          diff: +(zohoBalance - internalBalance).toFixed(2),
          zohoRawNames: z?.names || [],
          source: 'zoho_live',
        };
      }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      return out;
    }
  } catch (e) { console.info('vendor live recon fallback:', e.message); }

  const { data, error } = await supabase.rpc('vendor_reconciliation');
  if (error) throw error;
  return (data || []).map(r => ({
    carrierId:       r.carrier_id,
    carrierName:     r.carrier_name || r.carrier_id,
    internalBalance: Number(r.internal_balance) || 0,
    zohoBalance:     Number(r.zoho_balance) || 0,
    diff:            Number(r.diff) || 0,
    zohoRawNames:    r.zoho_raw_names || [],
    source:          'snapshot',
  }));
}

export async function loadVendorOthers() {
  // الموردون غير الناقلين — من المرآة الحيّة أولاً (نفس fallback أعلاه)
  try {
    const vendors = await loadVendorContactsLive();
    if (vendors.length) {
      const resolved = await resolveCarrierIds(vendors);
      return resolved
        .filter(v => !v.carrier_id && Math.abs(v.balance) > 0.5)
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .map((v, i) => ({ rawName: v.raw_name, balance: v.balance, rank: i + 1 }));
    }
  } catch (e) { console.info('vendor others live fallback:', e.message); }

  const { data, error } = await supabase.rpc('vendor_balance_others');
  if (error) throw error;
  return (data || []).map(r => ({
    rawName:  r.raw_name,
    balance:  Number(r.balance) || 0,
    rank:     Number(r.rank_order) || 0,
  }));
}

// ─────────────────────────────────────────────────────────────────
// COD TREASURY balances — from the Zoho Trial Balance (ميزان المراجعة).
// Each carrier has a "خزينة <name>" cash account; its balance tells us
// how much collected COD is sitting un-drained — the accountant-watch
// signal ("احصل خزاين تحصيل مليانة"). Snapshot model: latest upload wins.
// ─────────────────────────────────────────────────────────────────

// Treasury account names print as "خزينة سمسا" etc. Branches must be
// matched BEFORE base smsa. Carriers not in our system (فارنير/ماي جيت/
// لوجستك/رصيد يدوي) resolve to null and are shown as "خارج النظام".
function resolveTreasuryCarrier(rawName) {
  const n = normalizeForVendorMatch(rawName);
  if (n.includes('سمسا فروع') || n.includes('سمسا فرع')) return 'smsa_branches';
  if (n.includes('سمسا'))                                return 'smsa';
  if (n.includes('ايمايل') || n.includes('اي مايل'))     return 'imile';
  if (n.includes('جي ان تي') || n.includes('جي اند تي')) return 'jnt';
  if (n.includes('ديلفر ناو') || n.includes('ديليفر ناو')) return 'delivernow';
  if (n.includes('ديليكس') || n.includes('ديلكس'))       return 'delex';
  if (n.includes('بوليصه') || n.includes('بوليصة'))      return 'boleeseh';
  if (n.includes('ويبيك') || n.includes('ويبك'))         return 'webek';
  if (n.includes('اطاق'))                                return 'aatak';
  if (n.includes('فارنير') || n.includes('فارنر'))       return 'varnier';
  if (n.includes('ماي جيت') || n.includes('مايجيت'))     return 'mygate';
  if (n.includes('لوجستك') || n.includes('لوجستيك'))     return 'logistic';
  return null;
}

// Pull the "خزينة …" rows out of a parsed Zoho Trial Balance sheet.
// Columns: الحساب | رمز | وصف | صافي الرصيد المدين | صافي الرصيد الدائن | …
export function parseZohoTrialBalanceTreasury(rows) {
  if (!rows?.length) return { rows: [], errors: ['ملف فارغ'] };
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = (rows[i] || []).map(c => String(c ?? ''));
    if (r.some(c => c.includes('صافي الرصيد المدين')) || r.some(c => c.trim() === 'الحساب')) {
      headerRow = i; break;
    }
  }
  if (headerRow < 0) return { rows: [], errors: ['لم نجد صف عنوان ميزان المراجعة (الحساب / صافي الرصيد)'] };
  const head = rows[headerRow] || [];
  let debIdx = findIdx(head, ['صافي الرصيد المدين']);
  let creIdx = findIdx(head, ['صافي الرصيد الدائن']);
  if (debIdx < 0) debIdx = 3;
  if (creIdx < 0) creIdx = 4;
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = String(r[0] ?? '').trim();
    if (!name.startsWith('خزينة')) continue;
    const debit  = parseVendorAmount(r[debIdx]) || 0;
    const credit = parseVendorAmount(r[creIdx]) || 0;
    out.push({ raw_name: name, debit: +Number(debit).toFixed(2), credit: +Number(credit).toFixed(2) });
  }
  return { rows: out, errors: out.length ? [] : ['لم نجد صفوف تبدأ بـ «خزينة …» في الملف'] };
}

export async function uploadTreasurySnapshot({ parsed, userId = null }) {
  if (!parsed?.length) throw new Error('لا توجد خزائن في الملف');
  const snapshotId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const now = new Date().toISOString();
  const payload = parsed.map(r => ({
    snapshot_id: snapshotId,
    raw_name:    r.raw_name,
    carrier_id:  resolveTreasuryCarrier(r.raw_name),
    debit:       r.debit,
    credit:      r.credit,
    uploaded_at: now,
    uploaded_by: userId,
  }));
  const { error } = await supabase.from('cod_treasury_balances').insert(payload);
  if (error) throw error;
  return { snapshotId, count: payload.length, matched: payload.filter(r => r.carrier_id).length };
}

export async function loadTreasuryBalances() {
  const { data: latest, error: e1 } = await supabase
    .from('cod_treasury_balances').select('snapshot_id, uploaded_at')
    .order('uploaded_at', { ascending: false }).limit(1);
  if (e1) throw e1;
  if (!latest?.length) return { rows: [], uploadedAt: null };
  const { data, error } = await supabase
    .from('cod_treasury_balances').select('*')
    .eq('snapshot_id', latest[0].snapshot_id)
    .order('id', { ascending: true });
  if (error) throw error;
  return { rows: data || [], uploadedAt: latest[0].uploaded_at };
}

// ─────────────────────────────────────────────────────────────────
// CUSTOMER balances — Zoho live (المرجع) × الداخلي × المتاجر
// ─────────────────────────────────────────────────────────────────
// RPC customer_balance_recon_zoho(): يجمع فواتير زوهو المفتوحة (المرآة
// الحيّة zoho_invoices، balance>0.5) مقابل آخر snapshot مديونيات داخلي
// (صفوف is_summary) — المرساة store_id عبر customer_merchant_links ثم
// الاسم المطبَّع. المحفظة محور مستقل (لا تُطرح من الدين — قاعدة CRM).
// recon_status: matched (±1) · internal_only (رصيد قديم بلا فاتورة زوهو
// حيّة — غالباً أرصدة افتتاحية) · zoho_only · needs_investigation.
export async function loadCustomerBalanceRecon() {
  const { data, error } = await supabase.rpc('customer_balance_recon_zoho');
  if (error) throw error;
  // الجانب الداخلي = استحقاق لمحة (2026-07-17): تبيّن أن invoice_details كان
  // تقرير زوهو المجدول بالإيميل وتوقف عمداً بعد الـAPI — فكان التبويب يقارن
  // زوهو الحي بزوهو قديم. عمر الاستحقاق يظهر على البطاقة.
  const { data: snap } = await supabase.from('store_balance_snapshots')
    .select('uploaded_at, file_name').eq('source', 'internal')
    .order('uploaded_at', { ascending: false }).limit(1);
  const internalMeta = snap?.[0]
    ? { uploadedAt: snap[0].uploaded_at, sourceFile: snap[0].file_name }
    : null;
  const rows = (data || []).map(r => ({
    anchor:         r.anchor,
    storeId:        r.store_id,
    storeName:      r.store_name || (r.zoho_names || [])[0] || (r.internal_names || [])[0] || r.anchor,
    phone:          r.phone,
    billingType:    r.billing_type,
    platformStatus: r.platform_status,
    wallet:         Number(r.wallet_balance) || 0,
    zoho:           Number(r.zoho_balance) || 0,
    zohoOpenCnt:    Number(r.zoho_open_cnt) || 0,
    zohoOldest:     r.zoho_oldest,
    zohoNames:      r.zoho_names || [],
    internal:       Number(r.internal_balance) || 0,
    internalNames:  r.internal_names || [],
    diff:           Number(r.diff) || 0,
    status:         r.recon_status,
  }));
  rows.internalMeta = internalMeta;   // ملحق على المصفوفة — لا يكسر مستهلكي array
  return rows;
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
