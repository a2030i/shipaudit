// Operating policy approved on 2026-08-19:
// carrier work is invoice-audit only. COD remains a historical wind-down
// ledger: operators may record cash received against existing balances, but
// new audits/schedules must not create new COD obligations.
export const CARRIER_INVOICE_ONLY_SINCE = '2026-08-19';
export const COD_ZERO_TOLERANCE = 0.01;

export function carrierHasOutstandingLegacyCod(value) {
  return Math.abs(Number(value) || 0) > COD_ZERO_TOLERANCE;
}

export function carrierRequiredScheduleKinds() {
  return ['invoice'];
}

export function carrierCollectionRequirement() {
  return {
    status: 'not_required',
    requiresManualUpload: false,
    note: `توقف إنشاء تحصيل COD جديد منذ ${CARRIER_INVOICE_ONLY_SINCE}؛ تظهر الأرصدة التاريخية المتبقية في مسار التصفية فقط`,
  };
}
