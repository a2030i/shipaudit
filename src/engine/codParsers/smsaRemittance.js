import { makeRemittanceParser } from './genericRemittance.js';

// SMSA's COD remittance Excel uses bilingual column headers.
// Common variants we've seen / expect:
//   AWB / Awb No / Tracking Number / رقم البوليصة / رقم الشحنة
//   COD Amount / Collected Amount / Collection Amount /
//   المبلغ / المبلغ المحصّل / قيمة التحصيل
// We don't have a confirmed sample yet — once one lands, tighten
// these keys if SMSA uses something more specific.
export const smsaRemittanceParser = makeRemittanceParser({
  id:    'smsa',
  label: 'سمسا SMSA',
  awbKeys: [
    'awb', 'awb no', 'awb number', 'tracking', 'tracking no', 'waybill',
    'رقم الشحنة', 'رقم البوليصة', 'رقم الشحن',
  ],
  amtKeys: [
    'cod amount', 'collected amount', 'collection amount', 'amount',
    'cod', 'المبلغ', 'قيمة التحصيل', 'المبلغ المحصّل', 'المحصل',
  ],
});
