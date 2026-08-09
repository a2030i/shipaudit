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
    forbidden: 'تحتاج صلاحية عرض المطابقة للوصول إلى أرصدة دفتره.',
  };
  return messages[code] || code;
}

export async function loadDaftraOpeningBalances() {
  const { data, error } = await supabase.functions.invoke('daftra-opening-balances', {
    body: { action: 'list_opening_balances' },
  });
  if (error) throw new Error(await edgeErrorMessage(error, 'تعذر الاتصال بدفتره'));
  if (!data?.ok) throw new Error(await edgeErrorMessage({ message: data?.error }, 'تعذر الاتصال بدفتره'));
  return data;
}
