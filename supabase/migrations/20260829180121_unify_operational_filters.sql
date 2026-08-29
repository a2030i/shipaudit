-- Read-only operational context for the unified receivables worklist.
-- Financial identity remains the Zoho contact id. A shared Lamha phone is
-- exposed only as operator context and never links or aggregates balances.

create or replace function public.customer_operational_age_amounts(
  p_aging text[] default array[]::text[],
  p_min_days integer default null,
  p_max_days integer default null
)
returns table (
  zoho_id text,
  amount numeric,
  invoice_count integer,
  opening_count integer,
  oldest_days integer,
  oldest_due_date date
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '2500ms'
as $function$
  with allowed_aging as (
    select coalesce(array_agg(distinct key order by key), array[]::text[]) value
    from unnest(coalesce(p_aging, array[]::text[])) key
    where key = any(array['inv1_15','inv16_30','inv31_60','inv61_90','inv90p','opening'])
  ),
  normalized as (
    select
      l.contact_id::text zoho_id,
      case
        when l.line_kind = 'opening_balance'
          or (l.line_kind = 'invoice' and position('الرصيد الافتتاحي' in coalesce(l.invoice_number, '')) > 0)
          then 'opening_balance'
        else l.line_kind
      end effective_kind,
      l.collectible_amount,
      coalesce(l.age_days, 0) age_days,
      coalesce(l.due_date, l.line_date) effective_date
    from public.customer_collectible_lines l
    where auth.uid() is not null
      and public.crm_has_permission('receivables.view')
      and l.collectible_amount > 0.005
      and nullif(btrim(l.contact_id::text), '') is not null
  ),
  scoped as (
    select n.*
    from normalized n
    cross join allowed_aging a
    where n.effective_kind = 'invoice'
      and (p_min_days is null or n.age_days > p_min_days)
      and (p_max_days is null or n.age_days <= p_max_days)
      and (
        cardinality(a.value) = 0
        or ('inv1_15' = any(a.value) and n.age_days between 1 and 15)
        or ('inv16_30' = any(a.value) and n.age_days between 16 and 30)
        or ('inv31_60' = any(a.value) and n.age_days between 31 and 60)
        or ('inv61_90' = any(a.value) and n.age_days between 61 and 90)
        or ('inv90p' = any(a.value) and n.age_days > 90)
      )
  )
  select
    s.zoho_id,
    round(sum(s.collectible_amount)::numeric, 2) amount,
    count(*)::integer invoice_count,
    0::integer opening_count,
    max(s.age_days)::integer oldest_days,
    min(s.effective_date)::date oldest_due_date
  from scoped s
  group by s.zoho_id;
$function$;

comment on function public.customer_operational_age_amounts(text[], integer, integer) is
  'Exact read-only invoice amount inside the requested age scope. Opening balance stays separate and phone/name never determine financial identity.';

revoke all on function public.customer_operational_age_amounts(text[], integer, integer) from public, anon;
grant execute on function public.customer_operational_age_amounts(text[], integer, integer) to authenticated, service_role;

create or replace function public.lamha_shared_contact_context()
returns table (
  store_id text,
  shared_store_count integer,
  shared_stores jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2500ms'
as $function$
begin
  if auth.uid() is null or not public.crm_has_permission('receivables.view') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
  with latest as materialized (
    select
      m.store_id::text,
      m.store_name,
      m.status,
      m.billing_type,
      m.wallet_balance,
      m.last_shipment_at,
      case
        when regexp_replace(coalesce(m.phone,''), '\\D', '', 'g') like '00966%'
          then substring(regexp_replace(coalesce(m.phone,''), '\\D', '', 'g') from 3)
        when regexp_replace(coalesce(m.phone,''), '\\D', '', 'g') like '05%'
          then '966' || substring(regexp_replace(coalesce(m.phone,''), '\\D', '', 'g') from 2)
        when length(regexp_replace(coalesce(m.phone,''), '\\D', '', 'g')) = 9
          and regexp_replace(coalesce(m.phone,''), '\\D', '', 'g') like '5%'
          then '966' || regexp_replace(coalesce(m.phone,''), '\\D', '', 'g')
        else regexp_replace(coalesce(m.phone,''), '\\D', '', 'g')
      end phone_normalized
    from public.merchants m
    where m.snapshot_id = (
      select snapshot_id from public.merchants order by uploaded_at desc limit 1
    )
  ),
  shared_phones as materialized (
    select l.phone_normalized
    from latest l
    where l.phone_normalized <> ''
    group by l.phone_normalized
    having count(*) > 1
  )
  select
    current_store.store_id,
    count(peer.store_id)::integer shared_store_count,
    coalesce(jsonb_agg(jsonb_build_object(
      'storeId', peer.store_id,
      'storeName', peer.store_name,
      'status', peer.status,
      'billingType', peer.billing_type,
      'walletBalance', peer.wallet_balance,
      'lastShipmentAt', peer.last_shipment_at
    ) order by peer.store_name, peer.store_id), '[]'::jsonb) shared_stores
  from latest current_store
  join shared_phones group_phone on group_phone.phone_normalized = current_store.phone_normalized
  join latest peer on peer.phone_normalized = current_store.phone_normalized
    and peer.store_id <> current_store.store_id
  group by current_store.store_id;
end;
$function$;

comment on function public.lamha_shared_contact_context() is
  'Read-only same-contact context from the latest Lamha merchant snapshot. It does not assert ownership, link Zoho identities, aggregate debt, or permit writes.';

revoke all on function public.lamha_shared_contact_context() from public, anon;
grant execute on function public.lamha_shared_contact_context() to authenticated, service_role;
