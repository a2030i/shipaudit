-- الجذر — الحلّ الحاسم بعد فشل مسارين:
--   (١) `ALTER DEFAULT PRIVILEGES … REVOKE FROM anon` → أزال منح anon الصريح
--       لكن عاد منح **PUBLIC** المدمج، وanon يرثه.
--   (٢) إضافة `REVOKE FROM public` للامتيازات الافتراضية → السجلّ في
--       `pg_default_acl` صار `{postgres,authenticated,service_role}` بلا PUBLIC،
--       **ومع ذلك** الدالة الجديدة تولد بـ`=X` (مُختبَر بدالة تحقّق مرّتين).
--
-- فبدل الاعتماد على دلالات دقيقة تفشل صامتة، **event trigger** يسحب الصلاحية
-- عند كل إنشاء دالة — ضمان قاطع يُثبِته الاختبار، وأي RPC جديد يولد مقفلاً
-- بلا اعتماد على ذاكرة المطوّر.
create or replace function public.lock_new_function_acl()
 returns event_trigger language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
declare o record;
begin
  for o in select * from pg_event_trigger_ddl_commands()
           where command_tag in ('CREATE FUNCTION','ALTER FUNCTION') and schema_name = 'public'
  loop
    begin
      -- الاستثناءان العامّان بقصد موثّق: بوابة العميل تعمل بلا تسجيل دخول
      if (select proname from pg_proc where oid = o.objid)
         in ('portal_lookup','get_payment_config') then
        continue;
      end if;
      execute format('revoke execute on function %s from public, anon', o.object_identity);
    exception when others then
      null;   -- لا نُفشِل أي ترحيل بسبب دالة لا نملكها (امتدادات مثلاً)
    end;
  end loop;
end $$;

drop event trigger if exists trg_lock_new_function_acl;
create event trigger trg_lock_new_function_acl
  on ddl_command_end when tag in ('CREATE FUNCTION','ALTER FUNCTION')
  execute function public.lock_new_function_acl();
