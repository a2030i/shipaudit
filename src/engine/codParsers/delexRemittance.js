import { makeRemittanceParser } from './genericRemittance.js';

// ديلكس Delex — COD remittance parser.
export const delexRemittanceParser = makeRemittanceParser({
  id:    'delex',
  label: 'ديلكس Delex',
  awbKeys: [
    'awb', 'awb no', 'tracking', 'tracking no', 'waybill', 'order id',
    'رقم الشحنة', 'رقم البوليصة', 'رقم الطلب',
  ],
  amtKeys: [
    'cod amount', 'collected amount', 'collection amount', 'collected amount', 
    'net amount',  'المبلغ', 'قيمة التحصيل', 'المبلغ المحصّل',
    'المحصل', 'الصافي',
  ],
});
