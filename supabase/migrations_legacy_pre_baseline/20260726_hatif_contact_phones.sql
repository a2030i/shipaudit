-- ربط contactId (من أحداث هاتف) → رقم هاتف، يُملأ بجلب الجهة من هاتف
-- (GET /v1/contacts/{id}.phoneNumber عبر دالة hatif-resolve-contacts). يغطّي
-- التواصل المباشر البارد الذي لم نحملنه ولا هو متجر مُزامَن (خوف المستخدم 2026-07-26).
create table if not exists public.hatif_contact_phones (
  contact_id text primary key,
  phone text,
  name text,
  synced_at timestamptz default now()
);
alter table public.hatif_contact_phones enable row level security;
drop policy if exists hatif_contact_phones_read on public.hatif_contact_phones;
create policy hatif_contact_phones_read on public.hatif_contact_phones
  for select to authenticated using (true);

-- توسعة RPC: مصدر رابع للهاتف = hatif_contact_phones (يغطّي الجهات الباردة)
create or replace function public.hatif_touched_phones(p_days int default 30)
returns table(phone text, last_touch timestamptz, human_assigned boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ev as (
    select conversation_id, contact_id, received_at
    from hatif_events
    where event_type = 'AssignedUserIdChanged'
      and assigned_user_id is not null
      and received_at > now() - make_interval(days => greatest(p_days, 1))
  ),
  mapped as (
    select norm_sa_phone(coalesce(w1.phone, w2.phone, cs.phone, cp.phone)) as phone, ev.received_at
    from ev
    left join lateral (select w.phone from whatsapp_campaign_sends w
                       where w.conversation_id = ev.conversation_id and w.phone is not null limit 1) w1 on true
    left join lateral (select w.phone from whatsapp_campaign_sends w
                       where w.contact_id = ev.contact_id and w.phone is not null limit 1) w2 on true
    left join lateral (select cs.phone from hatif_contact_sync cs
                       where cs.contact_id = ev.contact_id and cs.phone is not null limit 1) cs on true
    left join lateral (select cp.phone from hatif_contact_phones cp
                       where cp.contact_id = ev.contact_id and cp.phone is not null limit 1) cp on true
  )
  select phone, max(received_at) as last_touch, true as human_assigned
  from mapped
  where phone is not null and phone <> ''
  group by phone;
$$;
revoke all on function public.hatif_touched_phones(int) from anon, public;
grant execute on function public.hatif_touched_phones(int) to authenticated, service_role;

-- cron: كل 10 دقائق يجلب أرقام الجهات المُسنَدة الجديدة (jobid 16)
-- select cron.schedule('hatif-resolve-contacts','*/10 * * * *', $$ select net.http_post(
--   url:='https://<proj>.supabase.co/functions/v1/hatif-resolve-contacts',
--   headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',(select cron_key from zoho_auth limit 1)),
--   body:='{}'::jsonb); $$);
