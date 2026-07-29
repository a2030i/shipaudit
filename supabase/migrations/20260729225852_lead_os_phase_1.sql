-- Lead OS phase 1
-- Excel is the primary intake today. The same model is ready for a future n8n webhook.
-- Keeps crm_leads as the canonical lead table to avoid breaking existing screens.

alter table public.crm_leads add column if not exists lead_kind text not null default 'cold';
alter table public.crm_leads add column if not exists source_channel text;
alter table public.crm_leads add column if not exists campaign_name text;
alter table public.crm_leads add column if not exists campaign_meta jsonb not null default '{}'::jsonb;
alter table public.crm_leads add column if not exists received_at timestamptz;
alter table public.crm_leads add column if not exists first_response_due_at timestamptz;
alter table public.crm_leads add column if not exists first_attempt_at timestamptz;
alter table public.crm_leads add column if not exists first_connected_at timestamptz;
alter table public.crm_leads add column if not exists last_touch_at timestamptz;
alter table public.crm_leads add column if not exists next_action_at timestamptz;
alter table public.crm_leads add column if not exists last_disposition text;
alter table public.crm_leads add column if not exists contact_attempts int not null default 0;
alter table public.crm_leads add column if not exists loss_reason text;
alter table public.crm_leads add column if not exists loss_notes text;
alter table public.crm_leads add column if not exists won_at timestamptz;
alter table public.crm_leads add column if not exists activated_at timestamptz;
alter table public.crm_leads add column if not exists converted_by uuid references public.profiles(id) on delete set null;
alter table public.crm_leads add column if not exists status_changed_at timestamptz;

update public.crm_leads
set received_at = coalesce(received_at, created_at),
    source_channel = coalesce(source_channel,
      case source when 'manual' then 'manual' when 'external_directory' then 'excel' else source end),
    status_changed_at = coalesce(status_changed_at, updated_at, created_at)
where received_at is null or source_channel is null or status_changed_at is null;

