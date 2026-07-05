// zoho-authurl — يبني رابط موافقة Zoho بالصلاحيات الموسّعة (قراءة كاملة +
// invoices.UPDATE فقط للكتابة، لا CREATE/DELETE) ليمنح المدير صلاحية «تطبيق
// الرصيد الدائن» بنقرة داخل النظام. الاستبدال يُتمّه zoho-sync (exchange_web
// force) عبر /zoho-callback. لا يمسّ التطبيق الداخلي القديم. admin فقط.

import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://shipaudit-five.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// الصلاحيات الموسّعة: قراءة كاملة + كتابة محدودة على الوحدات غير الحسّاسة.
// **صفر DELETE · صفر banking · صفر settings.UPDATE.**
// تطبيق الرصيد: الدفعة الزائدة = PUT customerpayments (UPDATE)؛ والإشعار الدائن
// = POST /creditnotes/{id}/invoices الذي يعتبره زوهو CREATE فيحتاج
// **creditnotes.CREATE** (بدونها «not authorized» — مُثبَت على Tine 2026-07-06).
// creditnotes.CREATE تسمح تقنياً بإنشاء إشعارات، لكن الكود يطبّق فقط ولا يُنشئ
// مستنداً أبداً (لا استدعاء POST /creditnotes). قرار المستخدم صراحةً: المصدر
// (إشعار/دفعة) يجب ألّا يفرّق في التسديد.
const SCOPE = [
  'ZohoBooks.invoices.READ', 'ZohoBooks.invoices.UPDATE',
  'ZohoBooks.creditnotes.READ', 'ZohoBooks.creditnotes.UPDATE', 'ZohoBooks.creditnotes.CREATE',
  'ZohoBooks.customerpayments.READ', 'ZohoBooks.customerpayments.UPDATE',
  'ZohoBooks.contacts.READ', 'ZohoBooks.contacts.UPDATE',
  'ZohoBooks.expenses.READ', 'ZohoBooks.bills.READ',
  'ZohoBooks.vendorpayments.READ', 'ZohoBooks.accountants.READ',
  'ZohoBooks.settings.READ', 'ZohoBooks.reports.READ',
].join(',');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // مصادقة داخلية: admin فقط (نفس نمط zoho-sync).
  const authHeader = req.headers.get('Authorization') || '';
  const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: prof } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (prof?.role !== 'admin') return json({ error: 'forbidden — للمدير فقط' }, 403);

  const id = Deno.env.get('ZOHO_CLIENT_ID');
  if (!id) return json({ error: 'missing_client_id' }, 400);
  const { data: za } = await db.from('zoho_auth').select('accounts_domain').eq('id', 1).maybeSingle();
  const acc = za?.accounts_domain || 'accounts.zoho.com';
  const url = `https://${acc}/oauth/v2/auth?response_type=code&client_id=${encodeURIComponent(id)}`
    + `&scope=${encodeURIComponent(SCOPE)}&redirect_uri=${encodeURIComponent(`${APP_ORIGIN}/zoho-callback`)}`
    + `&access_type=offline&prompt=consent`;
  return json({ ok: true, url });
});
