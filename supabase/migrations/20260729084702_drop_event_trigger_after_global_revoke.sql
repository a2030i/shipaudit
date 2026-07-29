-- بعد إثبات أن السحب العالمي يكفي (اختبار بدالة تحقّق **والحارس معطَّل**:
-- `anon=false` وبلا `=X` في الـACL)، يُحذف الحارس. مبرّرات الحذف — كلها
-- صحيحة من المراجعة الخارجية:
--   · `WHEN OTHERS THEN NULL` يبتلع فشل السحب فيمضي الترحيل بصمت — وهو
--     نقيض وصفه بـ«الضمان القاطع».
--   · الاستثناء كان **بالاسم** لا بالتوقيع، فأي overload بنفس الاسم يُستثنى.
--   · لا يستبعد أوامر الامتدادات (`in_extension`) فقد يتداخل مع تحديثاتها.
--   · مشغّل DDL على مستوى القاعدة كلها = سطح تداخل غير ضروري مع مهاجرات
--     Supabase مستقبلاً.
-- الدرس: عندما يخالف السلوك التوقّع، **اقرأ الدلالة الموثّقة** قبل بناء
-- طبقة تحايل عليها.
drop event trigger if exists trg_lock_new_function_acl;
drop function if exists public.lock_new_function_acl();

-- تثبيت الاستثناءين العامّين صراحةً (بوابة العميل تعمل بلا تسجيل دخول)
grant execute on function public.portal_lookup(text)   to anon;
grant execute on function public.get_payment_config()  to anon;
