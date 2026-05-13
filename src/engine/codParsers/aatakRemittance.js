import { makeRemittanceParser } from './genericRemittance.js';

// اطاق Aatak — COD remittance parser. Awaiting a real sample to
// tighten column names; for now we accept the common synonyms every
// KSA delivery service tends to use.
export const aatakRemittanceParser = makeRemittanceParser({
  id:    'aatak',
  label: 'اطاق Aatak',
  awbKeys: [
    'awb', 'awb no', 'tracking', 'tracking no', 'waybill', 'order no',
    'رقم الشحنة', 'رقم البوليصة', 'رقم الطلب', 'رقم الشحن',
  ],
  amtKeys: [
    'cod amount', 'collected amount', 'collection amount', 'amount',
    'net amount', 'cod', 'المبلغ', 'قيمة التحصيل', 'المبلغ المحصّل',
    'المحصل', 'الصافي',
  ],
});
