// "Pull-to-internal-system" exports.
//
// Two pipelines that mirror the existing weight-billing pattern —
// the operator clicks a single button, gets an Excel of everything
// newly available, and the source rows get marked as "pulled" so the
// next click only includes freshly-added items.
//
//   1) COD received-pending (cod_settlement direction='in') →
//      AWB + amount + carrier sheet. Used to record incoming
//      remittances in the external accounting system.
//
//   2) Approved audits → carrier + AWB sheet. Used to invoice the
//      end customer for shipments that passed the audit.
//
// Public API:
//   loadPendingCodReceipts({ carrierId })  → row count, total, list
//   pullCodReceipts({ userId })            → Excel + marks pulled
//   loadPendingInvoicingAudits()           → audits awaiting export
//   pullCustomerInvoicing({ userId, auditIds })
//                                          → Excel + marks exported

import * as XLSX from 'xlsx';
import { rtl } from './xlsxRtl.js';
import { supabase } from './supabase.js';

const EXPORT_BUCKET = 'internal-exports';

// Supabase Storage rejects non-ASCII object keys (see AGENTS.md §1.7).
// The Arabic display name is kept in the DB row; the storage key is
// sanitized to [A-Za-z0-9._-].
function asciiKey(kind, fileName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = String(fileName).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${kind}/${stamp}_${safe}`;
}

// Build the workbook ONCE, then (1) persist a copy to Storage + log it in
// internal_export_pulls so it's re-downloadable from the site later, and
// (2) trigger the browser download. Storage failure is non-fatal — the
// download still happens, so a missing bucket never blocks the operator.
export async function persistAndDownloadExport({ wb, fileName, kind, rowCount, total = null, userId = null }) {
  const buf = XLSX.write(rtl(wb), { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  try {
    const key = asciiKey(kind, fileName);
    const { error: upErr } = await supabase.storage.from(EXPORT_BUCKET)
      .upload(key, blob, { contentType: blob.type, upsert: false });
    if (upErr) throw upErr;
    await supabase.from('internal_export_pulls').insert({
      kind, file_name: fileName, file_path: key,
      row_count: rowCount, total, pulled_by: userId,
    });
  } catch (e) {
    console.warn('export history save failed (download still proceeds):', e.message);
  }
  if (typeof window !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  }
}

// Unified pull history for the page — merges the new internal_export_pulls
// (COD + invoicing) with the existing weight_billing_exports so all three
// export types show in one "السحبات السابقة" list, newest first.
export async function loadExportHistory({ limit = 60 } = {}) {
  const [pullsRes, weightsRes] = await Promise.all([
    supabase.from('internal_export_pulls')
      .select('id, kind, file_name, file_path, row_count, total, pulled_at')
      .order('pulled_at', { ascending: false }).limit(limit),
    supabase.from('weight_billing_exports')
      .select('id, file_name, file_path, row_count, created_at')
      .order('created_at', { ascending: false }).limit(limit),
  ]);
  const out = [];
  for (const r of (pullsRes.data || [])) {
    out.push({
      id: r.id, kind: r.kind, bucket: EXPORT_BUCKET,
      fileName: r.file_name, filePath: r.file_path,
      rowCount: r.row_count, total: r.total, pulledAt: r.pulled_at,
    });
  }
  for (const r of (weightsRes.data || [])) {
    out.push({
      id: r.id, kind: 'weight', bucket: 'weight-billing',
      fileName: r.file_name, filePath: r.file_path,
      rowCount: r.row_count, total: null, pulledAt: r.created_at,
    });
  }
  out.sort((a, b) => String(b.pulledAt || '').localeCompare(String(a.pulledAt || '')));
  return out.slice(0, limit);
}

// Re-download a past export from Storage. filePath rows whose file_path is
// null (older weight exports saved before storage was wired) can't be
// re-downloaded — the caller should disable the button for those.
export async function downloadExportFile({ bucket, filePath, fileName }) {
  if (!filePath) throw new Error('هذا الملف لم يُحفَظ في التخزين (سحبة قديمة)');
  const { data, error } = await supabase.storage.from(bucket || EXPORT_BUCKET).download(filePath);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = fileName || filePath.split('/').pop();
  document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

const PAGE = 1000;
async function loadAllPaginated(table, columns, filters = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    // STABLE order required — without it Postgres may return overlapping
    // rows across .range() pages once the table exceeds 1000 rows, which
    // double-counts (cod_settlement is well past 1000). 'id' exists on
    // every table this helper is called with (cod_settlement, audit_shipments).
    let q = supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + PAGE - 1);
    for (const [k, v] of Object.entries(filters)) {
      if (v === null) q = q.is(k, null);
      else            q = q.eq(k, v);
    }
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// ── 1) COD received pending pull ──────────────────────────────
// Reads every cod_settlement row that:
//   • direction = 'in'           (received from a carrier)
//   • pulled_at IS NULL          (not exported to internal yet)
// Each row carries the carrier's id; we enrich with the human-readable
// carrier name via the carriers table for the Excel.
// "Pending" now means: still in over_remit status — i.e. the
// carrier remitted this AWB but our system has no matching audit
// (`direction='out'`) yet. The export must keep returning these rows
// every time the operator pulls — once they reconcile the AWB
// against an audit (an 'out' row appears), it naturally drops out
// of the result set on its own.
//
// Previously we gated on pulled_at IS NULL — "once pulled, never
// shown again" — but the operator wanted the opposite: as long as
// the row is sitting in "مُستلَم بانتظار", surface it forever so
// nothing gets accidentally forgotten between pulls.
export async function loadPendingCodReceipts() {
  // Pull every direction='in' row and every direction='out' row's
  // (carrier_id, awb) key. The "in − out" set difference is the
  // over_remit list.
  const [inRows, outKeyRows] = await Promise.all([
    loadAllPaginated(
      'cod_settlement',
      'id, awb, amount, carrier_id, upload_date, source_file, created_at, pulled_at',
      { direction: 'in' },
    ),
    loadAllPaginated('cod_settlement', 'carrier_id, awb', { direction: 'out' }),
  ]);
  const outKeys = new Set(
    outKeyRows.map(r => `${r.carrier_id}__${String(r.awb).trim()}`)
  );
  const overRemit = inRows.filter(r => !outKeys.has(`${r.carrier_id}__${String(r.awb).trim()}`));

  const carrierIds = [...new Set(overRemit.map(r => r.carrier_id).filter(Boolean))];
  let carrierNameById = new Map();
  if (carrierIds.length) {
    const { data: carriers } = await supabase
      .from('carriers')
      .select('id, name')
      .in('id', carrierIds);
    carrierNameById = new Map((carriers || []).map(c => [c.id, c.name]));
  }
  return overRemit.map(r => ({
    id:         r.id,
    awb:        r.awb,
    amount:     Number(r.amount) || 0,
    carrierId:  r.carrier_id,
    carrier:    carrierNameById.get(r.carrier_id) || r.carrier_id || '—',
    settledAt:  r.upload_date || r.created_at,
    sourceFile: r.source_file || null,
    // pulled_at is still recorded as a "last exported" timestamp
    // for the audit trail, but it no longer hides the row.
    lastPulledAt: r.pulled_at || null,
  }));
}

export async function pullCodReceipts({ userId = null } = {}) {
  const pending = await loadPendingCodReceipts();
  if (!pending.length) return { ok: false, reason: 'empty', count: 0 };

  // 1) Build the Excel first — if the file write fails we don't want
  // to mark rows as pulled.
  const headers = ['رقم الشحنة', 'المبلغ (ر.س)', 'شركة الشحن', 'تاريخ التحصيل'];
  const data = pending.map(r => [
    r.awb,
    Number(r.amount || 0).toFixed(2),
    r.carrier,
    r.settledAt ? new Date(r.settledAt).toISOString().slice(0, 10) : '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'تحصيلات مُستلَمة');
  const dateStr = new Date().toISOString().slice(0, 10);
  const codTotal = pending.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  await persistAndDownloadExport({
    wb, fileName: `تحصيلات_جديدة_${dateStr}.xlsx`,
    kind: 'cod', rowCount: pending.length, total: +codTotal.toFixed(2), userId,
  });

  // 2) Mark every pulled id. Chunked to avoid the URL-length cap on
  // bulk .in() updates.
  const now = new Date().toISOString();
  const ids = pending.map(r => r.id);
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('cod_settlement')
      .update({ pulled_at: now, pulled_by: userId })
      .in('id', slice);
    if (error) throw error;
  }
  // Carriers count for the toast
  const carriersCount = new Set(pending.map(r => r.carrierId)).size;
  return { ok: true, count: pending.length, carriers: carriersCount };
}

// ── 2) Customer invoicing pull (audit shipments) ──────────────
// Only APPROVED audits feed the invoicing pipeline. Auto-pull is by
// default — pass auditIds to limit to a specific selection.
export async function loadPendingInvoicingAudits() {
  const { data, error } = await supabase
    .from('audits')
    .select('id, carrier_id, carrier_name, period, file_name, row_count, created_at')
    .eq('review_status', 'approved')
    .eq('customer_invoicing_status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function pullCustomerInvoicing({ userId = null, auditIds = null } = {}) {
  const pending = await loadPendingInvoicingAudits();
  if (!pending.length) return { ok: false, reason: 'empty', count: 0 };

  // Narrow to selection if the operator picked specific audits.
  const targetAudits = Array.isArray(auditIds) && auditIds.length
    ? pending.filter(a => auditIds.includes(a.id))
    : pending;
  if (!targetAudits.length) return { ok: false, reason: 'empty', count: 0 };

  // Load every shipment row for the target audits in one shot.
  const targetIds = targetAudits.map(a => a.id);
  const shipments = await loadAllPaginated(
    'audit_shipments',
    'audit_id, awb',
    {}, // filtered below — Supabase doesn't allow .in() inside the generic helper
  ).catch(async () => {
    // Fallback: hand-roll the .in() lookup since the helper above
    // can't do it.
    const out = [];
    const CHUNK = 200;
    for (let i = 0; i < targetIds.length; i += CHUNK) {
      const slice = targetIds.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('audit_shipments')
        .select('audit_id, awb')
        .in('audit_id', slice);
      if (error) throw error;
      out.push(...(data || []));
    }
    return out;
  });
  // Filter to target audits in case loadAllPaginated returned all rows.
  const targetSet = new Set(targetIds);
  const targetShipments = shipments.filter(s => targetSet.has(s.audit_id));
  const carrierByAuditId = new Map(targetAudits.map(a => [a.id, a.carrier_name || a.carrier_id || '—']));

  // Build the Excel: one row per shipment, columns = carrier + AWB.
  const headers = ['شركة الشحن', 'رقم الشحنة'];
  const data = targetShipments
    .filter(s => s.awb)
    .map(s => [carrierByAuditId.get(s.audit_id) || '—', String(s.awb)]);
  if (!data.length) return { ok: false, reason: 'no_shipments', count: 0 };

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [{ wch: 22 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'فواتير العملاء');
  const dateStr = new Date().toISOString().slice(0, 10);
  await persistAndDownloadExport({
    wb, fileName: `فواتير_عملاء_${dateStr}.xlsx`,
    kind: 'invoicing', rowCount: data.length, userId,
  });

  // Mark each target audit as exported.
  const now = new Date().toISOString();
  const CHUNK = 100;
  for (let i = 0; i < targetIds.length; i += CHUNK) {
    const slice = targetIds.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('audits')
      .update({
        customer_invoicing_status: 'exported',
        customer_invoiced_at:      now,
        customer_invoiced_by:      userId,
      })
      .in('id', slice);
    if (error) throw error;
  }

  return {
    ok: true,
    count: data.length,
    auditCount: targetAudits.length,
    carriers: new Set(targetAudits.map(a => a.carrier_id)).size,
  };
}
