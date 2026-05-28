import { supabase } from './supabase.js';
import { buildSummary } from '../engine/audit.js';
import { SEED_CARRIERS } from '../data/carriers.js';
import { deriveAuditType } from '../engine/audit.js';

// ── Carriers ──────────────────────────────────────────────────────────────────

export async function loadCarriers() {
  const { data, error } = await supabase
    .from('carriers').select('*').order('name');
  if (error) throw error;

  if (!data?.length) {
    await seedCarriers();
    return SEED_CARRIERS;
  }

  return data.map(row => ({
    id:               row.id,
    name:             row.name,
    logo:             row.logo,
    color:            row.color,
    contracts:        row.contracts ?? [],
    // The webhook/file profile (email_from, file_kind, awb_prefix, etc.).
    // Passed straight through — WebhookEvents needs `file_kind` to decide
    // whether to show 'حفظ كتحصيل' alongside 'حفظ كمراجعة', and the
    // CarrierProfile editor reads + writes it.
    file_signature:   row.file_signature   ?? {},
    // Operational metadata — used by /payments and the carrier ledger
    // for "who do I call about this invoice" lookups.
    contactEmail:     row.contact_email     ?? '',
    contactPhone:     row.contact_phone     ?? '',
    accountManager:   row.account_manager   ?? '',
    iban:             row.iban              ?? '',
    bankName:         row.bank_name         ?? '',
    contractPdfPath:  row.contract_pdf_path ?? null,
  }));
}

async function seedCarriers() {
  const rows = SEED_CARRIERS.map(c => ({
    id:        c.id,
    name:      c.name,
    logo:      c.logo,
    color:     c.color,
    contracts: c.contracts,
  }));
  await supabase.from('carriers').upsert(rows, { onConflict: 'id' });
}

