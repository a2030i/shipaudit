-- إغلاق سبب المشكلة من الجذر (مراجعة خارجية — محقّة):
-- سحب الصلاحية من دالة واحدة يعالج العَرَض. الجذر أن `pg_default_acl`
-- يمنح `anon` تنفيذ **كل دالة جديدة** في `public`، فكل RPC أكتبه غداً
-- يولد مكشوفاً ما لم أتذكّر السحب يدوياً — وهو ما نسيتُه فعلاً.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- ─────────────────────────────────────────────────────────────────
-- تدقيق الـ55 دالة المتاحة لـanon (بالقياس الحيّ لا بالافتراض):
--   · ~30 منها دوال امتداد pg_trgm (gtrgm_*/gin_*/similarity*/word_*)
--     — تبقى: الفهارس والمعاملات تحتاجها.
--   · اختبار `set role anon` أثبت أن **RLS صامد**: كل دوال البيانات
--     أعادت **صفر صف** للزائر المجهول (leads/campaigns/profiles/vat).
--   · لكن الدفاع بالعمق يقتضي ألّا يصل الزائر أصلاً — خصوصاً
--     `assistant_readonly_sql` (منفّذ SQL حرّ: يكشف وجود الجداول
--     ويسمح بالتحسّس، وأي جدول بسياسة متساهلة يتسرّب فوراً).
-- ─────────────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      -- الاستثناءان العامّان **بقصد موثّق** (بوابة العميل بلا تسجيل دخول):
      --   portal_lookup      → التاجر يستعلم عن رصيده برقم جواله
      --   get_payment_config → مفاتيح الدفع العامة لصفحة السداد
      and p.proname not in ('portal_lookup', 'get_payment_config')
      -- دوال الامتداد تبقى (تُملَك من غير postgres أو تخدم المعاملات)
      and p.proname !~ '^(gtrgm_|gin_(extract|trgm)|similarity|word_similarity|strict_word_similarity|show_trgm|show_limit|set_limit)'
  loop
    execute format('revoke execute on function %s from anon', f.sig);
  end loop;
end $$;
