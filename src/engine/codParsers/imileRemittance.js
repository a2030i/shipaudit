import { makeRemittanceParser } from './genericRemittance.js';

// iMile's COD remittance export. Format (verified against the file
// the operator shared as "ايمايل.xlsx"):
//
//   • Single sheet ("Worksheet"), header in row 0.
//   • 12 columns:
//       رقم الطلب · رقم الشحنة · تاريخ الطلب · اسم المتجر ·
//       طريقة الدفع · المبلغ · رسوم الشحن · الوزن الزائد ·
//       رسوم الدفع عند الاستلام · ضريبة رسوم الشحن ·
//       الإجمالي · إجمالي الاستحقاق
//
// AWB = "رقم الشحنة" (long numeric, e.g. 6051826825075).
// Amount = "إجمالي الاستحقاق" — what iMile owes the merchant after
// deductions. Used INSTEAD of "المبلغ" (raw COD collected) so the
// reconciliation matches the net we expect to receive.
//
// Picking the right column: the file has THREE columns whose
// headers contain "مبلغ" or "إجمالي" — المبلغ (gross COD), الإجمالي
// (iMile's per-shipment cost), and إجمالي الاستحقاق (the net).
// The generic findColumn returns the first column to match ANY key,
// so amtKeys is limited to the EXACT phrase "إجمالي الاستحقاق" plus
// English fallbacks. We deliberately don't list 'المبلغ' or
// 'إجمالي' here — the former would steal column F (gross), the
// latter would steal column K (iMile's cost).
export const imileRemittanceParser = makeRemittanceParser({
  id:    'imile',
  label: 'آي مايل iMile',
  awbKeys: [
    'رقم الشحنة',
    'رقم البوليصة',
    'tracking number', 'tracking no', 'tracking',
    'awb number', 'awb no', 'awb',
    'waybill',
  ],
  amtKeys: [
    'إجمالي الاستحقاق',         // iMile's "net due to merchant" — primary
    'net due amount', 'net due',
    'collected amount', 'collection amount',
    'cod amount',
  ],
  errorHint:
    'الملف لا يطابق صيغة iMile — تأكد أن فيه عمود «رقم الشحنة» وعمود «إجمالي الاستحقاق».',
});
