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

/**
 * Net out adjustment pairs that share the same doc_no (Aramex AB rows are
 * a debit + a credit that cancel out). The DB has UNIQUE(carrier_id, doc_no)
 * so we have to fold them into a single row before insert.
 */
function dedupeByDocNo(ops) {
  const map = new Map();
  for (const op of ops) {
    if (!map.has(op.docNo)) {
      map.set(op.docNo, { ...op });
      continue;
    }
    // Merge: keep the latest doc/due dates and reference, sum DR/CR, take
    // the LAST balance (running ledger), prefer non-empty shipment type.
    const existing = map.get(op.docNo);
    map.set(op.docNo, {
      ...existing,
      docDate:      op.docDate || existing.docDate,
      dueDate:      op.dueDate || existing.dueDate,
      referenceNo:  existing.referenceNo || op.referenceNo,
      dr:           (Number(existing.dr) || 0) + (Number(op.dr) || 0),
      cr:           (Number(existing.cr) || 0) + (Number(op.cr) || 0),
      balance:      op.balance ?? existing.balance,
      shipmentType: existing.shipmentType || op.shipmentType,
    });
  }
  return [...map.values()];
}

/**
 * Push the original PDF into the `carrier-statements` Storage bucket and
 * return its path. Best-effort — if the upload fails (network, RLS, etc.)
 * we still let the row save with source_path = null so the user doesn't
 * lose the parsed data.
 */
