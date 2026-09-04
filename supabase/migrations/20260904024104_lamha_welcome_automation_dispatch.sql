-- Durable dispatch bridge for the Lamha new-customer welcome automation.
-- A successful Lamha snapshot may prepare a Hatif campaign, but this function
-- is inert until the rule is explicitly active, automatic and fully configured.

create table if not exists public.automation_dispatches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.automation_runs(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete restrict,
  rule_version integer not null check (rule_version > 0),
  source_snapshot_id text not null,
  source_event_id bigint not null references public.merchant_lifecycle_events(id) on delete restrict,
  phone text not null,
  entity_name text,
  template_name text not null,
  template_variables jsonb not null default '[]'::jsonb,
  status text not null default 'prepared'
    check (status in ('prepared','queued','sent','failed','skipped','unknown','cancelled')),
  queue_id bigint references public.campaign_queue(id) on delete set null,
  reason text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  finished_at timestamptz,
  unique (rule_id, phone),
  unique (rule_id, source_event_id)
);

create index if not exists automation_dispatches_run_status_idx
  on public.automation_dispatches (run_id, status);
create index if not exists automation_dispatches_queue_idx
  on public.automation_dispatches (queue_id) where queue_id is not null;
create index if not exists automation_dispatches_source_event_idx
  on public.automation_dispatches (source_event_id);

alter table public.automation_dispatches enable row level security;
revoke all on table public.automation_dispatches from public, anon;
grant select on table public.automation_dispatches to authenticated;
grant select, insert, update, delete on table public.automation_dispatches to service_role;

drop policy if exists automation_dispatches_read on public.automation_dispatches;
create policy automation_dispatches_read on public.automation_dispatches
  for select to authenticated
  using (public.app_has_any_permission(array['agents.view']));

