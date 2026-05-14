// Service layer for COD-settlement reconciliation.
//
// Two ledgers (one table, two `direction` values):
//   • out  — money we paid OUT to merchants for shipments we believe got
//            delivered (per the internal system's settlement export).
//   • in   — money the carrier actually remitted IN to us.
//
// The reconciliation per AWB is computed live: sum(out) vs sum(in). A row
// in cod_reconciliation_action overlays the user's decision on diffs
// (approved / disputed / resolved + notes).

import { supabase } from './supabase.js';

// Threshold (in days) after which an over_remit row stops being treated
// as "probably still waiting for the matching outgoing settlement" and
// starts being treated as a real anomaly worth investigating. The first
// 30 days are the common-case sequencing buffer (Aramex remits faster
// than the internal weekly export).
const OVER_REMIT_AGE_DAYS = 30;

// ── Settlement uploads ─────────────────────────────────────────────────
// Returns Set of AWBs already present in cod_settlement for this
// (carrier, direction) pair — used by the upload preview + save to
// flag/skip duplicates before they hit the DB.
export async function findDuplicateSettlementAwbs({
  carrierId, direction, awbs,
}) {
  if (!carrierId || !direction || !Array.isArray(awbs) || !awbs.length) {
    return new Set();
  }
  const found = new Set();
  const CHUNK = 500;
  for (let i = 0; i < awbs.length; i += CHUNK) {
    const slice = awbs.slice(i, i + CHUNK).map(a => String(a).trim());
    const { data, error } = await supabase
      .from('cod_settlement')
      .select('awb')
      .eq('carrier_id', carrierId)
      .eq('direction', direction)
      .in('awb', slice);
    if (error) throw error;
    for (const r of data ?? []) found.add(String(r.awb).trim());
  }
  return found;
}

export async function saveSettlementUpload({
  direction, carrierId, rows, uploadDate, sourceFile, settlementRef, userId,
}) {
  if (!['out', 'in'].includes(direction)) {
    throw new Error(`direction غير صالح: ${direction}`);
  }
  if (!carrierId) throw new Error('carrier_id مطلوب');
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('لا توجد صفوف صالحة في الملف');
  }
  const uploadId = `cod_${direction}_${Date.now()}`;
  const date = uploadDate || new Date().toISOString().slice(0, 10);
  const ref  = (settlementRef ?? '').trim() || null;

  // ── Dedup 1: within the upload batch itself ──
  // Same AWB twice in the same file → keep first, drop rest.
  const seenInBatch = new Set();
  const inBatchDupAwbs = [];
  const dedupedRows = [];
  for (const r of rows) {
    const awb = String(r.awb).trim();
    if (!awb) continue;
    if (seenInBatch.has(awb)) { inBatchDupAwbs.push(awb); continue; }
    seenInBatch.add(awb);
    dedupedRows.push({ ...r, awb });
  }

  // ── Dedup 2: against rows already in the ledger ──
  // Same AWB + same direction + same carrier → carrier or merchant
  // already gave us this row in an earlier upload. Skip silently to
  // prevent inflating the totals.
  const existingDups = await findDuplicateSettlementAwbs({
    carrierId, direction, awbs: dedupedRows.map(r => r.awb),
  });
  const crossFileDupAwbs = [];
  const finalRows = [];
  for (const r of dedupedRows) {
    if (existingDups.has(r.awb)) { crossFileDupAwbs.push(r.awb); continue; }
    finalRows.push(r);
  }

  if (!finalRows.length) {
    return {
      uploadId,
      count: 0,
      inBatchDuplicates: inBatchDupAwbs.length,
      crossFileDuplicates: crossFileDupAwbs.length,
      totalSubmitted: rows.length,
    };
  }

  const inserts = finalRows.map(r => ({
    direction,
    carrier_id:     carrierId,
    awb:            r.awb,
    amount:         Number(r.amount),
    upload_date:    date,
    source_file:    sourceFile ?? null,
    settlement_ref: ref,
    upload_id:      uploadId,
    created_by:     userId ?? null,
  }));
  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase
      .from('cod_settlement').insert(inserts.slice(i, i + CHUNK));
    if (error) throw error;
  }
  return {
    uploadId,
    count: inserts.length,
    inBatchDuplicates: inBatchDupAwbs.length,
    crossFileDuplicates: crossFileDupAwbs.length,
    totalSubmitted: rows.length,
  };
}

