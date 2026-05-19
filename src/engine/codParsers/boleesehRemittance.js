import { makeRemittanceParser } from './genericRemittance.js';

// بوليصة Boleeseh — COD remittance parser.
//
// File format (per the user's "withdrawal_awbs-*.xlsx"):
//   Header row: المعرف · وقت/تاريخ الإصدار · رقم الطلب · شركة الشحن ·
//               رقم التتبع · البوليصة · المبلغ المحصل · رسوم التحصيل ·
//               المستحق
//   Data rows : one shipment per row, AWB prefix varies by sub-carrier
//               (JTE... for J&T, etc).
//
// IMPORTANT: the file has BOTH "رقم الطلب" (merchant order id) and
// "رقم التتبع" (the actual AWB the carrier uses to reconcile). The
// generic factory's findColumn returns the FIRST column matching any
// key — if "رقم الطلب" were in awbKeys it would win (column C beats
// column E) and we'd extract useless order ids. We deliberately keep
// "رقم الطلب" / "order no" OUT of awbKeys.
export const boleesehRemittanceParser = makeRemittanceParser({
  id:    'boleeseh',
  label: 'بوليصة Boleeseh',
  awbKeys: [
    'رقم التتبع', 'تتبع',
    'tracking no', 'tracking', 'awb no', 'awb', 'waybill',
    'shipment no', 'policy no',
    'رقم الشحنة', 'رقم البوليصة',
  ],
  amtKeys: [
    // Prefer the net merchant-due amount; fall back to gross collected.
    'المستحق', 'الصافي', 'net amount', 'paid amount',
    'المبلغ المحصل', 'المبلغ المحصّل', 'المحصل',
    'collected amount', 'collection amount', 'cod amount',
    'قيمة التحصيل', 'المبلغ',
  ],
  errorHint:
    'الملف لا يطابق صيغة تحصيل بوليصة — يلزم وجود عمود "رقم التتبع" + ' +
    'عمود مبلغ ("المبلغ المحصل" أو "المستحق").',
});
