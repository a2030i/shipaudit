-- تحليل مشاكل المكالمات — تصنيف آلي لكل مكالمة من نصّ ملخّصها (كلمات مفتاحية)
-- + عدّاد بالاتجاه + تنقيب لكل فئة. مصدر تصنيف واحد. يستبعد قوائم IVR الترحيبية. 2026-07-26.
create or replace function public.hatif_call_categories(t text)
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select array_remove(array[
    case when t ~ 'سعر|أسعار|تكلفة|غالي|أغلى|تنافس|مرتفع.{0,8}(سعر|تكلف)' then 'price' end,
    case when t ~ 'سجل تجاري|سجل التجاري' then 'cr_requirement' end,
    case when t ~ 'تأخر|تأخير|متأخر|لم تصل|ما وصل|توصيل.{0,8}(بطيء|متأخر)|سرعة التوصيل' then 'delivery' end,
    case when t ~ 'مفقود|فقدان|ضاع|ضايع|شحنة.{0,6}مفقود' then 'lost' end,
    case when t ~ 'خدمة العملاء|ما يرد|لا أحد يرد|تجاهل|صعوبة.{0,8}تواصل|لا يوجد دعم' then 'support' end,
    case when t ~ 'رجيع|إرجاع|ارجاع|استرجاع|مرتجع' then 'returns' end,
    case when t ~ 'فاتورة|فواتير|فوترة' then 'billing' end,
    case when t ~ 'ريد بوكس|red box|تفعيل شرك|شركات شحن إضاف|تفعيل.{0,10}شركة' then 'carriers' end,
    case when t ~ 'أغلق|إغلاق|مغلق|توقف النشاط|توقف العمل|أغلقت' then 'closed' end
  ], null);
$$;

create or replace function public.hatif_call_problems(p_days int default 60)
returns table(category text, calls bigint, calls_prev bigint, avg_sentiment numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  with base as (
    select ai_summary::text as t, sentiment, creation_time
    from hatif_call_log
    where ai_summary is not null and talk_seconds > 40
      and ai_summary::text !~ 'رسالة ترحيبية|مركز اتصال|الرجاء اختيار|للاستمرار باللغة'
      and creation_time > now() - make_interval(days => greatest(p_days,1) * 2)
  ), c as (
    select unnest(hatif_call_categories(t)) as cat, sentiment, creation_time from base
  )
  select cat,
    count(*) filter (where creation_time > now() - make_interval(days => greatest(p_days,1))),
    count(*) filter (where creation_time <= now() - make_interval(days => greatest(p_days,1))),
    round(avg(sentiment) filter (where sentiment is not null), 2)
  from c group by cat
  having count(*) filter (where creation_time > now() - make_interval(days => greatest(p_days,1))) > 0
  order by 2 desc;
$$;

create or replace function public.hatif_problem_calls(p_category text, p_days int default 60, p_limit int default 40)
returns table(id text, user_id text, creation_time timestamptz, talk_seconds int, sentiment int, recording_url text, ai_summary jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  select id, user_id, creation_time, talk_seconds, sentiment, recording_url, ai_summary
  from hatif_call_log
  where ai_summary is not null and talk_seconds > 40
    and ai_summary::text !~ 'رسالة ترحيبية|مركز اتصال|الرجاء اختيار|للاستمرار باللغة'
    and creation_time > now() - make_interval(days => greatest(p_days,1))
    and p_category = any(hatif_call_categories(ai_summary::text))
  order by creation_time desc
  limit greatest(p_limit,1);
$$;

revoke all on function public.hatif_call_problems(int) from anon, public;
revoke all on function public.hatif_problem_calls(text,int,int) from anon, public;
grant execute on function public.hatif_call_problems(int) to authenticated, service_role;
grant execute on function public.hatif_problem_calls(text,int,int) to authenticated, service_role;
