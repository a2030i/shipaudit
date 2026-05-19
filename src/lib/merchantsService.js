// Merchants directory service.
//
// Wraps the snapshot-upload + fuzzy-match flow that links receivables
// customer names to merchant rows. Receivables (`customer_receivables`)
// only knows the raw name string Boleeseh / J&T / etc. printed on
// their invoices; this service joins that string to a merchant_id,
// phone, billing_type, status, wallet_balance and shipment activity.
//
// Three persistence layers:
//   merchants                   — snapshots of stores.xlsx
//   customer_merchant_links     — durable customer_name → store_id map
//   (snapshot-aware: a link survives across snapshots, an explicit
//   manual override never gets blown away by re-uploading either side.)
//
// Public API:
//   parseStoresFile(allRows)                        → { rows: [...] }
//   uploadMerchantsSnapshot({ parsed, sourceFile, userId })
//                                                    → { snapshotId, count }
//   loadLatestMerchants()                            → { snapshot, merchants[] }
//   loadLatestMerchantsByName()                      → Map<lcName, merchant>
//   loadLatestMerchantsById()                        → Map<store_id, merchant>
//   loadCustomerMerchantLinks()                      → Map<customer_name, { storeId, confidence, method }>
//   autoLinkCustomers(customerNames, merchants, opts)→ Map<customer_name, link>
//                                                      (also writes results to DB)
//   setCustomerMerchantLink({ customerName, storeId, method, confidence, userId })
//   computeMerchantInsights(merchants)               → { signupCounts, dormant, churned, topVolume, ... }

import { supabase } from './supabase.js';

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

// ── Parse stores.xlsx ──────────────────────────────────────────
// Expects a worksheet with these Arabic headers (the platform's
// canonical export):
//   رقم المتجر · اسم المتجر · رقم الهاتف · عدد الشحنات ·
//   تاريخ اخر شحنة · نوع الربط · نوع الفاتورة · حالة المتجر ·
//   تاريخ الانشاء · تاريخ اخر شحن رصيد · الرصيد الحالي
//
// Tolerant column resolution: we look up each field by header text so
// re-orderings or minor renaming don't break the import. Phones come
// in as numbers (XLSX raw mode) — we stringify so the leading zero
// (if any) isn't lost.
const HEADER_KEYS = {
  storeId:            ['رقم المتجر', 'store id', 'merchant id'],
  storeName:          ['اسم المتجر', 'store name', 'merchant name'],
  phone:              ['رقم الهاتف', 'هاتف', 'phone', 'mobile'],
  shipmentCount:      ['عدد الشحنات', 'shipments', 'shipment count'],
  lastShipmentAt:     ['تاريخ اخر شحنة', 'تاريخ آخر شحنة', 'last shipment'],
  integrationType:    ['نوع الربط', 'integration'],
  billingType:        ['نوع الفاتورة', 'billing type'],
  status:             ['حالة المتجر', 'status'],
  createdAtPlatform:  ['تاريخ الانشاء', 'تاريخ الإنشاء', 'created'],
  lastTopupAt:        ['تاريخ اخر شحن رصيد', 'last topup'],
  walletBalance:      ['الرصيد الحالي', 'wallet', 'balance'],
};

function findHeaderIdx(headerRow, keys) {
  const lc = (s) => String(s ?? '').toLowerCase().trim();
  return headerRow.findIndex(cell => keys.some(k => lc(cell).includes(lc(k))));
}

function toIsoDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  if (!s) return null;
  // Already ISO-ish?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function toPhoneString(v) {
  if (v == null) return null;
  if (typeof v === 'number') return String(Math.round(v));  // 12-digit safe int
  const s = String(v).trim();
  return s || null;
}

