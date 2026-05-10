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
export async function saveSettlementUpload({
  direction, carrierId, rows, uploadDate, sourceFile, userId,
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
  const inserts = rows.map(r => ({
    direction,
    carrier_id:  carrierId,
    awb:         String(r.awb).trim(),
    amount:      Number(r.amount),
    upload_date: date,
    source_file: sourceFile ?? null,
    upload_id:   uploadId,
    created_by:  userId ?? null,
  }));
  // Insert in chunks of 500 — Supabase rejects very large single payloads.
  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase
      .from('cod_settlement').insert(inserts.slice(i, i + CHUNK));
    if (error) throw error;
  }
  return { uploadId, count: inserts.length };
}

// Delete every settlement row from a single upload (the user "undid" it).
export async function deleteSettlementUpload(uploadId) {
  const { error } = await supabase
    .from('cod_settlement').delete().eq('upload_id', uploadId);
  if (error) throw error;
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
export async function loadReconciliation(carrierId) {
  if (!carrierId) return [];

  // Pull all rows for this carrier and aggregate client-side. For the
  // expected volume (thousands) this is fine; we move to a SQL view if
  // it ever feels slow.
  const { data: ledger, error: lErr } = await supabase
    .from('cod_settlement')
    .select('direction, awb, amount, upload_date')
    .eq('carrier_id', carrierId);
  if (lErr) throw lErr;

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
    matchedCount: 0,
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
