-- مركز أداء متاجر لمحة: قراءة تنفيذية فقط من لقطات دليل المتاجر.
-- لقطة اليوم المرجعية هي لقطة منتصف الليل الأقرب لكل يوم بتوقيت الرياض.
-- العدادات السالبة لا تخصم من الشحنات؛ تظهر كاستثناء بيانات مستقل.

create or replace function public.lamha_store_performance_command_center(
  p_filter text default 'all',
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_filter text := coalesce(nullif(btrim(p_filter), ''), 'all');
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
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

  if v_filter not in (
    'all', 'shipped_today', 'registered_today', 'observed_today',
    'first_shipment', 'resumed', 'disabled_today', 'enabled_today',
    'account_enabled', 'account_disabled', 'never_shipped',
    'active_5d', 'active_30d', 'dormant_30', 'counter_exception'
  ) then
    raise exception 'invalid_filter';
  end if;

  with receipt_source as (
    select
      receipt.snapshot_id,
      receipt.snapshot_at,
      receipt.received_at,
      receipt.source,
      (receipt.snapshot_at at time zone 'Asia/Riyadh')::date as local_date,
      extract(epoch from (receipt.snapshot_at at time zone 'Asia/Riyadh')::time)::numeric as local_second,
      case
        when receipt.source = 'lamha_employee_api_export_scheduled' then 0
        when receipt.source = 'lamha_employee_api_export_daily'
          and (receipt.snapshot_at at time zone 'Asia/Riyadh')::time < time '00:30' then 1
        when receipt.source = 'lamha_employee_api_export_manual' then 2
        when receipt.source = 'lamha_employee_api_export_daily' then 3
        else 4
      end as source_rank
    from public.platform_snapshot_receipts receipt
    where (
        receipt.source = 'lamha_employee_api_export_scheduled'
        or (
          receipt.source = 'lamha_employee_api_export_daily'
          and (receipt.snapshot_at at time zone 'Asia/Riyadh')::time < time '00:30'
        )
      )
      and exists (
        select 1 from public.merchants merchant
        where merchant.snapshot_id = receipt.snapshot_id
      )
  ), ranked_daily as (
    select source.*,
      row_number() over (
        partition by source.local_date
        order by
          source.source_rank,
          least(source.local_second, 86400 - source.local_second),
          source.received_at
      ) as daily_rank
    from receipt_source source
  ), canonical_days as (
    select * from ranked_daily where daily_rank = 1
  ), latest_day as (
    select * from canonical_days order by local_date desc limit 1
  ), previous_day as (
    select day.*
    from canonical_days day, latest_day current_day
    where day.local_date < current_day.local_date
    order by day.local_date desc
    limit 1
  ), current_rows as (
    select
      current_store.*,
      previous_store.shipment_count as previous_shipment_count,
      previous_store.last_shipment_at as previous_last_shipment_at,
      previous_store.status as previous_status,
      previous_store.id is null as newly_observed,
      case when previous_meta.snapshot_id is null then 0 else greatest(
        0,
        coalesce(current_store.shipment_count, 0) - coalesce(previous_store.shipment_count, 0)
      )::int end as shipment_delta,
      case when previous_meta.snapshot_id is null then 0 else least(
        0,
        coalesce(current_store.shipment_count, 0) - coalesce(previous_store.shipment_count, 0)
      )::int end as negative_shipment_delta,
      case
        when lower(btrim(coalesce(current_store.status, ''))) in ('inactive', 'غير نشط') then 'disabled'
        when nullif(btrim(current_store.status), '') is null then 'unknown'
        else 'enabled'
      end as account_state,
      case
        when lower(btrim(coalesce(previous_store.status, ''))) in ('inactive', 'غير نشط') then 'disabled'
        when nullif(btrim(previous_store.status), '') is null then 'unknown'
        else 'enabled'
      end as previous_account_state,
      case
        when current_store.last_shipment_at is null then null
        else greatest(0, floor(extract(epoch from (
          current_day.snapshot_at - current_store.last_shipment_at
        )) / 86400))::int
      end as days_since_last,
      current_day.local_date as metric_date,
      current_day.snapshot_at as metric_at,
      current_day.source as metric_source,
      (select count(*) > 0 from previous_day) as has_previous
    from latest_day current_day
    join public.merchants current_store
      on current_store.snapshot_id = current_day.snapshot_id
    left join previous_day previous_meta on true
    left join public.merchants previous_store
      on previous_store.snapshot_id = previous_meta.snapshot_id
     and previous_store.store_id = current_store.store_id
  ), classified as (
    select row_data.*,
      (row_data.created_at_platform at time zone 'Asia/Riyadh')::date = row_data.metric_date
        as registered_today,
      row_data.has_previous and row_data.newly_observed as observed_today,
      row_data.has_previous
        and coalesce(row_data.previous_shipment_count, 0) = 0
        and coalesce(row_data.shipment_count, 0) > 0 as first_shipment,
      row_data.has_previous
        and row_data.shipment_delta > 0
        and row_data.previous_last_shipment_at is not null
        and row_data.previous_last_shipment_at < row_data.metric_at - interval '60 days'
        as resumed,
      row_data.has_previous
        and row_data.previous_account_state <> 'disabled'
        and row_data.account_state = 'disabled' as disabled_today,
      row_data.has_previous
        and row_data.previous_account_state = 'disabled'
        and row_data.account_state = 'enabled' as enabled_today,
      case
        when coalesce(row_data.shipment_count, 0) = 0 then 'never_shipped'
        when row_data.last_shipment_at >= row_data.metric_at - interval '5 days' then 'active_5d'
        when row_data.last_shipment_at >= row_data.metric_at - interval '30 days' then 'active_30d'
        else 'dormant_30'
      end as activity_state
    from current_rows row_data
  ), enriched as (
    select row_data.*,
      case
        when row_data.registered_today then 'registered_today'
        when row_data.first_shipment then 'first_shipment'
        when row_data.resumed then 'resumed'
        when row_data.activity_state = 'active_5d' then 'active_5d'
        when row_data.activity_state = 'active_30d' then 'active_30d'
        when row_data.activity_state = 'never_shipped' then 'never_shipped'
        else 'dormant_30'
      end as lifecycle_stage
    from classified row_data
  ), filtered as (
    select *
    from enriched row_data
    where (
      v_filter = 'all'
      or (v_filter = 'shipped_today' and row_data.shipment_delta > 0)
      or (v_filter = 'registered_today' and row_data.registered_today)
      or (v_filter = 'observed_today' and row_data.observed_today)
      or (v_filter = 'first_shipment' and row_data.first_shipment)
      or (v_filter = 'resumed' and row_data.resumed)
      or (v_filter = 'disabled_today' and row_data.disabled_today)
      or (v_filter = 'enabled_today' and row_data.enabled_today)
      or (v_filter = 'account_enabled' and row_data.account_state = 'enabled')
      or (v_filter = 'account_disabled' and row_data.account_state = 'disabled')
      or (v_filter = 'never_shipped' and row_data.activity_state = 'never_shipped')
      or (v_filter = 'active_5d' and row_data.activity_state = 'active_5d')
      or (v_filter = 'active_30d' and row_data.activity_state in ('active_5d', 'active_30d'))
      or (v_filter = 'dormant_30' and row_data.activity_state = 'dormant_30')
      or (v_filter = 'counter_exception' and row_data.negative_shipment_delta < 0)
    )
    and (
      p_search is null or btrim(p_search) = ''
      or row_data.store_name ilike '%' || btrim(p_search) || '%'
      or row_data.store_id ilike '%' || btrim(p_search) || '%'
      or coalesce(row_data.phone, '') ilike '%' || btrim(p_search) || '%'
    )
  ), ordered as (
    select row_data.*
    from filtered row_data
    order by
      case when v_filter = 'counter_exception' then row_data.negative_shipment_delta end asc nulls last,
      case when v_filter = 'registered_today' then row_data.created_at_platform end desc nulls last,
      row_data.shipment_delta desc,
      case when v_filter = 'dormant_30' then row_data.days_since_last end desc nulls last,
      case when v_filter = 'never_shipped' then row_data.created_at_platform end desc nulls last,
      row_data.last_shipment_at desc nulls last,
      row_data.shipment_count desc,
      row_data.store_name,
      row_data.store_id
    limit v_limit offset v_offset
  ), daily_points as (
    select
      current_day.local_date,
      current_day.snapshot_at,
      current_day.source,
      coalesce(sum(case when previous_meta.snapshot_id is null then 0 else greatest(
        0, coalesce(current_store.shipment_count, 0) - coalesce(previous_store.shipment_count, 0)
      ) end), 0)::bigint as shipments,
      count(*) filter (
        where previous_meta.snapshot_id is not null
          and coalesce(current_store.shipment_count, 0) > coalesce(previous_store.shipment_count, 0)
      )::int as shipping_stores,
      count(*) filter (
        where previous_meta.snapshot_id is not null
          and coalesce(current_store.shipment_count, 0) < coalesce(previous_store.shipment_count, 0)
      )::int as counter_exceptions
    from canonical_days current_day
    left join canonical_days previous_meta
      on previous_meta.local_date = (
        select max(previous_candidate.local_date)
        from canonical_days previous_candidate
        where previous_candidate.local_date < current_day.local_date
      )
    join public.merchants current_store on current_store.snapshot_id = current_day.snapshot_id
    left join public.merchants previous_store
      on previous_store.snapshot_id = previous_meta.snapshot_id
     and previous_store.store_id = current_store.store_id
    group by current_day.local_date, current_day.snapshot_at, current_day.source
    order by current_day.local_date desc
    limit 14
  )
  select jsonb_build_object(
    'metric', jsonb_build_object(
      'date', max(row_data.metric_date),
      'at', max(row_data.metric_at),
      'source', max(row_data.metric_source),
      'has_previous', bool_or(row_data.has_previous)
    ),
    'summary', jsonb_build_object(
      'total_stores', count(*)::int,
      'shipments_today', coalesce(sum(row_data.shipment_delta), 0)::bigint,
      'shipping_stores', count(*) filter (where row_data.shipment_delta > 0)::int,
      'registered_today', count(*) filter (where row_data.registered_today)::int,
      'observed_today', count(*) filter (where row_data.observed_today)::int,
      'first_shipment', count(*) filter (where row_data.first_shipment)::int,
      'resumed', count(*) filter (where row_data.resumed)::int,
      'disabled_today', count(*) filter (where row_data.disabled_today)::int,
      'enabled_today', count(*) filter (where row_data.enabled_today)::int,
      'account_enabled', count(*) filter (where row_data.account_state = 'enabled')::int,
      'account_disabled', count(*) filter (where row_data.account_state = 'disabled')::int,
      'account_unknown', count(*) filter (where row_data.account_state = 'unknown')::int,
      'active_5d', count(*) filter (where row_data.activity_state = 'active_5d')::int,
      'active_30d', count(*) filter (where row_data.activity_state in ('active_5d', 'active_30d'))::int,
      'never_shipped', count(*) filter (where row_data.activity_state = 'never_shipped')::int,
      'dormant_30', count(*) filter (where row_data.activity_state = 'dormant_30')::int,
      'counter_exceptions', count(*) filter (where row_data.negative_shipment_delta < 0)::int
    ),
    'active_filter', v_filter,
    'count', (select count(*)::int from filtered),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'store_id', ordered.store_id,
        'store_name', ordered.store_name,
        'phone', ordered.phone,
        'shipment_count', coalesce(ordered.shipment_count, 0),
        'shipment_delta', ordered.shipment_delta,
        'negative_shipment_delta', ordered.negative_shipment_delta,
        'last_shipment_at', ordered.last_shipment_at,
        'days_since_last', ordered.days_since_last,
        'account_state', ordered.account_state,
        'raw_status', ordered.status,
        'activity_state', ordered.activity_state,
        'lifecycle_stage', ordered.lifecycle_stage,
        'billing_type', ordered.billing_type,
        'integration_type', ordered.integration_type,
        'wallet_balance', ordered.wallet_balance,
        'created_at_platform', ordered.created_at_platform,
        'registered_today', ordered.registered_today,
        'observed_today', ordered.observed_today,
        'first_shipment', ordered.first_shipment,
        'resumed', ordered.resumed,
        'disabled_today', ordered.disabled_today,
        'enabled_today', ordered.enabled_today
      )) from ordered
    ), '[]'::jsonb),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', point.local_date,
        'at', point.snapshot_at,
        'source', point.source,
        'shipments', point.shipments,
        'shipping_stores', point.shipping_stores,
        'counter_exceptions', point.counter_exceptions
      ) order by point.local_date)
      from daily_points point
    ), '[]'::jsonb)
  )
  into v_result
  from enriched row_data;

  return coalesce(v_result, jsonb_build_object(
    'metric', '{}'::jsonb,
    'summary', '{}'::jsonb,
    'active_filter', v_filter,
    'count', 0,
    'rows', '[]'::jsonb,
    'trend', '[]'::jsonb
  ));
end;
$function$;

revoke execute on function public.lamha_store_performance_command_center(text,text,integer,integer)
  from public, anon;
grant execute on function public.lamha_store_performance_command_center(text,text,integer,integer)
  to authenticated, service_role;

comment on function public.lamha_store_performance_command_center(text,text,integer,integer) is
  'Read-only Lamha store performance command center based on one canonical midnight snapshot per Riyadh day.';
