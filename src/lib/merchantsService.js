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
import {
  isLamhaAccountDisabled,
  isLamhaAccountEnabled,
  isLamhaLifecycleStopped,
  normalizeLamhaStatus,
} from './lamhaAccountState.js';

const PAGE = 1000;
async function loadAll(table, columns, filters = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    // STABLE order required — without it Postgres may return overlapping
    // rows across .range() pages once a table exceeds 1000 (merchants is
    // ~1,491), double-counting. 'id' exists on every table passed here.
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
  status:             ['حالة المتجر', 'store status', 'merchant status'],
  profileStatus:      ['حالة الملف الشخصي', 'profile status'],
  vatRegistered:      ['مسجل في الضريبة', 'مسجل بالضريبة', 'vat registered', 'tax registered'],
  zatcaCompleted:     ['مكمل بيانات زاتكا', 'بيانات زاتكا', 'zatca'],
  verificationStatus: ['حالة التوثيق', 'verification status', 'verified status'],
  createdAtPlatform:  ['تاريخ الانشاء', 'تاريخ الإنشاء', 'created'],
  lastTopupAt:        ['تاريخ اخر شحن رصيد', 'تاريخ آخر شحن رصيد', 'last topup'],
  walletBalance:      ['الرصيد الحالي', 'wallet', 'balance'],
};

function normalizeHeader(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ـًٌٍَُِّْ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findHeaderIdx(headerRow, keys) {
  const normKeys = keys.map(normalizeHeader);
  return headerRow.findIndex(cell => {
    const h = normalizeHeader(cell);
    return normKeys.some(k => h.includes(k));
  });
}

function detectStoresHeaderRow(allRows) {
  const scan = allRows.slice(0, 10);
  let best = { idx: -1, score: 0, cols: {} };
  for (let i = 0; i < scan.length; i++) {
    const row = scan[i] || [];
    const cols = {};
    let score = 0;
    for (const [field, keys] of Object.entries(HEADER_KEYS)) {
      cols[field] = findHeaderIdx(row, keys);
      if (cols[field] >= 0) score++;
    }
    if (cols.storeId >= 0 && cols.storeName >= 0 && score > best.score) {
      best = { idx: i, score, cols };
    }
  }
  return best;
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

function toNum(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function toText(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function isYes(v) {
  const s = normalizeHeader(v);
  if (!s) return false;
  return ['نعم', 'yes', 'y', 'true', '1', 'مسجل', 'مكتمل', 'موثق'].includes(s);
}

function stripMerchantNewColumns(row) {
  const {
    profile_status,
    vat_registered,
    zatca_completed,
    verification_status,
    ...legacy
  } = row;
  return legacy;
}

function isMissingMerchantColumnError(error) {
  const msg = String(error?.message || '');
  return /profile_status|vat_registered|zatca_completed|verification_status|schema cache|column/i.test(msg);
}

function excelJsonValue(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v).trim() || null;
}

function excelRowData(headerRow, row) {
  const rawExcel = {};
  for (let idx = 0; idx < headerRow.length; idx++) {
    const header = String(headerRow[idx] ?? '').trim();
    if (!header) continue;
    const value = excelJsonValue(row[idx]);
    if (value != null) rawExcel[header] = value;
  }
  return rawExcel;
}

function canonicalExcelProfile(row, rawExcel = row.excelData?._excel || {}, presentFields = null) {
  // Excel is an enrichment source, never a competing Lamha directory.
  // Shared identity/account fields (name, phone, status, billing, shipments,
  // verification and integration) are intentionally retained only inside
  // `_excel` for audit. Their effective values must come from Lamha API.
  const profile = { _excel: rawExcel };
  const put = (field, key, value) => {
    if (!presentFields || presentFields.has(field)) profile[key] = value;
  };
  put('profileStatus', 'profileStatus', row.profileStatus);
  put('vatRegistered', 'vatRegistered', row.vatRegistered);
  put('zatcaCompleted', 'zatcaCompleted', row.zatcaCompleted);
  put('lastTopupAt', 'lastTopupAt', row.lastTopupAt);
  put('walletBalance', 'walletBalance', row.walletBalance);
  return profile;
}

function normalizeStoreId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // Excel sometimes turns an integer store id into the text "102.0".
  // Treat it as the same durable platform id as "102".
  if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, '');
  return raw;
}

function merchantRowScore(row, sourceIndex) {
  const lastActivity = Math.max(
    Date.parse(row.lastShipmentAt || '') || 0,
    Date.parse(row.lastTopupAt || '') || 0,
  );
  const filled = [
    row.storeName, row.phone, row.lastShipmentAt, row.integrationType,
    row.billingType, row.status, row.profileStatus, row.verificationStatus,
    row.createdAtPlatform, row.lastTopupAt,
  ].filter(v => v != null && String(v).trim() !== '').length;
  return [lastActivity, Number(row.shipmentCount) || 0, filled, sourceIndex];
}

function isHigherMerchantRowScore(candidate, current) {
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] === current[i]) continue;
    return candidate[i] > current[i];
  }
  return false;
}

