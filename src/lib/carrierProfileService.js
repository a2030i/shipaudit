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
const runtimeEnv = import.meta.env || {};
export const CARRIER_360_READ_MODE = runtimeEnv.VITE_CARRIER_360_READ_MODE || 'core';

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
  const [ops, codRows, audits, webhooks, zohoResult] = await Promise.all([
    loadAll('carrier_operations', 'id, doc_type, doc_no, doc_date, amount_dr, amount_cr, amount_paid, status, audit_id, payment_id, due_date, paid_at, notes, created_at, updated_at', { carrier_id: carrierId }),
    loadAll('cod_settlement',     'id, direction, awb, amount, upload_date, source_file, upload_id, created_at',                                                                       { carrier_id: carrierId }),
    loadAll('audits',             'id, file_name, contract_label, period, row_count, issue_count, total_expected, total_billed, total_tax, diff, mismatch_count, drift_pre_tax, drift_tax, audit_type, review_status, approved_at, rejected_at, rejected_reason, created_at, col_map', { carrier_id: carrierId }),
    loadAll('webhook_events',     'id, sender, subject, file_name, file_size, status, audit_id, received_at, file_path',                                                              { detected_carrier_id: carrierId }),
    supabase.rpc('carrier_zoho_financial_dossier', { p_carrier_id: carrierId }),
  ]);

  const zohoFinancial = zohoResult.error
    ? { available: false, error: zohoResult.error.message }
    : { available: true, ...(zohoResult.data || {}) };

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
  const byStatus = { pending: 0, draft: 0, approved: 0, rejected: 0, legacy_unverified: 0 };
  for (const a of audits) {
    const control = a.col_map?.__control || null;
    const verified = Number(control?.version) >= 3 && control?.valid === true
      && Boolean(control?.sourceHash) && Boolean(control?.sourcePath)
      && Boolean(a.file_name) && Boolean(a.contract_label);
    const st = verified ? (a.review_status || 'pending') : 'legacy_unverified';
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
    audits:    audits.slice(0, 100),
    webhooks:  webhooks.slice(0, 25),
    ops:       ops.slice(0, 50),
    codRows:   codRows.slice(0, 50),
    zohoFinancial,
  };
}

function asNumber(value) {
  return value == null ? null : (Number(value) || 0);
}

function adaptCarrierCore(payload) {
  if (!payload?.carrier?.id || !payload?.summary) throw new Error('استجابة مسار Carrier 360 المركزي غير مكتملة');
  const summary = payload.summary;
  return {
    carrier: payload.carrier,
    contract: payload.contract || { status: 'missing', current: null },
    summary: {
      ...summary,
      balance: asNumber(summary.balance), totalDr: asNumber(summary.totalDr), totalCr: asNumber(summary.totalCr),
      codOutstanding: asNumber(summary.codOutstanding), codOut: asNumber(summary.codOut), codIn: asNumber(summary.codIn),
      codOutCount: asNumber(summary.codOutCount), codInCount: asNumber(summary.codInCount),
      audits: asNumber(summary.audits), auditsNeedAction: asNumber(summary.auditsNeedAction),
      totalVariance: asNumber(summary.totalVariance), totalObjection: asNumber(summary.totalObjection),
      openClaims: asNumber(summary.openClaims), openClaimsAmount: asNumber(summary.openClaimsAmount),
      webhooks: asNumber(summary.webhooks), webhookPending: asNumber(summary.webhookPending),
      netPosition: asNumber(summary.netPosition),
    },
    latestAudit: payload.latestAudit || null,
    lastFile: payload.lastFile || null,
    audits: payload.recent?.audits || [],
    webhooks: payload.recent?.webhooks || [],
    ops: payload.recent?.ops || [],
    codRows: [],
    zohoFinancial: payload.zohoFinancial || { available: false, error: 'source_unavailable' },
    sources: payload.sources || {},
    permissions: payload.permissions || {},
    generatedAt: payload.generatedAt || null,
    readPath: payload.readPath || 'carrier_360_core',
  };
}

