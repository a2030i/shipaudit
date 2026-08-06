// Excess-weight billing pipeline.
//
// The merchant-facing billing system needs an Excel of (AWB, total
// weight) for every shipment that exceeded its destination's base
// allowance — but only ONCE per shipment. Audits get marked as
// `exported` after their excess rows are pulled, so the next run picks
// up only the newly-uploaded audits.
//
// API:
//   loadPendingAuditsForBilling()           → audits still in `pending` state
//   loadBillingExports({ limit, status })   → past exports + their status
//   exportPendingExcessWeights({ userId })  → build Excel, mark audits
//                                             `exported`, record the export
//   markExportBilled(exportId, userId)      → mark the export (and its
//                                             audits) as fully billed
//   voidExport(exportId, reason)            → mark voided + revert audits
//                                             back to `pending`
//
// All Excel/CSV writing is delegated to the existing
// `exportMergedExcessWeights` helper so we share one definition of
// "what does the excess Excel look like".

import * as XLSX from 'xlsx';
import { rtl } from './xlsxRtl.js';
import { supabase } from './supabase.js';
import { accountingPeriodAliases, auditPeriodMatches } from './accountingCycleService.js';
import { hasVerifiedAuditProof } from './auditProof.js';

// ─── helpers ────────────────────────────────────────────────────────────────
// Returns every billable shipment for an audit in (AWB, billed weight) form.
// No first-bracket pre-filtering — the external billing system has its own
// per-merchant thresholds; we hand it every shipment. Dropped rows: no AWB
// (noise), zero weight (returns), COD-fee-only rows.
//
// Billable shipments come from audit_shipments — NOT audits.results.
// `results` JSONB holds ONLY the issues (capped, §1.8 scale design), so a
// clean large audit (e.g. Aramex 1,684 rows all-OK) looks EMPTY through
// results and used to get silently marked 'skipped', losing its weights.
// Paginated with a stable .order('id') (§6: pages overlap without it).
async function billableRowsFor(audit) {
  const PAGE = 1000;
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('audit_shipments')
      .select('awb, weight_kg, dest_country, ship_date, is_cod')
      .eq('audit_id', audit.id)
      .gt('weight_kg', 0)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data || []) {
      if (!r.awb || r.is_cod) continue;
      out.push({
        awb:      String(r.awb),
        weight:   +Number(r.weight_kg).toFixed(2),
        dest:     r.dest_country || '',
        shipDate: r.ship_date || '',
        carrier:  audit.carrier_name || '',
        period:   audit.period || '',
      });
    }
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// Only reviews produced by the current contractual-control pipeline may feed
// merchant billing. Historical approvals pre-date the source-file / contract
// proof gate and must remain readable without silently creating Lamha charges.
export function isVerifiedAuditForWeightBilling(audit) {
  return hasVerifiedAuditProof(audit);
}

// Lamha owns the merchant-specific allowance and calculates the excess. Export
// only the carrier's total weight per AWB using Lamha's exact import headers.
export function toLamhaWeightRows(rows) {
  return (rows || []).map(row => ({
    'رقم الشحنة': String(row?.awb || '').trim(),
    'الوزن الجديد': +Number(row?.weight || 0).toFixed(2),
  }));
}

// The accountant first needs the shipment numbers to run Lamha's bulk search,
// then exports the matching Admin Order Export and uploads it in stage 3. This
// list is intentionally AWB-only: it is a read-only search aid and does not
// change the weight-export lifecycle.
export function toLamhaShipmentSearchRows(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows || []) {
    const awb = String(row?.awb || '').trim();
    if (!awb || seen.has(awb)) continue;
    seen.add(awb);
    result.push({ 'رقم الشحنة': awb });
  }
  return result;
}

// ─── reads ─────────────────────────────────────────────────────────────────
export async function loadPendingAuditsForBilling() {
  // Only APPROVED audits feed the merchant-billing pipeline. Pending /
  // rejected audits stay out: pending = accountant hasn't blessed the
  // numbers yet; rejected = explicitly excluded.
  const { data, error } = await supabase
    .from('audits')
    // NOTE: no `results` here — shipments come from audit_shipments now,
    // and pulling the issues JSONB for every pending audit was dead weight.
    .select('id, carrier_id, carrier_name, period, file_name, contract_label, col_map, created_at, weight_billing_status, review_status, row_count')
    .eq('weight_billing_status', 'pending')
    .eq('review_status',         'approved')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).filter(isVerifiedAuditForWeightBilling);
}

// Approved in the historical sense, but not safe to export because the audit
// lacks the current source-file + selected-contract proof. Kept separate so
// the UI can explain why a visible old review is not included in the Excel.
export async function loadBlockedUnverifiedAuditsForBilling() {
  const { data, error } = await supabase
    .from('audits')
    .select('id, carrier_id, carrier_name, period, file_name, contract_label, col_map, created_at, weight_billing_status, review_status, row_count')
    .eq('weight_billing_status', 'pending')
    .eq('review_status', 'approved')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).filter(audit => !isVerifiedAuditForWeightBilling(audit));
}

