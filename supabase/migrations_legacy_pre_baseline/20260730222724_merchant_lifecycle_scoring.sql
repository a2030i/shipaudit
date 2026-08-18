-- Merchant lifecycle + sales signal enrichment.
--
-- Additive rollout:
--   * preserves the existing v_crm_retargeting columns in their exact order;
--   * does not replace sales_today() or retargeting_followups;
--   * keeps Hatif replies outside the Lead pipeline;
--   * records objective store transitions only after a complete snapshot upload.

create unique index if not exists merchants_snapshot_store_uidx
  on public.merchants (snapshot_id, store_id);

create index if not exists merchants_uploaded_at_snapshot_idx
  on public.merchants (uploaded_at desc, snapshot_id);

create or replace view public.v_crm_retargeting
with (security_invoker = true)
as
with latest as (
  select snapshot_id
  from public.merchants
  order by uploaded_at desc
  limit 1
),
m as (
  select *
  from public.merchants
  where snapshot_id = (select snapshot_id from latest)
    and phone is not null
    and btrim(phone) <> ''
),
customer_rollup as (
  select
    phone,
    count(*)::int as store_count,
    (array_agg(store_name order by coalesce(shipment_count, 0) desc, store_id))[1] as primary_store,
    array_agg(distinct store_name order by store_name) as store_names,
    sum(coalesce(shipment_count, 0))::bigint as total_shipments,
    max(last_shipment_at) as last_shipment,
    round(sum(coalesce(wallet_balance, 0))::numeric, 2) as wallet,
    max(last_topup_at) as last_topup,
    min(created_at_platform) as created_at,
    bool_or(status = 'نشط') as any_active,
    (
      array_agg(integration_type order by coalesce(shipment_count, 0) desc, store_id)
      filter (where integration_type is not null)
    )[1] as integration_type,
    (
      array_agg(billing_type order by coalesce(shipment_count, 0) desc, store_id)
      filter (where billing_type is not null)
    )[1] as billing_type,
    bool_or(profile_status = 'مكتمل') as profile_done,
    bool_or(verification_status = 'موثق') as verified,
    bool_or(coalesce(vat_registered, false)) as vat_reg,
    bool_or(coalesce(zatca_completed, false)) as zatca_done
  from m
  group by phone
),
classified as (
  select
    c.*,
    case
      when c.last_shipment is not null then (current_date - c.last_shipment::date)::int
    end as days_since_last,
    (c.total_shipments >= 300) as high_value,
    (
      case when c.profile_done then 20 else 0 end
      + case when c.verified then 20 else 0 end
      + case when c.integration_type is not null then 25 else 0 end
      + case when c.last_topup is not null then 25 else 0 end
      + case when c.any_active then 10 else 0 end
    )::int as readiness_score,
    (c.vat_reg and not c.zatca_done) as compliance_pending,
    case
      when c.wallet < -0.5 then 'negative_balance'
      when c.total_shipments = 0 then
        case
          when c.last_topup is not null then 'topped_no_ship'
          when c.integration_type is not null then 'linked_no_ship'
          when c.any_active then 'new_active'
          else 'registered_no_ship'
        end
      when c.any_active then 'active'
      when (current_date - c.last_shipment::date) <= 60 then 'stopped_recent'
      else 'stopped_long'
    end as segment
  from customer_rollup c
),
enriched as (
  select
    c.*,
    case
      when segment = 'active' then null
      when segment = 'negative_balance' then 'FIN'
      when segment in ('stopped_recent', 'stopped_long')
        and (high_value or billing_type = 'دفع لاحق') then 'A'
      when segment = 'stopped_recent' and wallet > 0.5 then 'A'
      when segment in ('stopped_recent', 'topped_no_ship') then 'B'
      when segment = 'stopped_long' and total_shipments >= 50 then 'B'
      when segment in ('linked_no_ship', 'new_active', 'registered_no_ship') then 'C'
      else 'D'
    end as priority,
    case
      when segment = 'active' then 'grow'
      when segment = 'negative_balance' then 'finance'
      when high_value then 'call'
      when wallet > 0.5 then 'whatsapp_balance'
      when segment in ('linked_no_ship', 'new_active', 'registered_no_ship') then 'activation'
      else 'whatsapp'
    end as channel,
    case
      when segment = 'negative_balance' then 0
      when segment = 'topped_no_ship' then 100
      when total_shipments = 0 and profile_done and verified
        and integration_type is not null then 92
      when segment in ('new_active', 'linked_no_ship', 'registered_no_ship')
        and created_at >= current_date - 7 then 88
      when segment = 'stopped_recent' and high_value then 86
      when segment = 'stopped_recent' then 78
      when segment = 'stopped_long' and high_value then 72
      when segment = 'linked_no_ship' then least(80, 45 + readiness_score / 2)
      when segment = 'new_active' then 60
      when segment = 'registered_no_ship' then 40
      when segment = 'active' and high_value then 65
      else 30
    end::int as opportunity_score,
    case
      when segment = 'negative_balance' then 'collections'
      when total_shipments = 0 and (not profile_done or not verified) then 'onboarding'
      when total_shipments = 0 then 'sales_activation'
      when segment in ('stopped_recent', 'stopped_long') then 'sales_recovery'
      when segment = 'active' and high_value then 'account_management'
      else 'sales_growth'
    end as team_route,
    case
      when segment = 'negative_balance' then 'تحويل للتحصيل قبل أي محاولة بيع'
      when total_shipments = 0 and not profile_done then 'إكمال بيانات المتجر'
      when total_shipments = 0 and not verified then 'إكمال توثيق المتجر'
      when total_shipments = 0 and integration_type is null then 'إكمال ربط المتجر'
      when total_shipments = 0 then 'مساعدته على تنفيذ أول شحنة'
      when segment in ('stopped_recent', 'stopped_long') then 'فهم سبب التوقف وإعادة التفعيل'
      when compliance_pending then 'إكمال متطلبات زاتكا'
      else 'تنمية الحساب والمحافظة على نشاطه'
    end as next_step
  from classified c
)
select
  -- Existing contract: keep these columns and their order unchanged.
  phone,
  store_count,
  primary_store,
  store_names,
  total_shipments,
  last_shipment,
  wallet,
  last_topup,
  created_at,
  any_active,
  integration_type,
  billing_type,
  profile_done,
  verified,
  vat_reg,
  days_since_last,
  high_value,
  segment,
  priority,
  channel,
  -- Additive enrichment.
  zatca_done,
  compliance_pending,
  readiness_score,
  opportunity_score,
  team_route,
  next_step