// A platform export occasionally contains the same store more than once.
// The database correctly allows one row per (snapshot, store_id), so resolve
// duplicates before writing. Prefer the record with the newest activity,
// then the larger cumulative shipment count, then the most complete/latest
// source row. Missing optional values are filled from the other occurrences.
export function consolidateMerchantSnapshotRows(rows) {
  const byStoreId = new Map();
  const duplicateStoreIds = new Set();
  let duplicateRowCount = 0;

  for (const [sourceIndex, original] of (rows || []).entries()) {
    const storeId = normalizeStoreId(original?.storeId);
    if (!storeId) continue;
    const row = { ...original, storeId };
    const existing = byStoreId.get(storeId);
    if (!existing) {
      byStoreId.set(storeId, { row, score: merchantRowScore(row, sourceIndex) });
      continue;
    }

    duplicateRowCount++;
    duplicateStoreIds.add(storeId);
    const candidateScore = merchantRowScore(row, sourceIndex);
    const winner = isHigherMerchantRowScore(candidateScore, existing.score) ? row : existing.row;
    const fallback = winner === row ? existing.row : row;
    const merged = { ...winner };
    for (const key of Object.keys(fallback)) {
      if (merged[key] == null || merged[key] === '') merged[key] = fallback[key];
    }
    merged.excelData = {
      ...(fallback.excelData || {}),
      ...(winner.excelData || {}),
      _excel: { ...(fallback.excelData?._excel || {}), ...(winner.excelData?._excel || {}) },
    };
    byStoreId.set(storeId, {
      row: merged,
      score: merchantRowScore(merged, Math.max(sourceIndex, existing.score[3] || 0)),
    });
  }

  return {
    rows: [...byStoreId.values()].map(entry => entry.row),
    duplicateRowCount,
    duplicateStoreIds: [...duplicateStoreIds],
  };
}

export function parseStoresFile(allRows) {
  if (!Array.isArray(allRows) || allRows.length < 2) {
    throw new Error('الملف فارغ أو غير معتاد');
  }
  const { idx: headerIdx, cols } = detectStoresHeaderRow(allRows);
  if (cols.storeId < 0 || cols.storeName < 0) {
    throw new Error(
      'الملف لا يطابق صيغة كشف المتاجر — يلزم وجود رأس فيه ' +
      '"رقم المتجر" + "اسم المتجر".',
    );
  }

  const rawRows = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r) continue;
    const storeId = normalizeStoreId(r[cols.storeId]);
    const storeName = String(r[cols.storeName] ?? '').trim();
    if (!storeId || !storeName) continue;

    const parsedRow = {
      storeId,
      storeName,
      phone:               cols.phone >= 0           ? toPhoneString(r[cols.phone])              : null,
      shipmentCount:       cols.shipmentCount >= 0   ? (parseInt(r[cols.shipmentCount], 10) || 0) : 0,
      lastShipmentAt:      cols.lastShipmentAt >= 0  ? toIsoDate(r[cols.lastShipmentAt])         : null,
      integrationType:     cols.integrationType >= 0 ? String(r[cols.integrationType] ?? '').trim() || null : null,
      billingType:         cols.billingType >= 0     ? String(r[cols.billingType] ?? '').trim() || null     : null,
      status:              cols.status >= 0          ? String(r[cols.status] ?? '').trim() || null          : null,
      profileStatus:       cols.profileStatus >= 0   ? toText(r[cols.profileStatus])             : null,
      vatRegistered:       cols.vatRegistered >= 0   ? isYes(r[cols.vatRegistered])              : false,
      zatcaCompleted:      cols.zatcaCompleted >= 0  ? isYes(r[cols.zatcaCompleted])             : false,
      verificationStatus:  cols.verificationStatus >= 0 ? toText(r[cols.verificationStatus])     : null,
      createdAtPlatform:   cols.createdAtPlatform >= 0 ? toIsoDate(r[cols.createdAtPlatform])    : null,
      lastTopupAt:         cols.lastTopupAt >= 0     ? toIsoDate(r[cols.lastTopupAt])            : null,
      // A blank wallet cell means "not supplied", not a real zero balance.
      walletBalance:       cols.walletBalance >= 0   ? toNum(r[cols.walletBalance], null)        : null,
    };
    const presentFields = new Set(Object.entries(cols).filter(([, column]) => column >= 0).map(([field]) => field));
    parsedRow.excelData = canonicalExcelProfile(
      parsedRow,
      excelRowData(allRows[headerIdx] || [], r),
      presentFields,
    );
    rawRows.push(parsedRow);
  }
  const consolidated = consolidateMerchantSnapshotRows(rawRows);
  return {
    ...consolidated,
    sourceRowCount: rawRows.length,
    headerRow: headerIdx,
    detectedColumns: cols,
  };
}

