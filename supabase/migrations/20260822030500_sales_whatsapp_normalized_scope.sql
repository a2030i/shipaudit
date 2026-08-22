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

  select coalesce(array_agg(distinct public.norm_sa_phone(routing.phone)), array[]::text[])
  into v_allowed
  from public.v_platform_commercial_routing routing
  left join public.retargeting_followups followup on public.norm_sa_phone(followup.phone) = public.norm_sa_phone(routing.phone)
  where routing.sales_eligible
    and public.norm_sa_phone(routing.phone) = any(v_requested)
    and (v_see_all or followup.owner_id = v_uid or followup.phone is null);

  if cardinality(v_allowed) is distinct from cardinality(v_requested) then
    raise exception 'phone_outside_sales_scope';
  end if;

  return query
  with latest as (
    select distinct on (public.norm_sa_phone(send.phone))
      public.norm_sa_phone(send.phone) as phone,
      send.name, send.template_name, send.campaign_name,
      send.sent_at, send.status, send.delivered_at, send.read_at,
      send.replied_at, send.error_reason
    from public.whatsapp_campaign_sends send
    where public.norm_sa_phone(send.phone) = any(v_allowed)
    order by public.norm_sa_phone(send.phone), send.sent_at desc
  ), delivered_latest as (
    select public.norm_sa_phone(send.phone) as phone, max(send.sent_at) as last_ok
    from public.whatsapp_campaign_sends send
    where public.norm_sa_phone(send.phone) = any(v_allowed)
      and (send.delivered_at is not null or send.read_at is not null)
    group by public.norm_sa_phone(send.phone)
  ), counts as (
    select public.norm_sa_phone(send.phone) as phone, count(*)::integer as count
    from public.whatsapp_campaign_sends send
    where public.norm_sa_phone(send.phone) = any(v_allowed)
    group by public.norm_sa_phone(send.phone)
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
grant execute on function public.sales_whatsapp_campaign_status(text[]) to authenticated, service_role;

comment on function public.sales_whatsapp_campaign_status(text[]) is
  'Sales-scoped campaign status with normalized scope matching. Every requested phone must be in the caller-visible commercial pipeline; paid_after remains approximate.';