export async function saveCarrier(carrier, opts = {}) {
  // Capture pre-save contracts so we can diff and write a history row
  // per changed contract. Best-effort: failures here never block the save.
  let priorContracts = null;
  try {
    const { data: prior } = await supabase
      .from('carriers')
      .select('contracts')
      .eq('id', carrier.id)
      .maybeSingle();
    priorContracts = prior?.contracts || [];
  } catch { /* first-time save → no prior row */ }

  const { error } = await supabase.from('carriers').upsert({
    id:                 carrier.id,
    name:               carrier.name,
    logo:               carrier.logo,
    color:              carrier.color,
    contracts:          carrier.contracts ?? [],
    contact_email:      carrier.contactEmail    || null,
    contact_phone:      carrier.contactPhone    || null,
    account_manager:    carrier.accountManager  || null,
    iban:               carrier.iban            || null,
    bank_name:          carrier.bankName        || null,
    contract_pdf_path:  carrier.contractPdfPath || null,
    updated_at:         new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;

  // After the save lands, write contract-history rows for any contract
  // that was added, removed, or modified. Done inline so the same
  // database session sees the new contracts array; failure is logged
  // but doesn't bubble up — history is auxiliary.
  try {
    const { saveCarrierContractsWithHistory } = await import('./contractHistoryService.js');
    await saveCarrierContractsWithHistory(
      carrier.id,
      priorContracts,
      carrier.contracts ?? [],
      opts.userId || null,
    );
  } catch (e) {
    console.warn('contract history write failed:', e.message);
  }
}

export async function deleteCarrierFromDB(id) {
  const { error } = await supabase.from('carriers').delete().eq('id', id);
  if (error) throw error;
}

// ── Carrier contract PDF storage ─────────────────────────────────────────
// Best-effort upload to the carrier-contracts bucket. Returns the storage
// path on success or null on failure. Called from CarrierManager when
// the user attaches a PDF; the path is then saved to carriers.contract_pdf_path.
export async function uploadCarrierContractPdf({ carrierId, file }) {
  if (!file || !carrierId) return null;
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const safeId = carrierId.replace(/[^a-z0-9_-]/gi, '_');
  const path = `${safeId}/contract_${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('carrier-contracts')
    .upload(path, file, { upsert: true, contentType: file.type || 'application/pdf' });
  if (error) {
    console.warn('contract pdf upload failed:', error.message);
    return null;
  }
  return path;
}

// Signed URL for viewing — bucket is private, so we mint a short-lived
// link only when the user clicks "view".
export async function getCarrierContractUrl(path, expiresInSec = 600) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('carrier-contracts')
    .createSignedUrl(path, expiresInSec);
  if (error) {
    console.warn('contract pdf signed-url failed:', error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

// ── Audits ────────────────────────────────────────────────────────────────────

// Deterministic fingerprint of the audit's contents — sorted "awb|amount"
// pairs hashed with djb2 in 32-bit space. Two audits with the same hash
// (and same carrier) almost certainly came from the same source file.
// Used by saveAuditToDB to refuse re-uploading the same file twice.
function computeContentHash(results) {
  if (!Array.isArray(results) || !results.length) return null;
  const sigs = [];
  for (const r of results) {
    const awb = String(r.awb || '').trim();
    if (!awb) continue;
    const amt = Number(r.invoiced?.total || 0).toFixed(2);
    sigs.push(`${awb}|${amt}`);
  }
  if (!sigs.length) return null;
  sigs.sort();
  const joined = sigs.join('\n');
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = (((h << 5) + h) + joined.charCodeAt(i)) | 0;
  }
  return `${sigs.length}_${(h >>> 0).toString(36)}`;
}

// Pre-tax drift tolerance: how many SAR the file totals are allowed to
// differ from the contract-expected totals before we refuse to approve.
// Set very tight on purpose — the engine math should match the carrier
// math to within rounding noise. Any larger drift = something is wrong.
export const APPROVAL_DRIFT_TOLERANCE_PRE_TAX = 0.50;
export const APPROVAL_DRIFT_TOLERANCE_TAX     = 1.00;

// Slim a result row down to what we need for cross-audit dup tracing +
// for legacy audits.results JSONB fallback. The full detail (invoiced /
// expected breakdowns) lives in audit_shipments.detail and is loaded only
// when the user drills in.
function trimResultForLegacyJsonb(r) {
  return {
    awb:     r.awb,
    status:  r.status,
    invoiced: { total: Number(r.invoiced?.total) || 0, tax: Number(r.invoiced?.tax) || 0 },
  };
}

// Convert any string the parser might have left as the shipDate into an
// ISO yyyy-mm-dd date or null. Postgres rejects free-form date strings.
function toIsoDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

// Map one engine result row → audit_shipments column shape.
function toShipmentRow(auditId, carrierId, r) {
  return {
    audit_id:        auditId,
    carrier_id:      carrierId ?? '',
    awb:             String(r.awb || '').trim() || null,
    ship_date:       toIsoDate(r.shipDate),
    dest_country:    r.dest || null,
    domestic:        !!r.domestic,
    is_cod:          !!r.isCod,
    weight_kg:       Number(r.weight) || 0,
    invoiced_total:  Number(r.invoiced?.total) || 0,
    expected_total:  Number(r.expected?.total) || 0,
    diff_total:      Number(r.diffs?.total) || 0,
    tax_amount:      Number(r.invoiced?.tax) || 0,
    cod_amount:      Number(r.codAmount) || 0,
    cod_fee:         Number(r.codFee) || 0,
    pos_amount:      Number(r.posAmount) || 0,
    pos_fee:         Number(r.posFee) || 0,
    rss:             Number(r.rss) || 0,
    fuel_surcharge:  Number(r.fuelSurcharge) || 0,
    status:          r.status || 'ok',
    issue_count:     Array.isArray(r.issues) ? r.issues.length : 0,
    issues:          Array.isArray(r.issues) ? r.issues : [],
    // Keep the full breakdowns (invoiced / expected / diffs + flags)
    // for the drill-down panel — but only as JSONB on the row that
    // actually has issues; clean rows store an empty object.
    detail: r.status === 'ok' ? {} : {
      invoiced:    r.invoiced,
      expected:    r.expected,
      diffs:       r.diffs,
      destCity:    r.destCity,
      origin:      r.origin,
      billingType: r.billingType,
      serviceType: r.serviceType,
      signingStatus: r.signingStatus,
      crossAuditDup: r.crossAuditDup,
    },
  };
}

export async function saveAuditToDB(audit, userId) {
  const summary = audit.summary ?? {};
  const results = audit.results ?? [];
  // Defensive recompute — buildSummary used to omit these fields, and the
  // carrier-statement link flow needs totalBilled to compare against the
  // post-VAT operation amount. If the caller already filled them in we
  // honor those numbers; otherwise we sum across results so old/legacy
  // call sites still produce a usable row.
  const totalBilled = summary.totalBilled
    ?? +results.reduce((s, r) => s + (Number(r.invoiced?.total) || 0), 0).toFixed(2);
  const totalExpected = summary.totalExpected
    ?? +results.reduce((s, r) => s + (Number(r.expected?.total) || 0), 0).toFixed(2);
  // Per-file Tax Amount — falls back to summing invoiced.tax in case the
  // caller built the audit object without going through buildSummary.
  const totalTax = summary.totalTax
    ?? +results.reduce((s, r) => s + (Number(r.invoiced?.tax) || 0), 0).toFixed(2);
  const diff = summary.diff ?? summary.totalDiff ?? 0;
  const auditType = audit.auditType ?? deriveAuditType(results);
  const contentHash = computeContentHash(results);

  // ── Penny-perfect gate inputs (persisted so the UI can decide whether
  //    approval is allowed without recomputing) ─────────────────────────
  const driftPreTax    = +Math.abs(totalBilled - totalExpected).toFixed(2);
  const driftTax       = +Math.abs(totalTax - (totalBilled * 0.15)).toFixed(2);
  const mismatchCount  = results.filter(r => r.status === 'mismatch').length;

  // Refuse re-uploading the exact same file. The fingerprint is
  // (sorted awb|amount pairs) — robust against re-saves of the same
  // audit (we exclude its own id) but catches "I clicked رفع twice"
  // and "I uploaded last week's file again by mistake".
  if (contentHash) {
    const { data: existing, error: hashErr } = await supabase
      .from('audits')
      .select('id, file_name, period, created_at')
      .eq('carrier_id', audit.carrierId)
      .eq('content_hash', contentHash)
      .neq('id', audit.id)
      .limit(1);
    if (hashErr) throw hashErr;
    if (existing?.length) {
      const prior = existing[0];
      const date = prior.created_at
        ? new Date(prior.created_at).toLocaleDateString('ar-SA')
        : '—';
      const label = prior.file_name || `#${String(prior.id).slice(0, 12)}`;
      const err = new Error(
        `هذا الملف مرفوع سابقاً (${label} · ${date}). ` +
        `لتجنب التكرار، احذف المراجعة الموجودة من 📋 السجل أولاً ثم أعد الرفع.`,
      );
      err.code = 'DUPLICATE_AUDIT';
      err.priorAuditId = prior.id;
      throw err;
    }
  }

  // Honor review status from the audit object so the
  // "approve-while-saving-the-draft" flow actually flips
  // review_status='approved' in the same upsert. Old callers that
  // don't set audit.reviewStatus get the table default ('pending').
  const rs = audit.reviewStatus;
  const reviewFields = rs ? {
    review_status:   rs,
    approved_at:     rs === 'approved' ? (audit.approvedAt || new Date().toISOString()) : null,
    approved_by:     rs === 'approved' ? (audit.approvedBy || userId || null) : null,
    rejected_at:     rs === 'rejected' ? (audit.rejectedAt || new Date().toISOString()) : null,
    rejected_reason: rs === 'rejected' ? (audit.rejectedReason || null) : null,
  } : {};

  // COD-only audits (Aramex ZDCF rows) audit the per-shipment COD
  // service fee against contract.codFee. They share AWBs + weights
  // with the underlying shipment, but the shipment itself lives in
  // a separate ZDOI audit — these rows aren't billable to the
  // merchant. Mark them `skipped` upfront so they don't show up in
  // the weight-billing queue forever.
  const hasShippableRow = results.some(r =>
    r.awb && Number(r.weight) > 0 && !r.isCod,
  );
  const weightBillingFields = (!hasShippableRow || auditType === 'cod')
    ? { weight_billing_status: 'skipped' }
    : {};

  // Slim legacy JSONB: keep only the rows with issues (typically <5% of
  // a clean audit). The full row-level detail lives in audit_shipments.
  // This stops 500K-row audits from blowing past Postgres's TOAST limits.
  const legacyResultsSlim = results
    .filter(r => r.status !== 'ok')
    .map(trimResultForLegacyJsonb)
    .slice(0, 2000); // hard cap — UI uses paginated loads beyond this

  const { error } = await supabase.from('audits').upsert({
    id:             audit.id,
    carrier_id:     audit.carrierId,
    carrier_name:   audit.carrierName  ?? '',
    contract_label: audit.contractLabel ?? summary.contractLabel ?? '',
    file_name:      audit.fileName     ?? summary.fileName ?? '',
    period:         audit.period       ?? '',
    ...reviewFields,
    ...weightBillingFields,
    row_count:      results.length,
    issue_count:    results.filter(r => r.status !== 'ok').length,
    mismatch_count: mismatchCount,
    drift_pre_tax:  driftPreTax,
    drift_tax:      driftTax,
    total_expected: totalExpected,
    total_billed:   totalBilled,
    total_tax:      totalTax,
    diff,
    audit_type:     auditType,
    content_hash:   contentHash,
    results:        legacyResultsSlim,
    col_map:        audit.colMap   ?? {},
    created_by:     userId,
    created_at:     audit.createdAt ?? new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;

  // ── Persist per-shipment rows in batches. Handles 100K+ comfortably. ─
  await syncAuditShipments(audit.id, audit.carrierId, results);

  // Write the per-AWB ledger so future audits can detect cross-month
  // double-billing. (Continues to use the lightweight audit_awb_ledger
  // table because the cross-audit duplicate path is already tuned for it.)
  await syncAwbLedger(audit.id, audit.carrierId, results);
}

// Replace prior audit_shipments rows for this audit with a fresh set,
// inserted in chunks so that 100K-500K shipments fit within Supabase's
// per-request payload limits. Each chunk is ~1000 rows and bounded by
// the JSON size Postgres + supabase-js will accept (~1MB).
async function syncAuditShipments(auditId, carrierId, results) {
  await supabase.from('audit_shipments').delete().eq('audit_id', auditId);
  if (!Array.isArray(results) || !results.length) return;
  const CHUNK = 1000;
  for (let i = 0; i < results.length; i += CHUNK) {
    const slice = results.slice(i, i + CHUNK).map(r => toShipmentRow(auditId, carrierId, r));
    const { error } = await supabase.from('audit_shipments').insert(slice);
    if (error) {
      throw new Error(
        `فشل حفظ شحنات المراجعة (دفعة ${i}-${i + slice.length}): ${error.message}`,
      );
    }
  }
}

// ── AWB ledger ─────────────────────────────────────────────────────────────
// Maintains a (carrier, awb, billing_class) → audit_id lookup so we can
// flag the same shipment showing up in two different audits. Same AWB in
// the same audit but two billing classes (ZDOI + ZDCF for COD shipments) is
// legal; same AWB in the same class across audits is the red flag.
async function syncAwbLedger(auditId, carrierId, results) {
  // Wipe prior rows for this audit so re-saves don't accumulate.
  await supabase.from('audit_awb_ledger').delete().eq('audit_id', auditId);

  const rows = [];
  for (const r of results ?? []) {
    const awb = String(r.awb || '').trim();
    if (!awb) continue;
    rows.push({
      audit_id:      auditId,
      carrier_id:    carrierId ?? '',
      awb,
      billing_class: r.isCod ? 'cod' : 'ship',
      period:        r.shipDate ? r.shipDate.slice(0, 7) : null,
      ship_date:     r.shipDate || null,
      invoiced:      Number(r.invoiced?.total ?? 0),
    });
  }
  if (!rows.length) return;
  // Insert in chunks — Supabase rejects very large single payloads.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('audit_awb_ledger').insert(rows.slice(i, i + CHUNK));
    if (error) throw error;
  }
}

// Mutates `results` in-place: for any AWB that already appears in a prior
// audit's ledger (same carrier + same billing class), force status='mismatch'
// with expected=0 so the full invoiced amount lands in totalDiff, and add a
// "cross-month duplicate" issue. Returns the count of rows flagged.
export async function applyCrossAuditDuplicates(results, carrierId, opts = {}) {
  const { excludeAuditId } = opts;
  if (!Array.isArray(results) || !carrierId) return 0;
  const awbsByClass = { ship: [], cod: [] };
  for (const r of results) {
    const awb = String(r.awb || '').trim();
    if (!awb) continue;
    awbsByClass[r.isCod ? 'cod' : 'ship'].push(awb);
  }
  if (!awbsByClass.ship.length && !awbsByClass.cod.length) return 0;
  const prior = await findCrossAuditDuplicates({ carrierId, awbsByClass, excludeAuditId });
  if (!prior.size) return 0;
  let flagged = 0;
  for (const r of results) {
    const awb = String(r.awb || '').trim();
    if (!awb) continue;
    const cls = r.isCod ? 'cod' : 'ship';
    const hits = prior.get(`${awb}|${cls}`);
    if (!hits?.length) continue;
    const periods = [...new Set(hits.map(h => h.period).filter(Boolean))].join(' / ') || '—';
    const inv = r.invoiced ?? { delivery: 0, rss: 0, fuel: 0, total: 0 };
    r.expected = { delivery: 0, rss: 0, fuel: 0, total: 0 };
    r.diffs = {
      delivery: inv.delivery, rss: inv.rss, fuel: inv.fuel, total: inv.total,
    };
    r.status = inv.total > 0.51 ? 'mismatch' : 'ok';
    r.crossAuditDup = hits.length;
    r.issues = [
      ...(r.issues || []),
      {
        field: 'cross-duplicate',
        label: 'AWB فُوتر في مراجعة سابقة',
        invoiced: inv.total,
        expected: 0,
        diff: inv.total,
        note: `الـAWB ${awb} ظهر سابقاً في ${hits.length} مراجعة${hits.length > 1 ? '' : ''} (${periods}). تكرار بين الأشهر — لا يجوز.`,
      },
    ];
    flagged++;
  }
  return flagged;
}

// Look up which AWBs in the supplied list have ALREADY been audited in
// some other audit for the same carrier. Returns a Map keyed by
// `${awb}|${billing_class}` whose value lists the prior audit_ids and the
// invoiced amounts. Empty when no overlap.
//
// Use this BEFORE auditAll to surface cross-month duplicates: the engine
// flags within-file dupes; this catches the harder "same AWB in last
// month's invoice" case.
export async function findCrossAuditDuplicates({ carrierId, awbsByClass, excludeAuditId } = {}) {
  const out = new Map();
  if (!carrierId) return out;
  // awbsByClass: { ship: ['awb1', ...], cod: ['awb2', ...] }
  for (const [cls, awbs] of Object.entries(awbsByClass ?? {})) {
    if (!awbs?.length) continue;
    let q = supabase
      .from('audit_awb_ledger')
      .select('audit_id, awb, billing_class, period, ship_date, invoiced')
      .eq('carrier_id', carrierId)
      .eq('billing_class', cls)
      .in('awb', awbs);
    if (excludeAuditId) q = q.neq('audit_id', excludeAuditId);
    const { data, error } = await q;
    if (error) throw error;
    for (const row of data ?? []) {
      const k = `${row.awb}|${row.billing_class}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(row);
    }
  }
  return out;
}

export async function loadAuditsFromDB(limit = 50) {
  const { data, error } = await supabase
    .from('audits')
    .select('id, carrier_name, contract_label, file_name, period, row_count, issue_count, total_expected, total_billed, total_tax, diff, audit_type, created_at, review_status, approved_at, rejected_reason')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map(row => ({
    id:            row.id,
    carrierName:   row.carrier_name,
    contractLabel: row.contract_label,
    fileName:      row.file_name,
    period:        row.period,
    rowCount:      row.row_count,
    issueCount:    row.issue_count,
    totalExpected: row.total_expected,
    totalBilled:   row.total_billed,
    totalTax:      row.total_tax,
    diff:          row.diff,
    auditType:     row.audit_type,
    date:          row.created_at,
    reviewStatus:  row.review_status ?? 'pending',
    approvedAt:    row.approved_at,
    rejectedReason: row.rejected_reason,
  }));
}

// Reverse of toShipmentRow — rebuild the engine result row from a
// audit_shipments DB row. Used by loadAuditByIdFromDB so the existing
// AuditResults page sees the legacy shape.
function fromShipmentRow(r) {
  const d = r.detail || {};
  return {
    awb:             r.awb || '',
    shipDate:        r.ship_date || '',
    dest:            r.dest_country || '',
    destCity:        d.destCity || '',
    origin:          d.origin || '',
    domestic:        !!r.domestic,
    isCod:           !!r.is_cod,
    billingType:     d.billingType || '',
    serviceType:     d.serviceType || '',
    signingStatus:   d.signingStatus || '',
    weight:          Number(r.weight_kg) || 0,
    deliveryCharges: Number(d.invoiced?.delivery) || 0,
    rss:             Number(r.rss) || 0,
    fuelSurcharge:   Number(r.fuel_surcharge) || 0,
    codFee:          Number(r.cod_fee) || 0,
    posAmount:       Number(r.pos_amount) || 0,
    posFee:          Number(r.pos_fee) || 0,
    tax:             Number(r.tax_amount) || 0,
    codAmount:       Number(r.cod_amount) || 0,
    status:          r.status || 'ok',
    invoiced: d.invoiced || {
      delivery: 0, rss: 0, fuel: 0, codFee: 0, posFee: 0,
      total: Number(r.invoiced_total) || 0,
      tax:   Number(r.tax_amount) || 0,
    },
    expected: d.expected || {
      delivery: 0, rss: 0, fuel: 0, codFee: 0, posFee: 0,
      total: Number(r.expected_total) || 0,
    },
    diffs: d.diffs || {
      delivery: 0, rss: 0, fuel: 0, codFee: 0, posFee: 0,
      total: Number(r.diff_total) || 0,
    },
    issues:        Array.isArray(r.issues) ? r.issues : [],
    crossAuditDup: d.crossAuditDup || 0,
  };
}

// Paginated row loader. Used by the AuditResults page so big audits
// don't load 500K rows into the browser at once. status='all' returns
// every row in the page; 'issues' returns only mismatched/favorable/
// unknown rows (the only ones the user typically wants to see).
//
//   loadAuditShipments(id, { status:'issues', from:0, limit:200 })
//
export async function loadAuditShipments(auditId, { status = 'all', from = 0, limit = 500 } = {}) {
  let q = supabase
    .from('audit_shipments')
    .select('*')
    .eq('audit_id', auditId)
    .order('id', { ascending: true })
    .range(from, from + limit - 1);
  if (status === 'issues') q = q.neq('status', 'ok');
  else if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(fromShipmentRow);
}

export async function countAuditShipments(auditId, { status = 'all' } = {}) {
  let q = supabase
    .from('audit_shipments')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', auditId);
  if (status === 'issues') q = q.neq('status', 'ok');
  else if (status && status !== 'all') q = q.eq('status', status);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

export async function loadAuditByIdFromDB(id, { hydrateRows = true } = {}) {
  const { data, error } = await supabase
    .from('audits').select('*').eq('id', id).single();
  if (error) throw error;

  // Pull row-level detail from audit_shipments. For very big audits we
  // ONLY hydrate the problematic rows by default — clean rows stay on
  // the server. The UI fetches more on demand via loadAuditShipments().
  let results = [];
  if (hydrateRows) {
    try {
      const issues = await loadAuditShipments(id, { status: 'issues', from: 0, limit: 5000 });
      results = issues;
      // Legacy fallback: audits saved before the audit_shipments table
      // existed still have full results in the JSONB column.
      if (!results.length && Array.isArray(data.results) && data.results.length) {
        results = data.results;
      }
    } catch {
      if (Array.isArray(data.results)) results = data.results;
    }
  }

  // Rebuild the full per-status summary (ok / mismatch / favorable /
  // unknown counts, per-component diffs, gross totals). For the new
  // pipeline, audits row already holds totals + drift in scalar columns
  // so we trust those over re-summing the slim results array.
  const rebuilt = buildSummary(results);
  // Reconcile aggregate counts from the audits row (these are authoritative
  // for new-pipeline audits where `results` only contains issues).
  const issueCount = data.issue_count ?? rebuilt.total - rebuilt.ok;
  const okCount    = Math.max(0, (data.row_count || rebuilt.total) - issueCount);

  return {
    id:            data.id,
    carrierId:     data.carrier_id,
    carrierName:   data.carrier_name,
    contractLabel: data.contract_label,
    fileName:      data.file_name,
    period:        data.period,
    rowCount:      data.row_count,
    issueCount:    data.issue_count,
    totalExpected: data.total_expected,
    totalBilled:   data.total_billed,
    totalTax:      data.total_tax,
    diff:          data.diff,
    driftPreTax:   data.drift_pre_tax,
    driftTax:      data.drift_tax,
    mismatchCount: data.mismatch_count,
    auditType:     data.audit_type,
    results,
    colMap:        data.col_map ?? {},
    date:          data.created_at,
    reviewStatus:  data.review_status ?? 'pending',
    approvedAt:    data.approved_at,
    approvedBy:    data.approved_by,
    rejectedReason: data.rejected_reason,
    rejectedAt:    data.rejected_at,
    summary: {
      ...rebuilt,
      total:         data.row_count || rebuilt.total,
      ok:            okCount,
      mismatch:      data.mismatch_count ?? rebuilt.mismatch,
      totalBilled:   Number(data.total_billed)   || 0,
      totalExpected: Number(data.total_expected) || 0,
      totalTax:      Number(data.total_tax)      || 0,
      totalGross:    +(Number(data.total_billed || 0) + Number(data.total_tax || 0)).toFixed(2),
      driftPreTax:   Number(data.drift_pre_tax)  || 0,
      driftTax:      Number(data.drift_tax)      || 0,
      contractLabel: data.contract_label,
      fileName:      data.file_name,
    },
  };
}

// ── Penny-perfect approval gate ───────────────────────────────────────
// Returns { canApprove, errors[], warnings[] }. The page disables the
// approve button when any 'block' issue is present, and surfaces the
// list to the user so they know exactly what to fix.
export function evaluateApprovalGate(audit) {
  const errors = [];
  const warnings = [];
  const s = audit?.summary || {};

  const mismatchCount = Number(s.mismatch ?? audit?.mismatchCount ?? 0);
  if (mismatchCount > 0) {
    errors.push({
      code: 'mismatch_rows',
      message: `${mismatchCount} شحنة فيها فرق فردي يجب حلّها أولاً`,
    });
  }

  const driftPre = Number(s.driftPreTax ?? audit?.driftPreTax ?? Math.abs((s.totalBilled || 0) - (s.totalExpected || 0)));
  if (driftPre > APPROVAL_DRIFT_TOLERANCE_PRE_TAX) {
    errors.push({
      code: 'drift_pre_tax',
      message: `فرق ${driftPre.toFixed(2)} ر.س بين المتوقع (${Number(s.totalExpected || 0).toFixed(2)}) والمفوتر (${Number(s.totalBilled || 0).toFixed(2)})`,
    });
  }

  const driftTax = Number(s.driftTax ?? audit?.driftTax ?? Math.abs((s.totalTax || 0) - (s.totalBilled || 0) * 0.15));
  if (driftTax > APPROVAL_DRIFT_TOLERANCE_TAX) {
    warnings.push({
      code: 'drift_tax',
      message: `ضريبة ${Number(s.totalTax || 0).toFixed(2)} ر.س لا تطابق 15% (متوقع ${((s.totalBilled || 0) * 0.15).toFixed(2)})`,
    });
  }

  return { canApprove: errors.length === 0, errors, warnings };
}

// Approve an audit — gated by evaluateApprovalGate(). On success:
//   1. flips audits.review_status to 'approved'
//   2. inserts ONE row in carrier_operations (doc_type='INV') that
//      represents the carrier's invoice. Idempotent via the unique
//      index (audit_id) WHERE doc_type='INV'.
//
// Throws an Error with .code='APPROVAL_BLOCKED' if any drift / mismatch
// gate fails. The caller surfaces .errors to the user.
export async function approveAudit(auditId, userId) {
  // Fetch the latest audit + summary so the gate evaluates against the
  // current numbers (callers might re-approve after a re-save).
  const audit = await loadAuditByIdFromDB(auditId, { hydrateRows: false });
  const gate = evaluateApprovalGate(audit);
  if (!gate.canApprove) {
    const err = new Error('تعذّر الاعتماد — اختلافات يجب حلّها أولاً.');
    err.code   = 'APPROVAL_BLOCKED';
    err.errors = gate.errors;
    throw err;
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from('audits')
    .update({
      review_status:    'approved',
      approved_at:      nowIso,
      approved_by:      userId || null,
      rejected_reason:  null,
      rejected_at:      null,
    })
    .eq('id', auditId)
    .select()
    .single();
  if (updErr) throw updErr;

  // ── Hard audit trail: snapshot the financial state at the moment
  //    of approval so any later re-edit of the audit row leaves the
  //    historical decision intact in activity_log. The external
  //    auditor's first question is always "what did this audit look
  //    like when it was approved" — this is the answer.
  try {
    const { logActivity } = await import('./carrierStatementsService.js');
    await logActivity({
      action:     'audit.approve',
      entityType: 'audit',
      entityId:   updated.id,
      carrierId:  updated.carrier_id,
      userId:     userId || null,
      payload: {
        file_name:       updated.file_name,
        period:          updated.period,
        carrier_name:    updated.carrier_name,
        total_billed:    Number(updated.total_billed)  || 0,
        total_tax:       Number(updated.total_tax)     || 0,
        total_expected:  Number(updated.total_expected)|| 0,
        diff:            Number(updated.diff)          || 0,
        drift_pre_tax:   Number(updated.drift_pre_tax) || 0,
        drift_tax:       Number(updated.drift_tax)     || 0,
        mismatch_count:  Number(updated.mismatch_count)|| 0,
        row_count:       Number(updated.row_count)     || 0,
        approved_at:     nowIso,
      },
    });
  } catch (e) {
    console.warn('audit.approve activity log failed:', e.message);
  }

  // ── Auto-extract per-AWB COD shipments to cod_settlement (out) ONLY
  //    when the carrier's profile says its invoice file ALSO carries
  //    COD (file_kind='audit_with_cod' — e.g. DeliverNow). For carriers
  //    whose COD comes in a SEPARATE remittance file (Aramex etc) we
  //    skip extraction so we don't double-count later.
  try {
    const { data: carrierRow } = await supabase
      .from('carriers')
      .select('file_signature')
      .eq('id', updated.carrier_id)
      .maybeSingle();
    const fileKind = carrierRow?.file_signature?.file_kind || null;
    // Universal rule per the admin's spec: any COD info that comes from
    // a carrier's own file is treated as a SETTLED (مُستلَم) statement.
    // We only extract from the audit when the carrier's profile says the
    // invoice IS the COD statement (audit_with_cod). For carriers that
    // send a SEPARATE remittance file, the audit's COD column is just
    // shipping metadata and we wait for the dedicated remittance upload
    // to create the 'in' rows — otherwise we'd double-count once that
    // file arrives.
    if (fileKind === 'audit_with_cod') {
      const { syncAuditCodOut } = await import('./codSettlementService.js');
      const codRes = await syncAuditCodOut({
        auditId:    updated.id,
        carrierId:  updated.carrier_id,
        sourceFile: updated.file_name || null,
        userId:     userId || null,
        direction:  'in',
      });
      if (codRes.count > 0) {
        console.info(`audit ${updated.id}: extracted ${codRes.count} COD shipments (${codRes.total} SAR) as 'in' (carrier file = settlement)`);
      }
    } else {
      console.info(`audit ${updated.id}: file_kind=${fileKind || 'unset'} — audit doesn't populate cod_settlement directly`);
    }
  } catch (e) {
    console.warn('COD auto-extract failed:', e.message);
  }

  // ── Auto-post to the carrier sub-ledger (A/P sub-ledger). One DR
  //    line per audit, totalling the invoice amount + VAT. Idempotent
  //    via the unique partial index on (audit_id) WHERE doc_type='INV'.
  try {
    const gross = +((Number(updated.total_billed) || 0) + (Number(updated.total_tax) || 0)).toFixed(2);
    if (gross > 0) {
      const op = {
        carrier_id:   updated.carrier_id,
        doc_type:     'INV',
        doc_no:       updated.file_name || updated.id,
        reference_no: updated.period || null,
        doc_date:     nowIso.slice(0, 10),
        amount_dr:    gross,
        amount_cr:    0,
        balance:      gross,
        status:       'open',
        audit_id:     updated.id,
        invoice_file_name: updated.file_name || null,
        notes:        `فاتورة ${updated.carrier_name || ''} — ${updated.period || ''} (إجمالي مع الضريبة)`,
        created_at:   nowIso,
        updated_at:   nowIso,
      };
      // Idempotent post via delete-then-insert. We CANNOT use
      // `.upsert(op, { onConflict: 'audit_id' })` here: the only unique
      // index on audit_id is PARTIAL (WHERE doc_type='INV'), and PostgREST
      // can't pass that predicate, so Postgres rejects the ON CONFLICT with
      // 42P10 — the post then silently fails inside this try/catch and the
      // invoice never lands in the ledger. Clearing the prior INV row for
      // this audit first keeps the same idempotency on re-approval while
      // leaving any non-INV rows (e.g. RV statement links on the same
      // audit_id) untouched.
      await supabase
        .from('carrier_operations')
        .delete()
        .eq('audit_id', updated.id)
        .eq('doc_type', 'INV');
      const { error: opErr } = await supabase
        .from('carrier_operations')
        .insert(op);
      if (opErr) {
        console.warn('ledger auto-post failed:', opErr.message);
      }
    }
  } catch (e) {
    // Approval already landed — surface ledger errors but don't roll back.
    console.warn('ledger auto-post threw:', e.message);
  }

  return updated;
}

export async function rejectAudit(auditId, reason, userId) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('audits')
    .update({
      review_status:   'rejected',
      rejected_at:     nowIso,
      rejected_reason: reason || null,
      approved_at:     null,
      approved_by:     userId || null,
    })
    .eq('id', auditId)
    .select()
    .single();
  if (error) throw error;
  // Hard audit trail — capture the reason + the financial state at
  // rejection so the auditor can trace why a previously-approved
  // audit was reversed.
  try {
    const { logActivity } = await import('./carrierStatementsService.js');
    await logActivity({
      action:     'audit.reject',
      entityType: 'audit',
      entityId:   data.id,
      carrierId:  data.carrier_id,
      userId:     userId || null,
      payload: {
        reason:          reason || null,
        file_name:       data.file_name,
        period:          data.period,
        total_billed:    Number(data.total_billed)  || 0,
        total_tax:       Number(data.total_tax)     || 0,
        mismatch_count:  Number(data.mismatch_count)|| 0,
        rejected_at:     nowIso,
      },
    });
  } catch (e) {
    console.warn('audit.reject activity log failed:', e.message);
  }
  // If this audit was previously approved + posted, drop the ledger line
  // AND the auto-extracted cod_settlement rows so the balances stay
  // accurate. Audit trail = the audit row itself, which keeps both
  // rejected_at and (possibly) approved_at history.
  try {
    await supabase.from('carrier_operations')
      .delete()
      .eq('audit_id', auditId)
      .eq('doc_type', 'INV');
  } catch (e) {
    console.warn('ledger reverse-on-reject failed:', e.message);
  }
  try {
    const { clearAuditCodOut } = await import('./codSettlementService.js');
    await clearAuditCodOut(auditId);
  } catch (e) {
    console.warn('COD reverse-on-reject failed:', e.message);
  }
  return data;
}

