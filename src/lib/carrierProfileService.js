// Carrier Profile aggregation — one round-trip that returns EVERYTHING
// the CarrierProfile page needs about a single carrier:
//   • base row (name, logo, contracts, file_signature)
//   • open payable balance from carrier_operations (remaining after partial payments)
//   • COD outstanding (sum of 'out' rows minus 'in' rows in cod_settlement
//     for this carrier)
//   • last N audits with review status
//   • last N webhook events
//   • last N ledger ops (carrier_operations)
//
// All queries are paginated where needed so a busy carrier with 50K
// audits doesn't blow past Supabase's 1K cap.

import { supabase } from './supabase.js';

const PAGE = 1000;

async function loadAll(table, columns, filters = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    // STABLE order required — without it Postgres may return overlapping
    // rows across .range() pages once a table exceeds 1000, double-counting.
    // 'id' exists on every table passed here (carrier_operations,
    // cod_settlement, audits, webhook_events).
    let q = supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + PAGE - 1);
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

export const FILE_KIND_LABELS = {
  audit_with_cod:         'مراجعة + COD في نفس الملف',
  audit_and_cod_separate: 'مراجعة و COD في ملفّين منفصلين',
  audit_only:             'مراجعة فقط — لا COD',
  cod_only:               'تحصيل COD فقط',
};
export const FILE_KIND_OPTIONS = Object.entries(FILE_KIND_LABELS).map(([value, label]) => ({ value, label }));

