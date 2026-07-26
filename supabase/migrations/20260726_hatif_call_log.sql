-- سجلّ مكالمات هاتف الكامل (وارد+صادر) عبر GET /v1/call/list — تسجيل + ملخّص AI +
-- مشاعر + نص لكل مكالمة. مصدر لوحة أداء الفريق (2026-07-26). منفصل عن hatif_calls
-- (نظام IVR الصادر §1.40). يُملأ بدالة hatif-pull-calls (cron كل 30د).
create table if not exists public.hatif_call_log (
  id             text primary key,          -- Voxa call id
  user_id        text,                      -- الموظف (agent)
  user_name      text,
  phone_number_id text,
  contact_number text,                      -- رقم العميل (قد يكون null — القائمة لا ترجعه بعد)
  call_type      int,                        -- 1=وارد 2=صادر
  status         int,
  creation_time  timestamptz,
  pickup_time    timestamptz,
  hangup_time    timestamptz,
  ringing_duration text,
  talk_seconds   int,                        -- hangup - pickup
  recording_url  text,
  ai_summary     jsonb,
  sentiment      int,
  synced_at      timestamptz default now()
);
create index if not exists hatif_call_log_creation_idx on public.hatif_call_log (creation_time desc);
create index if not exists hatif_call_log_user_idx on public.hatif_call_log (user_id);
alter table public.hatif_call_log enable row level security;
drop policy if exists hatif_call_log_read on public.hatif_call_log;
create policy hatif_call_log_read on public.hatif_call_log
  for select to authenticated using (true);

-- إحصاءات أداء الفريق من المكالمات (آخر p_days يوماً)
create or replace function public.hatif_call_agent_stats(p_days int default 30)
returns table(
  user_id text, calls bigint, answered bigint, inbound bigint, outbound bigint,
  talk_seconds bigint, avg_talk numeric, avg_sentiment numeric, last_call timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    user_id,
    count(*)                                                     as calls,
    count(*) filter (where pickup_time is not null)             as answered,
    count(*) filter (where call_type = 1)                       as inbound,
    count(*) filter (where call_type = 2)                       as outbound,
    coalesce(sum(talk_seconds), 0)                              as talk_seconds,
    round(avg(talk_seconds) filter (where talk_seconds > 0), 1) as avg_talk,
    round(avg(sentiment) filter (where sentiment is not null), 2) as avg_sentiment,
    max(creation_time)                                          as last_call
  from hatif_call_log
  where creation_time > now() - make_interval(days => greatest(p_days, 1))
  group by user_id
  order by calls desc;
$$;
revoke all on function public.hatif_call_agent_stats(int) from anon, public;
grant execute on function public.hatif_call_agent_stats(int) to authenticated, service_role;

-- cron كل 30 دقيقة يسحب الجديد من سجلّ المكالمات:
-- select cron.schedule('hatif-pull-calls','*/30 * * * *', $$ select net.http_post(
--   url:='https://<proj>.supabase.co/functions/v1/hatif-pull-calls',
--   headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',(select cron_key from zoho_auth limit 1)),
--   body:='{}'::jsonb, timeout_milliseconds:=120000); $$);
