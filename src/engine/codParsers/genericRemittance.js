// Generic COD remittance parser factory.
//
// Each carrier we onboard for COD reconciliation has its own Excel
// schema, but they all converge on the same shape: one row per
// shipment with an AWB column and a "collected amount" column. The
// rest is decoration (status, dates, customer name, totals at the
// bottom).
//
// Rather than write five near-identical parsers, this factory builds
// one given the AWB / amount column synonyms a carrier uses. Add a
// new carrier by exporting from your file:
//
//   makeRemittanceParser({
//     id:      'aatak',
//     label:   'اطاق Aatak',
//     awbKeys: ['awb', 'tracking', 'رقم الشحنة'],
//     amtKeys: ['amount', 'collected', 'المبلغ المحصّل'],
//   })
//
// Auto-detect rules — flexible enough to absorb header-row drift:
//   • Walks first 20 rows to find the header (any row that contains
//     both an awbKey and an amtKey).
//   • Filters out totals/VAT rows (no 4+ digit run in the AWB cell).
//   • Drops rows with amount = 0 (CC/prepaid shipments that don't
//     reconcile against any settlement we paid the merchant).

function cellContains(cell, keys) {
  const s = String(cell ?? '').toLowerCase();
  return keys.some(k => s.includes(k.toLowerCase()));
}

function findHeaderRow(rows, awbKeys, amtKeys) {
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const hasAwb = row.some(c => cellContains(c, awbKeys));
    const hasAmt = row.some(c => cellContains(c, amtKeys));
    if (hasAwb && hasAmt) return i;
  }
  return -1;
}

function findColumn(headerRow, keys) {
  return headerRow.findIndex(c => cellContains(c, keys));
}

export function makeRemittanceParser({ id, label, awbKeys, amtKeys, errorHint }) {
  return {
    id,
    label,
    parse(allRows) {
      if (!allRows?.length) throw new Error('الملف فارغ');
      const headerIdx = findHeaderRow(allRows, awbKeys, amtKeys);
      if (headerIdx < 0) {
        throw new Error(
          errorHint ||
          `الملف لا يطابق صيغة ${label} — تأكد أنه يحتوي على عمود رقم الشحنة وعمود المبلغ المحصّل.`,
        );
      }
      const header = allRows[headerIdx];
      const awbCol = findColumn(header, awbKeys);
      const amtCol = findColumn(header, amtKeys);
      if (awbCol < 0 || amtCol < 0) {
        throw new Error('عمود AWB أو المبلغ غير موجود');
      }

      const out = [];
      for (let i = headerIdx + 1; i < allRows.length; i++) {
        const row = allRows[i];
        if (!row) continue;
        const awb = String(row[awbCol] ?? '').trim();
        if (!awb) continue;
        // Skip totals / VAT lines: their first column carries Arabic
        // or English labels like "Total Invoice" not a tracking
        // number. Real AWBs from every carrier we support contain at
        // least one 4+ digit run.
        if (!/\d{4,}/.test(awb)) continue;
        const amount = parseFloat(row[amtCol]);
        // CC/prepaid rows have amount = 0 — drop. Negative amounts
        // would be refunds; let them through so the user can see them.
        if (!Number.isFinite(amount) || amount === 0) continue;
        out.push({ awb, amount: +amount.toFixed(2) });
      }
      return out;
    },
  };
}