export function parseStoresFile(allRows) {
  if (!Array.isArray(allRows) || allRows.length < 2) {
    throw new Error('الملف فارغ أو غير معتاد');
  }
  const header = allRows[0];
  const cols = {};
  for (const [field, keys] of Object.entries(HEADER_KEYS)) {
    cols[field] = findHeaderIdx(header, keys);
  }
  if (cols.storeId < 0 || cols.storeName < 0) {
    throw new Error(
      'الملف لا يطابق صيغة كشف المتاجر — يلزم وجود رأس فيه ' +
      '"رقم المتجر" + "اسم المتجر".',
    );
  }

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r) continue;
    const storeId = String(r[cols.storeId] ?? '').trim();
    const storeName = String(r[cols.storeName] ?? '').trim();
    if (!storeId || !storeName) continue;

    rows.push({
      storeId,
      storeName,
      phone:               cols.phone >= 0           ? toPhoneString(r[cols.phone])              : null,
      shipmentCount:       cols.shipmentCount >= 0   ? (parseInt(r[cols.shipmentCount], 10) || 0) : 0,
      lastShipmentAt:      cols.lastShipmentAt >= 0  ? toIsoDate(r[cols.lastShipmentAt])         : null,
      integrationType:     cols.integrationType >= 0 ? String(r[cols.integrationType] ?? '').trim() || null : null,
      billingType:         cols.billingType >= 0     ? String(r[cols.billingType] ?? '').trim() || null     : null,
      status:              cols.status >= 0          ? String(r[cols.status] ?? '').trim() || null          : null,
      createdAtPlatform:   cols.createdAtPlatform >= 0 ? toIsoDate(r[cols.createdAtPlatform])    : null,
      lastTopupAt:         cols.lastTopupAt >= 0     ? toIsoDate(r[cols.lastTopupAt])            : null,
      walletBalance:       cols.walletBalance >= 0   ? (parseFloat(r[cols.walletBalance]) || 0) : 0,
    });
  }
  return { rows };
}

export async function uploadMerchantsSnapshot({ parsed, sourceFile, userId }) {
  if (!parsed?.rows?.length) throw new Error('لا توجد صفوف للحفظ');
  const snapshotId   = `m_${Date.now()}`;
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const inserts = parsed.rows.map(r => ({
    snapshot_id:          snapshotId,
    snapshot_date:        snapshotDate,
    store_id:             r.storeId,
    store_name:           r.storeName,
    phone:                r.phone,
    shipment_count:       r.shipmentCount,
    last_shipment_at:     r.lastShipmentAt,
    integration_type:     r.integrationType,
    billing_type:         r.billingType,
    status:               r.status,
    created_at_platform:  r.createdAtPlatform,
    last_topup_at:        r.lastTopupAt,
    wallet_balance:       r.walletBalance,
    uploaded_by:          userId || null,
  }));
  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase.from('merchants').insert(inserts.slice(i, i + CHUNK));
    if (error) throw error;
  }
  return {
    snapshotId,
    snapshotDate,
    count: inserts.length,
    prepaid:  inserts.filter(r => r.billing_type === 'دفع مسبق').length,
    postpaid: inserts.filter(r => r.billing_type === 'دفع لاحق').length,
    active:   inserts.filter(r => r.status === 'نشط').length,
  };
}

// Returns the merchants from the latest snapshot. Used everywhere
// downstream (anomalies, enrichment, insights).
export async function loadLatestMerchants() {
  // Find the latest snapshot id
  const { data: latest, error: e1 } = await supabase
    .from('merchants')
    .select('snapshot_id, snapshot_date, uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  if (e1) throw e1;
  if (!latest?.length) return { snapshot: null, merchants: [] };
  const snap = latest[0];
  const merchants = await loadAll('merchants',
    'id, store_id, store_name, phone, shipment_count, last_shipment_at, integration_type, billing_type, status, created_at_platform, last_topup_at, wallet_balance',
    { snapshot_id: snap.snapshot_id },
  );
  return {
    snapshot: {
      id:         snap.snapshot_id,
      date:       snap.snapshot_date,
      uploadedAt: snap.uploaded_at,
    },
    merchants,
  };
}

export async function loadLatestMerchantsByName() {
  const { merchants } = await loadLatestMerchants();
  const map = new Map();
  for (const m of merchants) {
    map.set(normalizeName(m.store_name), m);
  }
  return map;
}

export async function loadLatestMerchantsById() {
  const { merchants } = await loadLatestMerchants();
  const map = new Map();
  for (const m of merchants) map.set(m.store_id, m);
  return map;
}

// ── Fuzzy matching ─────────────────────────────────────────────
// Receivables names look like:
//    "ALI HUSSAIN HAMRANI - Printopia | برنتوبيا لحلول الطباعة"
//    "شركة أزراري التجاري - أزراري"
//    "OLALA - شركة ابتهاج البن للتجارة"
//
// Strategy: tokenize on dashes/pipes, normalize Arabic diacritics +
// generic prefixes ("متجر"/"شركة"/"مؤسسة"/"L1"/..), Levenshtein
// against each merchant store_name. Best match above a threshold wins.
const NAME_PREFIXES_RE = /^(?:متجر|شركة|مؤسسة|مؤسسه|شركه|m1|l1)\s+/i;
const ARABIC_DIACRITICS = /[ً-ْٰ]/g;
const NORMALISE_RE = /[\s\-_|/\\.،,]+/g;

function normalizeName(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    // Unify alefs (أ/إ/آ → ا) and ya forms (ى → ي) so visual matches succeed.
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(NAME_PREFIXES_RE, '')
    .replace(NORMALISE_RE, ' ')
    .trim();
}

function splitReceivableName(name) {
  // "ALI HAMRANI - Printopia | برنتوبيا"  → ['ALI HAMRANI','Printopia','برنتوبيا']
  return String(name || '')
    .split(/[\-|]/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Levenshtein normalised to [0..1] similarity.
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const al = a.length, bl = b.length;
  if (al === 0 || bl === 0) return 0;
  const dp = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = dp[j];
      dp[j] = a[i-1] === b[j-1] ? prev : 1 + Math.min(prev, dp[j], dp[j-1]);
      prev = tmp;
    }
  }
  const dist = dp[bl];
  const maxLen = Math.max(al, bl);
  return 1 - dist / maxLen;
}

