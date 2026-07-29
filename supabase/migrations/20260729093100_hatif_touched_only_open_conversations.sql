-- ⚠️ خلل مقيس: الاستبعاد كان «أُسنِدت محادثته لموظف خلال 30 يوماً» — **بلا
-- نظر إلى أنها أُغلقت**. والواقع أن المحادثات تُغلق بعد دقائق:
--   429 محادثة أُسنِدت خلال 30 يوماً · **425 منها أُغلقت** · **4 فقط مفتوحة**.
-- فالقاعدة كانت تحجب 429 رقماً لأجل 4 — أي **99% حجب زائد**.
--
-- الحالة التي كشفته (COOMO WATCHES، دين 4,430.49): محادثته أُسنِدت
-- 26 يوليو 10:05 صباحاً و**أُغلقت 10:20 من اليوم نفسه** (15 دقيقة)، ومع
-- ذلك بقي محجوباً عن حملات التحصيل ثلاثة أيام — والمستخدم ظنّها «رفض إرسال».
--
-- الإصلاح: الاستبعاد **فقط للمحادثة التي ما زالت مفتوحة** — أي لا يوجد
-- إغلاق (`StatusChanged` بـstatus=2) **بعد** آخر إسناد لموظف. هذا هو المعنى
-- المقصود أصلاً: لا تقاطع حواراً **جارياً**.
--
-- دلالة الحالة مستنتَجة من التوزيع الحيّ: 1 = مفتوحة (210 حدثاً) ·
-- 2 = مغلقة (5,249) — ومنطق التسلسل يؤكّدها (تُفتح ثم تُسنَد ثم تُغلق).
create or replace function public.hatif_touched_phones(p_days integer default 30)
 returns table(phone text, last_touch timestamptz, human_assigned boolean)
 language sql stable set search_path to 'public','pg_temp'
as $function$
  with conv as (
    select conversation_id, contact_id,
           max(received_at) filter (where event_type = 'AssignedUserIdChanged'
                                      and assigned_user_id is not null) assigned_at,
           max(received_at) filter (where event_type = 'StatusChanged'
                                      and status = 2)                   closed_at
    from hatif_events
    where received_at > now() - make_interval(days => greatest(p_days, 1))
    group by conversation_id, contact_id
  ),
  -- المفتوحة فقط: أُسنِدت ولم تُغلق بعد الإسناد
  ev as (
    select conversation_id, contact_id, assigned_at as received_at
    from conv
    where assigned_at is not null
      and (closed_at is null or closed_at <= assigned_at)
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
$function$;
