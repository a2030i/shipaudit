-- متابعة خدمة العملاء داخل لمحة: إدارية فقط، بلا اعتماد على حالة محادثة هاتف.

alter table public.support_tickets
  add column if not exists priority text not null default 'normal',
  add column if not exists next_followup_at timestamptz,
  add column if not exists last_followup_at timestamptz,
  add column if not exists closure_reason text,
  add column if not exists resolution_summary text;

alter table public.support_tickets
  drop constraint if exists support_tickets_priority_check,
  add constraint support_tickets_priority_check
    check (priority in ('normal', 'high', 'urgent')),
  drop constraint if exists support_tickets_closure_reason_check,
  add constraint support_tickets_closure_reason_check
    check (closure_reason is null or closure_reason in (
      'resolved', 'carrier_confirmed', 'billing_corrected', 'customer_informed',
      'no_customer_response', 'duplicate', 'rejected_with_reason', 'other'
    ));

create index if not exists idx_support_tickets_open_followup
  on public.support_tickets (next_followup_at, assigned_to)
  where status in ('open', 'in_progress', 'waiting_customer');

create index if not exists idx_support_tickets_open_owner
  on public.support_tickets (assigned_to, priority, created_at desc)
  where status in ('open', 'in_progress', 'waiting_customer');

alter table public.support_ticket_events
  drop constraint if exists support_ticket_events_kind_check;
alter table public.support_ticket_events
  add constraint support_ticket_events_kind_check
  check (kind in ('create', 'status', 'assign', 'comment', 'attach', 'followup'));

create or replace function public.support_ticket_admin_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();

  if new.status in ('resolved', 'closed') then
    if nullif(btrim(new.closure_reason), '') is null
       or nullif(btrim(new.resolution_summary), '') is null then
      raise exception 'closure_reason_and_resolution_summary_required';
    end if;
    new.resolved_at := coalesce(new.resolved_at, now());
    new.next_followup_at := null;
  else
    new.resolved_at := null;
    new.closure_reason := null;
    new.resolution_summary := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_support_ticket_admin_guard on public.support_tickets;
create trigger trg_support_ticket_admin_guard
before insert or update on public.support_tickets
for each row execute function public.support_ticket_admin_guard();

-- الاعتماد على updated_at لإغلاق «بانتظار العميل» غير صحيح ما دام هاتف نظاماً
-- منفصلاً؛ نوقف الإغلاق الآلي ونبقي الإغلاق قراراً موثقاً من الموظف.
do $$
declare
  v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname = 'support-autoclose-daily'
  limit 1;
  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;
end;
$$;

