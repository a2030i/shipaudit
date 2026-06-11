// «النقد والأعمار» — two manager questions in one load:
//   1. COD cash cycle: who is sitting on our COD cash and for how long?
//      (RPC cod_cash_cycle — per-AWB out→in matching aggregated in Postgres)
//   2. AP aging: what do we owe each carrier, bucketed by due date?
//      (client-side — carrier_operations is small, hundreds of rows)

import { supabase } from './supabase.js';

const n = (v) => Number(v) || 0;

export async function loadCashAging() {
  const [cycleRes, opsRes, carriersRes] = await Promise.all([
    supabase.rpc('cod_cash_cycle'),
    supabase.from('carrier_operations')
      .select('carrier_id, doc_type, status, amount_dr, amount_cr, amount_paid, due_date, doc_date')
      .neq('status', 'paid'),
    supabase.from('carriers').select('id, name'),
  ]);
  if (cycleRes.error) throw cycleRes.error;
  if (opsRes.error)   throw opsRes.error;

  const nameById = new Map((carriersRes.data || []).map(c => [c.id, c.name]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysUntil = (iso) => Math.round((new Date(iso) - today) / 86400000);

  // ── COD cycle rows ──
  const codRows = (cycleRes.data || [])
    .map(r => ({
      carrierId: r.carrier_id,
      carrierName: nameById.get(r.carrier_id) || r.carrier_id,
      matchedCount: n(r.matched_count),
      avgDays: r.avg_days == null ? null : n(r.avg_days),
      buckets: [n(r.out_d0_15), n(r.out_d16_30), n(r.out_d31_60), n(r.out_over60)],
      outCount: n(r.out_count),
      outTotal: n(r.out_total),
      oldestDays: n(r.oldest_days),
    }))
    .filter(r => r.outTotal > 0.5 || r.matchedCount > 0)
    .sort((a, b) => b.outTotal - a.outTotal);

  // ── AP aging ──
  // Remaining owed per op = DR − CR − already-paid (partial-aware). Credit
  // notes net negative and reduce the carrier total. Bucket by due_date
  // (fallback: doc_date + 30 days credit terms).
  const ap = new Map();
  for (const op of opsRes.data || []) {
    const remaining = n(op.amount_dr) - n(op.amount_cr) - n(op.amount_paid);
    if (Math.abs(remaining) < 0.01) continue;
    const cid = op.carrier_id;
    let row = ap.get(cid);
    if (!row) {
      row = { carrierId: cid, carrierName: nameById.get(cid) || cid,
              overdue: 0, d0_30: 0, d31_60: 0, over60: 0, credits: 0, total: 0 };
      ap.set(cid, row);
    }
    row.total += remaining;
    if (remaining < 0) { row.credits += remaining; continue; }
    const due = op.due_date
      || (op.doc_date ? new Date(new Date(op.doc_date).getTime() + 30 * 86400000).toISOString().slice(0, 10) : null);
    const d = due ? daysUntil(due) : 0;
    if (d < 0)        row.overdue += remaining;
    else if (d <= 30) row.d0_30   += remaining;
    else if (d <= 60) row.d31_60  += remaining;
    else              row.over60  += remaining;
  }
  const apRows = [...ap.values()]
    .map(r => ({ ...r,
      total: +r.total.toFixed(2), overdue: +r.overdue.toFixed(2), d0_30: +r.d0_30.toFixed(2),
      d31_60: +r.d31_60.toFixed(2), over60: +r.over60.toFixed(2), credits: +r.credits.toFixed(2) }))
    .filter(r => Math.abs(r.total) > 0.5)
    .sort((a, b) => b.total - a.total);

  return {
    cod: codRows,
    codTotal: +codRows.reduce((s, r) => s + r.outTotal, 0).toFixed(2),
    ap: apRows,
    apTotal: +apRows.reduce((s, r) => s + r.total, 0).toFixed(2),
    apOverdue: +apRows.reduce((s, r) => s + r.overdue, 0).toFixed(2),
  };
}
