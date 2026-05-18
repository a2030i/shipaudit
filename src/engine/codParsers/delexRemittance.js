import { makeRemittanceParser } from './genericRemittance.js';

// ديلكس Delex — COD remittance parser.
//
// File format (per "كشف تحصيلات لمحه الاسبوع الثاني من مايو.xlsx"):
//   Row 0  : blank
//   Row 1  : title + total ("تحصيلات الأسبوع X · 9,788.05")
//   Row 2  : HEADER — Barcode, Package Source, Sender Business Name,
//            ..., Payment Type, COD Collection Method,
//            Collection Amount, Original COD, Quantity, ...
//   Row 3+ : data rows, AWB pattern: 'DLX' + 12 digits, Prepaid rows
//            have Collection Amount=0 and are dropped by the
//            genericRemittance "amount === 0" filter.
//
// IMPORTANT: 'Barcode' + 'Collection Amount' are SPECIFIC to Delex.
// Don't add these keys to the DeliverNow parser — DeliverNow uses
// 'Awb No' / 'COD Amount' for its DNL-prefixed invoices.
export const delexRemittanceParser = makeRemittanceParser({
  id:    'delex',
  label: 'ديلكس Delex',
  awbKeys: [
    'barcode',
    'awb', 'awb no', 'tracking', 'tracking no', 'waybill', 'order id',
    'رقم الشحنة', 'رقم البوليصة', 'رقم الطلب',
  ],
  amtKeys: [
    // Prefer the actual cash field; gross COD as fallback.
    'collection amount', 'collected amount',
    'original cod', 'cod amount',
    'net amount',
    'المبلغ', 'قيمة التحصيل', 'المبلغ المحصّل',
    'المحصل', 'الصافي',
  ],
});
