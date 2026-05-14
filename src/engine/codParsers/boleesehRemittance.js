import { makeRemittanceParser } from './genericRemittance.js';

// بوليصة Boleeseh — COD remittance parser.
export const boleesehRemittanceParser = makeRemittanceParser({
  id:    'boleeseh',
  label: 'بوليصة Boleeseh',
  awbKeys: [
    'awb', 'awb no', 'tracking', 'tracking no', 'waybill', 'order no',
    'shipment no', 'policy no',
    'رقم الشحنة', 'رقم البوليصة', 'رقم الطلب', 'بوليصة',
  ],
  amtKeys: [
    'cod amount', 'collected amount', 'collection amount', 'collected amount', 
    'net amount',  'paid amount',
    'المبلغ', 'قيمة التحصيل', 'المبلغ المحصّل', 'المحصل', 'الصافي',
  ],
});
