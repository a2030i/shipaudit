-- تحسين إنشاء التذاكر + تحديث جماعي ذري وآمن.

alter table public.support_tickets
  drop constraint if exists support_tickets_shipping_context_check;
alter table public.support_tickets
  add constraint support_tickets_shipping_context_check
  check (
    (
      coalesce(category, 'other') in ('delayed', 'damaged', 'cod')
      and nullif(btrim(carrier_id), '') is not null
      and nullif(btrim(carrier_name), '') is not null
      and nullif(btrim(awb), '') is not null
    )
    or
    (
      coalesce(category, 'other') not in ('delayed', 'damaged', 'cod')
      and carrier_id is null
      and carrier_name is null
      and awb is null
    )
  );

create or replace function public.support_bulk_update(
  p_tickets uuid[],
  p_status text default null,
  p_priority text default null,
  p_assignee_mode text default 'keep',
  p_assignee uuid default null,
  p_followup_mode text default 'keep',
  p_next timestamptz default null,
  p_closure_reason text default null,
  p_resolution_summary text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_requested int;
  v_found int;
  v_updated int;
  v_assignee_name text;
  v_event_kind text := case when p_status is null then 'followup' else 'status' end;
  v_event_note text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('support.manage') then raise exception 'not_allowed'; end if;

  select array_agg(distinct id), count(distinct id)
    into v_ids, v_requested
  from unnest(coalesce(p_tickets, array[]::uuid[])) as selected(id);

  if coalesce(v_requested, 0) = 0 then raise exception 'no_tickets_selected'; end if;
  if v_requested > 200 then raise exception 'bulk_limit_200'; end if;

  if p_status is not null
     and p_status not in ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed') then
    raise exception 'invalid_status';
  end if;
  if p_priority is not null and p_priority not in ('normal', 'high', 'urgent') then
    raise exception 'invalid_priority';
  end if;
  if p_assignee_mode not in ('keep', 'set', 'clear') then raise exception 'invalid_assignee_mode'; end if;
  if p_followup_mode not in ('keep', 'set', 'clear') then raise exception 'invalid_followup_mode'; end if;
  if p_assignee_mode = 'set' and p_assignee is null then raise exception 'assignee_required'; end if;
  if p_followup_mode = 'set' and p_next is null then raise exception 'followup_date_required'; end if;

  if p_status in ('resolved', 'closed') then
    if nullif(btrim(p_closure_reason), '') is null
       or nullif(btrim(p_resolution_summary), '') is null then
      raise exception 'closure_reason_and_resolution_summary_required';
    end if;
  end if;

  if p_status is null and p_priority is null
     and p_assignee_mode = 'keep' and p_followup_mode = 'keep'
     and nullif(btrim(p_note), '') is null then
    raise exception 'no_changes_requested';
  end if;

  if p_assignee_mode = 'set' then
    select name into v_assignee_name
    from public.profiles
    where id = p_assignee;
    if v_assignee_name is null then raise exception 'assignee_not_found'; end if;
  elsif p_assignee_mode = 'clear' then
    v_assignee_name := 'بلا مسؤول';
  end if;

  select count(*) into v_found
  from public.support_tickets
  where id = any(v_ids);
  if v_found <> v_requested then raise exception 'ticket_set_changed'; end if;

  if p_followup_mode = 'set'
     and (
       p_status in ('resolved', 'closed')
       or (
         p_status is null
         and exists (
           select 1 from public.support_tickets
           where id = any(v_ids) and status in ('resolved', 'closed')
         )
       )
     ) then
    raise exception 'closed_ticket_requires_reopen_before_followup';
  end if;

  v_event_note := concat_ws(
    ' · ',
    'تحديث جماعي',
    nullif(btrim(p_note), ''),
    case p_status
      when 'open' then 'الحالة: جديدة'
      when 'in_progress' then 'الحالة: قيد المعالجة'
      when 'waiting_customer' then 'الحالة: بانتظار العميل'
      when 'resolved' then 'الحالة: محلولة'
      when 'closed' then 'الحالة: مغلقة'
    end,
    case p_priority
      when 'normal' then 'الأولوية: عادية'
      when 'high' then 'الأولوية: عالية'
      when 'urgent' then 'الأولوية: عاجلة'
    end,
    case when p_assignee_mode <> 'keep' then 'المسؤول: ' || v_assignee_name end,
    case p_followup_mode
      when 'clear' then 'أُلغي موعد المتابعة'
      when 'set' then 'المتابعة: ' || to_char(p_next at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')
    end,
    case when p_status in ('resolved', 'closed') then nullif(btrim(p_resolution_summary), '') end
  );

  with targets as materialized (
    select id, status old_status
    from public.support_tickets
    where id = any(v_ids)
    for update
  ),
  changed as (
    update public.support_tickets t
    set status = coalesce(p_status, t.status),
        priority = coalesce(p_priority, t.priority),
        assigned_to = case p_assignee_mode
          when 'set' then p_assignee
          when 'clear' then null
          else t.assigned_to
        end,
        next_followup_at = case
          when p_status in ('resolved', 'closed') then null
          when p_followup_mode = 'set' then p_next
          when p_followup_mode = 'clear' then null
          else t.next_followup_at
        end,
        last_followup_at = case
          when p_followup_mode <> 'keep' or nullif(btrim(p_note), '') is not null then now()
          else t.last_followup_at
        end,
        closure_reason = case
          when p_status in ('resolved', 'closed') then p_closure_reason
          when p_status is null then t.closure_reason
          else null
        end,
        resolution_summary = case
          when p_status in ('resolved', 'closed') then p_resolution_summary
          when p_status is null then t.resolution_summary
          else null
        end
    from targets old
    where t.id = old.id
    returning t.id, old.old_status, t.status new_status
  )
  insert into public.support_ticket_events
    (ticket_id, user_id, kind, old_status, new_status, note, internal)
  select id, auth.uid(), v_event_kind,
    case when p_status is null then null else old_status end,
    case when p_status is null then null else new_status end,
    v_event_note, true
  from changed;

  get diagnostics v_updated = row_count;
  return jsonb_build_object('updated', v_updated, 'event_kind', v_event_kind);
end;
$$;

revoke execute on function public.support_bulk_update(
  uuid[], text, text, text, uuid, text, timestamptz, text, text, text
) from public, anon;
grant execute on function public.support_bulk_update(
  uuid[], text, text, text, uuid, text, timestamptz, text, text, text
) to authenticated, service_role;
