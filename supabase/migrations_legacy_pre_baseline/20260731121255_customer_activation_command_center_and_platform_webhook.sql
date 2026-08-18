-- مركز قيادة هدف العملاء النشطين + استقبال لقطات المنصة عبر Webhook آمن.
-- الهدف الإداري يُقاس بعميل فريد (رقم هاتف) لا بعدد المتاجر التابعة له.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.platform_snapshot_receipts (
  event_id text primary key,
  payload_hash text not null,
  snapshot_id text not null unique,
  snapshot_at timestamptz not null,
  source text not null default 'platform_webhook',
  row_count integer not null check (row_count > 0 and row_count <= 5000),
  received_at timestamptz not null default now(),
  lifecycle jsonb
);

alter table public.platform_snapshot_receipts enable row level security;
revoke all on table public.platform_snapshot_receipts from public, anon, authenticated;
grant all on table public.platform_snapshot_receipts to service_role;

-- نقطة حقيقة واحدة لالتقاط انتقالات دورة الحياة. الغلاف العام يبقي حارس
-- الصلاحيات القديم، بينما مسار الـWebhook الداخلي يستدعيها داخل المعاملة نفسها.
create or replace function private.capture_merchant_lifecycle_events_internal(p_snapshot_id text)
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

  if v_previous_snapshot is null then
    return jsonb_build_object(
      'snapshot_id', p_snapshot_id,
      'previous_snapshot_id', null,
      'baseline', true,
      'created', 0,
      'by_type', '{}'::jsonb
    );
  end if;

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
      ('profile_completed'::text, p.profile_status, c.profile_status,
        coalesce(p.profile_status, '') <> 'مكتمل' and c.profile_status = 'مكتمل'),
      ('verified', p.verification_status, c.verification_status,
        coalesce(p.verification_status, '') <> 'موثق' and c.verification_status = 'موثق'),
      ('integration_connected', p.integration_type, c.integration_type,
        p.integration_type is null and c.integration_type is not null),
      ('integration_changed', p.integration_type, c.integration_type,
        p.integration_type is not null and c.integration_type is not null
          and p.integration_type is distinct from c.integration_type),
      ('wallet_topped', p.last_topup_at::text, c.last_topup_at::text,
        c.last_topup_at is not null
          and (p.last_topup_at is null or c.last_topup_at > p.last_topup_at)),
      ('first_shipment', coalesce(p.shipment_count, 0)::text, coalesce(c.shipment_count, 0)::text,
        coalesce(p.shipment_count, 0) = 0 and coalesce(c.shipment_count, 0) > 0),
      ('shipping_resumed', p.last_shipment_at::text, c.last_shipment_at::text,
        coalesce(c.shipment_count, 0) > coalesce(p.shipment_count, 0)
          and p.last_shipment_at is not null and c.last_shipment_at is not null
          and p.last_shipment_at < p.uploaded_at - interval '60 days'),
      ('deactivated', p.status, c.status,
        p.status = 'نشط' and c.status = 'غير نشط'),
      ('reactivated', p.status, c.status,
        p.status = 'غير نشط' and c.status = 'نشط')
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

revoke execute on function private.capture_merchant_lifecycle_events_internal(text)
  from public, anon, authenticated, service_role;

