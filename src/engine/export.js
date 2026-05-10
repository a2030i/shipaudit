import * as XLSX from 'xlsx';
import { getActiveContract } from '../data/carriers.js';

/**
 * Export AWB + total weight only — for hand-off to the external pricing
 * system. Two columns, nothing else.
 */
export function exportWeightsForExternalSystem(results, carrierName, period) {
  if (!results?.length) return false;
  const wb = XLSX.utils.book_new();
  const headers = ['رقم الشحنة', 'الوزن الإجمالي'];
  const rows = results
    .filter(r => r.awb && (r.weight ?? 0) > 0)
    .map(r => [r.awb, +Number(r.weight).toFixed(3)]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'AWB + الوزن');

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `أوزان_${carrierName}_${period}_${dateStr}.xlsx`);
  return true;
}

// Returns the standard-weight allowance for a destination from the
// contract — i.e. the upTo of the first bracket. Above this weight the
// merchant should be billed for excess. Works with both formats:
//   • Tiered array:  [{ upTo: 10, price: 13 }, ...]
//   • Lookup table:  { mode: 'lookup', brackets: [{ upTo: 0.5, ... }] }
function standardWeightForDest(contract, dest) {
  const def = contract?.pricing?.[dest];
  if (!def) return null;
  if (Array.isArray(def)) return def[0]?.upTo ?? null;
  if (def.mode === 'lookup' && Array.isArray(def.brackets)) {
    const sorted = [...def.brackets].sort(
      (a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity),
    );
    return sorted[0]?.upTo ?? null;
  }
  // Multi-service nested ({ Road: [...], Air: [...] }) — pick the first.
  if (typeof def === 'object') {
    const firstKey = Object.keys(def).find(k => Array.isArray(def[k]));
    if (firstKey) return def[firstKey][0]?.upTo ?? null;
  }
  return null;
}

/**
 * Export ONLY shipments whose chargeable weight exceeds the contract's
 * standard allowance for that destination — used to bill merchants for
 * excess weight in the user's external billing system.
 *
 * Threshold is derived per-destination from the contract:
 *   • Saudi domestic (Aramex):     10 kg
 *   • International (Aramex):      0.5 kg (smallest bracket)
 *   • SMSA UAE/KW/BH:              1.0 kg
 *   • SMSA QA/OM:                  0.5 kg
 *
 * Two columns only — AWB + chargeable weight — because the user's
 * downstream system computes the billing math itself. Chargeable (not
 * actual) weight is what Aramex bills on, so it's what the merchant
 * needs to be billed on.
 *
 * Returns:
 *   { ok: true,  count }                — file written
 *   { ok: false, reason: 'empty' }      — no shipments exceeded
 *   { ok: false, reason: 'no_contract'} — contract missing
 */
export function exportExcessWeights(results, contract, carrierName, period) {
  if (!results?.length) return { ok: false, reason: 'empty' };
  if (!contract)        return { ok: false, reason: 'no_contract' };

  const excess = [];
  for (const r of results) {
    if (!r.awb || !(r.weight > 0)) continue;
    const threshold = standardWeightForDest(contract, r.dest);
    if (threshold == null) continue;        // unknown route — skip silently
    if (r.weight > threshold) {
      excess.push([r.awb, +Number(r.weight).toFixed(3)]);
    }
  }
  if (!excess.length) return { ok: false, reason: 'empty' };

  const wb = XLSX.utils.book_new();
  const headers = ['رقم الشحنة', 'الوزن الإجمالي'];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...excess]);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'أوزان إضافية');

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `أوزان_إضافية_${carrierName}_${period}_${dateStr}.xlsx`);
  return { ok: true, count: excess.length };
}

/**
 * Combine excess-weight rows across MANY audits into a single Excel.
 * Each audit may belong to a different carrier and a different period —
 * we resolve the active contract per-audit so the threshold is correct.
 *
 * Inputs:
 *   audits[]   — array of full audit objects (id, carrierId, period,
 *                results[]). Each must include .results.
 *   carriers[] — array of carrier objects so we can look up contracts.
 *
 * Behavior:
 *   • Skips COD rows (isCod) — those are flat-fee, not weight-billed.
 *   • Skips rows whose destination has no contract entry.
 *   • Dedups by AWB across all selected audits — same shipment in two
 *     audits would be a data issue, so we keep the FIRST (earliest by
 *     audit createdAt order) occurrence and ignore subsequent.
 *   • Returns { ok, count, skipped, sources } so the caller can toast a
 *     useful breakdown.
 */