from enriched;

create table if not exists public.merchant_lifecycle_events (
  id bigint generated by default as identity primary key,
  snapshot_id text not null,
  previous_snapshot_id text not null,
  store_id text not null,
  store_name text not null,
  phone text,
  event_type text not null,
  from_value text,
  to_value text,
  shipment_delta integer not null default 0,
  wallet_delta numeric(14, 2) not null default 0,
  observed_at timestamptz not null default now(),
  constraint merchant_lifecycle_events_type_check check (
    event_type in (
      'registered',
      'profile_completed',
      'verified',
      'integration_connected',
      'integration_changed',
      'wallet_topped',
      'first_shipment',
      'shipping_resumed',
      'deactivated',
      'reactivated'
    )
  ),
  constraint merchant_lifecycle_events_snapshot_store_type_key
    unique (snapshot_id, store_id, event_type)
);

alter table public.merchant_lifecycle_events enable row level security;

revoke all on table public.merchant_lifecycle_events from public, anon, authenticated;
grant select, insert on table public.merchant_lifecycle_events to service_role;
grant usage, select on sequence public.merchant_lifecycle_events_id_seq to service_role;

create index if not exists merchant_lifecycle_events_phone_observed_idx
  on public.merchant_lifecycle_events (phone, observed_at desc)
  where phone is not null;

create index if not exists merchant_lifecycle_events_type_observed_idx
  on public.merchant_lifecycle_events (event_type, observed_at desc);

