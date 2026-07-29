-- إتمام التدقيق: المهاجرة السابقة سحبت من `anon` فقط فلم تُغلق إلا 3 دوال.
-- السبب مقيس من `proacl`: الدوال **الأقدم** تحمل منحاً صريحاً لـ**PUBLIC**
-- (يظهر كـ`=X/postgres` — المستفيد الفارغ يعني PUBLIC) وanon يرثه، بينما
-- الدوال المُنشأة بعد ضبط الـdefault ACL تحمل `anon=X` مباشرة.
--
-- فمصدرا الوصول **مختلفان حسب عمر الدالة**، والسحب الصحيح من **الاثنين معاً**
-- — وهي القاعدة نفسها التي كتبتُها ثم أخطأتُ في تطبيقها.
do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and p.proowner::regrole::text = 'postgres'
      -- استثناءان عامّان بقصد موثّق (بوابة العميل بلا تسجيل دخول)
      and p.proname not in ('portal_lookup', 'get_payment_config')
      -- دوال امتداد pg_trgm تبقى (الفهارس والمعاملات تحتاجها)
      and p.proname !~ '^(gtrgm_|gin_(extract|trgm)|similarity|word_similarity|strict_word_similarity|show_trgm|show_limit|set_limit)'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    n := n + 1;
  end loop;
  raise notice 'revoked anon+public execute on % functions', n;
end $$;
