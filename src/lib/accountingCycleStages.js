// تعريف خفيف لمراحل الدورة تستخدمه واجهة التنقل والخدمة معًا.
// يبقى منفصلًا عن قارئات Excel حتى لا تحمل الجانبية حزمة المحاسبة الثقيلة.
export const ACCOUNTING_CYCLE_STAGES = [
  { id: 'carrier_audits', label: 'مراجعة فواتير شركات الشحن', permission: 'audits.create' },
  { id: 'weight_export', label: 'تصدير أوزان الفوترة إلى لمحة', permission: 'internal_exports.pull' },
  { id: 'lamha_shipments', label: 'أرقام الشحنات واستيراد ملف لمحة', permission: 'uploads.upload_file' },
  { id: 'lamha_sources', label: 'تحديث كشف الحساب ودليل المتاجر', permission: 'uploads.upload_file' },
  { id: 'carrier_collections', label: 'رفع تحصيلات شركات الشحن', permission: 'cod.upload_in' },
  { id: 'lamha_collections', label: 'رفع تحصيل لمحة', permission: 'cod.upload_out' },
  { id: 'period_close', label: 'مراجعة وإقفال الشهر', permission: 'system.period_close' },
];
