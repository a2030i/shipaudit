-- أرقام العملاء الذين تحمل محادثتهم في هاتف إسناداً لموظف بشري (AssignedUserIdChanged
-- بموظف غير فارغ) خلال آخر p_days يوماً = «الفريق يتواصل معهم مباشرة». تُستبعَد من
-- حملات القوالب حتى لا نطلق قالباً على عميل يكلّمه موظف الآن (خوف المستخدم 2026-07-26).
-- الربط conversation/contact → هاتف عبر سجلّ حملاتنا ثم مزامنة جهات هاتف. الهاتف يُطبَّع
-- بـ norm_sa_phone ليطابق مفاتيح المودال (966XXXXXXXXX).
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
    select norm_sa_phone(coalesce(w1.phone, w2.phone, cs.phone)) as phone, ev.received_at
    from ev
    left join lateral (select w.phone from whatsapp_campaign_sends w
                       where w.conversation_id = ev.conversation_id and w.phone is not null limit 1) w1 on true
    left join lateral (select w.phone from whatsapp_campaign_sends w
                       where w.contact_id = ev.contact_id and w.phone is not null limit 1) w2 on true
    left join lateral (select cs.phone from hatif_contact_sync cs
                       where cs.contact_id = ev.contact_id and cs.phone is not null limit 1) cs on true
  )
  select phone, max(received_at) as last_touch, true as human_assigned
  from mapped
  where phone is not null and phone <> ''
  group by phone;
$$;
revoke all on function public.hatif_touched_phones(int) from anon, public;
grant execute on function public.hatif_touched_phones(int) to authenticated, service_role;
