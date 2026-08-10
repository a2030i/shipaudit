export const TAHSEEL_PORTAL_URL = 'https://lamha.thseel.com/login';

// This is the exact name to approve in Hatif/Meta, then register in ShipAudit.
// Registering it in ShipAudit never creates or modifies anything in Tahseel.
export const TAHSEEL_PORTAL_TEMPLATE_NAME = 'tahseel_portal_balance_v2';

export const TAHSEEL_PORTAL_TEMPLATE_MAP = Object.freeze([
  Object.freeze({ src: 'field:name', text: '' }),
  Object.freeze({ src: 'field:full_amount', text: '' }),
  Object.freeze({ src: 'field:count', text: '' }),
  Object.freeze({ src: 'field:filtered_overdue_amount', text: '' }),
  Object.freeze({ src: 'field:aging_filter', text: '' }),
]);

export const TAHSEEL_PORTAL_TEMPLATE_BODY = `مرحبًا {{1}}،

إجمالي المبلغ المستحق على حسابكم لدى لمحة وقت إرسال هذه الرسالة: {{2}} ر.س، موزع على {{3}} فاتورة غير مسددة.

المبلغ المشمول في حملة التحصيل الحالية: {{4}} ر.س — مدة التأخير: {{5}}.

للاطلاع على الفواتير والسداد عبر البوابة الموحدة:
${TAHSEEL_PORTAL_URL}

طريقة الدخول: أدخل رقم الجوال المسجل، وسيصل رمز التحقق إلى بريدك الإلكتروني المسجل.

إذا تعذر الدخول، يرجى التواصل معنا لتحديث رقم الجوال أو البريد الإلكتروني.`;

const formatAmount = (value) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function renderTahseelPortalTemplate({
  name,
  fullAmount,
  invoiceCount,
  filteredOverdueAmount = fullAmount,
  agingFilter = 'كامل الرصيد المستحق',
}) {
  return TAHSEEL_PORTAL_TEMPLATE_BODY
    .replace('{{1}}', String(name || 'عميل لمحة'))
    .replace('{{2}}', formatAmount(fullAmount))
    .replace('{{3}}', String(Number(invoiceCount || 0)))
    .replace('{{4}}', formatAmount(filteredOverdueAmount))
    .replace('{{5}}', String(agingFilter));
}

const AGING_LABELS = Object.freeze({
  b0_15: 'من 0 إلى 15 يوم',
  b16_30: 'من 16 إلى 30 يوم',
  b1: 'من 31 إلى 60 يوم',
  b2: 'من 61 إلى 90 يوم',
  b3: 'أكثر من 90 يوم',
});

const SUFFIX_DESCRIPTIONS = Object.freeze([
  { keys: ['b16_30', 'b1', 'b2', 'b3'], label: 'أكثر من 15 يوم' },
  { keys: ['b1', 'b2', 'b3'], label: 'أكثر من 30 يوم' },
  { keys: ['b2', 'b3'], label: 'أكثر من 60 يوم' },
  { keys: ['b3'], label: 'أكثر من 90 يوم' },
]);

export function describeCollectionAgingFilter(selectedKeys = []) {
  const selected = new Set(selectedKeys);
  if (!selected.size) return 'كامل الرصيد المستحق';

  const exactSuffix = SUFFIX_DESCRIPTIONS.find(({ keys }) => (
    keys.length === selected.size && keys.every(key => selected.has(key))
  ));
  if (exactSuffix) return exactSuffix.label;

  return Object.keys(AGING_LABELS)
    .filter(key => selected.has(key))
    .map(key => AGING_LABELS[key])
    .join('، ');
}
