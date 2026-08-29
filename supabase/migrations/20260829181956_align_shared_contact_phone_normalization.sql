-- Align same-contact context with Store 360 phone normalization.
-- This remains a read-only operating hint; it never links financial identities.

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
  with raw_latest as materialized (
    select
      m.store_id::text,
      m.store_name,
      m.status,
      m.billing_type,
      m.wallet_balance,
      m.last_shipment_at,
      regexp_replace(coalesce(m.phone,''), '[^0-9]', '', 'g') phone_digits
    from public.merchants m
    where m.snapshot_id = (
      select snapshot_id from public.merchants order by uploaded_at desc limit 1
    )
  ),
  latest as materialized (
    select
      r.store_id,
      r.store_name,
      r.status,
      r.billing_type,
      r.wallet_balance,
      r.last_shipment_at,
      case
        when r.phone_digits like '00966%' then substring(r.phone_digits from 6)
        when r.phone_digits like '966%' then substring(r.phone_digits from 4)
        when r.phone_digits like '0%' then substring(r.phone_digits from 2)
        else r.phone_digits
      end phone_normalized
    from raw_latest r
  ),
  shared_phones as materialized (
    select l.phone_normalized
    from latest l
    where length(l.phone_normalized) >= 8
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
  'Read-only same-contact context from the latest Lamha merchant snapshot. Phone format variants are normalized consistently. It does not assert ownership, link Zoho identities, aggregate debt, or permit writes.';

revoke all on function public.lamha_shared_contact_context() from public, anon;
grant execute on function public.lamha_shared_contact_context() to authenticated, service_role;
