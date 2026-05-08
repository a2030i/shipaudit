import { supabase } from './supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Carrier statements + ledger persistence.
//
//  Statement uploads are SNAPSHOTS, but each operation is unique by
//  (carrier_id, doc_no). On every upload we:
//    1. Insert a new carrier_statements row (the snapshot).
//    2. For each operation:
//         - new doc_no                 → insert as 'pending'
//         - existing & status='pending' → update fields silently
//         - existing & status≠'pending' & amount changed → flag 'reviewing'
//         - existing & status≠'pending' & amount same   → just refresh
//                                                          last_statement_id
//
//  Returns a `diff` summary so the UI can show
//  "X جديدة، Y محدّثة، Z تحت المراجعة".
// ─────────────────────────────────────────────────────────────────────────────

const TOLERANCE = 0.01; // SAR

export async function saveCarrierStatement({ carrierId, carrierName, fileName, parsed, userId }) {
  const { header, operations, totals } = parsed;

  // 1. Insert the statement snapshot
  const { data: stmt, error: stmtErr } = await supabase
    .from('carrier_statements')
    .insert({
      carrier_id:       carrierId,
      carrier_name:     carrierName,
      account_number:   header.accountNumber,
      customer_name:    header.customer,
      vat_no:           header.vatNo,
      credit_terms:     header.creditTerms,
      period_from:      header.periodFrom,
      period_to:        header.periodTo,
      total_balance:    totals.totalBalance,
      aging_0_30:       totals.aging?.d0_30,
      aging_31_60:      totals.aging?.d31_60,
      aging_61_90:      totals.aging?.d61_90,
      aging_over_90:    totals.aging?.over90,
      operations_count: operations.length,
      file_name:        fileName,
      uploaded_by:      userId ?? null,
    })
    .select()
    .single();
  if (stmtErr) throw stmtErr;

  // 2. Pull existing operations for this carrier so we can diff
  const docNos = operations.map(o => o.docNo);
  const { data: existingRows, error: exErr } = await supabase
    .from('carrier_operations')
    .select('id, doc_no, status, amount_dr, amount_cr')
    .eq('carrier_id', carrierId)
    .in('doc_no', docNos);
  if (exErr) throw exErr;

  const existing = new Map((existingRows ?? []).map(r => [r.doc_no, r]));

  const inserts = [];
  const updates = [];      // each: { id, patch, flagReviewing }
  const diff = { added: 0, updated: 0, reviewing: 0, unchanged: 0 };

  for (const op of operations) {
    const prior = existing.get(op.docNo);
    const base = {
      carrier_id:       carrierId,
      doc_no:           op.docNo,
      doc_type:         op.docType,
      reference_no:     op.referenceNo,
      doc_date:         op.docDate,
      due_date:         op.dueDate,
      amount_dr:        op.dr,
      amount_cr:        op.cr,
      balance:          op.balance,
      shipment_type:    op.shipmentType,
      last_statement_id: stmt.id,
    };

    if (!prior) {
      inserts.push({ ...base, status: 'pending' });
      diff.added++;
      continue;
    }

    const amountChanged =
      Math.abs((prior.amount_dr ?? 0) - op.dr) > TOLERANCE
      || Math.abs((prior.amount_cr ?? 0) - op.cr) > TOLERANCE;

    if (prior.status === 'pending') {
      updates.push({ id: prior.id, patch: base, flagReviewing: false });
      if (amountChanged) diff.updated++;
      else               diff.unchanged++;
    } else if (amountChanged) {
      // user already touched this op (paid / disputed / etc.) AND amount changed
      updates.push({
        id: prior.id,
        patch: { ...base, status: 'reviewing' },
        flagReviewing: true,
      });
      diff.reviewing++;
    } else {
      // touched op, amount unchanged — refresh last_statement_id only
      updates.push({
        id: prior.id,
        patch: { last_statement_id: stmt.id },
        flagReviewing: false,
      });
      diff.unchanged++;
    }
  }

  if (inserts.length) {
    const { error } = await supabase.from('carrier_operations').insert(inserts);
    if (error) throw error;
  }
  for (const u of updates) {
    const { error } = await supabase
      .from('carrier_operations').update(u.patch).eq('id', u.id);
    if (error) throw error;
  }

  return { statement: stmt, diff };
}

// ─── Reads ────────────────────────────────────────────────────────────────
export async function loadStatements(carrierId, limit = 50) {
  let q = supabase.from('carrier_statements').select('*')
    .order('uploaded_at', { ascending: false }).limit(limit);
  if (carrierId) q = q.eq('carrier_id', carrierId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function loadOperations({ carrierId, status, limit = 500 } = {}) {
  let q = supabase.from('carrier_operations').select('*')
    .order('doc_date', { ascending: false }).limit(limit);
  if (carrierId) q = q.eq('carrier_id', carrierId);
  if (status)    q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function loadOpenBalance(carrierId) {
  // Sum of (dr - cr) for everything not paid.
  const { data, error } = await supabase
    .from('carrier_operations')
    .select('amount_dr, amount_cr, status')
    .eq('carrier_id', carrierId);
  if (error) throw error;
  let balance = 0, pending = 0, paid = 0, disputed = 0, reviewing = 0;
  for (const r of (data ?? [])) {
    if (r.status === 'paid') { paid += (r.amount_dr || 0) - (r.amount_cr || 0); continue; }
    balance += (r.amount_dr || 0) - (r.amount_cr || 0);
    if (r.status === 'pending')   pending++;
    if (r.status === 'disputed')  disputed++;
    if (r.status === 'reviewing') reviewing++;
  }
  return { balance, pending, paid, disputed, reviewing };
}

// ─── Mutations ────────────────────────────────────────────────────────────
export async function setOperationStatus(id, patch) {
  const { error } = await supabase
    .from('carrier_operations').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteStatement(id) {
  const { error } = await supabase.from('carrier_statements').delete().eq('id', id);
  if (error) throw error;
}
