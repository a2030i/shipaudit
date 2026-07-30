-- CRM تشغيلي لمتاجر المنصّة.
--
-- يفصل بين:
--   1) الحالة الموضوعية للمتجر من أحدث snapshot (بدأ الشحن / توقف / عاد).
--   2) مرحلة البيع التي يحدّثها الموظف (جديد / تواصل / مؤهل / ... / خسرناه).
--   3) نتيجة آخر تواصل وموعد الإجراء التالي.
--
-- ردود هاتف لا تنشئ Lead ولا تغيّر المرحلة. تُعرض في الواجهة كسياق قراءة فقط.

alter table public.retargeting_followups
  add column if not exists sales_stage text not null default 'new',
  add column if not exists next_action_type text not null default 'call',
  add column if not exists first_contact_at timestamptz,
  add column if not exists contact_attempts integer not null default 0,
  add column if not exists loss_reason text,
  add column if not exists lost_at timestamptz,
  add column if not exists won_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.retargeting_followups'::regclass
      and conname = 'retargeting_followups_sales_stage_check'
  ) then
    alter table public.retargeting_followups
      add constraint retargeting_followups_sales_stage_check
      check (
        sales_stage in (
          'new', 'contacted', 'qualified', 'proposal',
          'negotiation', 'nurture', 'won', 'lost', 'disqualified'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.retargeting_followups'::regclass
      and conname = 'retargeting_followups_next_action_type_check'
  ) then
    alter table public.retargeting_followups
      add constraint retargeting_followups_next_action_type_check
      check (next_action_type in ('call', 'whatsapp', 'meeting', 'email', 'other'));
  end if;
end;
$$;

update public.retargeting_followups
set
  sales_stage = case
    when status in ('converted', 'returned') then 'won'
    when status in ('not_interested', 'competitor', 'closed_business') then 'lost'
    when status in ('supplier', 'noise', 'blacklist', 'test') then 'disqualified'
    when status = 'interested' then 'qualified'
    when status in (
      'contacted', 'whatsapp_sent', 'price_issue',
      'support_issue', 'integration_issue', 'finance'
    ) then 'contacted'
    when status in ('needs_followup', 'no_answer') then 'nurture'
    else 'new'
  end,
  first_contact_at = case
    when last_touch_at is not null then coalesce(first_contact_at, last_touch_at)
    else first_contact_at
  end,
  contact_attempts = case
    when last_touch_at is not null then greatest(contact_attempts, 1)
    else contact_attempts
  end,
  lost_at = case
    when status in ('not_interested', 'competitor', 'closed_business')
      then coalesce(lost_at, updated_at)
    else lost_at
  end,
  won_at = case
    when status in ('converted', 'returned')
      then coalesce(won_at, updated_at)
    else won_at
  end;

create index if not exists retargeting_followups_sales_stage_idx
  on public.retargeting_followups (sales_stage, updated_at desc);
create index if not exists retargeting_followups_owner_next_open_idx
  on public.retargeting_followups (owner_id, next_action_at)
  where sales_stage not in ('won', 'disqualified');

-- نعيد استخدام سجل CRM الموحّد للملاحظات والاتصالات بدل إنشاء timeline ثانٍ.
alter table public.crm_activities
  drop constraint if exists crm_activities_entity_type_check;
alter table public.crm_activities
  add constraint crm_activities_entity_type_check
  check (entity_type in ('customer', 'lead', 'deal', 'platform_merchant'));

-- Backfill موضوعي لأحداث المنصّة من الـ22 snapshots التاريخية. الجدول كان
-- فارغاً لأن ميزة الالتقاط أضيفت بعد آخر رفع؛ ON CONFLICT يجعلها idempotent.
with snapshot_dates as (
  select snapshot_id, max(uploaded_at) as uploaded_at
  from public.merchants
  group by snapshot_id
),
snapshot_pairs as (
  select
    snapshot_id,
    uploaded_at,
    lag(snapshot_id) over (order by uploaded_at, snapshot_id) as previous_snapshot_id
  from snapshot_dates
)
insert into public.merchant_lifecycle_events (
  snapshot_id, previous_snapshot_id, store_id, store_name, phone,
  event_type, to_value, shipment_delta, wallet_delta, observed_at
)
select
  pair.snapshot_id,
  pair.previous_snapshot_id,
  current_store.store_id,
  coalesce(current_store.store_name, '—'),
  current_store.phone,
  'registered',
  current_store.status,
  coalesce(current_store.shipment_count, 0),
  round(coalesce(current_store.wallet_balance, 0)::numeric, 2),
  pair.uploaded_at
from snapshot_pairs pair
join public.merchants current_store
  on current_store.snapshot_id = pair.snapshot_id
left join public.merchants previous_store
  on previous_store.snapshot_id = pair.previous_snapshot_id
 and previous_store.store_id = current_store.store_id
where pair.previous_snapshot_id is not null
  and previous_store.id is null
on conflict (snapshot_id, store_id, event_type) do nothing;

with snapshot_dates as (
  select snapshot_id, max(uploaded_at) as uploaded_at
  from public.merchants
  group by snapshot_id
),
snapshot_pairs as (
  select
    snapshot_id,
    uploaded_at,
    lag(snapshot_id) over (order by uploaded_at, snapshot_id) as previous_snapshot_id
  from snapshot_dates
)
insert into public.merchant_lifecycle_events (
  snapshot_id, previous_snapshot_id, store_id, store_name, phone,
  event_type, from_value, to_value, shipment_delta, wallet_delta, observed_at
)
select
  pair.snapshot_id,
  pair.previous_snapshot_id,
  current_store.store_id,
  coalesce(current_store.store_name, '—'),
  current_store.phone,
  event.event_type,
  event.from_value,
  event.to_value,
  coalesce(current_store.shipment_count, 0) - coalesce(previous_store.shipment_count, 0),
  round((
    coalesce(current_store.wallet_balance, 0)
    - coalesce(previous_store.wallet_balance, 0)
  )::numeric, 2),
  pair.uploaded_at
from snapshot_pairs pair
join public.merchants current_store
  on current_store.snapshot_id = pair.snapshot_id
join public.merchants previous_store
  on previous_store.snapshot_id = pair.previous_snapshot_id
 and previous_store.store_id = current_store.store_id
cross join lateral (
  values
    (
      'profile_completed'::text,
      previous_store.profile_status,
      current_store.profile_status,
      coalesce(previous_store.profile_status, '') <> 'مكتمل'
        and current_store.profile_status = 'مكتمل'
    ),
    (
      'verified',
      previous_store.verification_status,
      current_store.verification_status,
      coalesce(previous_store.verification_status, '') <> 'موثق'
        and current_store.verification_status = 'موثق'
    ),
    (
      'integration_connected',
      previous_store.integration_type,
      current_store.integration_type,
      previous_store.integration_type is null
        and current_store.integration_type is not null
    ),
    (
      'integration_changed',
      previous_store.integration_type,
      current_store.integration_type,
      previous_store.integration_type is not null
        and current_store.integration_type is not null
        and previous_store.integration_type is distinct from current_store.integration_type
    ),
    (
      'wallet_topped',
      previous_store.last_topup_at::text,
      current_store.last_topup_at::text,
      current_store.last_topup_at is not null
        and (
          previous_store.last_topup_at is null
          or current_store.last_topup_at > previous_store.last_topup_at
        )
    ),
    (
      'first_shipment',
      coalesce(previous_store.shipment_count, 0)::text,
      coalesce(current_store.shipment_count, 0)::text,
      coalesce(previous_store.shipment_count, 0) = 0
        and coalesce(current_store.shipment_count, 0) > 0
    ),
    (
      'shipping_resumed',
      previous_store.last_shipment_at::text,
      current_store.last_shipment_at::text,
      coalesce(current_store.shipment_count, 0) > coalesce(previous_store.shipment_count, 0)
        and previous_store.last_shipment_at is not null
        and current_store.last_shipment_at is not null
        and previous_store.last_shipment_at < previous_store.uploaded_at - interval '60 days'
    ),
    (
      'deactivated',
      previous_store.status,
      current_store.status,
      previous_store.status = 'نشط' and current_store.status = 'غير نشط'
    ),
    (
      'reactivated',
      previous_store.status,
      current_store.status,
      previous_store.status = 'غير نشط' and current_store.status = 'نشط'
    )
) as event(event_type, from_value, to_value, changed)
where pair.previous_snapshot_id is not null
  and event.changed
on conflict (snapshot_id, store_id, event_type) do nothing;

create or replace function public.platform_sales_pipeline(
  p_bucket text default 'new',
  p_owner uuid default null,
  p_unassigned boolean default false,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_see_all boolean;
  v_result jsonb;
begin
  if v_uid is null
     or not (
       public.crm_has_permission('sales.view')
       or public.crm_has_permission('crm.view')
       or public.crm_has_permission('merchants.view')
     ) then
    raise exception 'not_allowed';
  end if;

  v_see_all := public.crm_can_see_all();
  if p_owner is not null and p_owner is distinct from v_uid and not v_see_all then
    raise exception 'not_allowed';
  end if;

  if coalesce(p_bucket, 'all') not in (
    'all', 'new', 'in_progress', 'recontact_due', 'scheduled',
    'active', 'stopped', 'reactivated', 'won', 'lost', 'unscheduled'
  ) then
    raise exception 'invalid_bucket';
  end if;

  with recent_events as (
    select
      phone,
      bool_or(event_type in ('reactivated', 'shipping_resumed')
        and observed_at >= now() - interval '30 days') as reactivated_30d,
      max(observed_at) filter (
        where event_type in ('reactivated', 'shipping_resumed')
      ) as last_reactivated_at
    from public.merchant_lifecycle_events
    where phone is not null
    group by phone
  ),
  base as (
    select
      v.phone,
      v.primary_store,
      v.store_names,
      v.store_count,
      v.total_shipments,
      v.last_shipment,
      v.days_since_last,
      v.wallet,
      v.last_topup,
      v.created_at,
      v.integration_type,
      v.billing_type,
      v.profile_done,
      v.verified,
      v.segment,
      v.priority,
      v.channel,
      v.readiness_score,
      v.opportunity_score,
      v.team_route,
      v.next_step,
      f.phone is not null as has_followup,
      coalesce(f.sales_stage, 'new') as sales_stage,
      coalesce(f.status, 'new') as last_outcome,
      f.owner_id,
      profile.name as owner_name,
      f.next_action_at,
      coalesce(f.next_action_type, 'call') as next_action_type,
      f.notes,
      f.last_touch_at,
      f.first_contact_at,
      coalesce(f.contact_attempts, 0) as contact_attempts,
      f.loss_reason,
      f.lost_at,
      f.won_at,
      f.updated_at,
      coalesce(events.reactivated_30d, false) as reactivated_30d,
      events.last_reactivated_at,
      case
        when v.segment = 'negative_balance' then 'financial_hold'
        when v.total_shipments = 0 then 'pending_first_shipment'
        when v.segment = 'active' then 'active'
        when v.segment in ('stopped_recent', 'stopped_long') then 'stopped'
        else 'unknown'
      end as platform_state
    from public.v_crm_retargeting v
    left join public.retargeting_followups f on f.phone = v.phone
    left join public.profiles profile on profile.id = f.owner_id
    left join recent_events events on events.phone = v.phone
  ),
  scoped as (
    select *
    from base
    where
      (v_see_all or owner_id = v_uid or not has_followup)
      and (p_owner is null or owner_id = p_owner)
      and (not p_unassigned or not has_followup)
  ),
  searched as (
    select *
    from scoped
    where p_search is null
       or btrim(p_search) = ''
       or phone ilike '%' || btrim(p_search) || '%'
       or primary_store ilike '%' || btrim(p_search) || '%'
       or exists (
         select 1
         from unnest(store_names) store_name
         where store_name ilike '%' || btrim(p_search) || '%'
       )
  ),
  filtered as (
    select *
    from searched
    where
      coalesce(p_bucket, 'all') = 'all'
      or (
        p_bucket = 'new'
        and total_shipments = 0
        and created_at >= current_date - 30
        and sales_stage = 'new'
      )
      or (
        p_bucket = 'in_progress'
        and has_followup
        and sales_stage in (
          'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
        )
      )
      or (
        p_bucket = 'recontact_due'
        and has_followup
        and next_action_at is not null
        and next_action_at <= now()
        and sales_stage not in ('won', 'disqualified')
      )
      or (
        p_bucket = 'scheduled'
        and has_followup
        and next_action_at > now()
        and sales_stage not in ('won', 'disqualified')
      )
      or (p_bucket = 'active' and platform_state = 'active')
      or (p_bucket = 'stopped' and platform_state = 'stopped')
      or (p_bucket = 'reactivated' and reactivated_30d)
      or (p_bucket = 'won' and sales_stage = 'won')
      or (p_bucket = 'lost' and sales_stage = 'lost')
      or (
        p_bucket = 'unscheduled'
        and has_followup
        and next_action_at is null
        and sales_stage in (
          'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
        )
      )
  ),
  ordered as (
    select *
    from filtered
    order by
      case when next_action_at is not null and next_action_at <= now() then 0 else 1 end,
      case
        when p_bucket = 'new' then opportunity_score
        when p_bucket = 'stopped' then least(total_shipments, 2147483647)::integer
        else 0
      end desc,
      next_action_at asc nulls last,
      updated_at desc nulls last,
      created_at desc nulls last,
      primary_store
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'total', count(*),
      'new', count(*) filter (
        where total_shipments = 0
          and created_at >= current_date - 30
          and sales_stage = 'new'
      ),
      'in_progress', count(*) filter (
        where has_followup
          and sales_stage in (
            'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
          )
      ),
      'recontact_due', count(*) filter (
        where has_followup
          and next_action_at is not null
          and next_action_at <= now()
          and sales_stage not in ('won', 'disqualified')
      ),
      'scheduled', count(*) filter (
        where has_followup
          and next_action_at > now()
          and sales_stage not in ('won', 'disqualified')
      ),
      'active', count(*) filter (where platform_state = 'active'),
      'stopped', count(*) filter (where platform_state = 'stopped'),
      'reactivated', count(*) filter (where reactivated_30d),
      'won', count(*) filter (where sales_stage = 'won'),
      'lost', count(*) filter (where sales_stage = 'lost'),
      'unscheduled', count(*) filter (
        where has_followup
          and next_action_at is null
          and sales_stage in (
            'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
          )
      ),
      'unassigned', count(*) filter (where not has_followup)
    ),
    'count', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(to_jsonb(row_data)) from ordered row_data), '[]'::jsonb)
  )
  into v_result
  from scoped;

  return v_result;
