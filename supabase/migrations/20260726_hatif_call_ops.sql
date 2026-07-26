-- ملخّص إشارات المكالمات للوحة القرارات: مكالمات سلبية آخر 7 أيام (مقابل السابقة)
-- + أكثر مشكلة صاعدة. يغذّي بطاقتَي «مكالمات سلبية» و«مشكلة صاعدة» في /decisions. 2026-07-26.
create or replace function public.hatif_call_ops()
returns table(negative_7d bigint, negative_prev bigint, rising_category text, rising_now bigint, rising_delta bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with neg as (
    select
      count(*) filter (where creation_time > now() - interval '7 days') as n7,
      count(*) filter (where creation_time <= now() - interval '7 days' and creation_time > now() - interval '14 days') as nprev
    from hatif_call_log
    where sentiment <= 2 and talk_seconds > 40
      and ai_summary::text !~ 'رسالة ترحيبية|مركز اتصال|الرجاء اختيار|للاستمرار باللغة'
  ),
  prob as (
    select category, calls, (calls - calls_prev) as delta
    from hatif_call_problems(30)
    where (calls - calls_prev) > 0
    order by (calls - calls_prev) desc, calls desc
    limit 1
  )
  select neg.n7, neg.nprev,
    (select category from prob), (select calls from prob), (select delta from prob)
  from neg;
$$;
revoke all on function public.hatif_call_ops() from anon, public;
grant execute on function public.hatif_call_ops() to authenticated, service_role;