// Delete every settlement row from a single upload (the user "undid" it).
export async function deleteSettlementUpload(uploadId) {
  const { error } = await supabase
    .from('cod_settlement').delete().eq('upload_id', uploadId);
  if (error) throw error;
}

// List of all settlement uploads for a carrier, aggregated by upload_id
// so the UI can show one row per uploaded file: date, direction, count,
// total amount, source filename, settlement ref.
export async function loadSettlementUploads({ carrierId } = {}) {
  if (!carrierId) return [];
  const { data, error } = await supabase
    .from('cod_settlement')
    .select('upload_id, direction, upload_date, source_file, settlement_ref, amount, created_at')
    .eq('carrier_id', carrierId)
    .order('upload_date', { ascending: false });
  if (error) throw error;
  const map = new Map();
  for (const row of data ?? []) {
    if (!map.has(row.upload_id)) {
      map.set(row.upload_id, {
        uploadId:     row.upload_id,
        direction:    row.direction,
        uploadDate:   row.upload_date,
        sourceFile:   row.source_file,
        settlementRef: row.settlement_ref,
        createdAt:    row.created_at,
        count:        0,
        amount:       0,
      });
    }
    const u = map.get(row.upload_id);
    u.count++;
    u.amount += Number(row.amount) || 0;
  }
  // Newest first by uploadDate (already sorted by DB) then createdAt
  return [...map.values()].map(u => ({ ...u, amount: +u.amount.toFixed(2) }));
}

// ── Reconciliation engine ──────────────────────────────────────────────
// Returns one row per AWB present in either direction for the given
// carrier. The shape:
//   { awb, paid, received, diff, status, notes, lastUpdate, hasOut, hasIn }
//
// status comes from cod_reconciliation_action when present, otherwise:
//   • diff == 0           → 'matched'      (effectively settled)
//   • only out, no in     → 'outstanding'  (carrier hasn't paid yet)
//   • only in, no out     → 'over_remit'   (we don't have a payable
//                           record for this remittance)
//   • diff != 0           → 'pending_review' (needs approve/dispute)
// Per-carrier net balance: paid − received summed across every AWB
// (positive = carrier owes us, negative = carrier remitted more than
// we billed, i.e. we owe them / they over-remitted). Returns
// Map<carrier_id, sar>. Callers decide whether to filter (the
// dashboard's "تحصيلات COD المتبقّية" card hides ≤ 0; the COD-
// settlements dropdown shows everything with the sign).
//
// Paginates — Supabase caps a single SELECT at 1000 rows and the
// cod_settlement table outgrows that with one busy carrier.
export async function loadCarrierNetBalances() {
  const PAGE = 1000;
  const byKey = new Map();
  let from = 0;
  while (true) {
    const { data: ledger, error } = await supabase
      .from('cod_settlement')
      .select('carrier_id, awb, direction, amount')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of ledger ?? []) {
      const key = `${r.carrier_id}__${String(r.awb).trim()}`;
      const cur = byKey.get(key) || { carrier_id: r.carrier_id, awb: r.awb, paid: 0, received: 0 };
      if (r.direction === 'out') cur.paid += Number(r.amount) || 0;
      else                       cur.received += Number(r.amount) || 0;
      byKey.set(key, cur);
    }
    if (!ledger || ledger.length < PAGE) break;
    from += PAGE;
  }

  // Sum NET per carrier — keep the sign so the UI can render
  // negatives (over-remitted carriers).
  const totals = new Map();
  for (const m of byKey.values()) {
    const diff = m.paid - m.received;
    totals.set(m.carrier_id, (totals.get(m.carrier_id) || 0) + diff);
  }
  for (const [k, v] of totals) totals.set(k, +v.toFixed(2));
  return totals;
}

// Backwards-compatible alias for the existing callers. Same data
// (signed net per carrier) — caller filters if it only wants
// positive balances.
export const loadOutstandingByCarrier = loadCarrierNetBalances;

