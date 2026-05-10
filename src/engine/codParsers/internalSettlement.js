// Parser for the user's internal-system COD settlement export.
// Universal across all carriers — the file shape never changes regardless
// of which carrier the rows refer to.
//
// Expected header keywords (Arabic, exact strings the export currently uses):
//   "رقم الشحنة"      → AWB
//   "إجمالي الاستحقاق" → amount we paid the merchant
//
// The header row is auto-detected — we look for a row containing both
// keywords so we tolerate a few decorative rows above the table.

const AWB_HEADER_KEYS    = ['رقم الشحنة', 'awb', 'tracking'];
const AMOUNT_HEADER_KEYS = ['إجمالي الاستحقاق', 'الإجمالي', 'cod', 'amount'];

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const lower = row.map(c => String(c ?? '').toLowerCase().trim());
    const hasAwb    = lower.some(c => AWB_HEADER_KEYS.some(k => c.includes(k.toLowerCase())));
    const hasAmount = lower.some(c => AMOUNT_HEADER_KEYS.some(k => c.includes(k.toLowerCase())));
    if (hasAwb && hasAmount) return i;
  }
  return -1;
}

function findColumn(headerRow, keys) {
  const lower = headerRow.map(c => String(c ?? '').toLowerCase().trim());
  for (const k of keys) {
    const idx = lower.findIndex(c => c.includes(k.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

export const internalSettlementParser = {
  id:    'internal',
  label: 'تسوية صادرة (نظامنا)',
  parse(allRows) {
    const headerIdx = findHeaderRow(allRows);
    if (headerIdx < 0) {
      throw new Error(
        'تعذّر إيجاد رؤوس الأعمدة — تأكد أن الملف يحوي عمودي ' +
        '"رقم الشحنة" و"إجمالي الاستحقاق".',
      );
    }
    const header = allRows[headerIdx];
    // Prefer "إجمالي الاستحقاق" (final remit-to-merchant amount) over the
    // ambiguous "الإجمالي" / "المبلغ" since those can mean either order
    // total or shipping fees in different exports.
    const awbCol    = findColumn(header, AWB_HEADER_KEYS);
    const amountCol = findColumn(header, AMOUNT_HEADER_KEYS);
    if (awbCol < 0 || amountCol < 0) {
      throw new Error('عمود AWB أو عمود المبلغ غير موجود في الملف.');
    }
    const out = [];
    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row) continue;
      const awb = String(row[awbCol] ?? '').trim();
      if (!awb) continue;
      const amount = parseFloat(row[amountCol]);
      if (!Number.isFinite(amount) || amount === 0) continue;
      out.push({ awb, amount: +amount.toFixed(2) });
    }
    return out;
  },
};