export async function loadCarrierProfile(carrierId) {
  if (!carrierId) throw new Error('carrierId مطلوب');

  // Base carrier row
  const { data: carrier, error: cErr } = await supabase
    .from('carriers')
    .select('*')
    .eq('id', carrierId)
    .single();
  if (cErr) throw cErr;
  if (!carrier) throw new Error('الشركة غير موجودة');

  // Run the rest in parallel
  const [ops, codRows, audits, webhooks] = await Promise.all([
    loadAll('carrier_operations', 'id, doc_type, doc_no, doc_date, amount_dr, amount_cr, amount_paid, status, audit_id, payment_id, due_date, paid_at, notes, created_at, updated_at', { carrier_id: carrierId }),
    loadAll('cod_settlement',     'id, direction, awb, amount, upload_date, source_file, upload_id, created_at',                                                                       { carrier_id: carrierId }),
    loadAll('audits',             'id, file_name, period, row_count, issue_count, total_billed, total_tax, diff, mismatch_count, drift_pre_tax, drift_tax, audit_type, review_status, approved_at, rejected_at, rejected_reason, created_at', { carrier_id: carrierId }),
    loadAll('webhook_events',     'id, sender, subject, file_name, file_size, status, audit_id, received_at, file_path',                                                              { detected_carrier_id: carrierId }),
  ]);

  // ── Financial sub-ledger ───────────────────────────────────────
  let totalDr = 0, totalCr = 0, openBalance = 0;
  const docCounts = { INV: 0, COD: 0, PAY: 0, ADJ: 0, OTHER: 0 };
  for (const o of ops) {
    const dr = Number(o.amount_dr) || 0, cr = Number(o.amount_cr) || 0;
    totalDr += dr;
    totalCr += cr;
    // الرصيد المفتوح = المتبقي بعد المدفوعات الجزئية. كان بروفايل الناقل
    // يحسب عمليات partial بكاملها، فيُظهر رقماً أعلى من الدفتر.
    if (o.status !== 'paid') {
      const gross = dr - cr;
      const paid = Number(o.amount_paid) || 0;
      openBalance += gross >= 0 ? Math.max(0, gross - paid) : gross;
    }
    const dt = (o.doc_type || 'OTHER').toUpperCase();
    if (docCounts[dt] != null) docCounts[dt]++;
    else                        docCounts.OTHER++;
  }
  const balance = +openBalance.toFixed(2);

  // ── COD outstanding (out unmatched by in) ──────────────────────
  // We don't try to be too clever here: net = sum(out) − sum(in).
  // Per-AWB matching is shown in the page when needed.
  let codOut = 0, codIn = 0, codOutCount = 0, codInCount = 0;
  for (const r of codRows) {
    const amt = Number(r.amount) || 0;
    if (r.direction === 'out') { codOut += amt; codOutCount++; }
    else                       { codIn  += amt; codInCount++;  }
  }
  const codOutstanding = +(codOut - codIn).toFixed(2);

  // ── Audit summary ──────────────────────────────────────────────
  const byStatus = { pending: 0, draft: 0, approved: 0, rejected: 0 };
  for (const a of audits) {
    const st = a.review_status || 'pending';
    if (byStatus[st] != null) byStatus[st]++;
  }
  audits.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // ── Webhook summary ────────────────────────────────────────────
  const webhookPending = webhooks.filter(w => w.status === 'awaiting_assignment' || w.status === 'pending').length;
  webhooks.sort((a, b) => (b.received_at || '').localeCompare(a.received_at || ''));

  // ── Ops recent ─────────────────────────────────────────────────
  ops.sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));

  // ── Setup completeness ─────────────────────────────────────────
  const sig = carrier.file_signature || {};
  const hasContract       = Array.isArray(carrier.contracts) && carrier.contracts.length > 0;
  const hasEmailFrom      = Array.isArray(sig.email_from) && sig.email_from.length > 0;
  const hasFileKind       = typeof sig.file_kind === 'string' && !!sig.file_kind;
  const setupCompleteness = (hasContract ? 50 : 0) + (hasEmailFrom ? 25 : 0) + (hasFileKind ? 25 : 0);
  const setupGaps = [];
  if (!hasContract)  setupGaps.push('عقد');
  if (!hasEmailFrom) setupGaps.push('بصمة Webhook (email_from)');
  if (!hasFileKind)  setupGaps.push('نوع الملفات (file_kind)');

  // ── Last activity ──────────────────────────────────────────────
  const candidates = [
    ...ops.map(o => o.updated_at || o.created_at),
    ...audits.map(a => a.created_at),
    ...webhooks.map(w => w.received_at),
    ...codRows.map(r => r.created_at || r.upload_date),
  ].filter(Boolean);
  const lastActivityAt = candidates.length ? candidates.sort().pop() : null;

  return {
    carrier: {
      id:                carrier.id,
      name:              carrier.name,
      logo:              carrier.logo,
      color:             carrier.color,
      contracts:         carrier.contracts || [],
      file_signature:    sig,
      contact_email:     carrier.contact_email,
      contact_phone:     carrier.contact_phone,
      account_manager:   carrier.account_manager,
      iban:              carrier.iban,
      bank_name:         carrier.bank_name,
    },
    summary: {
      balance,
      totalDr:        +totalDr.toFixed(2),
      totalCr:        +totalCr.toFixed(2),
      docCounts,
      codOutstanding,
      codOut:         +codOut.toFixed(2),
      codIn:          +codIn.toFixed(2),
      codOutCount,
      codInCount,
      audits:         audits.length,
      auditsByStatus: byStatus,
      webhooks:       webhooks.length,
      webhookPending,
      setupCompleteness,
      setupGaps,
      lastActivityAt,
      // Net financial position considering COD held by carrier:
      //   balance − codOutstanding
      // (positive = we owe them, negative = they owe us)
      netPosition:    +(balance - codOutstanding).toFixed(2),
    },
    audits:    audits.slice(0, 25),
    webhooks:  webhooks.slice(0, 25),
    ops:       ops.slice(0, 50),
    codRows:   codRows.slice(0, 50),
  };
}

// Persist a partial file_signature update — used by the file-kind
// radio in CarrierProfile.
export async function updateCarrierFileSignature(carrierId, patch) {
  if (!carrierId) throw new Error('carrierId مطلوب');
  const { data: row, error: rErr } = await supabase
    .from('carriers')
    .select('file_signature')
    .eq('id', carrierId)
    .single();
  if (rErr) throw rErr;
  const merged = { ...(row?.file_signature || {}), ...(patch || {}) };
  const { error } = await supabase
    .from('carriers')
    .update({ file_signature: merged, updated_at: new Date().toISOString() })
    .eq('id', carrierId);
  if (error) throw error;
  return merged;
}