create or replace function public.capture_merchant_lifecycle_events(p_snapshot_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_previous_snapshot text;
  v_snapshot_exists boolean;
  v_counts jsonb;
  v_total integer;
begin
  if (select auth.uid()) is null
     or not public.crm_has_permission('merchants.upload') then
    raise exception 'not_allowed';
  end if;

  select exists (
    select 1 from public.merchants where snapshot_id = p_snapshot_id
  ) into v_snapshot_exists;

  if not v_snapshot_exists then
    raise exception 'snapshot_not_found';
  end if;

  select snapshot_id
  into v_previous_snapshot
  from public.merchants
  where snapshot_id <> p_snapshot_id
  order by uploaded_at desc
  limit 1;

  -- The first snapshot is the baseline, not thousands of fake "new" leads.
  if v_previous_snapshot is null then
    return jsonb_build_object(
      'snapshot_id', p_snapshot_id,
      'previous_snapshot_id', null,
      'baseline', true,
      'created', 0,
      'by_type', '{}'::jsonb
    );
  end if;

  -- Newly observed stores.
  insert into public.merchant_lifecycle_events (
    snapshot_id, previous_snapshot_id, store_id, store_name, phone,
    event_type, to_value, shipment_delta, wallet_delta
  )
  select
    p_snapshot_id, v_previous_snapshot, c.store_id, c.store_name, c.phone,
    'registered', c.status,
    coalesce(c.shipment_count, 0),
    round(coalesce(c.wallet_balance, 0)::numeric, 2)
  from public.merchants c
  left join public.merchants p
    on p.snapshot_id = v_previous_snapshot
   and p.store_id = c.store_id
  where c.snapshot_id = p_snapshot_id
    and p.id is null
  on conflict (snapshot_id, store_id, event_type) do nothing;

  -- Objective transitions for stores that exist in both snapshots.
  insert into public.merchant_lifecycle_events (
    snapshot_id, previous_snapshot_id, store_id, store_name, phone,
    event_type, from_value, to_value, shipment_delta, wallet_delta
  )
  select
    p_snapshot_id,
    v_previous_snapshot,
    c.store_id,
    c.store_name,
    c.phone,
    e.event_type,
    e.from_value,
    e.to_value,
    coalesce(c.shipment_count, 0) - coalesce(p.shipment_count, 0),
    round((coalesce(c.wallet_balance, 0) - coalesce(p.wallet_balance, 0))::numeric, 2)
  from public.merchants c
  join public.merchants p
    on p.snapshot_id = v_previous_snapshot
   and p.store_id = c.store_id
  cross join lateral (
    values
      (
        'profile_completed'::text,
        p.profile_status,
        c.profile_status,
        coalesce(p.profile_status, '') <> 'مكتمل'
          and c.profile_status = 'مكتمل'
      ),
      (
        'verified',
        p.verification_status,
        c.verification_status,
        coalesce(p.verification_status, '') <> 'موثق'
          and c.verification_status = 'موثق'
      ),
      (
        'integration_connected',
        p.integration_type,
        c.integration_type,
        p.integration_type is null
          and c.integration_type is not null
      ),
      (
        'integration_changed',
        p.integration_type,
        c.integration_type,
        p.integration_type is not null
          and c.integration_type is not null
          and p.integration_type is distinct from c.integration_type
      ),
      (
        'wallet_topped',
        p.last_topup_at::text,
        c.last_topup_at::text,
        c.last_topup_at is not null
          and (p.last_topup_at is null or c.last_topup_at > p.last_topup_at)
      ),
      (
        'first_shipment',
        coalesce(p.shipment_count, 0)::text,
        coalesce(c.shipment_count, 0)::text,
        coalesce(p.shipment_count, 0) = 0
          and coalesce(c.shipment_count, 0) > 0
      ),
      (
        'shipping_resumed',
        p.last_shipment_at::text,
        c.last_shipment_at::text,
        coalesce(c.shipment_count, 0) > coalesce(p.shipment_count, 0)
          and p.last_shipment_at is not null
          and c.last_shipment_at is not null
          and p.last_shipment_at < p.uploaded_at - interval '60 days'
      ),
      (
        'deactivated',
        p.status,
        c.status,
        p.status = 'نشط' and c.status = 'غير نشط'
      ),
      (
        'reactivated',
        p.status,
        c.status,
        p.status = 'غير نشط' and c.status = 'نشط'
      )
  ) as e(event_type, from_value, to_value, changed)
  where c.snapshot_id = p_snapshot_id
    and e.changed
  on conflict (snapshot_id, store_id, event_type) do nothing;

  select
    count(*)::int,
    coalesce(jsonb_object_agg(event_type, event_count), '{}'::jsonb)
  into v_total, v_counts
  from (
    select event_type, count(*)::int as event_count
    from public.merchant_lifecycle_events
    where snapshot_id = p_snapshot_id
    group by event_type
  ) s;

  return jsonb_build_object(
    'snapshot_id', p_snapshot_id,
    'previous_snapshot_id', v_previous_snapshot,
    'baseline', false,
    'created', coalesce(v_total, 0),
    'by_type', coalesce(v_counts, '{}'::jsonb)
  );
end;
$function$;

revoke execute on function public.capture_merchant_lifecycle_events(text)
  from public, anon;
grant execute on function public.capture_merchant_lifecycle_events(text)
  to authenticated, service_role;

create or replace function public.merchant_sales_signals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null
     or not (
       public.crm_has_permission('sales.view')
       or public.crm_has_permission('merchants.view')
       or public.crm_has_permission('crm.view')
     ) then
    raise exception 'not_allowed';
  end if;

  select jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'ready_to_activate', count(*) filter (
          where total_shipments = 0
            and profile_done and verified
            and integration_type is not null
            and segment <> 'negative_balance'
        ),
        'topped_no_ship', count(*) filter (where segment = 'topped_no_ship'),
        'new_7d_no_ship', count(*) filter (
          where total_shipments = 0
            and created_at >= current_date - 7
            and segment <> 'negative_balance'
        ),
        'stopped_30d', count(*) filter (
          where segment = 'stopped_recent' and days_since_last <= 30
        ),
        'key_accounts_at_risk', count(*) filter (
          where segment in ('stopped_recent', 'stopped_long')
            and total_shipments >= 1000
        ),
        'compliance_pending', count(*) filter (
          where compliance_pending
            and total_shipments > 0
            and days_since_last <= 30
        ),
        'multi_store_accounts', count(*) filter (where store_count > 1),
        'collections_only', count(*) filter (where segment = 'negative_balance')
      )
      from public.v_crm_retargeting
    ),
    'opportunity_details', (
      select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
      from (
        select
          v.phone,
          v.store_count,
          v.store_names,
          v.integration_type,
          v.billing_type,
          v.profile_done,
          v.verified,
          v.vat_reg,
          v.zatca_done,
          v.compliance_pending,
          v.readiness_score,
          v.opportunity_score,
          v.team_route,
          v.next_step
        from public.v_crm_retargeting v
        left join public.retargeting_followups f on f.phone = v.phone
        where f.phone is null
          and (
            v.segment = 'topped_no_ship'
            or v.segment = 'stopped_recent'
            or (v.segment = 'stopped_long' and v.priority = 'A')
            or (
              v.segment in ('new_active', 'linked_no_ship', 'registered_no_ship')
              and v.created_at >= now() - interval '30 days'
            )
          )
        order by v.opportunity_score desc, v.total_shipments desc, v.created_at desc nulls last
        limit 200
      ) d
    ),
    'activation_ready', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.opportunity_score desc, a.created_at desc), '[]'::jsonb)
      from (
        select
          v.phone,
          v.primary_store as store,
          v.store_count,
          v.store_names,
          v.segment,
          v.priority,
          v.channel,
          v.total_shipments,
          v.wallet,
          v.created_at,
          v.integration_type,
          v.billing_type,
          v.readiness_score,
          v.opportunity_score,
          v.team_route,
          v.next_step
        from public.v_crm_retargeting v
        left join public.retargeting_followups f on f.phone = v.phone
        where f.phone is null
          and v.total_shipments = 0
          and v.profile_done
          and v.verified
          and v.integration_type is not null
          and v.segment <> 'negative_balance'
          and (v.created_at is null or v.created_at < now() - interval '30 days')
        order by v.opportunity_score desc, v.created_at desc nulls last
        limit 15
      ) a
    ),
    'activation_ready_count', (
      select count(*)
      from public.v_crm_retargeting v
      left join public.retargeting_followups f on f.phone = v.phone
      where f.phone is null
        and v.total_shipments = 0
        and v.profile_done
        and v.verified
        and v.integration_type is not null
        and v.segment <> 'negative_balance'
        and (v.created_at is null or v.created_at < now() - interval '30 days')
    )
  )
  into v_result;

  return v_result;
end;
$function$;

revoke execute on function public.merchant_sales_signals()
  from public, anon;
grant execute on function public.merchant_sales_signals()
  to authenticated, service_role;