export async function loadCarrierProfileCore(carrierId, client = supabase) {
  if (!carrierId) throw new Error('carrierId مطلوب');
  const { data, error } = await client.rpc('carrier_360_core', { p_carrier_id: carrierId });
  if (error) throw error;
  return adaptCarrierCore(data);
}

export async function loadCarrierProfileRead(carrierId, { mode = CARRIER_360_READ_MODE, client = supabase } = {}) {
  if (mode === 'legacy') return loadCarrierProfile(carrierId);
  try {
    return await loadCarrierProfileCore(carrierId, client);
  } catch (error) {
    // Additive rollout guard: a core/RPC failure must not make Carrier 360
    // unavailable while the established read path is still present.
    console.warn('[carrier-360-read] core unavailable; using legacy fallback', error?.code || error?.message);
    return loadCarrierProfile(carrierId);
  }
}

export async function loadCarrierAuditsPage(carrierId, { page = 1, pageSize = 20, filter = 'all' } = {}, client = supabase) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const { data, error } = await client.rpc('carrier_360_audits_page', {
    p_carrier_id: carrierId, p_filter: filter || 'all', p_page: safePage, p_page_size: safeSize,
  });
  if (error) throw error;
  return {
    rows: data?.rows || [], page: Number(data?.page) || safePage, pageSize: Number(data?.pageSize) || safeSize,
    totalRows: Number(data?.totalRows) || 0, totalPages: Number(data?.totalPages) || 1,
    filter: data?.filter || filter || 'all',
  };
}

export function compareCarrierCoreFinancials(legacy, core) {
  const checks = [
    ['balance', legacy?.summary?.balance, core?.summary?.balance],
    ['totalDr', legacy?.summary?.totalDr, core?.summary?.totalDr],
    ['totalCr', legacy?.summary?.totalCr, core?.summary?.totalCr],
    ['codOutstanding', legacy?.summary?.codOutstanding, core?.summary?.codOutstanding],
    ['totalVariance', (legacy?.audits || []).reduce((sum, row) => sum + (Number(row.diff) || 0), 0), core?.summary?.totalVariance],
    ['totalObjection', (legacy?.audits || []).reduce((sum, row) => sum + Math.max(0, Number(row.diff) || 0), 0), core?.summary?.totalObjection],
  ];
  return checks.flatMap(([field, before, after]) => (
    Math.abs((Number(before) || 0) - (Number(after) || 0)) < 0.005
      ? [] : [{ field, before: Number(before) || 0, after: Number(after) || 0 }]
  ));
}

export async function loadCarrierZohoLinkOptions() {
  const [vendorsResult, treasuriesResult] = await Promise.all([
    supabase
      .from('zoho_contacts')
      .select('zoho_id, contact_name, outstanding_payable, unused_credits_payable, status, synced_at')
      .eq('contact_type', 'vendor')
      .order('contact_name', { ascending: true }),
    supabase
      .from('zoho_chart_accounts')
      .select('zoho_id, account_name, account_code, account_type, current_balance, currency_code, status, synced_at')
      .order('account_name', { ascending: true }),
  ]);
  if (vendorsResult.error) throw vendorsResult.error;
  if (treasuriesResult.error) throw treasuriesResult.error;
  return {
    vendors: vendorsResult.data || [],
    treasuries: (treasuriesResult.data || []).filter(account =>
      ['cash', 'bank', 'other_current_asset', 'other_asset'].includes(account.account_type)
      || /^\s*خزينة(?:\s|$)/i.test(account.account_name || '')),
  };
}

export async function saveCarrierZohoFinancialLinks({ carrierId, zohoVendorId, treasuryAccountId, notes = null }) {
  const { data, error } = await supabase.rpc('set_carrier_zoho_financial_links', {
    p_carrier_id: carrierId,
    p_zoho_vendor_id: zohoVendorId || null,
    p_treasury_account_id: treasuryAccountId || null,
    p_notes: notes || null,
  });
  if (error) throw error;
  return data;
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