// How many audits are stuck in `pending` review — they have rows but
// the accountant hasn't blessed them yet. Surfaced on the
// weight-billing hero so the user knows there's a queue waiting.
export async function loadAwaitingApproval() {
  const { data, error } = await supabase
    .from('audits')
    .select('id, carrier_id, carrier_name, period, file_name, created_at, row_count')
    .eq('review_status', 'pending')
    .eq('weight_billing_status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function loadBillingExports({ limit = 50, status } = {}) {
  let q = supabase
    .from('weight_billing_exports')
    .select('*')
    .order('exported_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function downloadApprovedShipmentNumbers({ period } = {}) {
  if (!period) throw new Error('اختر شهر دورة المحاسب أولًا');
  const { data, error } = await supabase
    .from('audits')
    .select('id, carrier_name, period, col_map, review_status')
    .eq('review_status', 'approved')
    .in('period', accountingPeriodAliases(period))
    .order('created_at', { ascending: true });
  if (error) throw error;

  const audits = (data || []).filter(isVerifiedAuditForWeightBilling);
  const shipments = [];
  for (const audit of audits) shipments.push(...await billableRowsFor(audit));
  const rows = toLamhaShipmentSearchRows(shipments);
  if (!rows.length) return { ok: false, reason: 'empty', count: 0, auditCount: audits.length };

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'أرقام الشحنات');
  const fileName = `أرقام_شحنات_لمحة_${period}_${rows.length}شحنة.xlsx`;
  if (typeof window !== 'undefined') XLSX.writeFile(rtl(workbook), fileName);
  return { ok: true, count: rows.length, auditCount: audits.length, fileName };
}

// Audits referenced by a given export, hydrated with their current
// status so the UI can show "still exported / now billed / voided".
export async function loadAuditsForExport(exportId) {
  const { data: exp, error: e1 } = await supabase
    .from('weight_billing_exports')
    .select('*')
    .eq('id', exportId)
    .single();
  if (e1) throw e1;
  const ids = exp?.audit_ids || [];
  if (!ids.length) return { export: exp, audits: [] };
  const { data: audits, error: e2 } = await supabase
    .from('audits')
    .select('id, carrier_id, carrier_name, period, file_name, weight_billing_status')
    .in('id', ids);
  if (e2) throw e2;
  return { export: exp, audits: audits || [] };
}

// ─── core action ────────────────────────────────────────────────────────────
export async function exportPendingExcessWeights({ carriers, userId, trigger = 'manual', period = null } = {}) {
  const allPending = await loadPendingAuditsForBilling();
  // مركز دورة المحاسب يصدّر شهره فقط. بقية نقاط الاستدعاء القديمة لا
  // تمرّر period وتحافظ على سلوك «كل المعلّق» كما كان.
  const pending = period
    ? allPending.filter(a => auditPeriodMatches(a.period, period))
    : allPending;
  if (!pending.length) {
    return { ok: false, reason: 'empty', count: 0, auditCount: 0 };
  }

  // Aggregate every billable shipment across the pending audits,
  // dedup by AWB so a shipment that somehow appears in two audits
  // (usually a re-upload) doesn't get billed to the merchant twice.
  // We DON'T need the carriers list any more — billableRowsFor
  // returns every shipment with its full billed weight, the external
  // billing system applies its own per-merchant thresholds.
  const byAwb = new Map();
  const auditIds = [];
  const skippedIds = []; // audits with no billable rows (COD-only, etc.)
  for (const a of pending) {
    const rows = await billableRowsFor(a);
    if (!rows.length) {
      skippedIds.push(a.id);
      continue;
    }
    auditIds.push(a.id);
    for (const r of rows) {
      if (!byAwb.has(r.awb)) byAwb.set(r.awb, r);
    }
  }

  // Mark empty audits as 'skipped' regardless of whether we have any
  // billable rows — they shouldn't keep clogging the pending counter.
  if (skippedIds.length) {
    const CHUNK = 100;
    for (let i = 0; i < skippedIds.length; i += CHUNK) {
      const slice = skippedIds.slice(i, i + CHUNK);
      await supabase.from('audits')
        .update({ weight_billing_status: 'skipped' })
        .in('id', slice);
    }
  }

  if (!byAwb.size) return { ok: false, reason: 'no_shipments', count: 0, auditCount: 0, skipped: skippedIds.length };

  // Build the Excel — the external billing system only needs AWB +
  // billed weight. Per the CFO's spec — the external billing system
  // only needs (AWB, billed weight). Carrier / period / dest /
  // shipDate stay on the audit rows for internal traceability but
  // they don't belong in the export.
  const rows = Array.from(byAwb.values());
  const ws = XLSX.utils.json_to_sheet(toLamhaWeightRows(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'أوزان للفوترة');

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `أوزان_للفوترة_${rows.length}شحنة_${ts}.xlsx`;
  const xlsxBuf = XLSX.write(rtl(wb), { type: 'array', bookType: 'xlsx' });
  const fileSize = xlsxBuf.byteLength;

  // Upload to storage so the file is durable + downloadable later
  // without recomputing. Bucket `weight-billing` should exist; if it
  // doesn't, we still record the export so the in-browser download
  // works for the user right now.
  let filePath = null;
  try {
    // Storage keys must be ASCII-only (§1.7 — Supabase Storage silently
    // rejects Arabic keys, which is why every past export had
    // file_path=null). The Arabic name stays in file_name for display.
    const asciiName = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${new Date().toISOString().slice(0, 7)}/${Date.now()}_${asciiName}`;
    const { error: upErr } = await supabase
      .storage
      .from('weight-billing')
      .upload(path, new Blob([xlsxBuf]), {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      });
    if (!upErr) filePath = path;
  } catch {
    /* storage not configured — non-fatal */
  }

  // Record the export
  const { data: exp, error: insErr } = await supabase
    .from('weight_billing_exports')
    .insert({
      audit_ids:   auditIds,
      row_count:   rows.length,
      file_name:   fileName,
      file_path:   filePath,
      file_size:   fileSize,
      status:      'exported',
      trigger,
      created_by:  userId || null,
    })
    .select()
    .single();
  if (insErr) throw insErr;

  // Flip the audits to `exported` so the next run picks up only fresh
  // uploads. Chunked in case auditIds is very large.
  const CHUNK = 100;
  for (let i = 0; i < auditIds.length; i += CHUNK) {
    const slice = auditIds.slice(i, i + CHUNK);
    const { error: updErr } = await supabase
      .from('audits')
      .update({ weight_billing_status: 'exported' })
      .in('id', slice);
    if (updErr) throw updErr;
  }

  // Trigger the browser download for the user who clicked the button.
  // Every interactive trigger downloads ('manual' from /weight-billing,
  // 'internal-exports' and 'pull-all' from the pull hub) — the old
  // manual-only guard silently skipped the download for the pull hub.
  // Only headless runs ('cron') stay silent.
  if (trigger !== 'cron' && typeof window !== 'undefined') {
    XLSX.writeFile(rtl(wb), fileName);
  }

  return {
    ok:         true,
    count:      rows.length,
    auditCount: auditIds.length,
    exportId:   exp.id,
    fileName,
    filePath,
  };
}

// Mark a previously-exported batch as fully billed. Audits referenced
// move from `exported` → `billed` so the historical view shows
// progress.
export async function markExportBilled(exportId, userId) {
  const { data: exp, error: e1 } = await supabase
    .from('weight_billing_exports')
    .update({ status: 'billed', billed_at: new Date().toISOString(), billed_by: userId || null })
    .eq('id', exportId)
    .select()
    .single();
  if (e1) throw e1;
  const ids = exp?.audit_ids || [];
  if (ids.length) {
    const { error: e2 } = await supabase
      .from('audits')
      .update({ weight_billing_status: 'billed' })
      .in('id', ids)
      .eq('weight_billing_status', 'exported'); // don't downgrade later states
    if (e2) throw e2;
  }
  return exp;
}

// Void an export: reverts audits back to `pending` so they pick up on
// the next run. Use when the file was thrown away before billing.
export async function voidExport(exportId, reason) {
  const { data: exp, error: e1 } = await supabase
    .from('weight_billing_exports')
    .update({ status: 'voided', voided_at: new Date().toISOString(), void_reason: reason || null })
    .eq('id', exportId)
    .select()
    .single();
  if (e1) throw e1;
  const ids = exp?.audit_ids || [];
  if (ids.length) {
    const { error: e2 } = await supabase
      .from('audits')
      .update({ weight_billing_status: 'pending' })
      .in('id', ids)
      .eq('weight_billing_status', 'exported');
    if (e2) throw e2;
  }
  return exp;
}

// Convenience: download a previously-exported file from storage and
// trigger a browser download. Falls back to the per-export metadata
// if storage didn't have the file.
export async function downloadExport(exportRow) {
  if (!exportRow?.file_path) {
    throw new Error('هذا التصدير لم يُحفظ في المخزن — استخدم زر "سحب جديد" بدلاً منه');
  }
  const { data, error } = await supabase
    .storage
    .from('weight-billing')
    .download(exportRow.file_path);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportRow.file_name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Accounting-cycle history prefers its event record, while the durable file
// metadata lives in weight_billing_exports. Resolve that event back to the
// exact stored batch before downloading; no new export row or status change is
// created by this path.
export async function redownloadWeightExport(record) {
  let exportRow = record;
  if (!exportRow?.file_path) {
    const exportId = record?.result?.exportId || record?.export_id || null;
    let query = supabase.from('weight_billing_exports').select('*');
    if (exportId) query = query.eq('id', exportId);
    else if (record?.file_name) query = query.eq('file_name', record.file_name);
    else throw new Error('تعذر تحديد ملف الأوزان السابق');
    const { data, error } = await query.order('exported_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('لم أجد سجل ملف الأوزان السابق');
    exportRow = data;
  }
  await downloadExport(exportRow);
  return exportRow;
}