create or replace function public.capture_merchant_lifecycle_events(p_snapshot_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null
     or not public.crm_has_permission('merchants.upload') then
    raise exception 'not_allowed';
  end if;

  return private.capture_merchant_lifecycle_events_internal(p_snapshot_id);
end;
$function$;

revoke execute on function public.capture_merchant_lifecycle_events(text)
  from public, anon;
grant execute on function public.capture_merchant_lifecycle_events(text)
  to authenticated, service_role;

create or replace function public.ingest_platform_merchant_snapshot(
  p_event_id text,
  p_snapshot_at timestamptz,
  p_payload_hash text,
  p_rows jsonb,
  p_source text default 'platform_webhook'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.platform_snapshot_receipts%rowtype;
  v_snapshot_id text;
  v_received_at timestamptz := clock_timestamp();
  v_row_count integer;
  v_previous_row_count integer;
  v_inserted integer;
  v_lifecycle jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_allowed';
  end if;

  if p_event_id is null or length(btrim(p_event_id)) < 8 or length(p_event_id) > 160 then
    raise exception 'invalid_event_id';
  end if;
  if p_snapshot_at is null
     or p_snapshot_at < now() - interval '7 days'
     or p_snapshot_at > now() + interval '10 minutes' then
    raise exception 'invalid_snapshot_at';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_payload_hash';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  if v_row_count < 1 or v_row_count > 5000 then
    raise exception 'invalid_row_count';
  end if;

  select count(*)::int
  into v_previous_row_count
  from public.merchants
  where snapshot_id = (
    select snapshot_id from public.merchants order by uploaded_at desc limit 1
  );

  -- حماية من أن تصبح دفعة جزئية هي «أحدث لقطة» فتُسقط العملاء من كل التحليلات.
  if v_previous_row_count >= 100
     and (
       v_row_count < floor(v_previous_row_count * 0.60)
       or v_row_count > ceil(v_previous_row_count * 1.50)
     ) then
    raise exception 'suspicious_row_count_change';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id, 0));

  select * into v_existing
  from public.platform_snapshot_receipts
  where event_id = p_event_id;

  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'event_id', v_existing.event_id,
      'snapshot_id', v_existing.snapshot_id,
      'row_count', v_existing.row_count,
      'received_at', v_existing.received_at,
      'lifecycle', v_existing.lifecycle
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    where nullif(btrim(item->>'store_id'), '') is null
       or nullif(btrim(item->>'store_name'), '') is null
       or nullif(btrim(item->>'phone'), '') is null
  ) then
    raise exception 'missing_required_merchant_field';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    group by btrim(item->>'store_id')
    having count(*) > 1
  ) then
    raise exception 'duplicate_store_id';
  end if;

  v_snapshot_id := 'api_' || left(
    encode(extensions.digest(convert_to(p_event_id, 'UTF8'), 'sha256'), 'hex'),
    32
  );

  insert into public.platform_snapshot_receipts (
    event_id, payload_hash, snapshot_id, snapshot_at, source, row_count, received_at
  ) values (
    p_event_id, p_payload_hash, v_snapshot_id, p_snapshot_at,
    coalesce(nullif(btrim(p_source), ''), 'platform_webhook'), v_row_count, v_received_at
  );

  insert into public.merchants (
    snapshot_id, snapshot_date, store_id, store_name, phone,
    shipment_count, last_shipment_at, integration_type, billing_type, status,
    created_at_platform, last_topup_at, wallet_balance,
    profile_status, vat_registered, zatca_completed, verification_status,
    uploaded_by, uploaded_at
  )
  select
    v_snapshot_id,
    (p_snapshot_at at time zone 'Asia/Riyadh')::date,
    btrim(row_data.store_id),
    btrim(row_data.store_name),
    btrim(row_data.phone),
    coalesce(row_data.shipment_count, 0),
    row_data.last_shipment_at,
    nullif(btrim(row_data.integration_type), ''),
    nullif(btrim(row_data.billing_type), ''),
    nullif(btrim(row_data.status), ''),
    row_data.created_at_platform,
    row_data.last_topup_at,
    round(coalesce(row_data.wallet_balance, 0)::numeric, 2),
    nullif(btrim(row_data.profile_status), ''),
    coalesce(row_data.vat_registered, false),
    coalesce(row_data.zatca_completed, false),
    nullif(btrim(row_data.verification_status), ''),
    null,
    v_received_at
  from jsonb_to_recordset(p_rows) as row_data(
    store_id text,
    store_name text,
    phone text,
    shipment_count integer,
    last_shipment_at timestamptz,
    integration_type text,
    billing_type text,
    status text,
    created_at_platform timestamptz,
    last_topup_at timestamptz,
    wallet_balance numeric,
    profile_status text,
    vat_registered boolean,
    zatca_completed boolean,
    verification_status text
  );

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_row_count then
    raise exception 'snapshot_row_count_mismatch';
  end if;

  v_lifecycle := private.capture_merchant_lifecycle_events_internal(v_snapshot_id);

  update public.platform_snapshot_receipts
  set lifecycle = v_lifecycle
  where event_id = p_event_id;

  return jsonb_build_object(
    'status', 'accepted',
    'event_id', p_event_id,
    'snapshot_id', v_snapshot_id,
    'row_count', v_inserted,
    'received_at', v_received_at,
    'lifecycle', v_lifecycle
  );
