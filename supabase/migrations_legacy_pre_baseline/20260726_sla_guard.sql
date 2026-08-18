-- حارس SLA: متابعات تجاوزت موعدها أو راكدة (لم تُلمَس 3+ أيام) → تُصعَّد لأعلى «الفعل
-- التالي» (إشارة sla أولوية 105 فوق الردّ) + بطاقة تنبيه للمدير عبر sla_breaches().
-- next_best_actions أُعيد إنشاؤها بفرع sla؛ التعريف الكامل مطبَّق عبر MCP (مرجع هنا).
create or replace function public.sla_breaches()
returns table(overdue bigint, stale bigint, total bigint, oldest_days int)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  with a as (
    select next_action_at, last_touch_at from retargeting_followups
    where status not in ('converted','rejected','not_interested','blacklist','supplier','noise','test')
      and ((next_action_at is not null and next_action_at < now()) or last_touch_at < now() - interval '3 days')
  )
  select
    count(*) filter (where next_action_at is not null and next_action_at < now()),
    count(*) filter (where last_touch_at < now() - interval '3 days'),
    count(*),
    coalesce(max(floor(extract(epoch from now() - last_touch_at)/86400))::int, 0)
  from a;
$fn$;
revoke all on function public.sla_breaches() from anon, public;
grant execute on function public.sla_breaches() to authenticated, service_role;
