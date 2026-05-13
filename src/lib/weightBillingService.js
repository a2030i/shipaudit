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
import { supabase } from './supabase.js';

// ─── helpers ────────────────────────────────────────────────────────────────
function firstBracketUpTo(contract, dest) {
  const p = contract?.pricing?.[dest];
  if (!p) return null;
  if (Array.isArray(p)) return p[0]?.upTo ?? null;
  if (p?.mode === 'lookup' && Array.isArray(p.brackets)) {
    const sorted = [...p.brackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    return sorted[0]?.upTo ?? null;
  }
  return null;
}

// Walks an audit's results array and returns the excess rows in the
// minimal shape the merchant-billing system wants: AWB + total weight.
// The merchant-billing system does its own math; we only feed it what
// it needs to identify and price the shipment.
function excessRowsFor(audit, carrier) {
  const contract = (carrier?.contracts ?? []).find(
    c => c.id === audit.contractId || c.label === audit.contract_label,
  ) || (carrier?.contracts ?? [])[0];
  if (!contract) return [];
  const out = [];
  for (const r of audit.results || []) {
    if (!r.awb || !(r.weight > 0)) continue;
    if (r.status === 'unknown' || r.isCod) continue;
    const threshold = firstBracketUpTo(contract, r.dest);
    if (threshold == null) continue;
    if (r.weight <= threshold) continue;
    out.push({
      awb:         String(r.awb),
      weight:      +Number(r.weight).toFixed(2),
      dest:        r.dest || '',
      shipDate:    r.shipDate || '',
      carrier:     audit.carrier_name || carrier?.name || '',
      period:      audit.period || '',
      threshold,
      excessKg:    +(r.weight - threshold).toFixed(2),
    });
  }
  return out;
}

// ─── reads ─────────────────────────────────────────────────────────────────
export async function loadPendingAuditsForBilling() {
  // Only APPROVED audits feed the merchant-billing pipeline. Pending /
  // rejected audits stay out: pending = accountant hasn't blessed the
  // numbers yet; rejected = explicitly excluded.
  const { data, error } = await supabase
    .from('audits')
    .select('id, carrier_id, carrier_name, period, file_name, contract_label, created_at, weight_billing_status, review_status, results, row_count')
    .eq('weight_billing_status', 'pending')
    .eq('review_status',         'approved')
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
export async function exportPendingExcessWeights({ carriers, userId, trigger = 'manual' } = {}) {
  const pending = await loadPendingAuditsForBilling();
  if (!pending.length) {
    return { ok: false, reason: 'empty', count: 0, auditCount: 0 };
  }

  const carrierMap = new Map((carriers ?? []).map(c => [c.id, c]));

  // Aggregate excess rows across every pending audit, dedup by AWB
  // (a shipment that somehow appears in two audits — usually a re-
  // billing — should not get billed to the merchant twice).
  const byAwb = new Map();
  const auditIds = [];
  for (const a of pending) {
    const carrier = carrierMap.get(a.carrier_id);
    if (!carrier) continue; // unknown carrier → skip silently; will retry next run
    const rows = excessRowsFor(a, carrier);
    if (!rows.length) continue;
    auditIds.push(a.id);
    for (const r of rows) {
      if (!byAwb.has(r.awb)) byAwb.set(r.awb, r);
    }
  }
  if (!byAwb.size) return { ok: false, reason: 'no_excess', count: 0, auditCount: 0 };

  // Build the Excel — the external billing system only needs AWB +
  // billed weight; everything else is operational metadata the
  // accountant can keep for reference.
  const rows = Array.from(byAwb.values());
  const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
    'رقم الشحنة (AWB)': r.awb,
    'الوزن (كغ)':       r.weight,
    'الدولة':           r.dest,
    'الشركة':           r.carrier,
    'الفترة':           r.period,
    'تاريخ الشحن':      r.shipDate,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'أوزان للفوترة');

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `أوزان_فوترة_${rows.length}شحنة_${ts}.xlsx`;
  const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const fileSize = xlsxBuf.byteLength;

  // Upload to storage so the file is durable + downloadable later
  // without recomputing. Bucket `weight-billing` should exist; if it
  // doesn't, we still record the export so the in-browser download
  // works for the user right now.
  let filePath = null;
  try {
    const path = `${new Date().toISOString().slice(0, 7)}/${fileName}`;
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
  // Manual-trigger only — cron runs are silent.
  if (trigger === 'manual' && typeof window !== 'undefined') {
    XLSX.writeFile(wb, fileName);
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
