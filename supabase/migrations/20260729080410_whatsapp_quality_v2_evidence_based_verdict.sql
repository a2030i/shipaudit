-- v2 — تصحيحان من مراجعة خارجية، كلاهما مؤكَّد:
--
-- (١) **حكم «أرقام رديئة» كان بلا دليل.** قالب `sadad`: 33 رسالة · تسليم
--     18.2% · فشل **صفر** · غير-قابل-للتسليم **صفر** → ومع ذلك حُكم عليه
--     «أرقام رديئة». الحقيقة أن 81.8% منها **معلّقة بلا حالة ملتقَطة**
--     (webhook هاتف غير مضبوط) لا فاشلة. انخفاض التسليم وحده ليس دليلاً
--     على رداءة الأرقام — الدليل هو `undeliverable`.
--
-- (٢) **إنذار كاذب**: «تجربة لدى المنصة» (109 رسالة) كانت تُحسَب ضمن
--     `other_fail` فتُظهر الواجهة «⚠️ يوجد فشل تقني» — وهي رفض من ميتا
--     لا خلل عندنا. صارت خانة مستقلة، و`other_fail` = الفشل التقني وحده.
--
-- وأُضيفت `pending` (أُرسلت بلا حالة نهائية) لأنها تفسّر فجوة التسليم.
drop function if exists public.whatsapp_quality(text,int);
create or replace function public.whatsapp_quality(p_dim text default 'template', p_days int default 30)
 returns table(
   label text, sent int, delivered int, read_n int, replied int,
   failed int, ecosystem int, undeliverable int, experiment int, other_fail int, pending int,
   delivery_rate numeric, reply_rate numeric, ecosystem_rate numeric,
   undeliverable_rate numeric, pending_rate numeric,
   first_sent timestamptz, last_sent timestamptz, verdict text)
 language sql stable security definer set search_path to 'public'
as $function$
  with base as (
    select
      case when p_dim = 'campaign' then coalesce(nullif(campaign_name,''), '(بلا اسم)')
           else coalesce(nullif(template_name,''), '(بلا قالب)') end as label,
      lower(coalesce(status,'')) st, coalesce(error_reason,'') err,
      delivered_at, read_at, replied_at, coalesce(reply_is_auto,false) auto, sent_at
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
      count(*) filter (where st = 'failed' and err ilike '%healthy ecosystem%')::int ecosystem,
      count(*) filter (where st = 'failed' and err ilike '%undeliverable%')::int undeliverable,
      count(*) filter (where st = 'failed' and err ilike '%experiment%')::int experiment,
      count(*) filter (where st = 'failed'
         and err not ilike '%healthy ecosystem%' and err not ilike '%undeliverable%'
         and err not ilike '%experiment%')::int other_fail,
      -- معلّقة: أُرسلت ولم تفشل ولم تصل حالتها النهائية (webhook ناقص)
      count(*) filter (where st <> 'failed'
         and delivered_at is null and read_at is null and replied_at is null)::int pending,
      min(sent_at) first_sent, max(sent_at) last_sent
    from base group by 1
  ),
  r as (
    select a.*,
      round(100.0 * a.delivered     / nullif(a.sent,0), 1) d_rate,
      round(100.0 * a.replied       / nullif(a.delivered,0), 1) rp_rate,
      round(100.0 * a.ecosystem     / nullif(a.sent,0), 1) eco_rate,
      round(100.0 * a.undeliverable / nullif(a.sent,0), 1) und_rate,
      round(100.0 * a.pending       / nullif(a.sent,0), 1) pnd_rate
    from agg a where a.sent > 0
  )
  select r.label, r.sent, r.delivered, r.read_n, r.replied,
    r.failed, r.ecosystem, r.undeliverable, r.experiment, r.other_fail, r.pending,
    r.d_rate, r.rp_rate, r.eco_rate, r.und_rate, r.pnd_rate,
    r.first_sent, r.last_sent,
    case
      when r.sent < 30            then 'عيّنة صغيرة'
      when r.eco_rate >= 25       then 'أوقفه — ميتا تخنقه'
      when r.eco_rate >= 10       then 'راجعه — خنق مرتفع'
      -- «أرقام رديئة» بدليل صريح فقط
      when r.und_rate >= 25       then 'أرقام رديئة'
      -- تسليم منخفض بلا فشل = حالات لم تصلنا، لا حكم على الجمهور
      when r.pnd_rate >= 40       then 'بيانات غير مكتملة'
      when r.d_rate   <  70       then 'متوسط'
      else 'جيد'
    end as verdict
  from r order by r.sent desc;
$function$;

-- ⚠️ فخّ §1.49: `grant to authenticated` وحده لا يمنع anon — Postgres يمنح
-- EXECUTE لـPUBLIC افتراضياً وanon يرثها. السحب يكون **من public** ثم منح صريح.
revoke execute on function public.whatsapp_quality(text,int) from public;
grant execute on function public.whatsapp_quality(text,int) to authenticated, service_role;