create or replace function public.support_update_status(
  p_ticket uuid,
  p_status text,
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
  v_old public.support_tickets;
  v_new public.support_tickets;
  v_note text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('support.manage') then raise exception 'not_allowed'; end if;
  if p_status not in ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed') then
    raise exception 'invalid_status';
  end if;

  select * into v_old from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'ticket_not_found'; end if;

  update public.support_tickets
  set status = p_status,
      closure_reason = case when p_status in ('resolved', 'closed') then p_closure_reason else null end,
      resolution_summary = case when p_status in ('resolved', 'closed') then p_resolution_summary else null end
  where id = p_ticket
  returning * into v_new;

  v_note := coalesce(
    nullif(btrim(p_note), ''),
    case when p_status in ('resolved', 'closed') then nullif(btrim(p_resolution_summary), '') end
  );

  insert into public.support_ticket_events
    (ticket_id, user_id, kind, old_status, new_status, note, internal)
  values
    (p_ticket, auth.uid(), 'status', v_old.status, p_status, v_note, true);

  return to_jsonb(v_new);
end;
$$;

create or replace function public.support_assign_ticket(
  p_ticket uuid,
  p_assignee uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new public.support_tickets;
  v_name text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('support.manage') then raise exception 'not_allowed'; end if;

  if p_assignee is not null then
    select name into v_name from public.profiles where id = p_assignee;
    if v_name is null then raise exception 'assignee_not_found'; end if;
  end if;

  update public.support_tickets
  set assigned_to = p_assignee
  where id = p_ticket
  returning * into v_new;
  if not found then raise exception 'ticket_not_found'; end if;

  insert into public.support_ticket_events
    (ticket_id, user_id, kind, note, internal)
  values
    (p_ticket, auth.uid(), 'assign',
     case when p_assignee is null then 'أُلغي الإسناد' else 'أُسندت إلى ' || v_name end,
     true);

  return to_jsonb(v_new);
end;
$$;

create or replace function public.support_update_followup(
  p_ticket uuid,
  p_priority text default 'normal',
  p_next timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new public.support_tickets;
  v_event_note text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('support.manage') then raise exception 'not_allowed'; end if;
  if p_priority not in ('normal', 'high', 'urgent') then raise exception 'invalid_priority'; end if;

  update public.support_tickets
  set priority = p_priority,
      next_followup_at = p_next,
      last_followup_at = case when nullif(btrim(p_note), '') is not null then now() else last_followup_at end
  where id = p_ticket
    and status in ('open', 'in_progress', 'waiting_customer')
  returning * into v_new;
  if not found then raise exception 'open_ticket_not_found'; end if;

  v_event_note := concat_ws(
    ' · ',
    nullif(btrim(p_note), ''),
    'الأولوية: ' || case p_priority when 'urgent' then 'عاجلة' when 'high' then 'عالية' else 'عادية' end,
    case when p_next is null then 'بلا موعد قادم' else 'المتابعة: ' || to_char(p_next at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') end
  );

  insert into public.support_ticket_events
    (ticket_id, user_id, kind, note, internal)
  values
    (p_ticket, auth.uid(), 'followup', v_event_note, true);

  return to_jsonb(v_new);
end;
$$;

create or replace function public.support_ticket_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('support.view') then raise exception 'not_allowed'; end if;

  select jsonb_build_object(
    'open', count(*) filter (where status = 'open'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'waiting', count(*) filter (where status = 'waiting_customer'),
    'stale3d', count(*) filter (
      where status in ('open', 'in_progress', 'waiting_customer')
        and created_at < now() - interval '3 days'
    ),
    'resolved7d', count(*) filter (
      where status in ('resolved', 'closed')
        and coalesce(resolved_at, updated_at) > now() - interval '7 days'
    ),
    'overdue', count(*) filter (
      where status in ('open', 'in_progress', 'waiting_customer')
        and next_followup_at < now()
    ),
    'due_24h', count(*) filter (
      where status in ('open', 'in_progress', 'waiting_customer')
        and next_followup_at >= now()
        and next_followup_at <= now() + interval '24 hours'
    ),
    'unassigned', count(*) filter (
      where status in ('open', 'in_progress', 'waiting_customer')
        and assigned_to is null
    ),
    'without_followup', count(*) filter (
      where status in ('open', 'in_progress', 'waiting_customer')
        and next_followup_at is null
    ),
    'total', count(*)
  ) into v_out
  from public.support_tickets;

  return v_out;
end;
$$;

create or replace function public.support_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('support.view') then raise exception 'not_allowed'; end if;

  select jsonb_build_object(
    'by_status', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
      from (select status, count(*) cnt from public.support_tickets group by status) s
    ),
    'by_priority', (
      select coalesce(jsonb_object_agg(priority, cnt), '{}'::jsonb)
      from (select priority, count(*) cnt from public.support_tickets group by priority) p
    ),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'category', category, 'total', cnt, 'open', open_cnt
      ) order by cnt desc), '[]'::jsonb)
      from (
        select coalesce(category, 'other') category, count(*) cnt,
          count(*) filter (where status in ('open', 'in_progress', 'waiting_customer')) open_cnt
        from public.support_tickets group by 1
      ) c
    ),
    'by_carrier', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'carrier_id', carrier_id, 'carrier_name', carrier_name,
        'total', cnt, 'open', open_cnt
      ) order by cnt desc), '[]'::jsonb)
      from (
        select carrier_id, coalesce(max(carrier_name), carrier_id, 'بدون شركة') carrier_name,
          count(*) cnt,
          count(*) filter (where status in ('open', 'in_progress', 'waiting_customer')) open_cnt
        from public.support_tickets group by carrier_id
      ) c
    ),
    'by_owner', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'owner_id', owner_id, 'owner_name', owner_name,
        'open', open_cnt, 'overdue', overdue_cnt, 'due_24h', due_24h_cnt,
        'resolved_30d', resolved_30d_cnt, 'avg_resolution_hours', avg_hours
      ) order by overdue_cnt desc, open_cnt desc, owner_name), '[]'::jsonb)
      from (
        select t.assigned_to owner_id, coalesce(max(p.name), 'بلا مسؤول') owner_name,
          count(*) filter (where t.status in ('open', 'in_progress', 'waiting_customer')) open_cnt,
          count(*) filter (
            where t.status in ('open', 'in_progress', 'waiting_customer')
              and t.next_followup_at < now()
          ) overdue_cnt,
          count(*) filter (
            where t.status in ('open', 'in_progress', 'waiting_customer')
              and t.next_followup_at >= now()
              and t.next_followup_at <= now() + interval '24 hours'
          ) due_24h_cnt,
          count(*) filter (where t.resolved_at > now() - interval '30 days') resolved_30d_cnt,
          round((avg(extract(epoch from (t.resolved_at - t.created_at)) / 3600)
            filter (where t.resolved_at is not null))::numeric, 1) avg_hours
        from public.support_tickets t
        left join public.profiles p on p.id = t.assigned_to
        group by t.assigned_to
      ) o
    ),
    'avg_resolution_hours', (
      select round((avg(extract(epoch from (resolved_at - created_at)) / 3600))::numeric, 1)
      from public.support_tickets where resolved_at is not null
    ),
    'created_30d', (select count(*) from public.support_tickets where created_at > now() - interval '30 days'),
    'resolved_30d', (select count(*) from public.support_tickets where resolved_at > now() - interval '30 days')
  ) into v_out;

  return v_out;
