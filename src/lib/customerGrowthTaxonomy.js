// مفردات موحّدة لنتائج تواصل المبيعات والحفاظ على العملاء.
// تبقى القيم الإنجليزية متوافقة مع retargeting_followups.status وcrm_activities.disposition.
export const CUSTOMER_CONTACT_OUTCOMES = Object.freeze({
  new: 'بلا نتيجة بعد',
  contacted: 'تم الرد — السبب لم يُحدّد',
  whatsapp_sent: 'أُرسلت رسالة',
  no_answer: 'لم يرد',
  interested: 'مهتم بالاستمرار',
  needs_followup: 'يحتاج متابعة',
  low_orders: 'لا توجد طلبات / ضعف المبيعات',
  seasonal: 'نشاط موسمي',
  price_issue: 'اعتراض على السعر',
  carrier_issue: 'مشكلة شركة شحن',
  support_issue: 'مشكلة خدمة أو دعم',
  integration_issue: 'مشكلة تقنية أو ربط',
  onboarding_gap: 'يحتاج شرحًا أو تهيئة',
  competitor: 'انتقل إلى منافس',
  finance: 'عائق مالي أو تحصيل',
  closed_business: 'أوقف نشاطه',
  data_issue: 'بيانات التواصل غير صحيحة / متجر مكرر',
  not_interested: 'غير مهتم',
  returned: 'عاد للشحن',
  converted: 'نفّذ أول شحنة',
});

export const CUSTOMER_OUTCOME_GROUPS = Object.freeze([
  {
    label: 'نتيجة التواصل',
    options: ['contacted', 'no_answer', 'interested', 'needs_followup', 'returned', 'converted'],
  },
  {
    label: 'سبب التوقف أو عدم البدء',
    options: [
      'low_orders', 'seasonal', 'price_issue', 'carrier_issue', 'support_issue',
      'integration_issue', 'onboarding_gap', 'competitor', 'finance',
      'closed_business', 'data_issue', 'not_interested',
    ],
  },
]);

export const CUSTOMER_LOSS_REASONS = Object.freeze([
  ['price', 'السعر'],
  ['competitor', 'اختار منافسًا'],
  ['low_orders', 'لا توجد طلبات / ضعف المبيعات'],
  ['seasonal', 'النشاط موسمي'],
  ['carrier_issue', 'مشكلة شركة شحن'],
  ['support_issue', 'مشكلة خدمة أو دعم'],
  ['integration_issue', 'مشكلة تقنية أو ربط'],
  ['onboarding_gap', 'لم تكتمل التهيئة أو التدريب'],
  ['finance_hold', 'عائق مالي أو تحصيل'],
  ['no_need', 'لا توجد حاجة حاليًا'],
  ['no_response', 'تعذّر الوصول بعد المحاولات'],
  ['closed_business', 'توقّف النشاط'],
  ['product_gap', 'الخدمة لا تغطي احتياجه'],
  ['data_issue', 'بيانات غير صحيحة أو سجل مكرر'],
  ['other', 'سبب آخر'],
]);

export function shippingLifecycle({ shipmentCount = 0, lastShipmentAt = null, now = Date.now() } = {}) {
  const count = Number(shipmentCount) || 0;
  if (count <= 0 || !lastShipmentAt) {
    return { key: 'never_shipped', label: 'لم ينفّذ أول شحنة', owner: 'فريق المبيعات', daysSinceLast: null };
  }
  const stamp = Date.parse(lastShipmentAt);
  const daysSinceLast = Number.isFinite(stamp) ? Math.max(0, Math.floor((Number(now) - stamp) / 86_400_000)) : null;
  if (daysSinceLast != null && daysSinceLast > 5) {
    return { key: 'stopped', label: 'اشتغل ثم توقف', owner: 'فريق الحفاظ على العملاء', daysSinceLast };
  }
  return { key: 'active', label: 'نشط خلال 5 أيام', owner: 'فريق الحفاظ على العملاء', daysSinceLast };
}