end;
$function$;

create or replace function public.platform_sales_account(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_exists boolean;
  v_result jsonb;
begin
  if v_uid is null
     or not (
       public.crm_has_permission('sales.view')
       or public.crm_has_permission('crm.view')
       or public.crm_has_permission('merchants.view')
     ) then
    raise exception 'not_allowed';
  end if;

  select
    f.owner_id,
    v.phone is not null
  into v_owner, v_exists
  from public.v_crm_retargeting v
  left join public.retargeting_followups f on f.phone = v.phone
  where v.phone = p_phone
  limit 1;

  if not coalesce(v_exists, false) then
    raise exception 'account_not_found';
  end if;

  if v_owner is not null
     and v_owner is distinct from v_uid
     and not public.crm_can_see_all() then
    raise exception 'not_allowed';
  end if;

  select jsonb_build_object(
    'account', (
      select to_jsonb(account_row)
      from (
        select
          v.*,
          coalesce(f.sales_stage, 'new') as sales_stage,
          coalesce(f.status, 'new') as last_outcome,
          f.owner_id,
          profile.name as owner_name,
          f.next_action_at,
          coalesce(f.next_action_type, 'call') as next_action_type,
          f.notes,
          f.last_touch_at,
          f.first_contact_at,
          coalesce(f.contact_attempts, 0) as contact_attempts,
          f.loss_reason,
          f.lost_at,
          f.won_at,
          f.updated_at
        from public.v_crm_retargeting v
        left join public.retargeting_followups f on f.phone = v.phone
        left join public.profiles profile on profile.id = f.owner_id
        where v.phone = p_phone
        limit 1
      ) account_row
    ),
    'activities', (
      select coalesce(jsonb_agg(to_jsonb(activity_row) order by activity_row.occurred_at desc), '[]'::jsonb)
      from (
        select
          activity.id,
          activity.kind,
          activity.disposition,
          activity.summary,
          activity.body,
          activity.occurred_at,
          profile.name as created_by_name
        from public.crm_activities activity
        left join public.profiles profile on profile.id = activity.created_by
        where activity.entity_type = 'platform_merchant'
          and activity.entity_ref = p_phone
        order by activity.occurred_at desc
        limit 100
      ) activity_row
    ),
    'lifecycle', (
      select coalesce(jsonb_agg(to_jsonb(lifecycle_row) order by lifecycle_row.observed_at desc), '[]'::jsonb)
      from (
        select
          event_type,
          store_name,
          from_value,
          to_value,
          shipment_delta,
          wallet_delta,
          observed_at
        from public.merchant_lifecycle_events
        where phone = p_phone
        order by observed_at desc
        limit 100
      ) lifecycle_row
    ),
    'status_changes', (
      select coalesce(jsonb_agg(to_jsonb(status_row) order by status_row.changed_at desc), '[]'::jsonb)
      from (
        select
          log.old_status,
          log.new_status,
          log.changed_at,
          profile.name as changed_by_name
        from public.retargeting_status_log log
        left join public.profiles profile on profile.id = log.changed_by
        where log.phone = p_phone
        order by log.changed_at desc
        limit 100
      ) status_row
    )
  )
  into v_result;

  return v_result;
end;
$function$;

create or replace function public.record_platform_sales_activity(
  p_phone text,
  p_stage text default null,
  p_outcome text default null,
  p_activity_type text default 'note',
  p_next timestamptz default null,
  p_next_type text default 'call',
  p_note text default null,
  p_owner uuid default null,
  p_loss_reason text default null,
  p_touch boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.retargeting_followups%rowtype;
  v_owner uuid;
  v_stage text;
  v_old_outcome text;
begin
  if v_uid is null or not public.crm_has_permission('sales.manage') then
    raise exception 'not_allowed';
  end if;

  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'phone_required';
  end if;

  if p_activity_type not in ('note', 'call', 'whatsapp', 'meeting', 'email') then
    raise exception 'invalid_activity_type';
  end if;

  if p_stage is not null and p_stage not in (
    'new', 'contacted', 'qualified', 'proposal',
    'negotiation', 'nurture', 'won', 'lost', 'disqualified'
  ) then
    raise exception 'invalid_stage';
  end if;

  if p_next_type is not null
     and p_next_type not in ('call', 'whatsapp', 'meeting', 'email', 'other') then
    raise exception 'invalid_next_action_type';
  end if;

  select *
  into v_existing
  from public.retargeting_followups
  where phone = p_phone
  for update;

  if found
     and v_existing.owner_id is not null
     and v_existing.owner_id is distinct from v_uid
     and not public.crm_can_see_all() then
    raise exception 'not_allowed';
  end if;

  if p_owner is not null
     and p_owner is distinct from v_uid
     and not public.crm_has_permission('crm.assign') then
    raise exception 'assign_not_allowed';
  end if;

  v_owner := coalesce(p_owner, v_existing.owner_id, v_uid);
  v_stage := coalesce(p_stage, v_existing.sales_stage, 'new');
  v_old_outcome := v_existing.status;

  if v_stage = 'lost'
     and nullif(btrim(coalesce(p_loss_reason, v_existing.loss_reason)), '') is null then
    raise exception 'loss_reason_required';
  end if;

  if p_touch
     and v_stage in ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture')
     and p_next is null then
    raise exception 'next_action_required';
  end if;

  insert into public.retargeting_followups (
    phone,
    status,
    sales_stage,
    owner_id,
    next_action_at,
    next_action_type,
    notes,
    last_touch_at,
    first_contact_at,
    contact_attempts,
    loss_reason,
    lost_at,
    won_at,
    updated_by,
    updated_at
  )
  values (
    p_phone,
    coalesce(p_outcome, 'new'),
    v_stage,
    v_owner,
    p_next,
    coalesce(p_next_type, 'call'),
    nullif(btrim(p_note), ''),
    case when p_touch then now() end,
    case when p_touch then now() end,
    case when p_touch then 1 else 0 end,
    case when v_stage = 'lost' then nullif(btrim(p_loss_reason), '') end,
    case when v_stage = 'lost' then now() end,
    case when v_stage = 'won' then now() end,
    v_uid,
    now()
  )
  on conflict (phone) do update set
    status = coalesce(p_outcome, public.retargeting_followups.status),
    sales_stage = v_stage,
    owner_id = v_owner,
    next_action_at = coalesce(p_next, public.retargeting_followups.next_action_at),
    next_action_type = case
      when p_next is not null then coalesce(p_next_type, 'call')
      else public.retargeting_followups.next_action_type
    end,
    notes = coalesce(nullif(btrim(p_note), ''), public.retargeting_followups.notes),
    last_touch_at = case
      when p_touch then now()
      else public.retargeting_followups.last_touch_at
    end,
    first_contact_at = case
      when p_touch then coalesce(public.retargeting_followups.first_contact_at, now())
      else public.retargeting_followups.first_contact_at
    end,
    contact_attempts = public.retargeting_followups.contact_attempts
      + case when p_touch then 1 else 0 end,
    loss_reason = case
      when v_stage = 'lost' then coalesce(
        nullif(btrim(p_loss_reason), ''),
        public.retargeting_followups.loss_reason
      )
      when v_stage <> 'lost' then null
      else public.retargeting_followups.loss_reason
    end,
    lost_at = case
      when v_stage = 'lost' then coalesce(public.retargeting_followups.lost_at, now())
      when v_stage <> 'lost' then null
      else public.retargeting_followups.lost_at
    end,
    won_at = case
      when v_stage = 'won' then coalesce(public.retargeting_followups.won_at, now())
      when v_stage <> 'won' then null
      else public.retargeting_followups.won_at
    end,
    updated_by = v_uid,
    updated_at = now();

  if p_outcome is not null
     and p_outcome is distinct from coalesce(v_old_outcome, 'new') then
    insert into public.retargeting_status_log (
      phone, old_status, new_status, changed_by
    )
    values (p_phone, v_old_outcome, p_outcome, v_uid);
  end if;

  insert into public.crm_activities (
    entity_type,
    entity_ref,
    kind,
    disposition,
    summary,
    body,
    occurred_at,
    owner_id,
    created_by
  )
  values (
    'platform_merchant',
    p_phone,
    'sales_' || p_activity_type,
    p_outcome,
    case
      when p_stage is not null
        and p_stage is distinct from v_existing.sales_stage
        then 'مرحلة البيع: ' || coalesce(v_existing.sales_stage, 'new') || ' → ' || v_stage
      when p_next is not null
        then 'جُدول الإجراء التالي'
      else 'ملاحظة مبيعات'
    end,
    nullif(btrim(p_note), ''),
    now(),
    v_owner,
    v_uid
  );

  return (
    select to_jsonb(followup)
    from public.retargeting_followups followup
    where followup.phone = p_phone
  );
end;
$function$;

-- يحافظ على الشاشات القديمة متوافقة مع الفصل الجديد بين outcome وstage.
create or replace function public.set_retargeting_followup(
  p_phone text,
  p_status text default null,
  p_owner uuid default null,
  p_next timestamptz default null,
  p_notes text default null,
  p_touch boolean default false
)
returns json
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_old text;
  v_stage text;
begin
  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'phone مطلوب';
  end if;

  select status
  into v_old
  from public.retargeting_followups
  where phone = p_phone;

  v_stage := case
    when p_status in ('converted', 'returned') then 'won'
    when p_status in ('not_interested', 'competitor', 'closed_business') then 'lost'
    when p_status in ('supplier', 'noise', 'blacklist', 'test') then 'disqualified'
    when p_status = 'interested' then 'qualified'
    when p_status in (
      'contacted', 'whatsapp_sent', 'price_issue',
      'support_issue', 'integration_issue', 'finance'
    ) then 'contacted'
    when p_status in ('needs_followup', 'no_answer') then 'nurture'
    when p_status = 'new' then 'new'
  end;

  insert into public.retargeting_followups (
    phone,
    status,
    sales_stage,
    owner_id,
    next_action_at,
    notes,
    last_touch_at,
    first_contact_at,
    contact_attempts,
    updated_by,
    updated_at
  )
  values (
    p_phone,
    coalesce(p_status, 'new'),
    coalesce(v_stage, 'new'),
    p_owner,
    p_next,
    p_notes,
    case when p_touch then now() end,
    case when p_touch then now() end,
    case when p_touch then 1 else 0 end,
    v_uid,
    now()
  )
  on conflict (phone) do update set
    status = coalesce(p_status, public.retargeting_followups.status),
    sales_stage = coalesce(v_stage, public.retargeting_followups.sales_stage),
    owner_id = case
      when p_owner is not null then p_owner
      else public.retargeting_followups.owner_id
    end,
    next_action_at = coalesce(p_next, public.retargeting_followups.next_action_at),
    notes = coalesce(p_notes, public.retargeting_followups.notes),
    last_touch_at = case
      when p_touch then now()
      else public.retargeting_followups.last_touch_at
    end,
    first_contact_at = case
      when p_touch then coalesce(public.retargeting_followups.first_contact_at, now())
      else public.retargeting_followups.first_contact_at
    end,
    contact_attempts = public.retargeting_followups.contact_attempts
      + case when p_touch then 1 else 0 end,
    lost_at = case
      when v_stage = 'lost' then coalesce(public.retargeting_followups.lost_at, now())
      when v_stage is not null and v_stage <> 'lost' then null
      else public.retargeting_followups.lost_at
    end,
    won_at = case
      when v_stage = 'won' then coalesce(public.retargeting_followups.won_at, now())
      when v_stage is not null and v_stage <> 'won' then null
      else public.retargeting_followups.won_at
    end,
    updated_by = v_uid,
    updated_at = now();

  if p_status is not null
     and p_status is distinct from coalesce(v_old, 'new') then
    insert into public.retargeting_status_log (
      phone, old_status, new_status, changed_by
    )
    values (p_phone, v_old, p_status, v_uid);
  end if;

  return (
    select row_to_json(followup)
    from public.retargeting_followups followup
    where followup.phone = p_phone
  );
end;
$function$;

revoke execute on function public.platform_sales_pipeline(
  text, uuid, boolean, text, integer, integer
) from public, anon;
revoke execute on function public.platform_sales_account(text)
  from public, anon;
revoke execute on function public.record_platform_sales_activity(
  text, text, text, text, timestamptz, text, text, uuid, text, boolean
) from public, anon;

grant execute on function public.platform_sales_pipeline(
  text, uuid, boolean, text, integer, integer
) to authenticated, service_role;
grant execute on function public.platform_sales_account(text)
  to authenticated, service_role;
grant execute on function public.record_platform_sales_activity(
  text, text, text, text, timestamptz, text, text, uuid, text, boolean
) to authenticated, service_role;

comment on function public.platform_sales_pipeline(
  text, uuid, boolean, text, integer, integer
) is 'مسار مبيعات متاجر المنصة: مرحلة بيع منفصلة عن الحالة التشغيلية، مع عدادات وفلاتر مرقمة.';
comment on function public.platform_sales_account(text)
  is 'ملف متجر مبيعات 360: معلومات المنصة + ملاحظات الموظف + دورة الحياة.';
comment on function public.record_platform_sales_activity(
  text, text, text, text, timestamptz, text, text, uuid, text, boolean
) is 'تسجيل تواصل/ملاحظة وجدولة الإجراء التالي ذرياً؛ ردود هاتف لا تستدعيها تلقائياً.';
