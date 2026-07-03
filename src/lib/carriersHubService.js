// Carriers Hub aggregation — ONE round-trip that returns the per-carrier
// rollup needed by the home dashboard. Designed to be cheap so the Hub
// loads instantly even with many carriers.
//
// As of the hub_rollup() migration, the heavy lifting (sum DR/CR, count
// docs by type, count pending audits / webhooks / settlements, find
// last activity) runs in Postgres as a single STABLE SECURITY DEFINER
// function. The previous implementation pulled four full tables into
// JS and aggregated client-side — fine at 26 ops / 3K settlements,
// disastrous at multi-million. The RPC scans the same per-carrier
// indexes the rest of the system uses, so cost is O(rows-per-carrier)
// not O(total-rows-in-system).
//
// Each row returned to the UI carries:
//   {
//     carrierId, name, logo, color,
//     balance,           // SUM(amount_dr) − SUM(amount_cr) — signed
//     totalDr, totalCr,  // sub-totals for the breakdown panel
//     docCounts,         // { INV, COD, PAY, ADJ, OTHER }
//     pendingAudits,     // audits with review_status='pending' (or null)
//     draftAudits,       // not used yet but reserved
//     approvedAudits,
//     webhookPending,    // webhook_events with status='awaiting_assignment'
//     webhookTotal,
//     settlementsCount,
//     hasContract,       // true if at least one active contract
//     hasFileSignature,  // true if email_from is set
//     fileKind,
//     lastActivityAt,    // most recent of: audit / op / settlement / webhook
//     setupCompleteness, // 0..100 — green/red gauge on the card
//   }
//
// Rows are sorted: pending actions (audits + webhooks) first, then by
// |balance| desc — biggest financial exposure on top.

import { supabase } from './supabase.js';

const EMPTY_DOC_COUNTS = { INV: 0, COD: 0, PAY: 0, ADJ: 0, OTHER: 0 };

export async function loadCarriersHub() {
  // Health signals fetched alongside the rollup (all lightweight):
  //  - codNet:      per-carrier COD still with the carrier (out − in, >0 = owed to us)
  //  - lastAudit:   most recent APPROVED audit per carrier (period label + when)
  //  - unauditedRv: open ledger invoices (RV) never linked to an audit —
  //                 money we're being billed that nobody verified.
  const [rollup, codNet, audits, openRvs] = await Promise.all([
    supabase.rpc('hub_rollup'),
    supabase.rpc('carrier_cod_net_balances').then(r => r.data ?? []).catch(() => []),
    supabase.from('audits')
      .select('carrier_id, period, approved_at')
      .eq('review_status', 'approved')
      .order('approved_at', { ascending: false })
      .then(r => r.data ?? []).catch(() => []),
    supabase.from('carrier_operations')
      .select('carrier_id, amount_dr, amount_cr')
      .eq('doc_type', 'RV')
      .is('audit_id', null)
      .neq('status', 'paid')
      .then(r => r.data ?? []).catch(() => []),
  ]);
  const { data, error } = rollup;
  if (error) throw error;

  const codByCarrier = new Map(codNet.map(r => [r.carrier_id, Number(r.net) || 0]));
  const lastAuditByCarrier = new Map();
  for (const a of audits) {
    if (!lastAuditByCarrier.has(a.carrier_id)) {
      lastAuditByCarrier.set(a.carrier_id, { period: a.period || null, approvedAt: a.approved_at });
    }
  }
  const unauditedByCarrier = new Map();
  for (const op of openRvs) {
    const cur = unauditedByCarrier.get(op.carrier_id) || { count: 0, amount: 0 };
    cur.count  += 1;
    cur.amount += (Number(op.amount_dr) || 0) - (Number(op.amount_cr) || 0);
    unauditedByCarrier.set(op.carrier_id, cur);
  }

  const rows = (data ?? []).map((r) => {
    const sig = r.file_signature || {};
    const hasContract       = Array.isArray(r.contracts) && r.contracts.length > 0;
    const hasFileSignature  = Array.isArray(sig.email_from) && sig.email_from.length > 0;
    const fileKind          = sig.file_kind || null;
    const totalDr           = Number(r.total_dr) || 0;
    const totalCr           = Number(r.total_cr) || 0;
    // الرصيد المفتوح (يستبعد المسدَّد) — نفس معادلة carrier_open_balance
    // في /ledger (توحيد فحص الوكلاء #7). total_dr/total_cr للعرض فقط.
    const balance           = Number(r.open_balance) || 0;

    // Setup completeness — gauges how "ready" each carrier is. The Hub
    // surfaces this so the admin sees at a glance which carriers still
    // need configuration before they can audit / receive COD.
    let setupCompleteness = 0;
    if (hasContract)       setupCompleteness += 50; // contract is the heaviest piece
    if (hasFileSignature)  setupCompleteness += 25; // webhook auto-classification
    if (fileKind)          setupCompleteness += 25; // file_kind explicitly chosen

    return {
      carrierId:        r.carrier_id,
      name:             r.name,
      logo:             r.logo,
      color:            r.color,
      balance:          +balance.toFixed(2),
      totalDr:          +totalDr.toFixed(2),
      totalCr:          +totalCr.toFixed(2),
      docCounts:        { ...EMPTY_DOC_COUNTS, ...(r.doc_counts || {}) },
      pendingAudits:    Number(r.pending_audits)    || 0,
      draftAudits:      Number(r.draft_audits)      || 0,
      approvedAudits:   Number(r.approved_audits)   || 0,
      webhookPending:   Number(r.webhook_pending)   || 0,
      webhookTotal:     Number(r.webhook_total)     || 0,
      settlementsCount: Number(r.settlements_count) || 0,
      hasContract,
      hasFileSignature,
      fileKind,
      lastActivityAt:   r.last_activity_at || null,
      setupCompleteness,
      // Health signals
      codOutstanding:   +(codByCarrier.get(r.carrier_id) || 0).toFixed(2),
      lastAudit:        lastAuditByCarrier.get(r.carrier_id) || null,
      unauditedRv:      (() => {
        const u = unauditedByCarrier.get(r.carrier_id);
        return u ? { count: u.count, amount: +u.amount.toFixed(2) } : { count: 0, amount: 0 };
      })(),
    };
  });

  // Sort: pending actions first (action required), then by |balance| desc.
  rows.sort((a, b) => {
    const aActions = a.pendingAudits + a.webhookPending;
    const bActions = b.pendingAudits + b.webhookPending;
    if (aActions !== bActions) return bActions - aActions;
    return Math.abs(b.balance) - Math.abs(a.balance);
  });

  // Global tallies for the header strip
  const totals = rows.reduce((acc, r) => {
    acc.totalDr        += r.totalDr;
    acc.totalCr        += r.totalCr;
    acc.netBalance     += r.balance;
    acc.pendingActions += r.pendingAudits + r.webhookPending;
    return acc;
  }, { totalDr: 0, totalCr: 0, netBalance: 0, pendingActions: 0 });
  totals.totalDr    = +totals.totalDr.toFixed(2);
  totals.totalCr    = +totals.totalCr.toFixed(2);
  totals.netBalance = +totals.netBalance.toFixed(2);

  return { rows, totals };
}