end;
$function$;

revoke execute on function public.ingest_platform_merchant_snapshot(text,timestamptz,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.ingest_platform_merchant_snapshot(text,timestamptz,text,jsonb,text)
  to service_role;

create or replace function public.customer_activation_command_center(
  p_days integer default 5,
  p_target integer default 500,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 5), 30));
  v_target integer := greatest(1, least(coalesce(p_target, 500), 100000));
  v_limit integer := greatest(2, least(coalesce(p_limit, 24), 60));
  v_current jsonb;
  v_movement jsonb;
  v_execution jsonb;
  v_outcomes jsonb;
  v_trend jsonb;
  v_sync jsonb;
  v_active integer;
  v_gap integer;
  v_exited integer;
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
    'total_customers', count(*)::int,
    'total_stores', coalesce(sum(store_count), 0)::int,
    'active', count(*) filter (
      where last_shipment >= now() - make_interval(days => v_days)
    )::int,
    'active_30d', count(*) filter (
      where last_shipment >= now() - interval '30 days'
    )::int,
    'active_sales_eligible', count(*) filter (
      where last_shipment >= now() - make_interval(days => v_days)
        and sales_eligible
    )::int,
    'active_financial_hold', count(*) filter (
      where last_shipment >= now() - make_interval(days => v_days)
        and financial_hold
    )::int,
    'prepaid_active', count(*) filter (
      where last_shipment >= now() - make_interval(days => v_days)
        and billing_type = 'دفع مسبق'
    )::int,
    'postpaid_active', count(*) filter (
      where last_shipment >= now() - make_interval(days => v_days)
        and billing_type = 'دفع لاحق'
    )::int,
    'target', v_target,
    'days', v_days
  )
  into v_current
  from public.v_platform_commercial_routing;

  v_active := coalesce((v_current->>'active')::int, 0);
  v_gap := greatest(0, v_target - v_active);

  with snapshot_meta as (
    select snapshot_id, min(snapshot_date) as snapshot_date, max(uploaded_at) as uploaded_at
    from public.merchants
    group by snapshot_id
  ), latest as (
    select * from snapshot_meta order by uploaded_at desc limit 1
  ), previous as (
    select meta.*
    from snapshot_meta meta, latest current_snapshot
    where meta.snapshot_id <> current_snapshot.snapshot_id
    order by
      (meta.uploaded_at <= current_snapshot.uploaded_at - interval '7 days') desc,
      case when meta.uploaded_at <= current_snapshot.uploaded_at - interval '7 days'
        then meta.uploaded_at end desc nulls last,
      meta.uploaded_at desc
    limit 1
  ), current_customers as (
    select m.phone, max(m.last_shipment_at) as last_shipment
    from public.merchants m join latest l on l.snapshot_id = m.snapshot_id
    where m.phone is not null and btrim(m.phone) <> ''
    group by m.phone
  ), previous_customers as (
    select m.phone, max(m.last_shipment_at) as last_shipment
    from public.merchants m join previous p on p.snapshot_id = m.snapshot_id
    where m.phone is not null and btrim(m.phone) <> ''
    group by m.phone
  ), current_active as (
    select c.phone from current_customers c, latest l
    where c.last_shipment >= l.uploaded_at - make_interval(days => v_days)
  ), previous_active as (
    select c.phone from previous_customers c, previous p
    where c.last_shipment >= p.uploaded_at - make_interval(days => v_days)
  )
  select jsonb_build_object(
    'has_previous', exists (select 1 from previous),
    'current_date', (select snapshot_date from latest),
    'previous_date', (select snapshot_date from previous),
    'current_active', (select count(*)::int from current_active),
    'previous_active', (select count(*)::int from previous_active),
    'entered', (
      select count(*)::int from current_active c
      where not exists (select 1 from previous_active p where p.phone = c.phone)
    ),
    'exited', (
      select count(*)::int from previous_active p
      where not exists (select 1 from current_active c where c.phone = p.phone)
    )
  )
  into v_movement;

  v_exited := coalesce((v_movement->>'exited')::int, 0);
  v_current := v_current || jsonb_build_object(
    'gap', v_gap,
    'progress_pct', round(least(100, (v_active::numeric / v_target) * 100), 1),
    'required_weekly_entrants', greatest(0, ceil(v_gap::numeric / 4)::int + v_exited)
  );
  v_movement := v_movement || jsonb_build_object(
    'net', coalesce((v_movement->>'entered')::int, 0) - v_exited
  );

  select jsonb_build_object(
    'actionable', count(*) filter (
      where route.sales_eligible
        and route.commercial_signal in (
          'hot_live_new', 'hot_live_topped', 'recent_stop', 'wallet_stranded',
          'live_inactive', 'live_no_first_shipment', 'recovery'
        )
    )::int,
    'hot_live', count(*) filter (
      where route.sales_eligible and (route.hot_live_new or route.hot_live_topped)
    )::int,
    'recent_stop', count(*) filter (
      where route.sales_eligible and route.recent_stop
    )::int,
    'wallet_stranded', count(*) filter (
      where route.sales_eligible and route.wallet_stranded
    )::int,
    'live_inactive', count(*) filter (
      where route.sales_eligible and route.live_inactive
    )::int,
    'financial_hold', count(*) filter (where route.financial_hold)::int,
    'unassigned', count(*) filter (
      where route.sales_eligible
        and route.commercial_signal in (
          'hot_live_new', 'hot_live_topped', 'recent_stop', 'wallet_stranded',
          'live_inactive', 'live_no_first_shipment', 'recovery'
        )
        and followup.owner_id is null
    )::int,
    'never_contacted', count(*) filter (
      where route.sales_eligible
        and route.commercial_signal in (
          'hot_live_new', 'hot_live_topped', 'recent_stop', 'wallet_stranded',
          'live_inactive', 'live_no_first_shipment', 'recovery'
        )
        and followup.first_contact_at is null
    )::int,
    'overdue', count(*) filter (
      where followup.next_action_at < now()
        and coalesce(followup.sales_stage, 'new') not in ('won', 'lost', 'disqualified')
    )::int,
    'contacted_no_next', count(*) filter (
      where followup.first_contact_at is not null
        and followup.next_action_at is null
        and coalesce(followup.sales_stage, 'new') not in ('won', 'lost', 'disqualified')
    )::int,
    'scheduled', count(*) filter (
      where followup.next_action_at >= now()
        and coalesce(followup.sales_stage, 'new') not in ('won', 'lost', 'disqualified')
    )::int
  )
  into v_execution
  from public.v_platform_commercial_routing route
  left join public.retargeting_followups followup on followup.phone = route.phone;

  select jsonb_build_object(
    'objective', count(distinct coalesce(nullif(event.phone, ''), 'store:' || event.store_id))::int,
    'first_shipments', count(distinct coalesce(nullif(event.phone, ''), 'store:' || event.store_id))
      filter (where event.event_type = 'first_shipment')::int,
    'resumed', count(distinct coalesce(nullif(event.phone, ''), 'store:' || event.store_id))
      filter (where event.event_type = 'shipping_resumed')::int,
    'attributed_after_contact', count(distinct event.phone) filter (
      where event.phone is not null
        and followup.first_contact_at is not null
        and followup.first_contact_at <= event.observed_at
    )::int,
    'marked_won', count(distinct event.phone) filter (
      where event.phone is not null and followup.won_at is not null
    )::int
  )
  into v_outcomes
  from public.merchant_lifecycle_events event
  left join public.retargeting_followups followup on followup.phone = event.phone
  where event.observed_at >= now() - interval '30 days'
    and event.event_type in ('first_shipment', 'shipping_resumed');

  with snaps as (
    select snapshot_id, min(snapshot_date) as snapshot_date, max(uploaded_at) as uploaded_at
    from public.merchants
    group by snapshot_id
    order by max(uploaded_at) desc
    limit v_limit
  ), customer_rows as (
    select
      snap.snapshot_id,
      snap.snapshot_date,
      snap.uploaded_at,
      merchant.phone,
      count(*)::int as stores,
      max(merchant.last_shipment_at) as last_shipment,
      bool_or(merchant.billing_type = 'دفع مسبق') as prepaid,
      bool_or(merchant.billing_type = 'دفع لاحق') as postpaid
    from snaps snap
    join public.merchants merchant on merchant.snapshot_id = snap.snapshot_id
    where merchant.phone is not null and btrim(merchant.phone) <> ''
    group by snap.snapshot_id, snap.snapshot_date, snap.uploaded_at, merchant.phone
  ), points as (
    select
      snapshot_id,
      snapshot_date,
      uploaded_at,
      count(*)::int as total_customers,
      sum(stores)::int as total_stores,
      count(*) filter (
        where last_shipment >= uploaded_at - make_interval(days => v_days)
      )::int as active,
      count(*) filter (
        where last_shipment >= uploaded_at - interval '30 days'
      )::int as active_30d,
      count(*) filter (
        where last_shipment >= uploaded_at - make_interval(days => v_days) and prepaid
      )::int as prepaid_active,
      count(*) filter (
        where last_shipment >= uploaded_at - make_interval(days => v_days) and postpaid
      )::int as postpaid_active
    from customer_rows
    group by snapshot_id, snapshot_date, uploaded_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'snapshot_id', point.snapshot_id,
    'snapshot_date', point.snapshot_date,
    'uploaded_at', point.uploaded_at,
    'total_customers', point.total_customers,
    'total_stores', point.total_stores,
    'active', point.active,
    'active_30d', point.active_30d,
    'prepaid_active', point.prepaid_active,
    'postpaid_active', point.postpaid_active
  ) order by point.uploaded_at), '[]'::jsonb)
  into v_trend
  from points point;

  with latest_snapshot as (
    select snapshot_id, max(uploaded_at) as uploaded_at
    from public.merchants
    group by snapshot_id
    order by max(uploaded_at) desc
    limit 1
  ), latest_webhook as (
    select * from public.platform_snapshot_receipts
    order by received_at desc
    limit 1
  )
  select jsonb_build_object(
    'snapshot_id', snapshot.snapshot_id,
    'uploaded_at', snapshot.uploaded_at,
    'age_minutes', greatest(0, floor(extract(epoch from (now() - snapshot.uploaded_at)) / 60))::int,
    'source', case when receipt.snapshot_id = snapshot.snapshot_id then 'webhook' else 'excel' end,
    'last_webhook_at', receipt.received_at,
    'last_webhook_rows', receipt.row_count
  )
  into v_sync
  from latest_snapshot snapshot
  left join latest_webhook receipt on true;

  return jsonb_build_object(
    'current', coalesce(v_current, '{}'::jsonb),
    'movement', coalesce(v_movement, '{}'::jsonb),
    'execution', coalesce(v_execution, '{}'::jsonb),
    'outcomes_30d', coalesce(v_outcomes, '{}'::jsonb),
    'trend', coalesce(v_trend, '[]'::jsonb),
    'sync', coalesce(v_sync, '{}'::jsonb)
  );
end;
$function$;

revoke execute on function public.customer_activation_command_center(integer,integer,integer)
  from public, anon;
grant execute on function public.customer_activation_command_center(integer,integer,integer)
  to authenticated, service_role;