end;
$$;

-- «ردود الحملات» = مهام متابعة مفتوحة نتجت عن رد حقيقي، وليست كل الردود الخام.
create or replace function public.sales_today(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  u uuid := coalesce(p_user, auth.uid());
  out jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if u is distinct from auth.uid() and not public.crm_can_see_all() then
    raise exception 'not_allowed';
  end if;

  select jsonb_build_object(
    'due_followups', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.next_at), '[]'::jsonb)
      from (
        select f.phone, v.primary_store store, f.status, f.next_action_at next_at, f.notes,
          greatest(0, extract(day from now() - f.next_action_at))::int days_over
        from public.retargeting_followups f
        left join lateral (
          select primary_store from public.v_crm_retargeting v where v.phone = f.phone limit 1
        ) v on true
        where f.owner_id = u and f.next_action_at is not null
          and f.next_action_at <= now() + interval '12 hours'
          and f.status not in ('converted','returned','not_interested','supplier','noise','blacklist','test')
        order by f.next_action_at
        limit 30
      ) x
    ),
    'lead_actions', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.next_at), '[]'::jsonb)
      from (
        select l.id, l.name, l.phone_normalized phone, l.status, l.last_disposition,
          l.next_action_at next_at, l.campaign_name, l.received_at
        from public.crm_leads l
        where l.owner_id = u and l.next_action_at is not null
          and l.next_action_at <= now() + interval '12 hours'
          and l.status not in ('converted','activated','lost','existing_customer')
        order by l.next_action_at
        limit 30
      ) x
    ),
    'replies', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.replied_at desc), '[]'::jsonb)
      from (
        select distinct on (t.entity_ref)
          t.id task_id, s.phone, s.name, s.template_name template, s.replied_at,
          left(coalesce(s.reply_body, ''), 120) reply, s.conversation_id,
          (s.hatif_assigned_at is not null) hatif_assigned
        from public.crm_tasks t
        join lateral (
          select ws.*
          from public.whatsapp_campaign_sends ws
          where ws.phone = t.entity_ref
            and ws.replied_at > now() - interval '48 hours'
            and coalesce(ws.reply_is_auto, false) = false
          order by ws.replied_at desc
          limit 1
        ) s on true
        where t.entity_type = 'retargeting'
          and t.kind = 'followup'
          and t.status = 'open'
          and (t.assigned_to = u or public.crm_can_see_all())
        order by t.entity_ref, s.replied_at desc
        limit 30
      ) x
    ),
    'my_new_leads', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at desc), '[]'::jsonb)
      from (
        select l.id, l.name, l.phone_normalized phone, l.category, l.campaign_name,
          l.received_at, l.first_response_due_at
        from public.crm_leads l
        where l.owner_id = u and l.lead_kind = 'inbound' and l.status = 'new'
        order by l.received_at desc
        limit 30
      ) x
    ),
    'my_new_leads_count', (
      select count(*) from public.crm_leads
      where owner_id = u and lead_kind = 'inbound' and status = 'new'
    ),
    'unassigned_inbound', (
      select case when public.crm_has_permission('crm.assign') then
        coalesce(jsonb_agg(to_jsonb(x) order by x.received_at), '[]'::jsonb)
      else '[]'::jsonb end
      from (
        select l.id, l.name, l.phone_normalized phone, l.campaign_name, l.received_at,
          l.first_response_due_at
        from public.crm_leads l
        where l.owner_id is null and l.lead_kind = 'inbound'
          and l.status not in ('converted','activated','lost','existing_customer')
        order by l.received_at
        limit 30
      ) x
    ),
    'my_tasks', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.due_at), '[]'::jsonb)
      from (
        select t.id, t.title, t.due_at, t.kind, t.entity_ref entity, t.entity_type
        from public.crm_tasks t
        where t.assigned_to = u
          and t.status = 'open'
          and t.due_at <= now() + interval '24 hours'
          and not (
            t.entity_type = 'retargeting'
            and t.kind = 'followup'
            and exists (
              select 1 from public.whatsapp_campaign_sends ws
              where ws.phone = t.entity_ref
                and ws.replied_at > now() - interval '48 hours'
                and coalesce(ws.reply_is_auto, false) = false
            )
          )
        order by t.due_at
        limit 30
      ) x
    ),
    'my_followups_total', (
      select count(*) from public.retargeting_followups
      where owner_id = u and status not in ('converted','returned','not_interested','supplier','noise','blacklist','test')
    )
  ) into out;
  return out;
