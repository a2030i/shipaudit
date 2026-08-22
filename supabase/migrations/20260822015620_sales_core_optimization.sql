-- Sales Core Optimization
-- Additive, local-only read paths. Existing functions remain available as rollback.

-- EXPLAIN on production showed the normalized Hatif lookup spending ~120ms scanning
-- rows that do not currently contain a usable phone. This exact expression is used by
-- customer_engagement_next_actions; the partial index is therefore query-shape driven.
create index if not exists hatif_call_log_normalized_phone_time_idx
  on public.hatif_call_log (
    (coalesce(contact_phone, public.norm_sa_phone(contact_number))),
    creation_time desc
  )
  where coalesce(contact_phone, public.norm_sa_phone(contact_number)) is not null;

-- The same queue repeatedly groups campaign activity by the normalized phone.
-- All current campaign rows are already normalized; the expression keeps future input
-- compatible with the existing business rule without changing its result.
create index if not exists whatsapp_campaign_sends_normalized_phone_time_idx
  on public.whatsapp_campaign_sends (
    (public.norm_sa_phone(phone)),
    sent_at desc
  )
  where sent_at is not null and public.norm_sa_phone(phone) is not null;

-- Paginated compatibility read for "today's work". It deliberately consumes the
-- existing reviewed queue rather than re-implementing opportunity rules.
create or replace function public.customer_growth_action_queue_page(
  p_page_size integer default 50,
  p_offset integer default 0,
  p_owner text default null,
  p_group text default null
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
  v_effective_owner text;
  v_rows jsonb;
  v_result jsonb;
begin
  if v_uid is null
     or not public.app_has_any_permission(array[
       'collections.view', 'sales.view', 'overview.view', 'crm.view'
     ]) then
    raise exception 'not_allowed';
  end if;

  if p_group is not null and p_group not in (
    U&'\0627\0644\062C\062F\062F',
    U&'\0627\0644\0645\062A\0648\0642\0641\0648\0646',
    U&'\0645\062A\0627\0628\0639\0629',
    U&'\062A\062D\0635\064A\0644',
    U&'\062A\0648\0627\0635\0644'
  ) then
    raise exception 'invalid_group';
  end if;

  v_see_all := public.crm_can_see_all();
  if p_owner is not null and p_owner <> v_uid::text and not v_see_all then
    raise exception 'not_allowed_owner';
  end if;

  -- A limited employee receives only their own queue. Admin/view_all keeps the
  -- existing all-team queue and may explicitly choose one owner.
  v_effective_owner := case
    when v_see_all then nullif(p_owner, '')
    else v_uid::text
  end;

  v_rows := private.customer_growth_action_queue(1000, v_effective_owner, null);

  with expanded as (
    select
      item.value as row_data,
      item.ordinality as result_order,
      case item.value->>'reason_code'
        when 'hot_reply' then U&'\062A\0648\0627\0635\0644'
        when 'reply' then U&'\062A\0648\0627\0635\0644'
        when 'sla' then U&'\0645\062A\0627\0628\0639\0629'
        when 'wallet_neg' then U&'\062A\062D\0635\064A\0644'
        when 'debt' then U&'\062A\062D\0635\064A\0644'
        when 'new_registered' then U&'\0627\0644\062C\062F\062F'
        when 'new_ready' then U&'\0627\0644\062C\062F\062F'
        when 'stopped_recent' then U&'\0627\0644\0645\062A\0648\0642\0641\0648\0646'
        when 'stopped_long' then U&'\0627\0644\0645\062A\0648\0642\0641\0648\0646'
        else U&'\2014'
      end as action_group
    from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb))
      with ordinality item(value, ordinality)
  ), enriched as (
    select
      expanded.row_data || jsonb_build_object(
        'owner_name', profile.name,
        'action_group', expanded.action_group
      ) as row_data,
      expanded.result_order,
      expanded.action_group
    from expanded
    left join public.profiles profile
      on profile.id::text = expanded.row_data->>'owner_id'
  ), filtered as (
    select *
    from enriched
    where p_group is null or action_group = p_group
  ), totals as (
    select
      count(*)::integer as count,
      coalesce(sum((row_data->>'amount')::numeric), 0)::numeric as money,
      count(*) filter (where coalesce((row_data->>'send_eligible')::boolean, false))::integer as ready,
      count(*) filter (where not coalesce((row_data->>'send_eligible')::boolean, false))::integer as held
    from filtered
  ), groups as (
    select coalesce(jsonb_object_agg(action_group, group_count), '{}'::jsonb) as value
    from (
      select action_group, count(*)::integer as group_count
      from enriched
      group by action_group
    ) grouped
  ), page_rows as (
    select *
    from filtered
    order by result_order
    limit greatest(1, least(coalesce(p_page_size, 50), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(row_data order by result_order) from page_rows),
      '[]'::jsonb
    ),
    'count', (select count from totals),
    'summary', jsonb_build_object(
      'count', (select count from totals),
      'money', (select money from totals),
      'ready', (select ready from totals),
      'held', (select held from totals),
      'by_group', (select value from groups)
    ),
    'page_info', jsonb_build_object(
      'limit', greatest(1, least(coalesce(p_page_size, 50), 100)),
      'offset', greatest(0, coalesce(p_offset, 0)),
      'has_next', greatest(0, coalesce(p_offset, 0))
        + greatest(1, least(coalesce(p_page_size, 50), 100))
        < (select count from totals)
    )
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.customer_growth_action_queue_page(integer, integer, text, text)
  from public, anon;
grant execute on function public.customer_growth_action_queue_page(integer, integer, text, text)
  to authenticated, service_role;

comment on function public.customer_growth_action_queue_page(integer, integer, text, text) is
  'Server-paginated compatibility read for the reviewed customer growth queue. No sends and no external calls.';

-- Scope-limited campaign status for Sales. Requested phones must all be visible in
-- the caller's commercial pipeline; a caller cannot use this function as a phone
-- status oracle. paid_after remains an approximate name/date correlation only.
create or replace function public.sales_whatsapp_campaign_status(
  p_phones text[]
)
returns table(
  phone text,
  name text,
  last_template text,
  last_campaign text,
  last_sent_at timestamptz,
  last_status text,
  delivered boolean,
  read_flag boolean,
  replied boolean,
  reply_at timestamptz,
  sends_count integer,
  paid_after boolean,
  paid_at timestamptz,
  last_delivered_at timestamptz,
  last_attempt_failed boolean,
  paid_after_basis text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_see_all boolean;
  v_requested text[];
  v_allowed text[];
begin
  if v_uid is null
     or not public.app_has_any_permission(array['campaigns.send'])
     or not public.app_has_any_permission(array['sales.view', 'crm.view']) then
    raise exception 'not_allowed';
  end if;

  select coalesce(array_agg(distinct normalized_phone), array[]::text[])
  into v_requested
  from (
    select public.norm_sa_phone(raw_phone) as normalized_phone
    from unnest(coalesce(p_phones, array[]::text[])) raw_phone
  ) requested
  where normalized_phone is not null;

  if cardinality(v_requested) > 1000 then
    raise exception 'too_many_phones';
  end if;

  v_see_all := public.crm_can_see_all();

  select coalesce(array_agg(distinct routing.phone), array[]::text[])
  into v_allowed
  from public.v_platform_commercial_routing routing
  left join public.retargeting_followups followup on followup.phone = routing.phone
  where routing.sales_eligible
    and routing.phone = any(v_requested)
    and (v_see_all or followup.owner_id = v_uid or followup.phone is null);

  if cardinality(v_allowed) is distinct from cardinality(v_requested) then
    raise exception 'phone_outside_sales_scope';
  end if;

  return query
  with latest as (
    select distinct on (send.phone)
      send.phone, send.name, send.template_name, send.campaign_name,
      send.sent_at, send.status, send.delivered_at, send.read_at,
      send.replied_at, send.error_reason
    from public.whatsapp_campaign_sends send
    where send.phone = any(v_allowed)
    order by send.phone, send.sent_at desc
  ), delivered_latest as (
    select send.phone, max(send.sent_at) as last_ok
    from public.whatsapp_campaign_sends send
    where send.phone = any(v_allowed)
      and (send.delivered_at is not null or send.read_at is not null)
    group by send.phone
  ), counts as (
    select send.phone, count(*)::integer as count
    from public.whatsapp_campaign_sends send
    where send.phone = any(v_allowed)
    group by send.phone
  ), paid as (
    select latest.phone,
      min(payment.date) filter (where payment.date >= latest.sent_at::date) as first_paid
    from latest
    join public.zoho_payments payment
      on lower(regexp_replace(coalesce(payment.customer_name, ''), '\s+', '', 'g'))
       = lower(regexp_replace(coalesce(latest.name, ''), '\s+', '', 'g'))
     and coalesce(latest.name, '') <> ''
    group by latest.phone
  )
  select
    latest.phone, latest.name, latest.template_name, latest.campaign_name,
    latest.sent_at, latest.status,
    latest.delivered_at is not null,
    latest.read_at is not null,
    latest.replied_at is not null,
    latest.replied_at,
    coalesce(counts.count, 1),
    paid.first_paid is not null,
    paid.first_paid::timestamptz,
    delivered_latest.last_ok,
    latest.status = 'Failed' or latest.error_reason is not null,
    'approximate_name_date_correlation'::text
  from latest
  left join counts on counts.phone = latest.phone
  left join paid on paid.phone = latest.phone
  left join delivered_latest on delivered_latest.phone = latest.phone;
end;
$function$;

revoke all on function public.sales_whatsapp_campaign_status(text[]) from public, anon;
grant execute on function public.sales_whatsapp_campaign_status(text[])
  to authenticated, service_role;

comment on function public.sales_whatsapp_campaign_status(text[]) is
  'Sales-scoped campaign status. Every requested phone must be in the caller-visible commercial pipeline. paid_after is approximate, not payment attribution or identity proof.';