create or replace function public.queue_lamha_welcome_automation(p_snapshot_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rule public.automation_rules;
  v_run_id uuid;
  v_queue_id bigint;
  v_latest_snapshot text;
  v_source_at timestamptz;
  v_checked integer := 0;
  v_invalid integer := 0;
  v_queued integer := 0;
  v_limit integer;
  v_lookback integer;
  v_delay integer;
  v_start time;
  v_end time;
  v_local_target timestamp;
  v_scheduled_at timestamptz;
  v_vars jsonb;
  v_recipients jsonb;
begin
  select * into v_rule
  from public.automation_rules
  where rule_key = 'welcome_new_customer';

  if not found
     or v_rule.status <> 'active'
     or v_rule.execution_mode <> 'automatic' then
    return jsonb_build_object('ok', true, 'queued', 0, 'status', 'disabled');
  end if;

  if v_rule.trigger_source <> 'lamha'
     or v_rule.event_type <> 'new_customer'
     or nullif(trim(v_rule.template_name), '') is null then
    return jsonb_build_object('ok', false, 'queued', 0, 'status', 'invalid_rule');
  end if;

  select coalesce(jsonb_agg(variable->>'value' order by (variable->>'position')::integer), '[]'::jsonb)
  into v_vars
  from jsonb_array_elements(v_rule.template_variables) variable;

  if jsonb_array_length(v_vars) < 2
     or exists (
       select 1 from jsonb_array_elements_text(v_vars) value
       where nullif(trim(value), '') is null
     ) then
    return jsonb_build_object('ok', false, 'queued', 0, 'status', 'template_variables_required');
  end if;

  select snapshot_id, max(uploaded_at)
  into v_latest_snapshot, v_source_at
  from public.merchants
  group by snapshot_id
  order by max(uploaded_at) desc
  limit 1;

  if v_latest_snapshot is null or v_latest_snapshot <> p_snapshot_id then
    return jsonb_build_object('ok', false, 'queued', 0, 'status', 'stale_snapshot');
  end if;

  -- Serialize the same rule across overlapping manual/cron synchronizations.
  perform pg_advisory_xact_lock(hashtext(v_rule.id::text));

  v_limit := least(greatest(coalesce((v_rule.safeguards->>'maxRecipientsPerRun')::integer, 200), 1), 200);
  v_lookback := greatest(coalesce((v_rule.trigger_config->>'lookbackHours')::integer, 24), 1);
  v_delay := greatest(coalesce((v_rule.schedule_config->>'delayMinutes')::integer, 10), 0);
  v_start := coalesce(nullif(v_rule.schedule_config->>'sendWindowStart', '')::time, time '09:00');
  v_end := coalesce(nullif(v_rule.schedule_config->>'sendWindowEnd', '')::time, time '20:00');

  v_local_target := (now() at time zone 'Asia/Riyadh') + make_interval(mins => v_delay);
  if v_local_target::time < v_start then
    v_local_target := v_local_target::date + v_start;
  elsif v_local_target::time > v_end then
    v_local_target := (v_local_target::date + 1) + v_start;
  end if;
  v_scheduled_at := v_local_target at time zone 'Asia/Riyadh';

  select count(*)::integer,
         count(*) filter (
           where public.norm_sa_phone(e.phone) is null
              or length(public.norm_sa_phone(e.phone)) < 11
         )::integer
  into v_checked, v_invalid
  from public.merchant_lifecycle_events e
  where e.event_type = 'registered'
    and e.observed_at >= now() - make_interval(hours => v_lookback);

  insert into public.automation_runs (
    rule_id, rule_version, status, trigger_type, source_snapshot,
    checked_count, eligible_count, excluded_count, action_count, summary
  ) values (
    v_rule.id, v_rule.version, 'running', 'event',
    jsonb_build_object('system', 'lamha', 'snapshotId', p_snapshot_id, 'sourceAt', v_source_at),
    v_checked, 0, v_invalid, 0, 'فحص العملاء الجدد بعد مزامنة لمحة'
  ) returning id into v_run_id;

  with normalized as (
    select
      min(e.id) as source_event_id,
      public.norm_sa_phone(e.phone) as phone,
      (array_agg(e.store_name order by e.observed_at, e.store_id))[1] as entity_name
    from public.merchant_lifecycle_events e
    where e.event_type = 'registered'
      and e.observed_at >= now() - make_interval(hours => v_lookback)
      and public.norm_sa_phone(e.phone) is not null
      and length(public.norm_sa_phone(e.phone)) >= 11
    group by public.norm_sa_phone(e.phone)
  ), eligible as (
    select n.*
    from normalized n
    where not exists (
      select 1 from public.no_whatsapp_phones() blocked where blocked.phone = n.phone
    )
      and not exists (
        select 1
        from public.whatsapp_campaign_sends sent
        where public.norm_sa_phone(sent.phone) = n.phone
          and sent.template_name = v_rule.template_name
      )
    order by n.source_event_id
    limit v_limit
  )
  insert into public.automation_dispatches (
    run_id, rule_id, rule_version, source_snapshot_id, source_event_id,
    phone, entity_name, template_name, template_variables, status
  )
  select
    v_run_id, v_rule.id, v_rule.version, p_snapshot_id, e.source_event_id,
    e.phone, e.entity_name, v_rule.template_name, v_vars, 'prepared'
  from eligible e
  on conflict do nothing;

  get diagnostics v_queued = row_count;

  select coalesce(jsonb_agg(jsonb_build_object(
    'to', d.phone,
    'name', d.entity_name,
    'vars', d.template_variables,
    'idempotency_ref', 'automation:' || d.rule_id::text || ':' || d.phone,
    'automation_dispatch_id', d.id,
    'automation_run_id', d.run_id
  ) order by d.created_at, d.id), '[]'::jsonb)
  into v_recipients
  from public.automation_dispatches d
  where d.run_id = v_run_id and d.status = 'prepared';

  if v_queued > 0 then
    insert into public.campaign_queue (
      scheduled_at, template_name, recipients, bucket_label, status, created_by
    ) values (
      v_scheduled_at, v_rule.template_name, v_recipients,
      'أتمتة: ترحيب العميل الجديد', 'pending', null
    ) returning id into v_queue_id;

    update public.automation_dispatches
    set status = 'queued', queue_id = v_queue_id, queued_at = now()
    where run_id = v_run_id and status = 'prepared';
  end if;

  update public.automation_runs
  set
    status = case when v_queued > 0 then 'queued' else 'succeeded' end,
    eligible_count = v_queued,
    excluded_count = greatest(v_checked - v_queued, 0),
    action_count = 0,
    summary = case
      when v_queued > 0 then 'تمت جدولة ' || v_queued || ' رسالة ترحيب'
      else 'لا يوجد عميل جديد مؤهل للإرسال'
    end,
    details = jsonb_build_object(
      'queueId', v_queue_id,
      'scheduledAt', v_scheduled_at,
      'template', v_rule.template_name,
      'invalidPhones', v_invalid,
      'audienceIdentity', 'normalized_phone'
    ),
    finished_at = case when v_queued = 0 then now() else null end
  where id = v_run_id;

  update public.automation_rules
  set last_run_at = now(), next_run_at = null, updated_at = now()
  where id = v_rule.id;

  return jsonb_build_object(
    'ok', true,
    'status', case when v_queued > 0 then 'queued' else 'empty' end,
    'runId', v_run_id,
    'queueId', v_queue_id,
    'checked', v_checked,
    'queued', v_queued,
    'excluded', greatest(v_checked - v_queued, 0),
    'scheduledAt', v_scheduled_at
  );
end;
$function$;

revoke all on function public.queue_lamha_welcome_automation(text)
  from public, anon, authenticated;
grant execute on function public.queue_lamha_welcome_automation(text)
  to service_role;

comment on function public.queue_lamha_welcome_automation(text) is
  'Service-role only. Queues one approved welcome per normalized phone after a successful latest Lamha snapshot; inert unless the rule is active and complete.';

-- Register the already-approved Hatif template in the application catalogue,
-- and point the rule at it without activating external delivery. The two fixed
-- values remain deliberately empty until the manager supplies them.
update public.app_settings
set value = jsonb_set(
  value::jsonb,
  '{templates}',
  (
    select jsonb_agg(template order by ordinal)
    from (
      select distinct on (template) template, ordinal
      from (
        select item.value as template, item.ordinality::integer as ordinal
        from jsonb_array_elements_text(coalesce(value::jsonb->'templates', '[]'::jsonb)) with ordinality item(value, ordinality)
        union all select 'masrah', 1000000
      ) templates
      order by template, ordinal
    ) unique_templates
  ),
  true
)::text
where key = 'whatsapp_config';

update public.automation_rules
set
  template_name = 'masrah',
  status = 'preview',
  execution_mode = 'preview',
  safeguards = safeguards || jsonb_build_object(
    'audienceIdentity', 'normalized_phone',
    'dedupeMode', 'once_per_phone_ever',
    'dedupeHours', 720,
    'maxMessagesPerPhonePerDay', 1,
    'maxRecipientsPerRun', 200,
    'requireFreshSources', true,
    'retryConfirmedFailures', 1,
    'blockUnknownDeliveryRetry', true
  ),
  version = version + 1,
  updated_at = now()
where rule_key = 'welcome_new_customer';

insert into public.automation_rule_versions (rule_id, version, snapshot, change_note)
select
  rule.id,
  rule.version,
  to_jsonb(rule) - 'last_preview_at' - 'last_preview_count' - 'last_run_at' - 'next_run_at',
  'اعتماد قالب masrah مع إبقاء الإرسال في وضع المعاينة حتى إدخال المتغيرين'
from public.automation_rules rule
where rule.rule_key = 'welcome_new_customer'
on conflict (rule_id, version) do nothing;