export function exportMergedExcessWeights(audits, carriers) {
  if (!Array.isArray(audits) || !audits.length) {
    return { ok: false, reason: 'empty_selection' };
  }
  if (!Array.isArray(carriers) || !carriers.length) {
    return { ok: false, reason: 'no_carriers' };
  }

  const carrierById = new Map(carriers.map(c => [c.id, c]));
  // Sort audits oldest-first so dedup keeps the earliest occurrence.
  const ordered = [...audits].sort((a, b) =>
    String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || '')),
  );

  const seen = new Set();   // dedup by AWB
  const rows = [];          // [awb, weight] pairs for the file
  const sources = new Set(); // for the toast — which audits contributed

  let skippedNoContract = 0;
  let skippedCod        = 0;

  for (const audit of ordered) {
    const carrier = carrierById.get(audit.carrierId);
    if (!carrier) { skippedNoContract += (audit.results?.length || 0); continue; }
    // Period = "YYYY-MM"; for getActiveContract we need a date — use the
    // first day of the period so we hit the contract that was active then.
    const periodKey = audit.period
      ? `${String(audit.period).slice(0, 7)}-01`
      : (audit.date || new Date().toISOString().slice(0, 10));
    const contract = getActiveContract(carrier, periodKey);
    if (!contract) { skippedNoContract += (audit.results?.length || 0); continue; }

    let contributedRows = 0;
    for (const r of audit.results ?? []) {
      if (!r?.awb || !(r.weight > 0)) continue;
      if (r.isCod) { skippedCod++; continue; }   // COD is flat-fee, not weight
      const threshold = standardWeightForDest(contract, r.dest);
      if (threshold == null) continue;
      if (r.weight <= threshold) continue;
      const awb = String(r.awb).trim();
      if (seen.has(awb)) continue;               // dedup across audits
      seen.add(awb);
      rows.push([awb, +Number(r.weight).toFixed(3)]);
      contributedRows++;
    }
    if (contributedRows > 0) sources.add(audit.id);
  }

  if (!rows.length) {
    return { ok: false, reason: 'empty', skippedCod, skippedNoContract };
  }

  const wb = XLSX.utils.book_new();
  const headers = ['رقم الشحنة', 'الوزن الإجمالي'];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'أوزان إضافية مجمعة');

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `أوزان_إضافية_مجمعة_${audits.length}مراجعة_${dateStr}.xlsx`);
  return {
    ok: true,
    count: rows.length,
    auditCount: sources.size,
    selectedCount: audits.length,
    skippedCod,
    skippedNoContract,
  };
}

