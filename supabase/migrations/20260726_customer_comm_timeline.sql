-- سجلّ تواصل العميل الموحّد (بلا دخول هاتف) — يجمع ما هو مربوط برقم العميل فعلاً:
-- حملات واتساب + مكالمات IVR (مع تسجيلها ونصّها من سجلّ المكالمات) + مَن تولّى محادثته.
-- المكالمات الصوتية اليدوية غير مشمولة (هاتف لا يُرجِع رقم عميلها بعد). 2026-07-26.
create or replace function public.customer_comm_timeline(p_phone text)
returns table(
  kind text, occurred_at timestamptz, title text, detail text, status text,
  recording_url text, sentiment int, ai_summary jsonb, agent_id text, reply_body text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ph as (select norm_sa_phone(p_phone) as phone)
  select 'campaign', w.sent_at,
         coalesce(nullif(w.campaign_name,''), 'حملة واتساب'),
         w.template_name,
         case when w.replied_at is not null and coalesce(w.reply_is_auto,false)=false then 'replied'
              when w.read_at is not null then 'read'
              when w.delivered_at is not null then 'delivered'
              when w.status = 'failed' then 'failed'
              else 'sent' end,
         null::text, null::int, null::jsonb, w.sent_by::text,
         case when coalesce(w.reply_is_auto,false)=false then w.reply_body else null end
  from whatsapp_campaign_sends w, ph
  where w.phone = ph.phone
  union all
  select 'ivr', coalesce(iv.initiated_at, iv.created_at),
         coalesce('مكالمة آلية: '||nullif(iv.script_key,''), 'مكالمة آلية'),
         case when iv.pressed_digit is not null then 'ضغط الرقم '||iv.pressed_digit
              when iv.result is not null then iv.result else iv.status end,
         iv.result, cl.recording_url, cl.sentiment, cl.ai_summary, iv.initiated_by::text, null
  from ivr_calls iv
  cross join ph
  left join hatif_call_log cl on cl.id = iv.voxa_call_id
  where iv.phone = ph.phone
  union all
  select 'handled', e.received_at, 'تولّى موظف محادثته', null, null,
         null::text, null::int, null::jsonb, e.assigned_user_id, null
  from hatif_events e
  cross join ph
  where e.event_type = 'AssignedUserIdChanged' and e.assigned_user_id is not null
    and (
      exists (select 1 from whatsapp_campaign_sends w
              where (w.conversation_id = e.conversation_id or w.contact_id = e.contact_id) and w.phone = ph.phone)
      or exists (select 1 from hatif_contact_phones cp
                 where cp.contact_id = e.contact_id and norm_sa_phone(cp.phone) = ph.phone)
      or exists (select 1 from hatif_contact_sync cs
                 where cs.contact_id = e.contact_id and norm_sa_phone(cs.phone) = ph.phone)
    )
  order by 2 desc;
$$;
revoke all on function public.customer_comm_timeline(text) from anon, public;
grant execute on function public.customer_comm_timeline(text) to authenticated, service_role;
