import { supabase } from './supabase.js';
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
    id:        row.id,
    name:      row.name,
    logo:      row.logo,
    color:     row.color,
    contracts: row.contracts ?? [],
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

export async function saveCarrier(carrier) {
  const { error } = await supabase.from('carriers').upsert({
    id:         carrier.id,
    name:       carrier.name,
    logo:       carrier.logo,
    color:      carrier.color,
    contracts:  carrier.contracts ?? [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteCarrierFromDB(id) {
  const { error } = await supabase.from('carriers').delete().eq('id', id);
  if (error) throw error;
}

// ── Audits ────────────────────────────────────────────────────────────────────

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
  const diff = summary.diff ?? summary.totalDiff ?? 0;
  const auditType = audit.auditType ?? deriveAuditType(results);

  const { error } = await supabase.from('audits').upsert({
    id:             audit.id,
    carrier_id:     audit.carrierId,
    carrier_name:   audit.carrierName  ?? '',
    contract_label: audit.contractLabel ?? summary.contractLabel ?? '',
    file_name:      audit.fileName     ?? summary.fileName ?? '',
    period:         audit.period       ?? '',
    row_count:      results.length,
    issue_count:    results.filter(r => r.status !== 'ok').length,
    total_expected: totalExpected,
    total_billed:   totalBilled,
    diff,
    audit_type:     auditType,
    results,
    col_map:        audit.colMap   ?? {},
    created_by:     userId,
    created_at:     audit.createdAt ?? new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;

  // Write the per-AWB ledger so future audits can detect cross-month
  // double-billing. Replace any prior rows for this audit (in case it's
  // being re-saved) with the fresh shipment list.
  await syncAwbLedger(audit.id, audit.carrierId, results);
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
    .select('id, carrier_name, contract_label, file_name, period, row_count, issue_count, total_expected, total_billed, diff, audit_type, created_at')
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
    diff:          row.diff,
    auditType:     row.audit_type,
    date:          row.created_at,
  }));
}

export async function loadAuditByIdFromDB(id) {
  const { data, error } = await supabase
    .from('audits').select('*').eq('id', id).single();
  if (error) throw error;
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
    diff:          data.diff,
    auditType:     data.audit_type,
    results:       data.results ?? [],
    colMap:        data.col_map ?? {},
    date:          data.created_at,
    summary: {
      contractLabel: data.contract_label,
      fileName:      data.file_name,
      totalExpected: data.total_expected,
      totalBilled:   data.total_billed,
      diff:          data.diff,
    },
  };
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
