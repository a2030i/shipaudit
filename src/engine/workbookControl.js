// Independent workbook totals used to prove that audited detail rows reconcile
// to the carrier's own invoice summary. Supports both a dedicated summary sheet
// (J&T) and a summary footer below the detail table (DeliverNow).

export function parseWorkbookNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  const parenthesized = /\([^)]*\d[^)]*\)/.test(raw);
  const cleaned = raw
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/,/g, '')
    .replace(/[^0-9.+-]/g, '');
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return null;
  return parenthesized ? -Math.abs(number) : number;
}

const absoluteAmount = value => {
  const number = parseWorkbookNumber(value);
  return number == null ? null : Math.abs(number);
};

export function extractWorkbookControl(candidates, detailSheetName) {
  const ordered = [...(candidates || [])].sort((a, b) => {
    const summaryDelta = Number(b.isSummary) - Number(a.isSummary);
    if (summaryDelta) return summaryDelta;
    return Number(a.name === detailSheetName) - Number(b.name === detailSheetName);
  });

  for (const sheet of ordered) {
    const rows = sheet.rows || [];
    for (let i = 0; i < Math.min(rows.length - 1, 25); i++) {
      const headers = (rows[i] || []).map(v => String(v ?? '').trim().toLowerCase());
      const values = rows[i + 1] || [];
      const find = re => {
        const index = headers.findIndex(header => re.test(header));
        return index >= 0 ? values[index] : null;
      };
      const totalBilled = absoluteAmount(find(/sum of total charge|^total charges?$|pre.?tax total|net charge/));
      const totalTax = absoluteAmount(find(/sum of vat amount|total vat|total tax/));
      const totalGross = absoluteAmount(find(/sum of receivable amount|receivable amount|gross amount|including (vat|tax)/));
      if (totalBilled == null && totalTax == null && totalGross == null) continue;
      return {
        sheetName: sheet.name,
        range: String(find(/billing time range|billing range|invoice period|^period$/) ?? '').trim(),
        shipmentCount: absoluteAmount(find(/total shipments|shipment count|number of shipments/)),
        totalBilled,
        totalTax,
        totalGross,
      };
    }

    // Vertical invoice summaries can sit below hundreds of detail rows. Only
    // exact accounting labels are accepted here so a shipment row cannot be
    // mistaken for the whole invoice.
    const verticalValue = re => {
      for (const row of rows) {
        for (let i = 0; i < (row || []).length; i++) {
          if (!re.test(String(row[i] ?? '').trim().toLowerCase())) continue;
          for (let j = i + 1; j < row.length; j++) {
            const number = absoluteAmount(row[j]);
            if (number != null) return number;
          }
        }
      }
      return null;
    };
    const totalBilled = verticalValue(/^(?:(?:sum of )?total charges?|pre.?tax total|net charge|total invoice before vat)\b/i);
    const totalTax = verticalValue(/^(?:(?:sum of )?(?:vat|tax) amount|total (?:vat|tax))\b/i);
    const totalGross = verticalValue(/^(?:(?:sum of )?receivable amount|gross amount|amount including (?:vat|tax)|total invoice after vat)\b/i);
    const shipmentCount = verticalValue(/^(?:total shipments|shipment count|number of shipments)\b/i);
    if (totalBilled != null || totalTax != null || totalGross != null) {
      return { sheetName: sheet.name, range: '', shipmentCount, totalBilled, totalTax, totalGross };
    }
  }
  return null;
}