export async function loadReconciliation(carrierId) {
  if (!carrierId) return [];

  // Pull all rows for this carrier and aggregate client-side. For the
  // expected volume (thousands) this is fine; we move to a SQL view if
  // it ever feels slow. Paginated because Supabase silently caps a
  // SELECT at 1000 rows — a single busy carrier (SMSA had 1,131 rows
  // after one COD report upload) easily blows past that.
  const PAGE = 1000;
  const ledger = [];
  let from = 0;
  while (true) {
    const { data, error: lErr } = await supabase
      .from('cod_settlement')
      .select('direction, awb, amount, upload_date')
      .eq('carrier_id', carrierId)
      .range(from, from + PAGE - 1);
    if (lErr) throw lErr;
    if (!data?.length) break;
    ledger.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const { data: actions, error: aErr } = await supabase
    .from('cod_reconciliation_action')
    .select('awb, status, notes, updated_at')
    .eq('carrier_id', carrierId);
  if (aErr) throw aErr;

  const actionByAwb = new Map();
  for (const a of actions ?? []) actionByAwb.set(a.awb, a);

  const map = new Map();
  for (const row of ledger ?? []) {
    const awb = String(row.awb).trim();
    if (!map.has(awb)) {
      map.set(awb, {
        awb, paid: 0, received: 0, hasOut: false, hasIn: false,
        firstOutDate: null, firstInDate: null,
        lastUpdate: null,
      });
    }
    const m = map.get(awb);
    if (row.direction === 'out') {
      m.paid += Number(row.amount) || 0;
      m.hasOut = true;
      if (!m.firstOutDate || row.upload_date < m.firstOutDate) m.firstOutDate = row.upload_date;
    } else {
      m.received += Number(row.amount) || 0;
      m.hasIn = true;
      if (!m.firstInDate || row.upload_date < m.firstInDate) m.firstInDate = row.upload_date;
    }
    if (!m.lastUpdate || row.upload_date > m.lastUpdate) m.lastUpdate = row.upload_date;
  }

  const TOL = 0.01; // SAR — sub-fils diffs are pure rounding
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (const m of map.values()) {
    m.paid     = +m.paid.toFixed(2);
    m.received = +m.received.toFixed(2);
    m.diff     = +(m.paid - m.received).toFixed(2);

    const action = actionByAwb.get(m.awb);
    if (action) {
      m.status     = action.status;        // approved | disputed | resolved
      m.notes      = action.notes;
      m.actionDate = action.updated_at;
    } else if (Math.abs(m.diff) <= TOL) {
      m.status = 'matched';
    } else if (m.hasOut && !m.hasIn) {
      m.status = 'outstanding';
    } else if (m.hasIn && !m.hasOut) {
      m.status = 'over_remit';
    } else {
      m.status = 'pending_review';
    }

    // Days since carrier remitted — only meaningful for over_remit rows,
    // but cheap to compute everywhere.
    if (m.firstInDate) {
      m.daysReceived = Math.floor((today - new Date(m.firstInDate)) / 86400000);
    } else {
      m.daysReceived = null;
    }
    // Aged over_remit = received from the carrier > 30 days ago without
    // a matching outgoing settlement ever showing up. Flag for the UI.
    m.isOverRemitAged = m.status === 'over_remit'
      && m.daysReceived != null
      && m.daysReceived > OVER_REMIT_AGE_DAYS;

    out.push(m);
  }
  return out;
}

// High-level totals for the page header. Computed from the same recon
// list so we never disagree with the table view.
export function summarizeReconciliation(rows) {
  const s = {
    outstandingCount: 0, outstandingAmount: 0,
    pendingReviewCount: 0, pendingReviewAmount: 0,
    disputedCount: 0, disputedAmount: 0, oldestDisputeDays: 0,
    matchedCount: 0, matchedAmount: 0,
    overRemitCount: 0, overRemitAmount: 0,
    overRemitRecentCount: 0, overRemitRecentAmount: 0,
    overRemitAgedCount: 0,   overRemitAgedAmount: 0,
    totalAwbs: rows.length,
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const r of rows) {
    if (r.status === 'outstanding') {
      s.outstandingCount++;
      s.outstandingAmount += r.diff;
    } else if (r.status === 'pending_review') {
      s.pendingReviewCount++;
      s.pendingReviewAmount += Math.abs(r.diff);
    } else if (r.status === 'disputed') {
      s.disputedCount++;
      s.disputedAmount += Math.abs(r.diff);
      if (r.actionDate) {
        const days = Math.floor((today - new Date(r.actionDate)) / 86400000);
        if (days > s.oldestDisputeDays) s.oldestDisputeDays = days;
      }
    } else if (r.status === 'matched' || r.status === 'approved' || r.status === 'resolved') {
      s.matchedCount++;
      // For matched rows paid ≈ received (within tolerance). For
      // approved / resolved rows the user has signed off on a small
      // diff; we still count the received amount as "settled cash".
      // Use received (what actually hit the bank) as the conservative
      // SAR figure.
      s.matchedAmount += Number(r.received) || 0;
    } else if (r.status === 'over_remit') {
      s.overRemitCount++;
      s.overRemitAmount += Math.abs(r.diff);
      // Recent (likely just sequencing) vs aged (real anomaly) split.
      if (r.isOverRemitAged) {
        s.overRemitAgedCount++;
        s.overRemitAgedAmount += Math.abs(r.diff);
      } else {
        s.overRemitRecentCount++;
        s.overRemitRecentAmount += Math.abs(r.diff);
      }
    }
  }
  s.outstandingAmount     = +s.outstandingAmount.toFixed(2);
  s.pendingReviewAmount   = +s.pendingReviewAmount.toFixed(2);
  s.disputedAmount        = +s.disputedAmount.toFixed(2);
  s.matchedAmount         = +s.matchedAmount.toFixed(2);
  s.overRemitAmount       = +s.overRemitAmount.toFixed(2);
  s.overRemitAgedAmount   = +s.overRemitAgedAmount.toFixed(2);
  s.overRemitRecentAmount = +s.overRemitRecentAmount.toFixed(2);
  return s;
}

// ── Actions ────────────────────────────────────────────────────────────
// Upsert because each (carrier_id, awb) has a unique constraint —
// taking action twice on the same AWB just updates the existing row.
export async function setReconciliationAction({
  carrierId, awb, status, notes, userId,
}) {
  if (!['approved', 'disputed', 'resolved'].includes(status)) {
    throw new Error(`status غير صالح: ${status}`);
  }
  const { error } = await supabase.from('cod_reconciliation_action').upsert({
    carrier_id: carrierId,
    awb:        String(awb).trim(),
    status,
    notes:      notes ?? null,
    created_by: userId ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'carrier_id,awb' });
  if (error) throw error;
}

export async function clearReconciliationAction(carrierId, awb) {
  const { error } = await supabase
    .from('cod_reconciliation_action')
    .delete()
    .eq('carrier_id', carrierId)
    .eq('awb', String(awb).trim());
  if (error) throw error;
}

// Aging for over_remit rows. Buckets by `firstInDate` — the day the
// carrier remitted the cash. The first 30 days are "probably just
// waiting on the matching outgoing"; past that it's a real anomaly.
export function ageOverRemit(rows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets = {
    d0_30:  { count: 0, amount: 0, label: '0–30 يوم (طبيعي)' },
    d31_60: { count: 0, amount: 0, label: '31–60 يوم'        },
    d61:    { count: 0, amount: 0, label: '+60 يوم'          },
  };
  for (const r of rows) {
    if (r.status !== 'over_remit') continue;
    const days = r.firstInDate
      ? Math.floor((today - new Date(r.firstInDate)) / 86400000)
      : 0;
    let key;
    if (days <= 30)      key = 'd0_30';
    else if (days <= 60) key = 'd31_60';
    else                 key = 'd61';
    buckets[key].count++;
    buckets[key].amount += Math.abs(r.diff);
  }
  for (const k of Object.keys(buckets)) {
    buckets[k].amount = +buckets[k].amount.toFixed(2);
  }
  return buckets;
}

// Aging buckets for outstanding rows. Buckets count by `firstOutDate` —
// the day we first paid the merchant for this AWB — since that's when
// our claim against the carrier really started.
export function ageOutstanding(rows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets = {
    d0_14:  { count: 0, amount: 0 },
    d15_30: { count: 0, amount: 0 },
    d31_60: { count: 0, amount: 0 },
    d61:    { count: 0, amount: 0 },
  };
  for (const r of rows) {
    if (r.status !== 'outstanding') continue;
    const days = r.firstOutDate
      ? Math.floor((today - new Date(r.firstOutDate)) / 86400000)
      : 0;
    let key;
    if (days <= 14)      key = 'd0_14';
    else if (days <= 30) key = 'd15_30';
    else if (days <= 60) key = 'd31_60';
    else                 key = 'd61';
    buckets[key].count++;
    buckets[key].amount += r.diff;
  }
  for (const k of Object.keys(buckets)) {
    buckets[k].amount = +buckets[k].amount.toFixed(2);
  }
  return buckets;
}
