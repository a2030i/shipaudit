export const TAHSEEL_PORTAL_URL = 'https://lamha.thseel.com/login';

// This is the exact name to approve in Hatif/Meta, then register in ShipAudit.
// Registering it in ShipAudit never creates or modifies anything in Tahseel.
export const TAHSEEL_PORTAL_TEMPLATE_NAME = 'tahseel_portal_balance';

export const TAHSEEL_PORTAL_TEMPLATE_MAP = Object.freeze([
  Object.freeze({ src: 'field:name', text: '' }),
  Object.freeze({ src: 'field:full_amount', text: '' }),
  Object.freeze({ src: 'field:count', text: '' }),
]);

export const TAHSEEL_PORTAL_TEMPLATE_BODY = `مرحبًا {{1}}،

إجمالي المبلغ المستحق على حسابكم لدى لمحة وقت إرسال هذه الرسالة: {{2}} ر.س، موزع على {{3}} فاتورة غير مسددة.

للاطلاع على الفواتير والسداد عبر البوابة الموحدة:
${TAHSEEL_PORTAL_URL}

طريقة الدخول: أدخل رقم الجوال المسجل، وسيصل رمز التحقق إلى بريدك الإلكتروني المسجل.

إذا تعذر الدخول، يرجى التواصل معنا لتحديث رقم الجوال أو البريد الإلكتروني.`;

const formatAmount = (value) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function renderTahseelPortalTemplate({ name, fullAmount, invoiceCount }) {
  return TAHSEEL_PORTAL_TEMPLATE_BODY
    .replace('{{1}}', String(name || 'عميل لمحة'))
    .replace('{{2}}', formatAmount(fullAmount))
    .replace('{{3}}', String(Number(invoiceCount || 0)));
}
