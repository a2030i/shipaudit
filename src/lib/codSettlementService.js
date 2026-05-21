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

  // ── Financial ledger auto-post ───────────────────────────────────
  // Only the 'in' direction (carrier remitting COD back to us) creates
  // a ledger line — that's a real CR against the carrier's account.
  // 'out' is purely the merchant-settlement side (internal data) and
  // doesn't flow through the carrier sub-ledger. One CR row per upload,
  // idempotent via the unique partial index on (reference_no) WHERE
  // doc_type='COD'.
  if (direction === 'in') {
    try {
      const totalCr = +inserts.reduce((s, r) => s + (Number(r.amount) || 0), 0).toFixed(2);
      if (totalCr > 0) {
        const nowIso = new Date().toISOString();
        const op = {
          carrier_id:   carrierId,
          doc_type:     'COD',
          doc_no:       `COD-${uploadId.slice(-10)}`,
          reference_no: uploadId,
          doc_date:     date,
          amount_dr:    0,
          amount_cr:    totalCr,
          balance:      -totalCr,
          status:       'open',
          notes:        `تحصيل COD — ${inserts.length} شحنة · ${sourceFile || ref || ''}`.trim(),
          created_at:   nowIso,
          updated_at:   nowIso,
        };
        const { error: opErr } = await supabase
          .from('carrier_operations')
          .upsert(op, { onConflict: 'reference_no' });
        if (opErr && !String(opErr.message).includes('duplicate')) {
          console.warn('COD ledger auto-post failed:', opErr.message);
        }
      }
    } catch (e) {
      console.warn('COD ledger auto-post threw:', e.message);
    }
  }

  return {
    uploadId,
    count: inserts.length,
    inBatchDuplicates: inBatchDupAwbs.length,
    crossFileDuplicates: crossFileDupAwbs.length,
    totalSubmitted: rows.length,
  };
}

