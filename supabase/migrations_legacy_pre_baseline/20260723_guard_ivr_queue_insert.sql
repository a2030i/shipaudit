-- البند 1 من خطة تطوير هاتف: حارس صلاحية جدولة IVR (نفس نمط campaign_queue §1.38).
-- ivr_queue كان بلا سياسة INSERT (RLS مفعّل) → الجدولة معطّلة أصلاً. نُضيف:
-- (١) سياسة INSERT تسمح للمستخدم بإدراج صفوفه فقط (created_by=self).
-- (٢) trigger يفحص campaigns.ivr سيرفرياً — الحدّ الفعلي (لا يُتجاوز من الواجهة).

do $$ begin
  if not exists (select 1 from pg_policies where tablename='ivr_queue' and policyname='ivr_queue_insert')
    then create policy ivr_queue_insert on public.ivr_queue for insert to authenticated with check (created_by = auth.uid()); end if;
end $$;

create or replace function public.guard_ivr_queue_insert() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare perms jsonb; rol text;
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  select role, permissions into rol, perms from public.profiles where id = auth.uid();
  if rol = 'admin' or coalesce((perms->>'campaigns.ivr')::boolean, false) then
    return new;
  end if;
  raise exception 'جدولة المكالمات الآلية تتطلّب صلاحية campaigns.ivr';
end $fn$;

drop trigger if exists trg_guard_ivr_queue on public.ivr_queue;
create trigger trg_guard_ivr_queue before insert on public.ivr_queue
  for each row execute function public.guard_ivr_queue_insert();