async function uploadSourcePdf({ carrierId, file }) {
  if (!file) return null;
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const path = `${carrierId || 'unknown'}/${Date.now()}_${safeName}`;
    const { error } = await supabase.storage
      .from('carrier-statements')
      .upload(path, file, {
        contentType: file.type || 'application/pdf',
        upsert: false,
      });
    if (error) {
      console.warn('Storage upload failed:', error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.warn('Storage upload threw:', e?.message);
    return null;
  }
}

/**
 * Generate a signed URL good for `expiresInSec` seconds. Used by the
 * UI to open the original PDF in a new tab.
 */
export async function getStatementFileUrl(sourcePath, expiresInSec = 600) {
  if (!sourcePath) return null;
  const { data, error } = await supabase.storage
    .from('carrier-statements')
    .createSignedUrl(sourcePath, expiresInSec);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export async function saveCarrierStatement({ carrierId, carrierName, fileName, file, parsed, userId }) {
  const { header, totals } = parsed;
  const operations = dedupeByDocNo(parsed.operations || []);

  // 0. Upload the original PDF (best-effort)
  const sourcePath = file ? await uploadSourcePdf({ carrierId, file }) : null;

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
      source_path:      sourcePath,
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

  // Some statement rows (DR / DG / AB and occasionally RV) print only one
  // date column instead of two. The parser leaves dueDate=null in that
  // case, which propagates into the ledger and breaks aging buckets +
  // sort. Fall back to docDate + creditTerms (e.g. "30 days") so every
  // op has a usable due_date. Defaults to 30 days when terms are missing.
  const creditDays = (() => {
    const m = String(header?.creditTerms ?? '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 30;
  })();
  const computeDueDate = (op) => {
    if (op.dueDate)  return op.dueDate;
    if (!op.docDate) return null;
    const d = new Date(op.docDate);
    if (Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + creditDays);
    return d.toISOString().slice(0, 10);
  };

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
      due_date:         computeDueDate(op),
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

// ─── Payment-matching suggestions ────────────────────────────────────────
/**
 * For each candidate bank transfer, propose the best-fitting open operation
 * across all carriers using:
 *   • carrier-id match (must be the same carrier the transfer goes to)
 *   • amount tolerance (±0.5 SAR or ±0.5%)
 *   • date proximity (transfer date within 45 days after doc_date or before
 *     due_date — which yields the lowest score wins)
 *   • prefer larger debits & older docs
 *
 * Returns: [{ transfer, suggestion, confidence }, ...]
 */
export async function suggestPaymentMatches(transfers) {
  if (!transfers?.length) return [];
  // Pull all open operations once.
  const { data: ops, error } = await supabase
    .from('carrier_operations')
    .select('id, carrier_id, doc_no, doc_type, doc_date, due_date, amount_dr, amount_cr, balance, status, reference_no')
    .neq('status', 'paid')
    .neq('amount_dr', 0);
  if (error) throw error;

  const opsByCarrier = new Map();
  for (const op of ops ?? []) {
    if (!opsByCarrier.has(op.carrier_id)) opsByCarrier.set(op.carrier_id, []);
    opsByCarrier.get(op.carrier_id).push(op);
  }

  const out = [];
  for (const t of transfers) {
    const candidates = opsByCarrier.get(t.matchedCarrier) ?? [];
    if (!candidates.length) {
      out.push({ transfer: t, suggestion: null, confidence: 0 });
      continue;
    }

    // 1) Try EXACT amount match first (the carrier-statement amount = bank amount)
    const target = Number(t.grossAmount ?? t.debit) || 0;
    const tolAbs = 1.0; // 1 SAR
    const tolPct = 0.005; // 0.5%
    const within = (a) => {
      const diff = Math.abs((Number(a.amount_dr) || 0) - target);
      return diff <= tolAbs || diff / Math.max(target, 1) <= tolPct;
    };

    let exact = candidates.filter(within);

    // 2) Or try matching the SUM-of-multiple-ops if exact one not found
    let pickedSet = null;
    if (exact.length === 0) {
      // Greedy 2-op match: try pairs that add up to target
      for (let i = 0; i < candidates.length && !pickedSet; i++) {
        for (let j = i + 1; j < candidates.length && !pickedSet; j++) {
          const sum = (candidates[i].amount_dr || 0) + (candidates[j].amount_dr || 0);
          if (Math.abs(sum - target) <= tolAbs) pickedSet = [candidates[i], candidates[j]];
        }
      }
    }

    let suggestion = null;
    let confidence = 0;
    if (exact.length === 1) {
      suggestion = { type: 'single', ops: exact };
      confidence = 95;
    } else if (exact.length > 1) {
      // Pick the one whose due_date is closest BEFORE transfer date (oldest open)
      exact.sort((a, b) => (a.due_date || a.doc_date || '').localeCompare(b.due_date || b.doc_date || ''));
      suggestion = { type: 'single', ops: [exact[0]] };
      confidence = 80;
    } else if (pickedSet) {
      suggestion = { type: 'multi', ops: pickedSet };
      confidence = 70;
    } else {
      // Fallback: amount-closest single
      candidates.sort((a, b) =>
        Math.abs((Number(a.amount_dr) || 0) - target)
        - Math.abs((Number(b.amount_dr) || 0) - target)
      );
      const top = candidates[0];
      const diff = Math.abs((Number(top.amount_dr) || 0) - target);
      if (diff <= 50) {
        suggestion = { type: 'closest', ops: [top] };
        confidence = 40;
      }
    }
    out.push({ transfer: t, suggestion, confidence });
  }
  return out;
}

/**
 * Bulk-mark operations as paid against the same bank transfer.
 */
export async function markOperationsPaid(opIds, paymentRef, paidAtIso) {
  if (!opIds?.length) return;
  const { error } = await supabase
    .from('carrier_operations')
    .update({
      status: 'paid',
      paid_at: paidAtIso || new Date().toISOString(),
      payment_ref: paymentRef || null,
    })
    .in('id', opIds);
  if (error) throw error;
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
  // AP-first ordering: earliest due date at the top so the user sees
  // what's about to be overdue (or already is) without having to sort.
  // NULL due dates land at the end. Tie-break by doc_date desc so within
  // the same due date the newest receipt appears first.
  let q = supabase.from('carrier_operations').select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('doc_date', { ascending: false })
    .limit(limit);
  if (carrierId) q = q.eq('carrier_id', carrierId);
  if (status)    q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Pre-save delta lookup for the statement upload preview. Caller passes
// an array of doc_nos parsed from the new file; we return a Map keyed by
// doc_no carrying the existing row's amounts/status so the UI can label
// each parsed op as 'new' / 'unchanged' / 'changed' before commit.
export async function loadExistingOpsByDocNos(carrierId, docNos) {
  if (!carrierId || !Array.isArray(docNos) || !docNos.length) return new Map();
  // Chunk the IN list — Supabase choke on huge arrays.
  const map = new Map();
  const CHUNK = 500;
  for (let i = 0; i < docNos.length; i += CHUNK) {
    const slice = docNos.slice(i, i + CHUNK).map(d => String(d));
    const { data, error } = await supabase
      .from('carrier_operations')
      .select('id, doc_no, amount_dr, amount_cr, status')
      .eq('carrier_id', carrierId)
      .in('doc_no', slice);
    if (error) throw error;
    for (const r of data ?? []) map.set(String(r.doc_no), r);
  }
  return map;
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

  // Pull the canonical carrier list — we'll only surface entries that
  // actually exist in `carriers`. Orphan carrier_ids that linger in
  // statements/operations after a rename + cleanup were showing up as
  // ghost rows in the dropdown ("two Aramex"); this gates that out.
  const { data: carrierRows, error: e3 } = await supabase
    .from('carriers').select('id, name');
  if (e3) throw e3;
  const validCarrierIds = new Set((carrierRows ?? []).map(c => c.id));
  const carrierNameById = new Map((carrierRows ?? []).map(c => [c.id, c.name]));

  const today = new Date().toISOString().slice(0, 10);
  const byCarrier = new Map();

  for (const o of ops ?? []) {
    // Skip orphan carrier_ids — operations whose carrier was deleted /
    // renamed but legacy rows still reference the old id. They belong
    // nowhere and showing them as a separate dropdown entry just
    // confuses the user.
    if (!validCarrierIds.has(o.carrier_id)) continue;
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

  // Last statement per carrier — same orphan filter as above.
  const seenStmt = new Set();
  for (const s of stmts ?? []) {
    if (!validCarrierIds.has(s.carrier_id)) continue;
    if (seenStmt.has(s.carrier_id)) continue;
    seenStmt.add(s.carrier_id);
    const row = byCarrier.get(s.carrier_id);
    if (row) {
      row.lastStatementAt = s.uploaded_at;
      // Prefer the carriers-table name over the statement's, so a typo
      // in an old PDF doesn't override the canonical record.
      row.carrierName = carrierNameById.get(s.carrier_id) ?? s.carrier_name;
    } else {
      // Carrier has a statement but no operations (rare). Use the
      // carriers-table name as the source of truth.
      byCarrier.set(s.carrier_id, {
        carrierId: s.carrier_id,
        carrierName: carrierNameById.get(s.carrier_id) ?? s.carrier_name,
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

/**
 * Returns a Map( audit_id → { opId, docNo, carrierId } ) for every
 * operation that already has an audit attached. Used by the link-audit
 * modal to prevent re-linking the same audit to a second operation.
 */
export async function loadLinkedAuditIndex() {
  const { data, error } = await supabase
    .from('carrier_operations')
    .select('id, carrier_id, doc_no, audit_id')
    .not('audit_id', 'is', null);
  if (error) throw error;
  const map = new Map();
  for (const r of data ?? []) {
    if (r.audit_id) map.set(r.audit_id, { opId: r.id, docNo: r.doc_no, carrierId: r.carrier_id });
  }
  return map;
}

// ─── Mutations ────────────────────────────────────────────────────────────
export async function setOperationStatus(id, patch) {
  const { error } = await supabase
    .from('carrier_operations').update(patch).eq('id', id);
  if (error) throw error;
}

// ── Disputes — journal + lifecycle ────────────────────────────────────
// Each disputed operation accumulates a thread of dispute_notes entries
// (opened → follow_ups → response → resolved). The op itself carries
// summary state: dispute_opened_at, dispute_resolved_at, resolution
// kind, and an optional link to the credit-memo op that settled it.

export async function loadDisputeNotes(operationId) {
  if (!operationId) return [];
  const { data, error } = await supabase
    .from('dispute_notes')
    .select('id, note, kind, created_by, created_at')
    .eq('operation_id', operationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addDisputeNote({
  operationId, note, kind = 'follow_up', userId,
}) {
  if (!operationId)    throw new Error('operation_id مطلوب');
  if (!note?.trim())   throw new Error('الملاحظة مطلوبة');
  const { error } = await supabase.from('dispute_notes').insert({
    operation_id: operationId,
    note:         note.trim(),
    kind,
    created_by:   userId ?? null,
  });
  if (error) throw error;
}

// Open a dispute: flip status, stamp dispute_opened_at, add a note
// (kind='opened'). Idempotent — if it's already disputed, we just add
// a follow-up note instead of resetting the open timestamp.
export async function openDispute({ operationId, note, userId }) {
  const { data: existing } = await supabase
    .from('carrier_operations')
    .select('status, dispute_opened_at')
    .eq('id', operationId)
    .single();
  const isFreshOpen = existing?.status !== 'disputed' || !existing?.dispute_opened_at;
  const patch = { status: 'disputed' };
  if (isFreshOpen) patch.dispute_opened_at = new Date().toISOString();
  await setOperationStatus(operationId, patch);
  if (note?.trim()) {
    await addDisputeNote({
      operationId, note,
      kind: isFreshOpen ? 'opened' : 'follow_up',
      userId,
    });
  }
}

export async function resolveDispute({
  operationId, resolution = 'accepted', creditOpId, note, userId,
}) {
  if (!['credit_received', 'accepted'].includes(resolution)) {
    throw new Error(`resolution غير صالح: ${resolution}`);
  }
  // Status flips to 'audited' if no credit involved (we just accept the
  // charge as-is); if a credit was received, also 'audited' since the
  // open balance is now reconciled.
  await setOperationStatus(operationId, {
    status: 'audited',
    dispute_resolved_at: new Date().toISOString(),
    dispute_resolution:  resolution,
    dispute_credit_op_id: creditOpId || null,
  });
  await addDisputeNote({
    operationId,
    note: note?.trim() ||
      (resolution === 'credit_received'
        ? 'تم استلام مذكرة دائنة من الناقل'
        : 'تم قبول الفاتورة كما هي'),
    kind: 'resolved',
    userId,
  });
}

export async function reopenDispute({ operationId, note, userId }) {
  await setOperationStatus(operationId, {
    status: 'disputed',
    dispute_resolved_at: null,
    dispute_resolution:  null,
    dispute_credit_op_id: null,
  });
  await addDisputeNote({
    operationId,
    note: note?.trim() || 'تم إعادة فتح النزاع',
    kind: 'reopened',
    userId,
  });
}

// Pull all DG / AB / CM-style credit operations for a carrier so the
// resolve-dispute UI can offer them as candidates to link.
export async function loadCreditCandidates(carrierId) {
  if (!carrierId) return [];
  const { data, error } = await supabase
    .from('carrier_operations')
    .select('id, doc_no, doc_type, doc_date, amount_cr, reference_no')
    .eq('carrier_id', carrierId)
    .in('doc_type', ['DG', 'AB', 'CM'])
    .gt('amount_cr', 0)
    .order('doc_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Stale disputes for the dashboard panel — disputes opened > N days ago
// that are still not resolved.
export async function loadStaleDisputes({ thresholdDays = 30 } = {}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - thresholdDays);
  const { data, error } = await supabase
    .from('carrier_operations')
    .select('id, carrier_id, doc_no, doc_date, due_date, amount_dr, amount_cr, dispute_opened_at, notes')
    .eq('status', 'disputed')
    .lt('dispute_opened_at', cutoff.toISOString())
    .order('dispute_opened_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ── Payments — first-class records of money out ────────────────────────
// Each payment groups N operations that were settled together. Created
// by markPaid / markPaidBulk and persisted alongside the per-op state
// flip so the audit trail of "what did we pay, when, against which
// invoices" is reconstructable forever after.
export async function createPaymentRecord({
  carrierId, paidAt, amount, paymentRef, notes, opIds, userId,
}) {
  if (!carrierId)             throw new Error('carrier_id مطلوب');
  if (!Array.isArray(opIds))  throw new Error('opIds مطلوبة');
  const { data, error } = await supabase
    .from('payments')
    .insert({
      carrier_id:  carrierId,
      paid_at:     paidAt || new Date().toISOString().slice(0, 10),
      amount:      Number(amount) || 0,
      payment_ref: paymentRef || null,
      notes:       notes || null,
      created_by:  userId || null,
    })
    .select('id, paid_at, amount, payment_ref, notes, created_at')
    .single();
  if (error) throw error;
  // Tag all the included ops with the payment id. Done in chunks since
  // Postgres' IN list capacity is generous but not unlimited.
  const CHUNK = 500;
  for (let i = 0; i < opIds.length; i += CHUNK) {
    const slice = opIds.slice(i, i + CHUNK);
    const { error: linkErr } = await supabase
      .from('carrier_operations')
      .update({ payment_id: data.id })
      .in('id', slice);
    if (linkErr) throw linkErr;
  }
  return data;
}

export async function loadPayments({ carrierId, limit = 200 } = {}) {
  let q = supabase
    .from('payments')
    .select('id, carrier_id, paid_at, amount, payment_ref, notes, created_at')
    .order('paid_at', { ascending: false })
    .limit(limit);
  if (carrierId) q = q.eq('carrier_id', carrierId);
  const { data, error } = await q;
  if (error) throw error;
  // Fold in op counts so the list view can show "N عملية" without an
  // N+1 query per row.
  const ids = (data ?? []).map(p => p.id);
  if (!ids.length) return [];
  const { data: ops, error: opErr } = await supabase
    .from('carrier_operations')
    .select('payment_id')
    .in('payment_id', ids);
  if (opErr) throw opErr;
  const counts = new Map();
  for (const o of ops ?? []) counts.set(o.payment_id, (counts.get(o.payment_id) ?? 0) + 1);
  return (data ?? []).map(p => ({ ...p, opsCount: counts.get(p.id) ?? 0 }));
}

export async function loadPaymentOps(paymentId) {
  const { data, error } = await supabase
    .from('carrier_operations')
    .select('*')
    .eq('payment_id', paymentId)
    .order('doc_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function deletePaymentRecord(paymentId) {
  // Reverse: detach ops (their payment_id goes NULL) + flip them back to
  // pending, then delete the payment row. Used when the user wants to
  // undo a payment they entered by mistake.
  const { error: e1 } = await supabase
    .from('carrier_operations')
    .update({ status: 'pending', payment_id: null, paid_at: null, payment_ref: null })
    .eq('payment_id', paymentId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('payments').delete().eq('id', paymentId);
  if (e2) throw e2;
}

export async function deleteStatement(id) {
  // Refuse to delete a statement if any of its operations are linked to an
  // audit — deleting would cascade into linked ops, breaking the audit↔op
  // pairing the user explicitly asked us to protect.
  const { data: linked, error: linkErr } = await supabase
    .from('carrier_operations')
    .select('id, doc_no, audit_id')
    .eq('last_statement_id', id)
    .not('audit_id', 'is', null)
    .limit(1);
  if (linkErr) throw linkErr;
  if (linked?.length) {
    throw new Error(
      `لا يمكن حذف الكشف — توجد عملية (${linked[0].doc_no}) مرتبطة بمراجعة. ` +
      `الغِ الربط من الدفتر أولاً.`,
    );
  }
  const { error } = await supabase.from('carrier_statements').delete().eq('id', id);
  if (error) throw error;
}