// Match a single customer_name → best merchant. Returns
// { storeId, storeName, confidence, method } or null.
export function findMerchantForCustomer(customerName, merchants) {
  if (!customerName || !merchants?.length) return null;
  const segments = splitReceivableName(customerName).map(normalizeName).filter(Boolean);
  if (!segments.length) return null;

  let best = null;
  for (const m of merchants) {
    const mNorm = normalizeName(m.store_name);
    if (!mNorm) continue;
    // Exact match on any segment → confidence 1.0
    for (const seg of segments) {
      if (seg === mNorm) {
        return { storeId: m.store_id, storeName: m.store_name, confidence: 1.0, method: 'auto-exact' };
      }
      // Substring containment also high confidence
      if (seg.length >= 3 && (seg.includes(mNorm) || mNorm.includes(seg))) {
        const sim = Math.min(seg.length, mNorm.length) / Math.max(seg.length, mNorm.length);
        if (!best || sim > best.confidence) {
          best = { storeId: m.store_id, storeName: m.store_name, confidence: +sim.toFixed(2), method: 'auto-fuzzy' };
        }
        continue;
      }
      // Fuzzy Levenshtein
      const sim = similarity(seg, mNorm);
      if (!best || sim > best.confidence) {
        best = { storeId: m.store_id, storeName: m.store_name, confidence: +sim.toFixed(2), method: 'auto-fuzzy' };
      }
    }
  }
  if (best && best.confidence >= 0.78) return best;
  return null;
}

export async function loadCustomerMerchantLinks() {
  const { data, error } = await supabase
    .from('customer_merchant_links')
    .select('customer_name, store_id, confidence, match_method');
  if (error) throw error;
  const map = new Map();
  for (const r of data || []) {
    map.set(r.customer_name, {
      storeId:    r.store_id,
      confidence: r.confidence,
      method:     r.match_method,
    });
  }
  return map;
}

// Auto-link a batch of customer names against the merchants table.
// Skips names that already have a manual link. Returns a Map keyed by
// customer_name → link result. Persists every result so subsequent
// runs are cheap and durable.
export async function autoLinkCustomers(customerNames, merchants, { userId } = {}) {
  if (!customerNames?.length || !merchants?.length) return new Map();
  const existing = await loadCustomerMerchantLinks();
  const results = new Map();
  const toUpsert = [];
  for (const name of customerNames) {
    const prior = existing.get(name);
    // Don't overwrite a manual link — but DO refresh stale auto links
    // when the user re-uploaded merchants.
    if (prior?.method === 'manual') {
      results.set(name, prior);
      continue;
    }
    const match = findMerchantForCustomer(name, merchants);
    const link = match
      ? { storeId: match.storeId, confidence: match.confidence, method: match.method }
      : { storeId: null, confidence: 0, method: 'unmatched' };
    results.set(name, link);
    toUpsert.push({
      customer_name: name,
      store_id:      link.storeId,
      confidence:    link.confidence,
      match_method:  link.method,
      linked_by:     userId || null,
      linked_at:     new Date().toISOString(),
    });
  }
  if (toUpsert.length) {
    const CHUNK = 500;
    for (let i = 0; i < toUpsert.length; i += CHUNK) {
      const { error } = await supabase
        .from('customer_merchant_links')
        .upsert(toUpsert.slice(i, i + CHUNK), { onConflict: 'customer_name' });
      if (error) throw error;
    }
  }
  return results;
}