end;
$$;

-- حماية الصفوف بنفس كتالوج الصلاحيات الذي تستعمله الواجهة.
drop policy if exists support_tickets_select on public.support_tickets;
drop policy if exists support_tickets_insert on public.support_tickets;
drop policy if exists support_tickets_update on public.support_tickets;
drop policy if exists support_tickets_delete on public.support_tickets;
create policy support_tickets_select on public.support_tickets
  for select to authenticated using (public.crm_has_permission('support.view'));
create policy support_tickets_insert on public.support_tickets
  for insert to authenticated with check (
    public.crm_has_permission('support.create') and created_by = auth.uid()
  );
create policy support_tickets_update on public.support_tickets
  for update to authenticated
  using (public.crm_has_permission('support.manage'))
  with check (public.crm_has_permission('support.manage'));
create policy support_tickets_delete on public.support_tickets
  for delete to authenticated using (public.crm_has_permission('support.delete'));

drop policy if exists support_ticket_events_select on public.support_ticket_events;
drop policy if exists support_ticket_events_insert on public.support_ticket_events;
create policy support_ticket_events_select on public.support_ticket_events
  for select to authenticated using (public.crm_has_permission('support.view'));
create policy support_ticket_events_insert on public.support_ticket_events
  for insert to authenticated with check (
    (public.crm_has_permission('support.create') or public.crm_has_permission('support.manage'))
    and user_id = auth.uid()
  );

drop policy if exists support_att_rows_select on public.support_ticket_attachments;
drop policy if exists support_att_rows_insert on public.support_ticket_attachments;
drop policy if exists support_att_rows_delete on public.support_ticket_attachments;
create policy support_att_rows_select on public.support_ticket_attachments
  for select to authenticated using (public.crm_has_permission('support.view'));
create policy support_att_rows_insert on public.support_ticket_attachments
  for insert to authenticated with check (
    public.crm_has_permission('support.create') and uploaded_by = auth.uid()
  );
create policy support_att_rows_delete on public.support_ticket_attachments
  for delete to authenticated using (public.crm_has_permission('support.delete'));

drop policy if exists support_att_read on storage.objects;
drop policy if exists support_att_write on storage.objects;
drop policy if exists support_att_delete on storage.objects;
create policy support_att_read on storage.objects
  for select to authenticated using (
    bucket_id = 'support-attachments' and public.crm_has_permission('support.view')
  );
create policy support_att_write on storage.objects
  for insert to authenticated with check (
    bucket_id = 'support-attachments' and public.crm_has_permission('support.create')
  );
create policy support_att_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'support-attachments' and public.crm_has_permission('support.delete')
  );

revoke execute on function public.support_ticket_admin_guard() from public, anon, authenticated;
revoke execute on function public.support_update_status(uuid, text, text, text, text) from public, anon;
revoke execute on function public.support_assign_ticket(uuid, uuid) from public, anon;
revoke execute on function public.support_update_followup(uuid, text, timestamptz, text) from public, anon;
revoke execute on function public.support_ticket_stats() from public, anon;
revoke execute on function public.support_dashboard() from public, anon;
revoke execute on function public.sales_today(uuid) from public, anon;

grant execute on function public.support_update_status(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.support_assign_ticket(uuid, uuid) to authenticated, service_role;
grant execute on function public.support_update_followup(uuid, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.support_ticket_stats() to authenticated, service_role;
grant execute on function public.support_dashboard() to authenticated, service_role;
grant execute on function public.sales_today(uuid) to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.support_autoclose()') is not null then
    execute 'revoke execute on function public.support_autoclose() from public, anon, authenticated';
    execute 'grant execute on function public.support_autoclose() to service_role';
  end if;
end;
$$;
