-- التزامات معاودة الاتصال المستخرجة من ملخصات مكالمات هاتف.
-- هذه طبقة قياس/تدقيق وليست صندوق محادثات أو نظام مهام موازياً:
-- هاتف يبقى مكان الاتصال، ولمحة تطابق الوعد بالمكالمة الصادرة الفعلية.

alter table public.hatif_call_log
  add column if not exists contact_phone text;

update public.hatif_call_log
set contact_phone = public.norm_sa_phone(contact_number)
where contact_phone is null
  and nullif(btrim(contact_number), '') is not null;

create index if not exists hatif_call_log_phone_time_idx
  on public.hatif_call_log (contact_phone, call_type, creation_time desc)
  where contact_phone is not null;

create table if not exists public.hatif_call_commitments (
  id uuid primary key default gen_random_uuid(),
  source_call_id text not null unique
    references public.hatif_call_log(id) on delete cascade,
  phone text not null,
  source_call_at timestamptz not null,
  expected_agent_id text,
  expected_agent_name text,
  window_start timestamptz,
  window_end timestamptz,
  extraction_confidence text not null default 'high'
    check (extraction_confidence in ('high', 'medium', 'review')),
  source_text text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'needs_confirmation',
      'on_time_answered', 'on_time_no_answer',
      'late_answered', 'late_no_answer',
      'missed', 'cancelled'
    )),
  matched_call_id text
    references public.hatif_call_log(id) on delete set null,
  actual_agent_id text,
  actual_agent_name text,
  attempted_at timestamptz,
  answered_at timestamptz,
  owner_match boolean,
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hatif_call_commitment_window_check check (
    (window_start is null and window_end is null)
    or (window_start is not null and window_end is not null and window_end > window_start)
  ),
  constraint hatif_call_commitment_confirmation_check check (
    status = 'needs_confirmation' or (window_start is not null and window_end is not null)
  )
);

create index if not exists hatif_call_commitments_window_idx
  on public.hatif_call_commitments (window_start, status)
  where status not in ('cancelled', 'on_time_answered', 'late_answered');

create index if not exists hatif_call_commitments_phone_idx
  on public.hatif_call_commitments (phone, source_call_at desc);

alter table public.hatif_call_commitments enable row level security;

revoke all on table public.hatif_call_commitments from public, anon, authenticated;
grant select on table public.hatif_call_commitments to authenticated;
grant select, insert, update, delete on table public.hatif_call_commitments to service_role;

drop policy if exists hatif_call_commitments_read on public.hatif_call_commitments;
create policy hatif_call_commitments_read
on public.hatif_call_commitments
for select
to authenticated
using (
  public.crm_has_permission('crm.view_all')
  or public.crm_has_permission('whatsapp.view_log')
);

-- يعيد تقييم الالتزامات القريبة فقط. المكالمة المبكرة لا تُحسب وفاءً لأن العميل
-- طلب نافذة محددة. محاولة بلا رد داخل النافذة تُثبت التزام الموظف ولا تُسمى فشلاً.
create or replace function public.evaluate_hatif_call_commitments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer := 0;
begin
  with candidate as (
    select
      commitment.id as commitment_id,
      matched.id as matched_call_id,
      matched.user_id as actual_agent_id,
      matched.user_name as actual_agent_name,
      matched.creation_time as attempted_at,
      matched.pickup_time as answered_at,
      case
        when matched.id is null and now() > commitment.window_end + interval '15 minutes'
          then 'missed'
        when matched.id is null then 'pending'
        when matched.creation_time <= commitment.window_end and matched.pickup_time is not null
          then 'on_time_answered'
        when matched.creation_time <= commitment.window_end
          then 'on_time_no_answer'
        when matched.pickup_time is not null
          then 'late_answered'
        else 'late_no_answer'
      end as next_status,
      case
        when matched.id is null
          or (commitment.expected_agent_id is null and commitment.expected_agent_name is null)
          then null
        when commitment.expected_agent_id is not null and matched.user_id is not null
          then commitment.expected_agent_id = matched.user_id
        when commitment.expected_agent_name is not null and matched.user_name is not null
          then lower(btrim(commitment.expected_agent_name)) = lower(btrim(matched.user_name))
        else null
      end as owner_match
    from public.hatif_call_commitments commitment
    left join lateral (
      select call_row.*
      from public.hatif_call_log call_row
      where call_row.contact_phone = commitment.phone
        and call_row.call_type = 2
        and call_row.id <> commitment.source_call_id
        and call_row.creation_time >= commitment.window_start
        and call_row.creation_time <= least(now(), commitment.window_end + interval '1 day')
      order by
        case
          when call_row.creation_time <= commitment.window_end and call_row.pickup_time is not null then 0
          when call_row.creation_time <= commitment.window_end then 1
          when call_row.pickup_time is not null then 2
          else 3
        end,
        call_row.creation_time asc,
        call_row.id asc
      limit 1
    ) matched on true
    where commitment.status in (
      'pending', 'on_time_no_answer', 'late_no_answer', 'missed'
    )
      and commitment.window_start is not null
      and commitment.window_end is not null
      -- يسمح بتقييم المزامنة التاريخية الحديثة دون مسح كامل السجل كل خمس دقائق.
      and commitment.window_end >= now() - interval '90 days'
  )
  update public.hatif_call_commitments commitment
  set
    status = candidate.next_status,
    matched_call_id = candidate.matched_call_id,
    actual_agent_id = candidate.actual_agent_id,
    actual_agent_name = candidate.actual_agent_name,
    attempted_at = candidate.attempted_at,
    answered_at = candidate.answered_at,
    owner_match = candidate.owner_match,
    evaluated_at = now(),
    updated_at = now()
  from candidate
  where commitment.id = candidate.commitment_id
    and (
      commitment.status is distinct from candidate.next_status
      or commitment.matched_call_id is distinct from candidate.matched_call_id
      or commitment.actual_agent_id is distinct from candidate.actual_agent_id
      or commitment.attempted_at is distinct from candidate.attempted_at
      or commitment.answered_at is distinct from candidate.answered_at
      or commitment.owner_match is distinct from candidate.owner_match
    );

  get diagnostics v_updated = row_count;
  return jsonb_build_object('updated', v_updated, 'evaluated_at', now());