// ── Audit-driven COD extraction ─────────────────────────────────────
// When the user approves an audit that carries COD amounts, we
// automatically insert rows in cod_settlement so the COD reconciliation
// reflects the audit's content. The DIRECTION depends on the carrier's
// file profile:
//
//   audit_with_cod (e.g., DeliverNow)
//     The invoice file IS the carrier's own statement — coming FROM the
//     carrier. Treat as direction='in' (مُستلَم من الناقل): single
//     record, no duplication. It reconciles against any direction='out'
//     uploads from the internal system.
//
//   audit_and_cod_separate (e.g., Aramex)
//     The audit's COD column lists what we EXPECT the carrier to remit.
//     Treat as direction='out' (متوقّع من الناقل). The separate
//     remittance file arrives later as a manual 'in' upload.
//
// Idempotent: re-approving an audit deletes both possible prior batches
// first, then re-inserts under whichever direction is current. Rejecting
// or reopening calls clearAuditCodOut which wipes the audit's rows.
export async function syncAuditCodOut({
  auditId, carrierId, sourceFile, userId, direction = 'out',
}) {
  if (!auditId || !carrierId) throw new Error('auditId + carrierId مطلوبان');
  if (!['in', 'out'].includes(direction)) {
    throw new Error(`direction غير صالح: ${direction}`);
  }
  const outUploadId = `audit_out_${auditId}`;
  const inUploadId  = `audit_in_${auditId}`;
  const uploadId    = direction === 'in' ? inUploadId : outUploadId;

  // Idempotent reset — clear BOTH directions so swapping file_kind on a
  // carrier (e.g., audit_with_cod → audit_and_cod_separate) cleans up
  // the previous direction's leftovers automatically.
  await supabase
    .from('cod_settlement')
    .delete()
    .in('upload_id', [outUploadId, inUploadId]);

  // Pull COD-bearing shipments from the per-row table. Paginate so a
  // 500K-shipment audit with 50K COD rows doesn't fail on the 1K cap.
  const PAGE = 1000;
  const codRows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('audit_shipments')
      .select('awb, cod_amount, ship_date')
      .eq('audit_id', auditId)
      .gt('cod_amount', 0)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    codRows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  if (!codRows.length) return { count: 0, total: 0, direction };

  // Dedup AWBs within the batch (one shipment can show up twice in the
  // file if the carrier billed it on multiple invoice lines).
  const seen = new Set();
  const baseRows = [];
  for (const r of codRows) {
    const awb = String(r.awb || '').trim();
    if (!awb || seen.has(awb)) continue;
    seen.add(awb);
    baseRows.push({
      awb,
      amount:      Number(r.cod_amount) || 0,
      upload_date: r.ship_date || new Date().toISOString().slice(0, 10),
    });
  }

  const rows = baseRows.map(r => ({
    direction,
    carrier_id:     carrierId,
    awb:            r.awb,
    amount:         r.amount,
    upload_date:    r.upload_date,
    source_file:    sourceFile || `audit:${auditId}`,
    settlement_ref: null,
    upload_id:      uploadId,
    created_by:     userId || null,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('cod_settlement').insert(rows.slice(i, i + CHUNK));
    if (error) throw error;
  }
  const total = baseRows.reduce((s, r) => s + r.amount, 0);
  return {
    count:     baseRows.length,
    total:     +total.toFixed(2),
    direction,
  };
}

// Reverse: drop every cod_settlement row this audit's approval created
// (both 'out' and 'in' if autoSettle was on). Called from rejectAudit
// and reopenAudit.
export async function clearAuditCodOut(auditId) {
  if (!auditId) return 0;
  const outId = `audit_out_${auditId}`;
  const inId  = `audit_in_${auditId}`;
  const { data, error } = await supabase
    .from('cod_settlement')
    .delete()
    .in('upload_id', [outId, inId])
    .select('id');
  if (error) throw error;
  return data?.length || 0;
}

// Delete every settlement row from a single upload (the user "undid" it).
// Also reverses the matching ledger line so the carrier balance updates.
export async function deleteSettlementUpload(uploadId) {
  const { error } = await supabase
    .from('cod_settlement').delete().eq('upload_id', uploadId);
  if (error) throw error;
  try {
    await supabase.from('carrier_operations')
      .delete()
      .eq('doc_type', 'COD')
      .eq('reference_no', uploadId);
  } catch (e) {
    console.warn('COD ledger reverse-on-delete failed:', e.message);
  }
}

// List of all settlement uploads for a carrier, aggregated by upload_id
// so the UI can show one row per uploaded file: date, direction, count,
// total amount, source filename, settlement ref.
export async function loadSettlementUploads({ carrierId } = {}) {
  if (!carrierId) return [];
  // Paginated — same 1000-row cap as everywhere else in this file.
  // Without pagination the per-file totals shifted every refresh
  // because Supabase returned a different 1000-row slice each time.
  const PAGE = 1000;
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('cod_settlement')
      .select('upload_id, direction, upload_date, source_file, settlement_ref, amount, created_at')
      .eq('carrier_id', carrierId)
      .order('upload_date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  // Need each row's AWB too to compute per-file settled / unsettled
  // counts. Pull all AWBs for the carrier once, build a quick lookup
  // of which direction each AWB has, then walk through `all` again
  // to tag rows. Cheaper than a second roundtrip per upload.
  const PAGE2 = 1000;
  const awbRows = [];
  let from2 = 0;
  while (true) {
    const { data, error } = await supabase
      .from('cod_settlement')
      .select('upload_id, direction, awb, amount')
      .eq('carrier_id', carrierId)
      .range(from2, from2 + PAGE2 - 1);
    if (error) throw error;
    if (!data?.length) break;
    awbRows.push(...data);
    if (data.length < PAGE2) break;
    from2 += PAGE2;
  }
  // Cross-direction set: every AWB that has at least one 'in' row +
  // every AWB that has at least one 'out' row. Used to decide whether
  // a row from this upload has been matched yet.
  const inAwbs  = new Set();
  const outAwbs = new Set();
  for (const r of awbRows) {
    const awb = String(r.awb).trim();
    if (r.direction === 'in')  inAwbs.add(awb);
    else                       outAwbs.add(awb);
  }

  const map = new Map();
  for (const row of all) {
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
        // Per-upload settlement progress.
        // For outgoing uploads (out): settledCount = number of AWBs
        // in this file that ALSO have an 'in' row anywhere. The rest
        // are still waiting for the carrier to remit.
        // For incoming uploads (in):  matchedCount = AWBs in this
        // file that have a matching 'out' (otherwise it's over-remit).
        settledCount:   0,
        settledAmount:  0,
        unsettledCount: 0,
        unsettledAmount: 0,
      });
    }
    const u = map.get(row.upload_id);
    u.count++;
    u.amount += Number(row.amount) || 0;
  }

  // Second pass: walk AWBs grouped by upload_id and tag each as
  // settled/unsettled. We use awbRows so we have every AWB on hand.
  for (const r of awbRows) {
    const u = map.get(r.upload_id);
    if (!u) continue;
    const awb = String(r.awb).trim();
    const amt = Number(r.amount) || 0;
    const settled = u.direction === 'out'
      ? inAwbs.has(awb)
      : outAwbs.has(awb);
    if (settled) {
      u.settledCount++;
      u.settledAmount += amt;
    } else {
      u.unsettledCount++;
      u.unsettledAmount += amt;
    }
  }

  return [...map.values()].map(u => ({
    ...u,
    amount:           +u.amount.toFixed(2),
    settledAmount:    +u.settledAmount.toFixed(2),
    unsettledAmount:  +u.unsettledAmount.toFixed(2),
  }));
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
// Backed by the carrier_cod_net_balances() RPC. Returns one row per
// carrier with net = SUM(out) - SUM(in).
//
// The previous JS path paginated the entire cod_settlement table
// (thousands of rows today, multi-million at scale) and re-aggregated
// in JS — every Dashboard load paid that cost. The RPC does the same
// aggregation on the server in one round-trip.
//
// Math equivalence: the JS grouped by (carrier_id, awb) first, then
// summed per carrier. Since addition is commutative,
//   per_carrier_total = SUM_over_awb(SUM(out) - SUM(in))
//                     = SUM(out) - SUM(in)   over all rows
// so the AWB grouping was unnecessary. Verified against prod: every
// non-zero carrier returns the same net to two decimal places.
export async function loadCarrierNetBalances() {
  const { data, error } = await supabase.rpc('carrier_cod_net_balances');
  if (error) throw error;
  const totals = new Map();
  for (const r of (data ?? [])) {
    totals.set(r.carrier_id, +(Number(r.net) || 0).toFixed(2));
  }
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
