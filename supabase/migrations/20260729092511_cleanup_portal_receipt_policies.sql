-- تنظيف ما فات ترحيل الحذف (مراجعة خارجية — محقّة):
-- المهاجرة السابقة حذفت سياسات **بأسماء خمّنتُها** (`payment_receipts_*`)
-- بينما الأسماء الفعلية «Team read payment receipts» و«Upload payment
-- receipts». و`drop policy if exists` لا يفشل على اسم غير موجود،
-- **فمرّ الترحيل بنجاح كاذب** والسياستان باقيتان.
--
-- **الدرس: لا تحذف كائناً باسم مفترَض — اقرأ `pg_policies` أولاً.**
-- `if exists` يخفي الخطأ بدل أن يكشفه، فهو مفيد للتكرار وخطر على التحقّق.
--
-- الحاوية نفسها (`payment-receipts`، **صفر ملف**) لا تُحذف من SQL:
-- `storage.protect_delete()` يحرس `storage.buckets` أيضاً لا `objects` فقط
-- (تصحيح لما ظننتُه في §1.51) — تُحذف من لوحة Supabase أو عبر Storage API.
drop policy if exists "Team read payment receipts" on storage.objects;
drop policy if exists "Upload payment receipts"    on storage.objects;