// Keep shipment-month filtering deterministic and timezone-safe. Platform
// exports store ISO dates, so slicing the calendar portion is safer than
// converting to local time (which can move a midnight date to another month).
export function merchantLastShipmentMonth(value) {
  if (!value) return '';
  const direct = String(value).trim().match(/^(\d{4})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function filterMerchantsByShipmentMonth(merchants, month) {
  if (!month) return merchants || [];
  return (merchants || []).filter(
    merchant => merchantLastShipmentMonth(merchant?.last_shipment_at) === month,
  );
}

export async function uploadMerchantsSnapshot({ parsed, sourceFile, userId }) {
  if (!parsed?.rows?.length) throw new Error('لا توجد صفوف للحفظ');
  const snapshotId   = `m_${Date.now()}`;
  const snapshotDate = new Date().toISOString().slice(0, 10);
  // Be defensive when an older caller supplies parsed rows directly.
  const consolidated = consolidateMerchantSnapshotRows(parsed.rows);
  const inserts = consolidated.rows.map(r => ({
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
    profile_status:       r.profileStatus,
    vat_registered:       r.vatRegistered,
    zatca_completed:      r.zatcaCompleted,
    verification_status:  r.verificationStatus,
    created_at_platform:  r.createdAtPlatform,
    last_topup_at:        r.lastTopupAt,
    wallet_balance:       r.walletBalance,
    uploaded_by:          userId || null,
  }));
  // One request is intentional: Postgres applies it atomically. The previous
  // 500-row loop could leave an incomplete snapshot as the "latest" source if
  // a duplicate appeared in a later chunk.
  let { error } = await supabase.from('merchants').insert(inserts);
  if (error && isMissingMerchantColumnError(error)) {
    ({ error } = await supabase.from('merchants').insert(inserts.map(stripMerchantNewColumns)));
  }
  if (error) {
    if (String(error.message || '').includes('merchants_snapshot_store_uidx')) {
      throw new Error('يوجد رقم متجر مكرر في الملف. لم تُحفظ أي لقطة؛ أعد تحليل الملف ثم حاول مجددًا.');
    }
    throw error;
  }
  // Preserve every Excel column as a fallback profile source. The registry
  // merges it separately from Lamha API data, so an Excel upload can fill a
  // missing API field without overwriting a non-null API value.
  let profileEnrichment = { merged: 0, error: null };
  try {
    for (let from = 0; from < consolidated.rows.length; from += 500) {
      const profileRows = consolidated.rows.slice(from, from + 500).map(row => ({
        store_id: row.storeId,
        excel_data: row.excelData || canonicalExcelProfile(row),
      }));
      const { data, error: profileError } = await supabase.rpc('merge_lamha_store_profiles_from_excel', {
        p_rows: profileRows,
        p_source_file: sourceFile || null,
      });
      if (profileError) throw profileError;
      profileEnrichment.merged += Number(data?.merged || profileRows.length);
    }
  } catch (profileError) {
    profileEnrichment = {
      merged: profileEnrichment.merged,
      error: String(profileError?.message || profileError),
    };
    console.error('Lamha Excel profile enrichment failed:', profileError);
  }
  // التقط انتقالات دورة حياة المتجر بعد اكتمال كل دفعات الـsnapshot.
  // الإثراء best-effort عمداً: غياب المهاجرة أثناء النشر المتدرّج أو فشل
  // التحليل لا يحوّل رفعاً ناجحاً إلى فشل. الرفع هو مصدر الحقيقة، والـRPC
  // idempotent ويمكن استدعاؤه لاحقاً لنفس snapshot بلا تكرار.
  let lifecycle = null;
  const { data: lifecycleData, error: lifecycleError } = await supabase
    .rpc('capture_merchant_lifecycle_events', { p_snapshot_id: snapshotId });
  if (lifecycleError) {
    console.info('Merchant lifecycle capture deferred:', lifecycleError.message);
  } else {
    lifecycle = lifecycleData || null;
  }
  // كشف متاجر جديد يغيّر حالة/شحنات كثير من المتاجر → أطلق مزامنة تاقات هاتف فوراً
  // (بدل انتظار الكرون 20د). fire-and-forget — الفشل صامت (الكرون شبكة أمان).
  supabase.rpc('trigger_tag_sync').then(() => {}, () => {});
  return {
    snapshotId,
    snapshotDate,
    count: inserts.length,
    sourceRowCount: parsed.sourceRowCount || parsed.rows.length,
    duplicateRowCount: parsed.duplicateRowCount || consolidated.duplicateRowCount || 0,
    duplicateStoreIds: parsed.duplicateStoreIds || consolidated.duplicateStoreIds || [],
    prepaid:       inserts.filter(r => r.billing_type === 'دفع مسبق').length,
    postpaid:      inserts.filter(r => r.billing_type === 'دفع لاحق').length,
    active:        inserts.filter(r => isLamhaAccountEnabled(r.status)).length,
    profileDone:   inserts.filter(r => r.profile_status === 'مكتمل').length,
    vatRegistered: inserts.filter(r => r.vat_registered).length,
    zatcaDone:     inserts.filter(r => r.zatca_completed).length,
    verified:      inserts.filter(r => r.verification_status === 'موثق').length,
    profileEnrichment,
    lifecycle,
  };
}

// V2 Lamha contract: the Employee API owns the operational directory. An
// uploaded stores.xlsx file can only enrich fields Lamha API does not expose
// today. It must not create a newer merchant snapshot or replace API account
// state, identity, billing, shipment, verification or integration values.
export async function uploadLamhaExcelEnrichment({ parsed, sourceFile }) {
  if (!parsed?.rows?.length) throw new Error('لا توجد صفوف للإثراء');
  const consolidated = consolidateMerchantSnapshotRows(parsed.rows);
  let merged = 0;
  for (let from = 0; from < consolidated.rows.length; from += 500) {
    const profileRows = consolidated.rows.slice(from, from + 500).map(row => ({
      store_id: row.storeId,
      excel_data: row.excelData || canonicalExcelProfile(row),
    }));
    const { data, error } = await supabase.rpc('merge_lamha_store_profiles_from_excel', {
      p_rows: profileRows,
      p_source_file: sourceFile || null,
    });
    if (error) throw error;
    merged += Number(data?.merged || profileRows.length);
  }
  return {
    mode: 'excel_enrichment',
    count: consolidated.rows.length,
    merged,
    sourceRowCount: parsed.sourceRowCount || parsed.rows.length,
    duplicateRowCount: parsed.duplicateRowCount || consolidated.duplicateRowCount || 0,
    duplicateStoreIds: parsed.duplicateStoreIds || consolidated.duplicateStoreIds || [],
    profileDone: consolidated.rows.filter(r => r.profileStatus === 'مكتمل').length,
    vatRegistered: consolidated.rows.filter(r => r.vatRegistered).length,
    zatcaDone: consolidated.rows.filter(r => r.zatcaCompleted).length,
    walletRows: consolidated.rows.filter(r => r.walletBalance != null).length,
    topupRows: consolidated.rows.filter(r => r.lastTopupAt).length,
  };
}

// Returns the merchants from the latest snapshot. Used everywhere
// downstream (anomalies, enrichment, insights).
export const MERCHANT_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Do not let an absent or old platform snapshot silently look like a current
// operational fact. Consumers use this state to disable decisions that join
// Zoho receivables with Lamha merchant status.
export function merchantSnapshotSourceState(result, now = Date.now()) {
  const snapshot = result?.snapshot || null;
  const recordCount = Array.isArray(result?.merchants) ? result.merchants.length : 0;
  const base = {
    checkedAt: new Date(now).toISOString(),
    sourceUpdatedAt: snapshot?.uploadedAt || null,
    recordCount,
    maxAgeMinutes: MERCHANT_SNAPSHOT_MAX_AGE_MS / 60_000,
  };

  if (!snapshot) return { ...base, status: 'empty', message: 'لم يُرفع دليل متاجر المنصة بعد.' };
  if (!recordCount) return { ...base, status: 'empty', message: 'أحدث دليل متاجر مرفوع لكنه لا يحتوي متاجر.' };

  const updatedAt = Date.parse(snapshot.uploadedAt || '');
  if (!Number.isFinite(updatedAt)) {
    return { ...base, status: 'stale', message: 'لقطة المتاجر بلا وقت رفع صالح؛ لا يمكن اعتماد حالة المتاجر.' };
  }
  if (now - updatedAt > MERCHANT_SNAPSHOT_MAX_AGE_MS) {
    return { ...base, status: 'stale', message: 'دليل المتاجر أقدم من 24 ساعة؛ حدّثه قبل اتخاذ قرار تشغيل أو إيقاف.' };
  }
  return { ...base, status: 'fresh', message: 'أحدث دليل متاجر متاح.' };
}

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
  let merchants;
  try {
    merchants = await loadAll('merchants',
      'id, store_id, store_name, phone, shipment_count, last_shipment_at, integration_type, billing_type, status, profile_status, vat_registered, zatca_completed, verification_status, created_at_platform, last_topup_at, wallet_balance',
      { snapshot_id: snap.snapshot_id },
    );
  } catch (e) {
    if (!isMissingMerchantColumnError(e)) throw e;
    merchants = await loadAll('merchants',
      'id, store_id, store_name, phone, shipment_count, last_shipment_at, integration_type, billing_type, status, created_at_platform, last_topup_at, wallet_balance',
      { snapshot_id: snap.snapshot_id },
    );
  }
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

  const candidatesByStore = new Map();
  for (const m of merchants) {
    const mNorm = normalizeName(m.store_name);
    if (!mNorm) continue;
    let merchantBest = null;
    // Exact match on any segment → confidence 1.0
    for (const seg of segments) {
      if (seg === mNorm) {
        merchantBest = { storeId: m.store_id, storeName: m.store_name, confidence: 1.0, method: 'auto-exact' };
        break;
      }
      // Substring containment also high confidence
      if (seg.length >= 3 && (seg.includes(mNorm) || mNorm.includes(seg))) {
        const sim = Math.min(seg.length, mNorm.length) / Math.max(seg.length, mNorm.length);
        if (!merchantBest || sim > merchantBest.confidence) {
          merchantBest = { storeId: m.store_id, storeName: m.store_name, confidence: +sim.toFixed(2), method: 'auto-fuzzy' };
        }
        continue;
      }
      // Fuzzy Levenshtein
      const sim = similarity(seg, mNorm);
      if (!merchantBest || sim > merchantBest.confidence) {
        merchantBest = { storeId: m.store_id, storeName: m.store_name, confidence: +sim.toFixed(2), method: 'auto-fuzzy' };
      }
    }
    if (merchantBest) candidatesByStore.set(String(m.store_id), merchantBest);
  }
  const ranked = [...candidatesByStore.values()].sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.confidence < 0.78) return null;
  if (runnerUp && best.confidence - runnerUp.confidence < 0.05) return null;
  return best;
}

