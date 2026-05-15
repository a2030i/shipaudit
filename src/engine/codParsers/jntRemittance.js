import { makeRemittanceParser } from './genericRemittance.js';

// جي اند تي J&T Express — COD remittance parser.
//
// Sample file shape (per WestBr...For Tech.xlsx, dated 2026-05-10):
//   Row 0  : ['Date:', '2026-05-10', '', 'COD Client Receipt Statement', ...]
//   Row 1  : ['COD: ', '1 May to 7 May', ...]
//   Row 2  : ['Doc #:', 'WestBr202605100020', ...]
//   Row 3  : Header — 'No.', 'Client order No', 'Tracking No.',
//            'Client name', 'Origin Station', 'COD Amount',
//            'Less POS Charges', 'Transaction Fees', 'COD Service Fees',
//            'Link Service Fees', 'Total Service Fees',
//            'Actual COD Received', 'Origin District',
//            'Destination District', 'Entry Time', 'Signing Time',
//            'Signing Status', 'Notes'
//   Row 4+ : Data — AWB pattern: 'JTE' + 12 digits
//
// We anchor on 'Actual COD Received' (the NET amount J&T transferred to
// us, post-fees) — that's what hits our bank, and that's what the
// reconciliation should compare against our internal-system 'out' batch.
// 'COD Amount' (gross) is kept as a secondary key only in case the
// remittance template ever drops the 'Actual' column.
export const jntRemittanceParser = makeRemittanceParser({
  id:    'jnt',
  label: 'جي اند تي J&T Express',
  awbKeys: [
    'tracking no', 'tracking', 'awb', 'waybill',
    'رقم الشحنة', 'رقم البوليصة',
  ],
  amtKeys: [
    // Prefer NET first — J&T's 'Actual COD Received' is the post-fee
    // figure that matches the bank transfer.
    'actual cod received', 'actual cod', 'cod received',
    'net cod', 'net amount',
    'cod amount',     // gross fallback
    'collected amount', 'collection amount',
    'المبلغ المحصّل', 'الصافي', 'قيمة التحصيل', 'المبلغ',
  ],
  errorHint:
    'الملف لا يطابق صيغة كشف تحصيل J&T — تأكد أن أول صفوف الملف فيها ' +
    '"COD Client Receipt Statement" + عمود "Tracking No." + عمود "Actual COD Received".',
});
