-- جودة القوالب والحملات — الخطر التجاري الوحيد المؤكَّد (36.6% رفض في 7 أيام،
-- **صفر فشل تقني**: 1,222 «للحفاظ على صحة المنظومة» + 1,158 «غير قابل للتسليم»).
-- الأولى إشارة **خنق من ميتا** لجودة الاستهداف/المحتوى — تراكمها يخفّض تصنيف
-- الرقم ثم حدّ الإرسال اليومي. فالقياس يجب أن يفصل الثلاثة لا أن يجمعها «فشل».
--
-- p_dim: 'template' (اسم القالب) أو 'campaign' (اسم الحملة = الشريحة عملياً).
create or replace function public.whatsapp_quality(p_dim text default 'template', p_days int default 30)
 returns table(
   label text, sent int, delivered int, read_n int, replied int,
   failed int, ecosystem int, undeliverable int, other_fail int,
   delivery_rate numeric, reply_rate numeric, ecosystem_rate numeric,
   first_sent timestamptz, last_sent timestamptz, verdict text)
 language sql stable security definer set search_path to 'public'
as $function$
  with base as (
    select
      case when p_dim = 'campaign' then coalesce(nullif(campaign_name,''), '(بلا اسم)')
           else coalesce(nullif(template_name,''), '(بلا قالب)') end as label,
      lower(coalesce(status,'')) st, error_reason, delivered_at, read_at, replied_at,
      coalesce(reply_is_auto,false) auto, sent_at
    from whatsapp_campaign_sends
    where sent_at >= now() - make_interval(days => greatest(p_days,1))
  ),
  agg as (
    select label,
      count(*)::int sent,
      count(*) filter (where delivered_at is not null or read_at is not null or replied_at is not null)::int delivered,
      count(*) filter (where read_at is not null)::int read_n,
      count(*) filter (where replied_at is not null and not auto)::int replied,
      count(*) filter (where st = 'failed')::int failed,
      count(*) filter (where st = 'failed' and error_reason ilike '%healthy ecosystem%')::int ecosystem,
      count(*) filter (where st = 'failed' and error_reason ilike '%undeliverable%')::int undeliverable,
      count(*) filter (where st = 'failed'
         and coalesce(error_reason,'') not ilike '%healthy ecosystem%'
         and coalesce(error_reason,'') not ilike '%undeliverable%')::int other_fail,
      min(sent_at) first_sent, max(sent_at) last_sent
    from base group by 1
  )
  select a.label, a.sent, a.delivered, a.read_n, a.replied,
    a.failed, a.ecosystem, a.undeliverable, a.other_fail,
    round(100.0 * a.delivered / nullif(a.sent,0), 1) delivery_rate,
    round(100.0 * a.replied   / nullif(a.delivered,0), 1) reply_rate,
    round(100.0 * a.ecosystem / nullif(a.sent,0), 1) ecosystem_rate,
    a.first_sent, a.last_sent,
    -- الحكم: نسبة خنق ميتا أولاً (الأخطر على الرقم) ثم التسليم.
    -- عيّنة أقل من 30 رسالة لا يُحكَم عليها (ضوضاء إحصائية).
    case
      when a.sent < 30 then 'عيّنة صغيرة'
      when 100.0 * a.ecosystem / a.sent >= 25 then 'أوقفه — ميتا تخنقه'
      when 100.0 * a.ecosystem / a.sent >= 10 then 'راجعه — خنق مرتفع'
      when 100.0 * a.delivered / a.sent < 50  then 'ضعيف — أرقام رديئة'
      when 100.0 * a.delivered / a.sent < 70  then 'متوسط'
      else 'جيد'
    end as verdict
  from agg a
  where a.sent > 0
  order by a.sent desc;
$function$;

grant execute on function public.whatsapp_quality(text,int) to authenticated;
