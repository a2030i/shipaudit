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
import { supabase } from './supabase.js';

const PAGE = 1000;
async function loadAllPaginated(table, columns, filters = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    let q = supabase.from(table).select(columns).range(from, from + PAGE - 1);
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
// Schema note: cod_settlement actually has `amount` / `upload_date` /
// `source_file` (not the amount_actual/amount_expected/settled_at/
// settlement_source names this helper used to ask for). The mismatched
// column list made the query 42703-fail silently in the caller's catch,
// so the operator saw "لا توجد تحصيلات جديدة" even when 22 rows were
// sitting in the "over_remit" bucket on /cod-settlements waiting.
export async function loadPendingCodReceipts() {
  const rows = await loadAllPaginated(
    'cod_settlement',
    'id, awb, amount, carrier_id, upload_date, source_file, created_at',
    { direction: 'in', pulled_at: null },
  );
  const carrierIds = [...new Set(rows.map(r => r.carrier_id).filter(Boolean))];
  let carrierNameById = new Map();
  if (carrierIds.length) {
    const { data: carriers } = await supabase
      .from('carriers')
      .select('id, name')
      .in('id', carrierIds);
    carrierNameById = new Map((carriers || []).map(c => [c.id, c.name]));
  }
  return rows.map(r => ({
    id:         r.id,
    awb:        r.awb,
    amount:     Number(r.amount) || 0,
    carrierId:  r.carrier_id,
    carrier:    carrierNameById.get(r.carrier_id) || r.carrier_id || '—',
    settledAt:  r.upload_date || r.created_at,
    sourceFile: r.source_file || null,
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
  XLSX.writeFile(wb, `تحصيلات_جديدة_${dateStr}.xlsx`);

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
  XLSX.writeFile(wb, `فواتير_عملاء_${dateStr}.xlsx`);

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