// Returns customers in the CURRENT receivables snapshot who don't
// resolve to a valid merchant link. "Unmatched" means one of:
//   • no row in customer_merchant_links for this customer_name
//   • a row exists but store_id is null
//   • a row exists but the linked store_id is no longer in the latest
//     merchants snapshot (orphaned)
//
// Important: this used to start from customer_merchant_links and only
// surface entries that had already been auto-link processed. That made
// the count diverge from the receivables page — a brand-new customer
// in the latest snapshot wouldn't appear here at all because it never
// got an auto-link entry. Now both pages agree on the same number.
export async function loadUnmatchedCustomers() {
  const { customers: recCustomers = [] } = await loadLatestReceivablesLite();
  if (!recCustomers.length) return [];

  const [{ data: links }, { merchants }] = await Promise.all([
    supabase.from('customer_merchant_links').select('customer_name, store_id, match_method, confidence'),
    loadLatestMerchants(),
  ]);
  const linkByName  = new Map((links || []).map(l => [l.customer_name, l]));
  const merchantIds = new Set((merchants || []).map(m => m.store_id));

  const unmatched = [];
  for (const c of recCustomers) {
    const link = linkByName.get(c.name);
    const truly = !link || !link.store_id || !merchantIds.has(link.store_id);
    if (!truly) continue;
    unmatched.push({
      customerName: c.name,
      confidence:   link?.confidence ?? null,
      matchMethod:  link?.match_method ?? 'never_linked',
      totalDue:     c.total || 0,
      oldestInvoiceAt: c.oldestInvoiceDate || null,
      daysOutstanding: c.daysOutstanding || 0,
    });
  }
  return unmatched.sort((a, b) => (b.totalDue || 0) - (a.totalDue || 0));
}