export function exportAuditExcel(results, summary, carrierName, period, contractLabel) {
  const mis = results.filter(r => r.status === 'mismatch');
  if (!mis.length) return false;

  const wb = XLSX.utils.book_new();
  const today = new Date().toLocaleDateString('ar-SA');

  // ── Sheet 1: تفاصيل الفروق ─────────────────────────────────────────────────
  const headers = [
    'رقم الشحنة (AWB)',
    'تاريخ الشحن',
    'الدولة',
    'الوزن (كغ)',
    'رسوم الشحن المفوترة',
    'رسوم الشحن المتوقعة (العقد)',
    'فرق الشحن',
    'RSS المفوتر',
    'RSS المتوقع (العقد)',
    'فرق RSS',
    'رسوم الوقود المفوترة',
    'رسوم الوقود المتوقعة (العقد)',
    'فرق الوقود',
    'الإجمالي المفوتر',
    'الإجمالي المتوقع (العقد)',
    'إجمالي الفرق (ر.س)',
    'البنود المختلفة',
  ];

  const rows = mis.map(r => [
    r.awb,
    r.shipDate,
    r.dest,
    r.weight,
    r.invoiced.delivery,
    +r.expected.delivery.toFixed(2),
    r.diffs.delivery,
    r.invoiced.rss,
    +r.expected.rss.toFixed(2),
    r.diffs.rss,
    r.invoiced.fuel,
    +r.expected.fuel.toFixed(2),
    r.diffs.fuel,
    +r.invoiced.total.toFixed(2),
    +r.expected.total.toFixed(2),
    r.diffs.total,
    r.issues.map(i => i.label).join(' | '),
  ]);

  const totalRow = [
    'الإجمالي', '', '', '',
    mis.reduce((s,r)=>s+r.invoiced.delivery,0).toFixed(2),
    mis.reduce((s,r)=>s+r.expected.delivery,0).toFixed(2),
    summary.deliveryDiff.toFixed(2),
    mis.reduce((s,r)=>s+r.invoiced.rss,0).toFixed(2),
    mis.reduce((s,r)=>s+r.expected.rss,0).toFixed(2),
    summary.rssDiff.toFixed(2),
    mis.reduce((s,r)=>s+r.invoiced.fuel,0).toFixed(2),
    mis.reduce((s,r)=>s+r.expected.fuel,0).toFixed(2),
    summary.fuelDiff.toFixed(2),
    mis.reduce((s,r)=>s+r.invoiced.total,0).toFixed(2),
    mis.reduce((s,r)=>s+r.expected.total,0).toFixed(2),
    summary.totalDiff.toFixed(2),
    `${mis.length} شحنة بها فروق`,
  ];

  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows, [], totalRow]);
  ws1['!cols'] = [
    {wch:24},{wch:13},{wch:24},{wch:10},
    {wch:22},{wch:24},{wch:12},
    {wch:16},{wch:20},{wch:12},
    {wch:22},{wch:24},{wch:12},
    {wch:18},{wch:22},{wch:18},
    {wch:40},
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'تفاصيل الفروق');

  // ── Sheet 2: ملخص تنفيذي ──────────────────────────────────────────────────
  const summarySheet = [
    [`تقرير مراجعة فواتير الشحن — ${carrierName}`],
    [`الفترة: ${period}   |   العقد: ${contractLabel}   |   تاريخ التقرير: ${today}`],
    [],
    ['البيان', 'القيمة'],
    ['إجمالي الشحنات المراجعة', summary.total],
    ['مطابقة للعقد ✓', summary.ok],
    ['بها فروق ✗', summary.mismatch],
    ['غير معروفة', summary.unknown],
    [],
    ['فروق رسوم الشحن (ر.س)', +summary.deliveryDiff.toFixed(2)],
    ['فروق RSS (ر.س)',         +summary.rssDiff.toFixed(2)],
    ['فروق رسوم الوقود (ر.س)', +summary.fuelDiff.toFixed(2)],
    ['────────────────────', '──────────'],
    ['إجمالي الفرق الكلي (ر.س)', +summary.totalDiff.toFixed(2)],
    [],
    ['الفروق حسب الدولة', ''],
    ...Object.entries(summary.byCountry).map(([c,v]) => [c, +v.diff.toFixed(2)]),
    [],
    ['ملاحظة', 'الأسعار المتوقعة محسوبة بناءً على العقد الموقع مع الشركة'],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(summarySheet);
  ws2['!cols'] = [{wch:40},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws2, 'ملخص تنفيذي');

  // ── Sheet 3: الشحنات المطابقة ─────────────────────────────────────────────
  const okRows = results.filter(r => r.status === 'ok');
  if (okRows.length) {
    const okData = [
      ['AWB', 'التاريخ', 'الدولة', 'الوزن', 'الإجمالي المفوتر'],
      ...okRows.map(r => [r.awb, r.shipDate, r.dest, r.weight, r.invoiced?.total?.toFixed(2)]),
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(okData);
    ws3['!cols'] = [{wch:24},{wch:13},{wch:24},{wch:10},{wch:18}];
    XLSX.utils.book_append_sheet(wb, ws3, 'مطابقة ✓');
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `فروق_${carrierName}_${period}_${dateStr}.xlsx`);
  return true;
}
