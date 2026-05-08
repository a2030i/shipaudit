import * as XLSX from 'xlsx';

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
