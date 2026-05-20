import { makeRemittanceParser } from './genericRemittance.js';

// ويبك Webek — COD parser for the "audit + COD" combined file Webek
// emails (same flow as DeliverNow: one workbook, one row per shipment,
// columns for delivery cost / excess weight / POS fees / collection
// amount). Header verified against the Lamha.xlsx sample (May 2026).
//
// Header columns we care about:
//   • رقم الامر          → AWB
//   • مبلغ التحصيل       → COD amount (0 for delivery-only orders)
//   • قيمة التوصيل       → audit-side delivery cost (engine reads this)
//   • نوع التحصيل        → "توصيل وتحصيل" vs "توصيل"
//
// Note the spelling: Webek writes "رقم الامر" (without alef) instead
// of the more common "رقم الطلب". Both are kept as keys so older
// exports keep parsing.
export const webekRemittanceParser = makeRemittanceParser({
  id:    'webek',
  label: 'ويبك Webek',
  awbKeys: [
    'رقم الامر', 'رقم الأمر',
    'رقم الطلب', 'رقم الشحنة', 'رقم البوليصة',
    'awb', 'awb no', 'tracking', 'tracking no', 'waybill', 'order no', 'order id',
  ],
  amtKeys: [
    'مبلغ التحصيل',
    'قيمة التحصيل', 'المبلغ المحصّل', 'المحصل', 'الصافي',
    'cod amount', 'collected amount', 'collection amount',
    'net amount',
    // Intentionally NO bare 'المبلغ' — Webek's file has both
    // "مبلغ التحصيل" (what we want) and the "POS رسوم" + "قيمة
    // التوصيل" cost columns; the more specific "مبلغ التحصيل"
    // key wins on the first matching column.
  ],
});
