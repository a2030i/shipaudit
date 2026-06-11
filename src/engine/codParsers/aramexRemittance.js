// Parser for the Aramex COD remittance file (per-customer Excel they
// email/portal-deliver). Header row 0, fixed Latin column names.
//
// Required:
//   AWB             → tracking number (we treat it as a string — Excel
//                     sometimes loads big numerics as Numbers, so coerce)
//   CollectedAmount → amount Aramex actually remitted to us
//
// We deliberately use CollectedAmount (not CODValue / DueAmount), because
// CollectedAmount is what physically arrived in our account. CODValue is
// the original order amount; DueAmount is the carrier-side ledger figure;
// only Collected* matches a bank credit.

export const aramexRemittanceParser = {
  // MUST equal the carriers-table id (c_1777506662790), NOT a slug. The COD
  // page uses this id for every cod_settlement query/insert; the old slug
  // 'aramex' split Aramex's data across two ids (unified 2026-06-09).
  id:    'c_1777506662790',
  label: 'أرامكس',
  parse(allRows) {
    if (!allRows?.length) throw new Error('الملف فارغ');
    const header = allRows[0]?.map(c => String(c ?? '').trim()) ?? [];
    const awbCol       = header.findIndex(c => /^awb$/i.test(c));
    const collectedCol = header.findIndex(c => /^collectedamount$/i.test(c));
    if (awbCol < 0 || collectedCol < 0) {
      throw new Error(
        'الملف لا يطابق صيغة أرامكس — لازم يحتوي عمودَي ' +
        '"AWB" و"CollectedAmount".',
      );
    }
    const out = [];
    for (let i = 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row) continue;
      const awb = String(row[awbCol] ?? '').trim();
      if (!awb) continue;
      // Aramex sometimes blanks out non-numeric tracking-like cells (e.g.
      // "TAX Rounding Diff" lines on the shipping invoice). Drop them.
      if (!/\d{4,}/.test(awb)) continue;
      const amount = parseFloat(row[collectedCol]);
      if (!Number.isFinite(amount) || amount === 0) continue;
      out.push({ awb, amount: +amount.toFixed(2) });
    }
    return out;
  },
};