end;
$function$;

revoke all on function public.evaluate_hatif_call_commitments() from public, anon, authenticated;
grant execute on function public.evaluate_hatif_call_commitments() to service_role;

-- سجل العميل الموحد يشمل الآن المكالمات الصوتية اليدوية من سجل هاتف الكامل.
-- نستبعد مكالمات IVR المرتبطة كي لا تظهر مرتين.
-- PostgreSQL لا يسمح لـCREATE OR REPLACE بتغيير صف OUT؛ الحذف وإعادة الإنشاء
-- آمنان داخل معاملة المهاجرة، والمنح تُعاد مباشرة بعد التعريف.
drop function if exists public.customer_comm_timeline(text);

create or replace function public.customer_comm_timeline(p_phone text)
returns table(
  kind text, occurred_at timestamptz, title text, detail text, status text,
  recording_url text, sentiment int, ai_summary jsonb, agent_id text, reply_body text,
  conversation_id text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  with ph as (select norm_sa_phone(p_phone) as phone)
  select 'campaign', w.sent_at,
         coalesce(nullif(w.campaign_name,''), 'حملة واتساب'), w.template_name,
         case when w.replied_at is not null and coalesce(w.reply_is_auto,false)=false then 'replied'
              when w.read_at is not null then 'read'
              when w.delivered_at is not null then 'delivered'
              when w.status = 'failed' then 'failed' else 'sent' end,
         null::text, null::int, null::jsonb, w.sent_by::text,
         case when coalesce(w.reply_is_auto,false)=false then w.reply_body else null end,
         w.conversation_id
  from whatsapp_campaign_sends w, ph where w.phone = ph.phone
  union all
  select 'ivr', coalesce(iv.initiated_at, iv.created_at),
         coalesce('IVR: '||nullif(iv.script_key,''), 'IVR'),
         case when iv.pressed_digit is not null then 'digit '||iv.pressed_digit
              when iv.result is not null then iv.result else iv.status end,
         iv.result, cl.recording_url, cl.sentiment, cl.ai_summary, iv.initiated_by::text, null, null::text
  from ivr_calls iv cross join ph
  left join hatif_call_log cl on cl.id = iv.voxa_call_id
  where iv.phone = ph.phone
  union all
  select 'voice_call', call_row.creation_time,
         case when call_row.call_type = 1 then 'مكالمة واردة'
              else 'مكالمة صادرة' end
           || case when nullif(btrim(call_row.user_name), '') is not null
                   then ' — ' || call_row.user_name else '' end,
         case when call_row.pickup_time is not null then 'تم الرد'
              else 'لم يُردّ' end
           || case when coalesce(call_row.talk_seconds, 0) > 0
                   then ' · ' || call_row.talk_seconds::text || ' ثانية' else '' end,
         case when call_row.pickup_time is not null then 'answered' else 'not_answered' end,
         call_row.recording_url, call_row.sentiment, call_row.ai_summary,
         call_row.user_id, null::text, null::text
  from hatif_call_log call_row cross join ph
  where call_row.contact_phone = ph.phone
    and not exists (
      select 1 from ivr_calls iv where iv.voxa_call_id = call_row.id
    )
  union all
  select 'handled', e.received_at, 'handled', null, null,
         null::text, null::int, null::jsonb, e.assigned_user_id, null, e.conversation_id
  from hatif_events e cross join ph
  where e.event_type = 'AssignedUserIdChanged' and e.assigned_user_id is not null
    and (
      exists (select 1 from whatsapp_campaign_sends w where (w.conversation_id = e.conversation_id or w.contact_id = e.contact_id) and w.phone = ph.phone)
      or exists (select 1 from hatif_contact_phones cp where cp.contact_id = e.contact_id and norm_sa_phone(cp.phone) = ph.phone)
      or exists (select 1 from hatif_contact_sync cs where cs.contact_id = e.contact_id and norm_sa_phone(cs.phone) = ph.phone)
    )
  order by 2 desc;
$function$;

revoke all on function public.customer_comm_timeline(text) from public, anon;
grant execute on function public.customer_comm_timeline(text) to authenticated, service_role;

comment on table public.hatif_call_commitments is
  'سجل قياس آلي لوعود معاودة الاتصال المستخرجة من مكالمات هاتف؛ لا ينشئ Lead أو طابور محادثات.';
comment on function public.evaluate_hatif_call_commitments() is
  'يطابق نافذة الاتصال بالمكالمة الصادرة الفعلية من هاتف ويثبت الموظف والتوقيت والرد.';
