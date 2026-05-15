// Carriers Hub aggregation — ONE round-trip that returns the per-carrier
// rollup needed by the home dashboard. Designed to be cheap so the Hub
// loads instantly even with many carriers.
//
// Each row carries:
//   {
//     carrierId, name, logo, color,
//     balance,           // SUM(amount_dr) − SUM(amount_cr) — signed
//     totalDr, totalCr,  // sub-totals for the breakdown panel
//     pendingAudits,     // audits with review_status='pending' (or null)
//     draftAudits,       // not used yet but reserved
//     webhookPending,    // webhook_events with status='awaiting_assignment'
//     hasContract,       // true if at least one active contract
//     hasFileSignature,  // true if email_from is set
//     lastActivityAt,    // most recent of: audit / op / settlement / webhook
//     setupCompleteness, // 0..100 — green/red gauge on the card
//   }
//
// Rows are returned sorted by |balance| desc — biggest financial
// exposure first.

import { supabase } from './supabase.js';

const PAGE = 1000;

async function loadAll(table, columns, filters = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    let q = supabase.from(table).select(columns).range(from, from + PAGE - 1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export async function loadCarriersHub() {
  // Pull in parallel — none of these tables is huge.
  const [carriers, ops, audits, webhooks, settlements] = await Promise.all([
    supabase.from('carriers').select('id, name, logo, color, contracts, file_signature').order('name'),
    loadAll('carrier_operations', 'carrier_id, amount_dr, amount_cr, doc_type, doc_date, updated_at'),
    loadAll('audits', 'id, carrier_id, review_status, created_at'),
    loadAll('webhook_events', 'id, detected_carrier_id, status, received_at'),
    loadAll('cod_settlement', 'carrier_id, upload_date, created_at'),
  ]);
  if (carriers.error) throw carriers.error;

  const byCarrier = new Map();
  for (const c of carriers.data ?? []) {
    const sig = c.file_signature || {};
    const hasContract = Array.isArray(c.contracts) && c.contracts.length > 0;
    const hasFileSignature = Array.isArray(sig.email_from) && sig.email_from.length > 0;
    byCarrier.set(c.id, {
      carrierId:        c.id,
      name:             c.name,
      logo:             c.logo,
      color:            c.color,
      balance:          0,
      totalDr:          0,
      totalCr:          0,
      docCounts:        { INV: 0, COD: 0, PAY: 0, ADJ: 0, OTHER: 0 },
      pendingAudits:    0,
      draftAudits:      0,
      approvedAudits:   0,
      webhookPending:   0,
      webhookTotal:     0,
      settlementsCount: 0,
      hasContract,
      hasFileSignature,
      fileKind:         sig.file_kind || null,
      lastActivityAt:   null,
    });
  }

  const touchActivity = (cid, iso) => {
    if (!cid || !iso) return;
    const row = byCarrier.get(cid);
    if (!row) return;
    if (!row.lastActivityAt || iso > row.lastActivityAt) row.lastActivityAt = iso;
  };

  for (const o of ops || []) {
    const row = byCarrier.get(o.carrier_id);
    if (!row) continue;
    const dr = Number(o.amount_dr) || 0;
    const cr = Number(o.amount_cr) || 0;
    row.totalDr += dr;
    row.totalCr += cr;
    row.balance += dr - cr;
    const dt = (o.doc_type || 'OTHER').toUpperCase();
    if (row.docCounts[dt] != null) row.docCounts[dt]++;
    else                            row.docCounts.OTHER++;
    touchActivity(o.carrier_id, o.updated_at || o.doc_date);
  }

  for (const a of audits || []) {
    const row = byCarrier.get(a.carrier_id);
    if (!row) continue;
    const st = a.review_status || 'pending';
    if (st === 'pending')        row.pendingAudits++;
    else if (st === 'draft')     row.draftAudits++;
    else if (st === 'approved')  row.approvedAudits++;
    touchActivity(a.carrier_id, a.created_at);
  }

  for (const w of webhooks || []) {
    const row = byCarrier.get(w.detected_carrier_id);
    if (!row) continue;
    row.webhookTotal++;
    if (w.status === 'awaiting_assignment' || w.status === 'pending') {
      row.webhookPending++;
    }
    touchActivity(w.detected_carrier_id, w.received_at);
  }

  for (const s of settlements || []) {
    const row = byCarrier.get(s.carrier_id);
    if (!row) continue;
    row.settlementsCount++;
    touchActivity(s.carrier_id, s.created_at || s.upload_date);
  }

  // Setup completeness — gauges how "ready" each carrier is. The Hub
  // surfaces this so the admin sees at a glance which carriers still
  // need configuration before they can audit / receive COD.
  for (const row of byCarrier.values()) {
    let score = 0;
    if (row.hasContract)        score += 50; // contract is the heaviest piece
    if (row.hasFileSignature)   score += 25; // webhook auto-classification
    if (row.fileKind)           score += 25; // file_kind explicitly chosen
    row.setupCompleteness = score;
    row.balance = +row.balance.toFixed(2);
    row.totalDr = +row.totalDr.toFixed(2);
    row.totalCr = +row.totalCr.toFixed(2);
  }

  const rows = [...byCarrier.values()];
  // Sort: pending audits first (action required), then by |balance| desc.
  rows.sort((a, b) => {
    const aActions = a.pendingAudits + a.webhookPending;
    const bActions = b.pendingAudits + b.webhookPending;
    if (aActions !== bActions) return bActions - aActions;
    return Math.abs(b.balance) - Math.abs(a.balance);
  });

  // Global tallies for the header strip
  const totals = rows.reduce((acc, r) => {
    acc.totalDr += r.totalDr;
    acc.totalCr += r.totalCr;
    acc.netBalance += r.balance;
    acc.pendingActions += r.pendingAudits + r.webhookPending;
    return acc;
  }, { totalDr: 0, totalCr: 0, netBalance: 0, pendingActions: 0 });
  totals.totalDr    = +totals.totalDr.toFixed(2);
  totals.totalCr    = +totals.totalCr.toFixed(2);
  totals.netBalance = +totals.netBalance.toFixed(2);

  return { rows, totals };
}
