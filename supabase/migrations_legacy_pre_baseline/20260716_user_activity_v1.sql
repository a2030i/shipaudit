-- سجل تحركات الموظفين (§1.36): دخول/تنقّل/أفعال/تصدير/محاولات ممنوعة
-- + التقاط تلقائي لتعديلات الجداول الحسّاسة عبر triggers (لا يُتجاوز من الواجهة).
-- (مُطبَّقة على FIN عبر MCP باسم user_activity_v1 — هذه نسخة المستودع)
create table if not exists public.user_activity_log (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null,              -- login | page | denied | export | data | action
  action text not null,
  detail jsonb,
  path text,
  ip text,
  country text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists ual_user_idx on public.user_activity_log(user_id, created_at desc);
create index if not exists ual_kind_idx on public.user_activity_log(kind, created_at desc);

alter table public.user_activity_log enable row level security;
do $$ begin
  create policy ual_admin_select on public.user_activity_log
    for select to authenticated using (is_admin());
exception when duplicate_object then null; end $$;

create or replace function public.log_sensitive_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into user_activity_log (user_id, kind, action, detail)
  values (
    auth.uid(), 'data', TG_TABLE_NAME || ':' || lower(TG_OP),
    jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP,
      'row_id', coalesce(to_jsonb(case when TG_OP = 'DELETE' then OLD else NEW end)->>'id', ''))
  );
  return coalesce(NEW, OLD);
end $$;

do $$
declare t text;
begin
  foreach t in array array['payments','carrier_operations','audits','period_closes','support_tickets','app_settings']
  loop
    execute format('drop trigger if exists %I on public.%I', 'ual_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_sensitive_change()', 'ual_' || t, t);
  end loop;
end $$;
drop trigger if exists ual_profiles on public.profiles;
create trigger ual_profiles after update on public.profiles
for each row execute function public.log_sensitive_change();

create or replace function public.employee_activity_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id,
    'last_sign_in', u.last_sign_in_at,
    'last_action', la.action, 'last_action_at', la.created_at,
    'last_ip', la.ip, 'last_country', la.country,
    'actions_7d', coalesce(c7.n, 0), 'denied_7d', coalesce(d7.n, 0)
  )), '[]'::jsonb) into out
  from profiles p
  left join auth.users u on u.id = p.id
  left join lateral (
    select action, created_at, ip, country from user_activity_log l
    where l.user_id = p.id order by created_at desc limit 1
  ) la on true
  left join lateral (
    select count(*) n from user_activity_log l
    where l.user_id = p.id and l.created_at > now() - interval '7 days'
  ) c7 on true
  left join lateral (
    select count(*) n from user_activity_log l
    where l.user_id = p.id and l.kind = 'denied' and l.created_at > now() - interval '7 days'
  ) d7 on true;
  return out;
end $$;
revoke all on function public.employee_activity_summary() from public, anon;
grant execute on function public.employee_activity_summary() to authenticated;

create or replace function public.employee_activity_log(p_user uuid, p_kind text default null, p_limit int default 100, p_offset int default 0)
returns setof public.user_activity_log
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return query
    select * from user_activity_log
    where user_id = p_user and (p_kind is null or kind = p_kind)
    order by created_at desc
    limit least(coalesce(p_limit, 100), 500) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.employee_activity_log(uuid, text, int, int) from public, anon;
grant execute on function public.employee_activity_log(uuid, text, int, int) to authenticated;
