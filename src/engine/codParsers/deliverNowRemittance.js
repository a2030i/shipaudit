// Parser for DeliverNow's COD remittance files. DeliverNow ships TWO
// formats depending on the report type:
//
// 1) "Draft Invoice / الفاتورة المبدئية" (monthly billing, AWB=DNL...)
//    • Row 0:  title 'Draft Invoice - الفاتورة المبدئية'
//    • Row 1:  bilingual account/customer info blob
//    • Row 2:  blank
//    • Row 3:  HEADER — Awb No / COD Amount + other columns
//    • Last rows: VAT / totals (no AWB)
//
// 2) "كشف تحصيلات لمحه" (weekly cash-collection report, AWB=DLX...)
//    • Row 0:  blank
//    • Row 1:  title + total ("تحصيلات الأسبوع X · 9,788.05")
//    • Row 2:  HEADER — Barcode, Package Source, Sender Business Name,
//              ..., Payment Type, COD Collection Method,
//              Collection Amount, Original COD, ...
//    • Rows 3..N: data — one shipment per row, Prepaid rows have
//              Collection Amount=0 and get skipped.
//
// Both produce the same output: [{ awb, amount }] with amount > 0.
// CC/Delivered / Prepaid rows are filtered because they don't represent
// cash the carrier actually collected on our behalf.

const AWB_HEADER_KEYS = [
  'awb no', 'awb number', 'barcode', 'tracking',
  'رقم البوليصة', 'رقم الشحنة',
];
const AMT_HEADER_KEYS = [
  // Variants ordered by specificity — first match wins.
  'collection amount',    // weekly DLX format (net the carrier paid us)
  'cod amount',           // monthly DNL invoice format
  'original cod',
  'قيمة التحصيل', 'المبلغ المحصّل', 'الصافي',
];

function cellHas(cell, keys) {
  const s = String(cell ?? '').toLowerCase();
  return keys.some(k => s.includes(k.toLowerCase()));
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const hasAwb = row.some(c => cellHas(c, AWB_HEADER_KEYS));
    const hasAmt = row.some(c => cellHas(c, AMT_HEADER_KEYS));
    if (hasAwb && hasAmt) return i;
  }
  return -1;
}

function findColumn(headerRow, keys) {
  return headerRow.findIndex(c => cellHas(c, keys));
}

export const deliverNowRemittanceParser = {
  id:    'delivernow',
  label: 'ديلفر ناو DeliverNow',
  parse(allRows) {
    if (!allRows?.length) throw new Error('الملف فارغ');
    const headerIdx = findHeaderRow(allRows);
    if (headerIdx < 0) {
      throw new Error(
        'الملف لا يطابق صيغة DeliverNow — يلزم وجود عمود AWB ' +
        '("Awb No" أو "Barcode") + عمود مبلغ ("COD Amount" أو ' +
        '"Collection Amount").',
      );
    }
    const header  = allRows[headerIdx];
    const awbCol  = findColumn(header, AWB_HEADER_KEYS);
    const amtCol  = findColumn(header, AMT_HEADER_KEYS);
    if (awbCol < 0 || amtCol < 0) {
      throw new Error('عمود AWB أو COD Amount غير موجود');
    }

    const out = [];
    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row) continue;
      const awb = String(row[awbCol] ?? '').trim();
      if (!awb) continue;
      // Skip the totals/VAT rows at the bottom — their first column
      // carries Arabic/English labels like "Total Invoice", not a
      // tracking number. DeliverNow AWBs are alphanum (DNL...), so
      // require at least one 4+ digit run.
      if (!/\d{4,}/.test(awb)) continue;
      const amount = parseFloat(row[amtCol]);
      // CC/Delivered (prepaid) rows have COD Amount = 0 — skip.
      if (!Number.isFinite(amount) || amount <= 0) continue;
      out.push({ awb, amount: +amount.toFixed(2) });
    }
    return out;
  },
};