alter table public.crm_leads alter column received_at set default now();
alter table public.crm_leads alter column received_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_leads'::regclass and conname = 'crm_leads_lead_kind_check'
  ) then
    alter table public.crm_leads add constraint crm_leads_lead_kind_check
      check (lead_kind in ('cold','inbound','referral','existing'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_leads'::regclass and conname = 'crm_leads_disposition_check'
  ) then
    alter table public.crm_leads add constraint crm_leads_disposition_check
      check (last_disposition is null or last_disposition in
        ('answered','interested','callback','no_answer','busy','wrong_number','not_interested'));
  end if;
end $$;

create index if not exists ix_crm_leads_inbound_sla
  on public.crm_leads(first_response_due_at)
  where lead_kind = 'inbound' and status not in ('converted','activated','lost','existing_customer');
create index if not exists ix_crm_leads_next_action
  on public.crm_leads(owner_id, next_action_at)
  where next_action_at is not null and status not in ('converted','activated','lost','existing_customer');
create index if not exists ix_crm_leads_campaign
  on public.crm_leads(campaign_name, received_at desc)
  where campaign_name is not null;

-- Views materialize SELECT * columns at creation time. Append the new columns explicitly
-- while preserving the existing production column order and the in_hatif signal.
create or replace view public.crm_leads_campaign
with (security_invoker = true) as
select
  l.id, l.name, l.name_normalized, l.phone, l.whatsapp, l.email, l.source,
  l.snapshot_id, l.city, l.notes, l.status, l.owner_id, l.converted_at,
  l.converted_customer, l.converted_store_id, l.created_by, l.created_at, l.updated_at,
  l.phone_normalized, l.whatsapp_normalized, l.name_en, l.category, l.address,
  l.website, l.platform, l.store_url, l.social_links, l.raw_payload, l.source_row_number,
  l.duplicate_key, l.duplicate_count, l.duplicate_names, l.matched_store_id,
  l.matched_store_name, l.matched_store_status, l.matched_store_billing_type,
  l.matched_store_shipments, l.matched_store_last_shipment_at, l.matched_store_wallet,
  s.sent_at as last_campaign_at,
  s.status as last_campaign_status,
  s.template_name as last_campaign_template,
  s.replied_at as last_campaign_replied_at,
  exists (
    select 1 from public.hatif_unknown_contacts h where h.phone = l.phone_normalized
  ) as in_hatif,
  l.lead_kind, l.source_channel, l.campaign_name, l.campaign_meta, l.received_at,
  l.first_response_due_at, l.first_attempt_at, l.first_connected_at, l.last_touch_at,
  l.next_action_at, l.last_disposition, l.contact_attempts, l.loss_reason, l.loss_notes,
  l.won_at, l.activated_at, l.converted_by, l.status_changed_at
from public.crm_leads l
left join lateral (
  select w.sent_at, w.status, w.template_name, w.replied_at
  from public.whatsapp_campaign_sends w
  where w.phone = l.phone_normalized
  order by w.sent_at desc
  limit 1
) s on true;

-- One active sales opportunity per lead. Closed deals remain as history.
create unique index if not exists ux_crm_deals_one_open_lead
  on public.crm_deals(entity_ref)
  where entity_type = 'lead' and status = 'open';

create table if not exists public.crm_lead_history (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  disposition text,
  next_action_at timestamptz,
  owner_id uuid references public.profiles(id) on delete set null,
  changed_by uuid references public.profiles(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_crm_lead_history_lead
  on public.crm_lead_history(lead_id, created_at desc);
alter table public.crm_lead_history enable row level security;
grant select on public.crm_lead_history to authenticated, service_role;
revoke all on public.crm_lead_history from anon;

drop policy if exists crm_lead_history_select on public.crm_lead_history;
create policy crm_lead_history_select on public.crm_lead_history
for select to authenticated using (
  exists (
    select 1 from public.crm_leads l
    where l.id = lead_id
      and (l.owner_id = (select auth.uid()) or l.created_by = (select auth.uid()) or public.crm_can_see_all())
  )
);

create or replace function public.crm_has_permission(p_key text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and (
        p.role = 'admin'
        or coalesce((p.permissions ->> p_key)::boolean, false)
      )
  );
$$;
revoke all on function public.crm_has_permission(text) from public, anon;
grant execute on function public.crm_has_permission(text) to authenticated, service_role;

create or replace function public.crm_log_lead_history()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    insert into public.crm_lead_history(
      lead_id, event_type, to_status, disposition, next_action_at, owner_id, changed_by, details
    ) values (
      new.id, 'created', new.status, new.last_disposition, new.next_action_at,
      new.owner_id, coalesce((select auth.uid()), new.created_by),
      jsonb_build_object('source', new.source, 'channel', new.source_channel, 'campaign', new.campaign_name)
    );
    return new;
  end if;

  if old.owner_id is distinct from new.owner_id then v_type := 'assigned';
  elsif old.status is distinct from new.status then v_type := 'stage_changed';
  elsif old.last_disposition is distinct from new.last_disposition then v_type := 'outcome_recorded';
  elsif old.next_action_at is distinct from new.next_action_at then v_type := 'next_action_changed';
  else return new;
  end if;

  insert into public.crm_lead_history(
    lead_id, event_type, from_status, to_status, disposition, next_action_at,
    owner_id, changed_by, details
  ) values (
    new.id, v_type, old.status, new.status, new.last_disposition, new.next_action_at,
    new.owner_id, (select auth.uid()),
    jsonb_build_object('old_owner', old.owner_id, 'old_next_action_at', old.next_action_at)
  );
  return new;
end;
$$;
revoke all on function public.crm_log_lead_history() from public, anon, authenticated;

drop trigger if exists trg_crm_lead_history on public.crm_leads;
create trigger trg_crm_lead_history
after insert or update on public.crm_leads
for each row execute function public.crm_log_lead_history();

-- Return only existing identity keys for phones in the current Excel batch.
-- This replaces downloading the entire leads table to the browser.
create or replace function public.crm_find_existing_leads(p_phones text[])
returns table(phone_normalized text, name_normalized text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.crm_has_permission('crm.upload_leads') then
    raise exception 'not_allowed';
  end if;
  return query
    select l.phone_normalized, l.name_normalized
    from public.crm_leads l
    where l.phone_normalized = any(coalesce(p_phones, '{}'::text[]));
end;
$$;
revoke all on function public.crm_find_existing_leads(text[]) from public, anon;
grant execute on function public.crm_find_existing_leads(text[]) to authenticated, service_role;

-- Atomic result recording: contact outcome, lifecycle stage, activity, next task and deal.
create or replace function public.crm_record_lead_outcome(
  p_lead_id uuid,
  p_disposition text,
  p_status text,
  p_next_action timestamptz default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lead public.crm_leads%rowtype;
  v_stage_id uuid;
  v_connected boolean;
begin
  if v_uid is null or not public.crm_has_permission('crm.change_status') then
    raise exception 'not_allowed';
  end if;
  if p_disposition is null or p_disposition not in ('answered','interested','callback','no_answer','busy','wrong_number','not_interested') then
    raise exception 'invalid_disposition';
  end if;
  if p_status is null or p_status not in ('new','attempting','contacted','qualified','proposal','negotiation','nurture','lost') then
    raise exception 'invalid_status';
  end if;
  if p_status = 'lost' then
    raise exception 'use_close_lead_for_loss';
  end if;
  if p_status not in ('new') and p_next_action is null then
    raise exception 'next_action_required';
  end if;

  select * into v_lead from public.crm_leads where id = p_lead_id for update;
  if not found then raise exception 'lead_not_found'; end if;
  if v_lead.owner_id is distinct from v_uid and not public.crm_can_see_all() then
    raise exception 'not_allowed';
  end if;
  if v_lead.status in ('converted','activated','lost','existing_customer') then
    raise exception 'lead_closed';
  end if;

  v_connected := p_disposition in ('answered','interested','callback','not_interested');
  update public.crm_leads set
    status = p_status,
    last_disposition = p_disposition,
    contact_attempts = contact_attempts + 1,
    first_attempt_at = coalesce(first_attempt_at, now()),
    first_connected_at = case when v_connected then coalesce(first_connected_at, now()) else first_connected_at end,
    last_touch_at = now(),
    next_action_at = p_next_action,
    status_changed_at = case when status is distinct from p_status then now() else status_changed_at end,
    notes = case when nullif(btrim(coalesce(p_notes,'')), '') is null then notes
                 else concat_ws(E'\n', nullif(notes,''), '[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] ' || btrim(p_notes)) end,
    updated_at = now()
  where id = p_lead_id
  returning * into v_lead;

  insert into public.crm_activities(
    entity_type, entity_ref, kind, disposition, summary, body, occurred_at, owner_id, created_by
  ) values (
    'lead', p_lead_id::text, 'call', p_disposition,
    'نتيجة التواصل: ' || p_disposition, nullif(btrim(coalesce(p_notes,'')), ''),
    now(), v_lead.owner_id, v_uid
  );

  update public.crm_tasks
  set status = 'cancelled', updated_at = now()
  where entity_type = 'lead' and entity_ref = p_lead_id::text and status = 'open';

  if p_next_action is not null then
    insert into public.crm_tasks(
      entity_type, entity_ref, title, kind, due_at, status, priority, assigned_to, created_by
    ) values (
      'lead', p_lead_id::text, 'متابعة: ' || v_lead.name, 'sales_followup',
      p_next_action, 'open',
      case when p_next_action < now() + interval '24 hours' then 'high' else 'normal' end,
      coalesce(v_lead.owner_id, v_uid), v_uid
    );
  end if;

  if p_status in ('qualified','proposal','negotiation') then
    select id into v_stage_id from public.crm_stages
    where key = case p_status when 'qualified' then 'qualified' when 'proposal' then 'proposal' else 'negotiation' end;

    insert into public.crm_deals(
      title, entity_type, entity_ref, stage_id, value, owner_id, status, created_by
    ) values (
      'صفقة — ' || v_lead.name, 'lead', p_lead_id::text, v_stage_id, 0,
      coalesce(v_lead.owner_id, v_uid), 'open', v_uid
    )
    on conflict (entity_ref) where entity_type = 'lead' and status = 'open'
    do update set stage_id = excluded.stage_id, owner_id = excluded.owner_id, updated_at = now();
  end if;

  return to_jsonb(v_lead);
end;
$$;
revoke all on function public.crm_record_lead_outcome(uuid,text,text,timestamptz,text) from public, anon;
grant execute on function public.crm_record_lead_outcome(uuid,text,text,timestamptz,text) to authenticated, service_role;

-- Atomic close. Winning means the sale is closed; activation remains a separate measurable milestone.
create or replace function public.crm_close_lead(
  p_lead_id uuid,
  p_won boolean,
  p_reason text default null,
  p_notes text default null,
  p_customer_name text default null,
  p_store_id text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lead public.crm_leads%rowtype;
  v_stage_id uuid;
  v_status text := case when p_won then 'converted' else 'lost' end;
begin
  if v_uid is null or not (
    case when p_won then public.crm_has_permission('crm.convert_lead')
         else public.crm_has_permission('crm.change_status') end
  ) then raise exception 'not_allowed'; end if;
  if not p_won and nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception 'loss_reason_required';
  end if;

  select * into v_lead from public.crm_leads where id = p_lead_id for update;
  if not found then raise exception 'lead_not_found'; end if;
  if v_lead.owner_id is distinct from v_uid and not public.crm_can_see_all() then
    raise exception 'not_allowed';
  end if;
  if v_lead.status = v_status then return to_jsonb(v_lead); end if;
  if v_lead.status in ('converted','activated','lost') then raise exception 'lead_already_closed'; end if;

  update public.crm_leads set
    status = v_status,
    next_action_at = null,
    loss_reason = case when p_won then null else btrim(p_reason) end,
    loss_notes = case when p_won then null else nullif(btrim(coalesce(p_notes,'')), '') end,
    converted_at = case when p_won then now() else converted_at end,
    won_at = case when p_won then now() else won_at end,
    converted_customer = case when p_won then coalesce(nullif(btrim(coalesce(p_customer_name,'')), ''), name) else converted_customer end,
    converted_store_id = case when p_won then coalesce(p_store_id, matched_store_id) else converted_store_id end,
    converted_by = case when p_won then v_uid else converted_by end,
    status_changed_at = now(),
    updated_at = now()
  where id = p_lead_id
  returning * into v_lead;

  select id into v_stage_id from public.crm_stages where key = case when p_won then 'won' else 'lost' end;

  update public.crm_deals set
    stage_id = v_stage_id,
    status = case when p_won then 'won' else 'lost' end,
    lost_reason = case when p_won then null else btrim(p_reason) end,
    closed_at = now(),
    updated_at = now()
  where entity_type = 'lead' and entity_ref = p_lead_id::text and status = 'open';

  if not found then
    insert into public.crm_deals(
      title, entity_type, entity_ref, stage_id, value, owner_id, status,
      lost_reason, closed_at, created_by
    ) values (
      'صفقة — ' || v_lead.name, 'lead', p_lead_id::text, v_stage_id, 0,
      coalesce(v_lead.owner_id, v_uid), case when p_won then 'won' else 'lost' end,
      case when p_won then null else btrim(p_reason) end, now(), v_uid
    );
  end if;

  update public.crm_tasks
  set status = 'cancelled', updated_at = now()
  where entity_type = 'lead' and entity_ref = p_lead_id::text and status = 'open';

  insert into public.crm_activities(
    entity_type, entity_ref, kind, disposition, summary, body, occurred_at, owner_id, created_by
  ) values (
    'lead', p_lead_id::text, case when p_won then 'conversion' else 'lost' end,
    case when p_won then 'won' else p_reason end,
    case when p_won then 'أُغلقت الصفقة رابحة' else 'أُغلقت الفرصة: ' || p_reason end,
    nullif(btrim(coalesce(p_notes,'')), ''), now(), v_lead.owner_id, v_uid
  );

  return to_jsonb(v_lead);
end;
$$;
revoke all on function public.crm_close_lead(uuid,boolean,text,text,text,text) from public, anon;
grant execute on function public.crm_close_lead(uuid,boolean,text,text,text,text) to authenticated, service_role;

-- Lightweight work queue. LIMIT is inside each source subquery (the old function returned 12.7 MB).
create or replace function public.sales_today(p_user uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u uuid := coalesce(p_user, (select auth.uid()));
  out jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if u is distinct from (select auth.uid()) and not public.crm_can_see_all() then
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
        select s.phone, s.name, s.template_name template, s.replied_at,
          left(coalesce(s.reply_body,''), 120) reply
        from public.whatsapp_campaign_sends s
        where s.replied_at > now() - interval '48 hours'
          and (s.sent_by = u::text or public.crm_can_see_all())
        order by s.replied_at desc
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
        where t.assigned_to = u and t.status = 'open' and t.due_at <= now() + interval '24 hours'
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
revoke all on function public.sales_today(uuid) from public, anon;
grant execute on function public.sales_today(uuid) to authenticated, service_role;

create or replace function public.crm_leads_dashboard_meta()
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  with counts as (
    select
      count(*)::int total,
      count(*) filter (where status = 'new')::int new_count,
      count(*) filter (where lead_kind = 'inbound' and status = 'new')::int inbound_new,
      count(*) filter (where lead_kind = 'inbound' and owner_id is null
        and status not in ('converted','activated','lost','existing_customer'))::int inbound_unassigned,
      count(*) filter (where lead_kind = 'inbound' and first_response_due_at < now()
        and first_attempt_at is null and status not in ('converted','activated','lost','existing_customer'))::int overdue_sla,
      count(*) filter (where matched_store_id is not null or status = 'existing_customer')::int existing_customers,
      count(*) filter (where coalesce(duplicate_count, 1) > 1)::int duplicate_rows,
      count(*) filter (where owner_id is null)::int unassigned,
      count(*) filter (where status in ('converted','activated'))::int converted
    from public.crm_leads
  ),
  cat as (
    with recursive t as (
      (select category c from public.crm_leads where category is not null order by category limit 1)
      union all
      select (select category from public.crm_leads where category > t.c and category is not null order by category limit 1)
      from t where t.c is not null
    )
    select coalesce(jsonb_agg(c order by c), '[]'::jsonb) items from t where nullif(c,'') is not null
  ),
  plat as (
    with recursive t as (
      (select platform c from public.crm_leads where platform is not null order by platform limit 1)
      union all
      select (select platform from public.crm_leads where platform > t.c and platform is not null order by platform limit 1)
      from t where t.c is not null
    )
    select coalesce(jsonb_agg(c order by c), '[]'::jsonb) items from t where nullif(c,'') is not null
  ),
  stat as (
    with recursive t as (
      (select status c from public.crm_leads where status is not null order by status limit 1)
      union all
      select (select status from public.crm_leads where status > t.c and status is not null order by status limit 1)
      from t where t.c is not null
    )
    select coalesce(jsonb_agg(c order by c), '[]'::jsonb) items from t where nullif(c,'') is not null
  )
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'total', counts.total,
      'newCount', counts.new_count,
      'inboundNew', counts.inbound_new,
      'inboundUnassigned', counts.inbound_unassigned,
      'overdueSla', counts.overdue_sla,
      'existingCustomers', counts.existing_customers,
      'duplicateRows', counts.duplicate_rows,
      'unassigned', counts.unassigned,
      'converted', counts.converted
    ),
    'options', jsonb_build_object(
      'categories', cat.items, 'platforms', plat.items, 'statuses', stat.items
    )
  )
  from counts, cat, plat, stat;
$$;
revoke all on function public.crm_leads_dashboard_meta() from public, anon;
grant execute on function public.crm_leads_dashboard_meta() to authenticated, service_role;
