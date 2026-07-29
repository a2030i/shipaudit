-- إلغاء بوابة التاجر للدفع بالكامل — قرار المستخدم (2026-07-29):
-- «ماعاد احتاجها، حتى ميسر ماعاد نحتاجها». التحصيل يتم عبر حملات واتساب
-- والتحويل البنكي المباشر، فالبوابة والدفع الإلكتروني زائدان.
--
-- ما يُحذف (كله بلا بيانات إنتاج — مُتحقَّق قبل الحذف):
--   · payment_requests = **0 صف** (التدفّق لم يُستخدَم قط)
--   · portal_access_tokens = 5 · portal_access_log = 36 → **صفوف اختباري اليوم فقط**
--   · portal_otp = 0 · حاوية payment-receipts = **0 ملف**
--
-- ⚠️ **ما لا يُمَسّ**: `payments` و`payment_allocations` — دفعات الناقلين
-- وهي عصب المحاسبة، ولا علاقة لها بالبوابة رغم تشابه الاسم.

drop function if exists public.portal_lookup(text);
drop function if exists public.get_payment_config();
drop function if exists public.attach_moyasar_payment(uuid, text, numeric);
drop function if exists public.attach_moyasar_payment(uuid, text);
drop function if exists public.portal_issue_token(text,text,text,int,uuid);
drop function if exists public.portal_redeem_token(text,text,text,int);
drop function if exists public.portal_data_for_customer(text);

drop table if exists public.portal_access_log    cascade;
drop table if exists public.portal_otp           cascade;
drop table if exists public.portal_access_tokens cascade;
drop table if exists public.payment_requests     cascade;

-- مفتاح ميسر من الإعدادات
delete from public.app_settings where key ilike '%moyasar%' or key ilike '%payment_config%';

-- سياسات حاوية الإيصالات (الحاوية نفسها تُحذف من لوحة Supabase — حذف
-- storage.objects من SQL يرفضه حارس المنصّة، فخّ §1.51)
drop policy if exists "payment_receipts_insert_auth" on storage.objects;
drop policy if exists "payment_receipts_read_auth"   on storage.objects;
drop policy if exists "payment_receipts_anon_upload" on storage.objects;
