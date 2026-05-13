import { makeRemittanceParser } from './genericRemittance.js';

// ويبك Webek — COD remittance parser.
export const webekRemittanceParser = makeRemittanceParser({
  id:    'webek',
  label: 'ويبك Webek',
  awbKeys: [
    'awb', 'awb no', 'tracking', 'tracking no', 'waybill', 'order no',
    'رقم الشحنة', 'رقم البوليصة', 'رقم الطلب',
  ],
  amtKeys: [
    'cod amount', 'collected amount', 'collection amount', 'amount',
    'net amount', 'cod', 'المبلغ', 'قيمة التحصيل', 'المبلغ المحصّل',
    'المحصل', 'الصافي',
  ],
});
