import { makeRemittanceParser } from './genericRemittance.js';

// SMSA's "COD Collection Report" workbook. Structure (verified
// against Four Tech Information Technology Co.(SA21601).xlsx):
//   • Multiple sheets, one per remittance batch (COD90837, COD89251…)
//   • Rows 0–9: metadata (Supplier Number, Account No, Period,
//     Payment Reference, Currency, …)
//   • Row 10: header — Sr.No, AWB Number, City, Destination Country,
//             Ship Date, Order Number, Ship Weight, POD Date, POD Name,
//             COD Reference, Period, Currency, COD Amount, Conversion
//             Rate, COD Amount - Payment, Net Due Amount
//   • Rows 11..N: data
//
// We read "AWB Number" + "COD Amount" (gross, before SMSA deducts
// the per-shipment service fee — the fee is reconciled separately on
// the AP side as part of the shipment-audit codFee). UploadModal's
// per-sheet loop handles the multi-sheet workbook.
//
// Note: amtKeys uses /^cod amount$/-style exact phrasing first so
// it picks "COD Amount" rather than "COD Amount - Payment" (which
// would be net after SMSA's fee deduction).
export const smsaRemittanceParser = makeRemittanceParser({
  id:    'smsa',
  label: 'سمسا SMSA',
  awbKeys: [
    'awb number', 'awb no', 'awb',
    'tracking number', 'tracking no', 'tracking', 'waybill',
    'رقم الشحنة', 'رقم البوليصة', 'رقم الشحن',
  ],
  amtKeys: [
    // Use ONLY specific phrases. The SMSA sheet has a "COD Reference"
    // column (the batch ID like "COD90837") that would steal the
    // amount slot if we kept a bare 'cod' fallback — findColumn
    // returns the first column matching ANY key, and "COD Reference"
    // appears before "COD Amount" in the header row.
    'cod amount',
    'collected amount', 'collection amount',
    'paid amount', 'net amount',
    'المبلغ المحصّل', 'قيمة التحصيل', 'المبلغ',
  ],
});
