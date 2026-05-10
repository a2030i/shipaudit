import { supabase } from './supabase.js';
import { SEED_CARRIERS } from '../data/carriers.js';

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
    results,
    col_map:        audit.colMap   ?? {},
    created_by:     userId,
    created_at:     audit.createdAt ?? new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function loadAuditsFromDB(limit = 50) {
  const { data, error } = await supabase
    .from('audits')
    .select('id, carrier_name, contract_label, file_name, period, row_count, issue_count, total_expected, total_billed, diff, created_at')
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
