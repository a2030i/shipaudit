-- ALTER note: see MCP-applied migration.
-- توزيع ساعة فتح الرسائل (read_at) + الردّ بتوقيت السعودية (Asia/Riyadh) — لقرار توقيت الحملة.
create or replace function public.message_open_hours(p_days int default 120)
returns table(hour int, opens bigint, replies bigint)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  with h as (select generate_series(0,23) as hour)
  select h.hour,
    (select count(*) from whatsapp_campaign_sends w where w.read_at is not null
       and w.read_at > now() - make_interval(days=>greatest(p_days,1))
       and extract(hour from w.read_at at time zone 'Asia/Riyadh')::int = h.hour),
    (select count(*) from whatsapp_campaign_sends w where w.replied_at is not null and coalesce(w.reply_is_auto,false)=false
       and w.replied_at > now() - make_interval(days=>greatest(p_days,1))
       and extract(hour from w.replied_at at time zone 'Asia/Riyadh')::int = h.hour)
  from h order by h.hour;
$fn$;
revoke all on function public.message_open_hours(int) from anon, public;
grant execute on function public.message_open_hours(int) to authenticated, service_role;
