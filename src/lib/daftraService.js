import { supabase } from './supabase.js';

async function edgeErrorMessage(error, fallback) {
  let payload = null;
  try { payload = await error?.context?.clone?.().json(); } catch { /* non-JSON */ }
  const code = String(payload?.error || error?.message || fallback);
  const messages = {
    daftra_not_configured: 'بيانات اتصال دفتره غير مكتملة في أسرار Supabase.',
    daftra_access_denied: 'رفض دفتره المفتاح. تأكد أن API Key صالح وله صلاحية عرض العملاء.',
    invalid_daftra_base_url: 'رابط دفتره غير صحيح. استخدم نطاق حسابك على daftra.com.',
    invalid_daftra_api_path: 'رابط دفتره يجب أن ينتهي بـ /api2.',
    daftra_invalid_response: 'أعاد دفتره استجابة غير متوقعة عند قراءة العملاء.',
    daftra_journal_accounts_invalid_response: 'أعاد دفتره استجابة غير متوقعة عند قراءة حسابات العملاء.',
    daftra_journal_accounts_http_403: 'مفتاح دفتره لا يملك صلاحية قراءة دليل الحسابات.',
    daftra_period_snapshot_not_found: 'لا توجد لقطة معتمدة لتقرير أرصدة دفتره في الفترة المحددة.',
    invalid_period: 'فترة تقرير دفتره غير صحيحة.',
    forbidden: 'تحتاج صلاحية عرض المطابقة للوصول إلى أرصدة دفتره.',
  };
  return messages[code] || code;
}

export async function loadDaftraClosingBalances({
  periodStart = '2026-01-01',
  periodEnd = '2026-01-31',
} = {}) {
  const { data, error } = await supabase.functions.invoke('daftra-opening-balances', {
    body: {
      action: 'list_period_closing_balances',
      period_start: periodStart,
      period_end: periodEnd,
    },
  });
  if (error) throw new Error(await edgeErrorMessage(error, 'تعذر الاتصال بدفتره'));
  if (!data?.ok) throw new Error(await edgeErrorMessage({ message: data?.error }, 'تعذر الاتصال بدفتره'));
  return data;
}