// Send an approved/rejected audit back to pending — useful when new
// info shows up and the accountant wants to re-examine before billing.
// Also reverses the ledger line + COD extractions if previously posted.
export async function reopenAudit(auditId, userId = null) {
  const nowIso = new Date().toISOString();
  // Capture the prior state for the audit trail BEFORE we overwrite it
  const { data: prior } = await supabase
    .from('audits')
    .select('id, carrier_id, file_name, period, review_status, approved_at, approved_by, rejected_at, rejected_reason, total_billed, total_tax')
    .eq('id', auditId)
    .maybeSingle();

  const { data, error } = await supabase
    .from('audits')
    .update({
      review_status: 'pending',
      approved_at:   null,
      rejected_at:   null,
    })
    .eq('id', auditId)
    .select()
    .single();
  if (error) throw error;
  try {
    await supabase.from('carrier_operations')
      .delete()
      .eq('audit_id', auditId)
      .eq('doc_type', 'INV');
  } catch (e) {
    console.warn('ledger reverse-on-reopen failed:', e.message);
  }
  try {
    const { clearAuditCodOut } = await import('./codSettlementService.js');
    await clearAuditCodOut(auditId);
  } catch (e) {
    console.warn('COD reverse-on-reopen failed:', e.message);
  }
  // Hard audit trail — include the prior state we're undoing so the
  // record explains "this was approved on X, reopened on Y by Z".
  try {
    const { logActivity } = await import('./carrierStatementsService.js');
    await logActivity({
      action:     'audit.reopen',
      entityType: 'audit',
      entityId:   data.id,
      carrierId:  data.carrier_id,
      userId:     userId || null,
      payload: {
        file_name:        data.file_name,
        period:           data.period,
        prior_status:     prior?.review_status   || null,
        prior_approved_at: prior?.approved_at    || null,
        prior_approved_by: prior?.approved_by    || null,
        prior_rejected_at: prior?.rejected_at    || null,
        prior_rejected_reason: prior?.rejected_reason || null,
        prior_total_billed: Number(prior?.total_billed) || 0,
        prior_total_tax:    Number(prior?.total_tax)    || 0,
        reopened_at:      nowIso,
      },
    });
  } catch (e) {
    console.warn('audit.reopen activity log failed:', e.message);
  }
  return data;
}

