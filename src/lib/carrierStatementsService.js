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

// ─── Cross-carrier dashboard data ────────────────────────────────────────
/**
 * One row per carrier_id with rollups: outstanding balance, pending /
 * overdue / disputed counts, aging buckets, last statement date.
 * Outstanding = sum(amount_dr - amount_cr) for ops not in 'paid' status.
 */
export async function loadCarriersOverview() {
  const { data: ops, error: e1 } = await supabase
    .from('carrier_operations')
    .select('carrier_id, status, amount_dr, amount_cr, doc_date, due_date');
  if (e1) throw e1;

  const { data: stmts, error: e2 } = await supabase
    .from('carrier_statements')
    .select('carrier_id, carrier_name, period_to, uploaded_at')
    .order('uploaded_at', { ascending: false });
  if (e2) throw e2;

  const today = new Date().toISOString().slice(0, 10);
  const byCarrier = new Map();

  for (const o of ops ?? []) {
    if (!byCarrier.has(o.carrier_id)) {
      byCarrier.set(o.carrier_id, {
        carrierId: o.carrier_id,
        carrierName: null,
        outstanding: 0,
        paidTotal: 0,
        overdueAmount: 0,
        pendingCount: 0,
        overdueCount: 0,
        disputedCount: 0,
        reviewingCount: 0,
        auditedCount: 0,
        paidCount: 0,
        aging: { d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 },
        lastStatementAt: null,
      });
    }
    const row = byCarrier.get(o.carrier_id);
    const amount = (Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0);

    if (o.status === 'paid') {
      row.paidTotal += amount;
      row.paidCount++;
      continue;
    }

    row.outstanding += amount;
    if (o.status === 'pending')   row.pendingCount++;
    if (o.status === 'audited')   row.auditedCount++;
    if (o.status === 'disputed')  row.disputedCount++;
    if (o.status === 'reviewing') row.reviewingCount++;

    // Overdue & aging — use due_date when present, else doc_date+30 as a default
    const reference = o.due_date ?? null;
    if (reference && reference < today) {
      row.overdueAmount += amount;
      row.overdueCount++;
    }
    if (o.doc_date) {
      const ageDays = Math.floor((new Date(today) - new Date(o.doc_date)) / 86_400_000);
      if      (ageDays <= 30) row.aging.d0_30   += amount;
      else if (ageDays <= 60) row.aging.d31_60  += amount;
      else if (ageDays <= 90) row.aging.d61_90  += amount;
      else                     row.aging.over90 += amount;
    }
  }

  // Last statement per carrier
  const seenStmt = new Set();
  for (const s of stmts ?? []) {
    if (seenStmt.has(s.carrier_id)) continue;
    seenStmt.add(s.carrier_id);
    const row = byCarrier.get(s.carrier_id);
    if (row) {
      row.lastStatementAt = s.uploaded_at;
      row.carrierName = s.carrier_name;
    } else {
      // Carrier has a statement but no operations (rare)
      byCarrier.set(s.carrier_id, {
        carrierId: s.carrier_id, carrierName: s.carrier_name,
        outstanding: 0, paidTotal: 0, overdueAmount: 0,
        pendingCount: 0, overdueCount: 0, disputedCount: 0, reviewingCount: 0, auditedCount: 0, paidCount: 0,
        aging: { d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 },
        lastStatementAt: s.uploaded_at,
      });
    }
  }

  // Sort by outstanding descending — biggest creditors at top
  return [...byCarrier.values()].sort((a, b) => (b.outstanding ?? 0) - (a.outstanding ?? 0));
}

/**
 * Top-level rollup across every carrier — used as the Dashboard hero.
 */
export function aggregateOverview(rows) {
  const total = {
    outstanding: 0, paidTotal: 0, overdueAmount: 0,
    pendingCount: 0, overdueCount: 0, disputedCount: 0, reviewingCount: 0,
    auditedCount: 0, paidCount: 0, carrierCount: rows.length,
    aging: { d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 },
  };
  for (const r of rows) {
    total.outstanding   += r.outstanding;
    total.paidTotal     += r.paidTotal;
    total.overdueAmount += r.overdueAmount;
    total.pendingCount  += r.pendingCount;
    total.overdueCount  += r.overdueCount;
    total.disputedCount += r.disputedCount;
    total.reviewingCount += r.reviewingCount;
    total.auditedCount  += r.auditedCount;
    total.paidCount     += r.paidCount;
    total.aging.d0_30   += r.aging.d0_30;
    total.aging.d31_60  += r.aging.d31_60;
    total.aging.d61_90  += r.aging.d61_90;
    total.aging.over90  += r.aging.over90;
  }
  return total;
}

/**
 * Recent activity feed: last N statements uploaded + last N status changes.
 */
export async function loadRecentActivity(limit = 8) {
  const [stmtsRes, opsRes] = await Promise.all([
    supabase.from('carrier_statements')
      .select('id, carrier_id, carrier_name, period_from, period_to, total_balance, file_name, uploaded_at')
      .order('uploaded_at', { ascending: false }).limit(limit),
    supabase.from('carrier_operations')
      .select('id, carrier_id, doc_no, doc_type, status, amount_dr, amount_cr, paid_at, updated_at')
      .in('status', ['paid', 'disputed', 'reviewing'])
      .order('updated_at', { ascending: false }).limit(limit),
  ]);
  if (stmtsRes.error) throw stmtsRes.error;
  if (opsRes.error)   throw opsRes.error;
  return { statements: stmtsRes.data ?? [], operations: opsRes.data ?? [] };
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
