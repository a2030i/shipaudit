// Parser for DeliverNow's COD remittance file. Format spotted from the
// user's real export ("ف 2769 - فورتيك.xls"):
//   • Row 0: title "Draft Invoice - الفاتورة المبدئية"
//   • Row 1: bilingual account/customer info blob
//   • Row 2: blank
//   • Row 3: HEADER — Awb No / COD Amount + other columns
//   • Rows 4..N: data — one shipment per row
//   • Last rows: VAT / totals (no AWB)
//
// We extract only the rows that actually represent COD cash the carrier
// collected on our behalf — i.e. rows with a numeric COD Amount > 0.
// CC/Delivered rows (prepaid) get filtered out because they don't
// reconcile against a settlement we paid the merchant for.

const AWB_HEADER_KEYS = ['awb no', 'awb number', 'رقم البوليصة'];
const AMT_HEADER_KEYS = ['cod amount', 'قيمة التحصيل'];

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
        'الملف لا يطابق صيغة DeliverNow — تأكد أن فيه عمودَي ' +
        '"Awb No / رقم البوليصة" و "COD Amount / قيمة التحصيل".',
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