export async function setCustomerMerchantLink({ customerName, storeId, method = 'manual', confidence = 1.0, userId }) {
  if (!customerName) throw new Error('customer_name مطلوب');
  const { data, error } = await supabase
    .from('customer_merchant_links')
    .upsert({
      customer_name: customerName,
      store_id:      storeId || null,
      confidence,
      match_method:  method,
      linked_by:     userId || null,
      linked_at:     new Date().toISOString(),
    }, { onConflict: 'customer_name' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Insights (Phase 5) ─────────────────────────────────────────
export function computeMerchantInsights(merchants, today = new Date()) {
  if (!Array.isArray(merchants) || !merchants.length) {
    return {
      total: 0, prepaid: 0, postpaid: 0, active: 0, inactive: 0,
      newLast30: 0, newLast90: 0, neverShipped: 0,
      dormantActive: 0, walletPilesUp: 0,
      walletTotal: 0, topByVolume: [],
    };
  }
  const days = (a, b) => Math.floor((b - new Date(a)) / 86_400_000);
  let prepaid = 0, postpaid = 0, active = 0, inactive = 0;
  let newLast30 = 0, newLast90 = 0, neverShipped = 0;
  let dormantActive = 0, walletPilesUp = 0;
  let walletTotal = 0;
  let totalShipments = 0;
  const churnedList = [];     // status=inactive but had shipments → real customers we lost
  const walletPilesList = []; // prepaid + balance > 0 + idle > 60d
  for (const m of merchants) {
    if (m.billing_type === 'دفع مسبق') prepaid++;
    if (m.billing_type === 'دفع لاحق') postpaid++;
    if (m.status === 'نشط') active++;
    if (m.status === 'غير نشط') inactive++;
    if (m.created_at_platform && days(m.created_at_platform, today) <= 30) newLast30++;
    if (m.created_at_platform && days(m.created_at_platform, today) <= 90) newLast90++;
    if ((m.shipment_count || 0) === 0) neverShipped++;
    if (m.status === 'نشط' && m.last_shipment_at && days(m.last_shipment_at, today) > 60) dormantActive++;
    if (m.status === 'غير نشط' && (m.shipment_count || 0) > 0) churnedList.push(m);
    if (m.billing_type === 'دفع مسبق' && (m.wallet_balance || 0) > 0 && m.last_shipment_at && days(m.last_shipment_at, today) > 60) {
      walletPilesUp++;
      walletPilesList.push(m);
    }
    walletTotal += Number(m.wallet_balance) || 0;
    totalShipments += Number(m.shipment_count) || 0;
  }
  const topByVolume = [...merchants]
    .filter(m => (m.shipment_count || 0) > 0)
    .sort((a, b) => (b.shipment_count || 0) - (a.shipment_count || 0))
    .slice(0, 20);
  const churnedSorted = churnedList
    .sort((a, b) => {
      // Most recently lost first (newest last_shipment_at wins)
      const ta = a.last_shipment_at ? new Date(a.last_shipment_at).getTime() : 0;
      const tb = b.last_shipment_at ? new Date(b.last_shipment_at).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 20);
  const walletPilesSorted = walletPilesList
    .sort((a, b) => (b.wallet_balance || 0) - (a.wallet_balance || 0))
    .slice(0, 20);
  const walletPilesAmount = walletPilesList.reduce((s, m) => s + (Number(m.wallet_balance) || 0), 0);
  return {
    total: merchants.length, prepaid, postpaid, active, inactive,
    newLast30, newLast90, neverShipped, dormantActive, walletPilesUp,
    walletTotal: +walletTotal.toFixed(2),
    walletPilesAmount: +walletPilesAmount.toFixed(2),
    churned: churnedList.length,
    totalShipments,
    avgShipmentsPerActive: active ? Math.round(totalShipments / active) : 0,
    topByVolume,
    churnedTop: churnedSorted,
    walletPilesTop: walletPilesSorted,
  };
}