// Lightweight receivables fetcher (just name + total + aging) — kept
// inside merchantsService to avoid a circular import with the receivables
// service which itself reads from this file for merchant overlay.
async function loadLatestReceivablesLite() {
  const { data: latest, error: e1 } = await supabase
    .from('customer_receivables')
    .select('snapshot_id, uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  if (e1) throw e1;
  if (!latest?.length) return { customers: [] };
  const rows = await loadAll(
    'customer_receivables',
    'customer_name, balance_amount, invoice_date, is_summary',
    { snapshot_id: latest[0].snapshot_id },
  );
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const byCustomer = new Map();
  for (const r of rows) {
    const name = r.customer_name;
    if (!byCustomer.has(name)) byCustomer.set(name, { name, total: 0, oldestInvoiceDate: null, daysOutstanding: 0 });
    const c = byCustomer.get(name);
    if (r.is_summary) {
      c.total = Number(r.balance_amount) || 0;
    } else if (r.invoice_date) {
      if (!c.oldestInvoiceDate || r.invoice_date < c.oldestInvoiceDate) {
        c.oldestInvoiceDate = r.invoice_date;
        c.daysOutstanding = Math.max(0, Math.floor((today - new Date(r.invoice_date)) / 86_400_000));
      }
    }
  }
  return { customers: [...byCustomer.values()] };
}

export async function loadCustomerMerchantLinks() {
  const data = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supabase
      .from('customer_merchant_links')
      .select('customer_name, store_id, confidence, match_method')
      .order('customer_name', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    data.push(...(page || []));
    if (!page?.length || page.length < PAGE) break;
  }
  const map = new Map();
  for (const r of data) {
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
//
// The match itself now runs server-side via bulk_match_customers()
// RPC — the previous JS path was O(customers × merchants × name²)
// and locked the browser tab for several seconds at the current row
// counts (3K × 3K). The RPC uses a pg_trgm GIN index on the
// normalized store_name so each customer's match becomes O(top-N
// candidates) regardless of how many merchants exist.
//
// The `merchants` argument is kept in the signature for backwards
// compatibility but is no longer used here — the RPC reads the
// latest merchants snapshot itself.
// أسماء عملاء زوهو **الحيّة** (المرآة: العقود + الفواتير) ثم مطابقتها بكشف
// المتاجر. كانت هذه الخطوة تعيش داخل زر «ربط تلقائي» في الصفحة فقط — فتُنسى
// بعد كل رفع كشف جديد، ويبقى العملاء الجدد بلا متجر حتى ينتبه أحد.
// استُخرِجت هنا كي يستدعيها الزر **والرفع** معاً (نقطة منطق واحدة).
export async function autoLinkFromZoho({ userId } = {}) {
  const [contactsRes, invoicesRes] = await Promise.all([
    supabase.from('zoho_contacts').select('contact_name').eq('contact_type', 'customer'),
    supabase.from('zoho_invoices').select('customer_name'),
  ]);
  if (contactsRes.error) throw contactsRes.error;
  const names = [...new Set([
    ...(contactsRes.data || []).map(r => r.contact_name),
    ...(invoicesRes.data || []).map(r => r.customer_name),
  ].filter(Boolean))];
  if (!names.length) return { total: 0, matched: 0, unmatched: 0 };
  const results = await autoLinkCustomers(names, null, { userId });
  const matched = [...results.values()].filter(r => r.storeId).length;
  return { total: names.length, matched, unmatched: names.length - matched };
}

export async function autoLinkCustomers(customerNames, _merchants, { userId } = {}) {
  if (!customerNames?.length) return new Map();
  const existing = await loadCustomerMerchantLinks();
  const results = new Map();
  // Filter to names that need fresh matching (don't touch manual
  // links — operators rely on those staying put across re-runs).
  const namesToMatch = [];
  for (const name of customerNames) {
    const prior = existing.get(name);
    if (prior?.method === 'manual') {
      results.set(name, prior);
      continue;
    }
    namesToMatch.push(name);
  }
  if (!namesToMatch.length) return results;

  // One round-trip for the whole batch. Postgres returns at most one
  // row per customer (the best match above threshold); names with no
  // returned row default to `unmatched`.
  const { data: matches, error } = await supabase.rpc('bulk_match_customers', {
    p_names:     namesToMatch,
    p_threshold: 0.78,
  });
  if (error) throw error;
  const matchByName = new Map((matches || []).map(m => [m.customer_name, m]));

  const toUpsert = [];
  for (const name of namesToMatch) {
    const m = matchByName.get(name);
    const link = m
      ? { storeId: m.store_id, confidence: Number(m.confidence), method: m.method }
      : { storeId: null,        confidence: 0,                    method: 'unmatched' };
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
      const { error: e2 } = await supabase
        .from('customer_merchant_links')
        .upsert(toUpsert.slice(i, i + CHUNK), { onConflict: 'customer_name' });
      if (e2) throw e2;
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
      profileDone: 0, vatRegistered: 0, zatcaDone: 0, verified: 0,
      walletTotal: 0, topByVolume: [],
    };
  }
  const days = (a, b) => Math.floor((b - new Date(a)) / 86_400_000);
  let prepaid = 0, postpaid = 0, active = 0, inactive = 0;
  let newLast30 = 0, newLast90 = 0, neverShipped = 0;
  let dormantActive = 0, walletPilesUp = 0;
  let profileDone = 0, vatRegistered = 0, zatcaDone = 0, verified = 0;
  let walletTotal = 0;
  let totalShipments = 0;
  const churnedList = [];     // status=inactive but had shipments → real customers we lost
  const walletPilesList = []; // prepaid + balance > 0 + idle > 60d
  for (const m of merchants) {
    if (m.billing_type === 'دفع مسبق') prepaid++;
    if (m.billing_type === 'دفع لاحق') postpaid++;
    if (isLamhaAccountEnabled(m.status)) active++;
    if (isLamhaAccountDisabled(m.status)) inactive++;
    if (m.profile_status === 'مكتمل') profileDone++;
    if (m.vat_registered === true) vatRegistered++;
    if (m.zatca_completed === true) zatcaDone++;
    if (m.verification_status === 'موثق') verified++;
    if (m.created_at_platform && days(m.created_at_platform, today) <= 30) newLast30++;
    if (m.created_at_platform && days(m.created_at_platform, today) <= 90) newLast90++;
    if ((m.shipment_count || 0) === 0) neverShipped++;
    if (['active', 'نشط'].includes(normalizeLamhaStatus(m.status)) && m.last_shipment_at && days(m.last_shipment_at, today) > 60) dormantActive++;
    if (isLamhaLifecycleStopped(m.status) && (m.shipment_count || 0) > 0) churnedList.push(m);
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
    profileDone, vatRegistered, zatcaDone, verified,
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