// Global AWB lookup: every place this shipment was billed across audits.
// Joins audit_awb_ledger with audits so each hit carries the audit's
// metadata (carrier, file, period, type) — the user is usually mid-dispute
// and needs to jump straight to the audit.
export async function searchAwbAcrossAudits(awbQuery) {
  const q = String(awbQuery ?? '').trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('audit_awb_ledger')
    .select(`
      audit_id, awb, billing_class, period, ship_date, invoiced, carrier_id,
      audits!inner ( id, carrier_name, file_name, audit_type, period, created_at )
    `)
    .ilike('awb', `%${q}%`)
    .order('ship_date', { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data ?? []).map(row => ({
    auditId:      row.audit_id,
    awb:          row.awb,
    billingClass: row.billing_class,
    period:       row.period,
    shipDate:     row.ship_date,
    invoiced:     Number(row.invoiced ?? 0),
    carrierId:    row.carrier_id,
    audit: row.audits ? {
      id:          row.audits.id,
      carrierName: row.audits.carrier_name,
      fileName:    row.audits.file_name,
      auditType:   row.audits.audit_type,
      period:      row.audits.period,
      createdAt:   row.audits.created_at,
    } : null,
  }));
}

export async function deleteAuditFromDB(id) {
  // Refuse to delete an audit that is currently linked to an operation.
  // The operation row has a foreign key on audit_id and the user's rule is
  // "ممنوع حذف المراجعه إذا مرتبطة بعملية" — so we surface a clear Arabic
  // error instead of letting Postgres reject it with a constraint code.
  const { data: linked, error: linkErr } = await supabase
    .from('carrier_operations')
    .select('id, doc_no, carrier_id')
    .eq('audit_id', id)
    .limit(1);
  if (linkErr) throw linkErr;
  if (linked?.length) {
    const op = linked[0];
    const err = new Error(
      `لا يمكن حذف مراجعة مرتبطة بعملية (${op.doc_no}). ` +
      `الغِ الربط من الدفتر أولاً ثم احذفها.`,
    );
    err.code = 'AUDIT_LINKED';
    err.linkedOp = op;
    throw err;
  }
  const { error } = await supabase.from('audits').delete().eq('id', id);
  if (error) throw error;
}
