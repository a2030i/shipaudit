-- Lamha supplies the exact Zoho Books contact identifier in accountingUrl.
-- That identifier is the authority for Store <-> Zoho identity. Names and
-- phone numbers remain display/search attributes and must never select the
-- financial account used by operational workflows.

create or replace function public.lamha_zoho_contact_id(p_api_data jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select nullif(substring(coalesce(p_api_data ->> 'accountingUrl', '') from '/contacts/([0-9]+)'), '')
$function$;

revoke all on function public.lamha_zoho_contact_id(jsonb) from public, anon;
grant execute on function public.lamha_zoho_contact_id(jsonb) to authenticated, service_role;

create table if not exists public.lamha_zoho_store_links (
  store_id text primary key,
  zoho_contact_id text not null unique,
  accounting_url text not null,
  source text not null default 'lamha_api'
    check (source = 'lamha_api'),
  source_checked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint lamha_zoho_store_links_store_not_blank check (btrim(store_id) <> ''),
  constraint lamha_zoho_store_links_contact_not_blank check (btrim(zoho_contact_id) <> '')
);

create index if not exists lamha_zoho_store_links_contact_idx
  on public.lamha_zoho_store_links (zoho_contact_id);

alter table public.lamha_zoho_store_links enable row level security;
revoke all on table public.lamha_zoho_store_links from public, anon, authenticated;
grant all on table public.lamha_zoho_store_links to service_role;

comment on table public.lamha_zoho_store_links is
  'Authoritative one-to-one Store ID to Zoho Contact ID map extracted only from Lamha Employee API accountingUrl.';
comment on column public.lamha_zoho_store_links.zoho_contact_id is
  'Exact Zoho Books contact identifier supplied by Lamha; names and phones are never fallback identity keys.';

create table if not exists public.lamha_zoho_link_audit (
  id bigint generated always as identity primary key,
  event_kind text not null check (event_kind in (
    'authority_created', 'authority_changed', 'legacy_link_created',
    'legacy_store_corrected', 'conflicting_contact_unlinked'
  )),
  store_id text,
  zoho_contact_id text,
  previous_store_id text,
  previous_zoho_contact_id text,
  source_checked_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp()
);

create index if not exists lamha_zoho_link_audit_recorded_idx
  on public.lamha_zoho_link_audit (recorded_at desc);

alter table public.lamha_zoho_link_audit enable row level security;
revoke all on table public.lamha_zoho_link_audit from public, anon, authenticated;
grant all on table public.lamha_zoho_link_audit to service_role;

comment on table public.lamha_zoho_link_audit is
  'Append-only proof of Store/Zoho identity corrections driven by the exact Lamha accounting identifier; contains no token or raw profile payload.';

alter table public.customer_merchant_links
  add column if not exists zoho_contact_id text;

alter table public.customer_merchant_links
  drop constraint if exists customer_merchant_links_match_method_check;
alter table public.customer_merchant_links
  add constraint customer_merchant_links_match_method_check
  check (match_method = any (array[
    'auto-exact'::text, 'auto-fuzzy'::text, 'manual'::text,
    'unmatched'::text, 'lamha-zoho-id'::text
  ]));

create unique index if not exists customer_merchant_links_zoho_contact_uidx
  on public.customer_merchant_links (zoho_contact_id)
  where zoho_contact_id is not null;

comment on column public.customer_merchant_links.zoho_contact_id is
  'Compatibility mirror of the exact Zoho identity. Lamha-authoritative rows are protected by trigger and use match_method=lamha-zoho-id.';

create or replace function public.refresh_lamha_zoho_store_links()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_authoritative integer := 0;
  v_created integer := 0;
  v_corrected integer := 0;
  v_conflicts integer := 0;
begin
  -- Refuse an ambiguous source rather than choosing an arbitrary store.
  if exists (
    select 1
    from public.lamha_store_profiles p
    where lower(coalesce(p.api_data ->> 'accountingProvider', '')) = 'zoho'
      and public.lamha_zoho_contact_id(p.api_data) is not null
    group by public.lamha_zoho_contact_id(p.api_data)
    having count(distinct p.store_id) > 1
  ) then
    raise exception 'lamha_zoho_contact_is_not_unique';
  end if;

  -- Record new/changed authority before replacing the current registry.
  insert into public.lamha_zoho_link_audit (
    event_kind, store_id, zoho_contact_id, previous_zoho_contact_id, source_checked_at
  )
  select
    case when current_link.store_id is null then 'authority_created' else 'authority_changed' end,
    p.store_id,
    public.lamha_zoho_contact_id(p.api_data),
    current_link.zoho_contact_id,
    coalesce(p.api_detail_checked_at, p.api_list_checked_at, p.updated_at)
  from public.lamha_store_profiles p
  left join public.lamha_zoho_store_links current_link on current_link.store_id = p.store_id
  where lower(coalesce(p.api_data ->> 'accountingProvider', '')) = 'zoho'
    and public.lamha_zoho_contact_id(p.api_data) is not null
    and current_link.zoho_contact_id is distinct from public.lamha_zoho_contact_id(p.api_data);

  -- Remove changed rows before the upsert so even a future two-store ID swap
  -- cannot collide with the one-to-one unique constraint mid-transaction.
  delete from public.lamha_zoho_store_links current_link
  using public.lamha_store_profiles p
  where current_link.store_id = p.store_id
    and lower(coalesce(p.api_data ->> 'accountingProvider', '')) = 'zoho'
    and public.lamha_zoho_contact_id(p.api_data) is not null
    and current_link.zoho_contact_id <> public.lamha_zoho_contact_id(p.api_data);

  insert into public.lamha_zoho_store_links (
    store_id, zoho_contact_id, accounting_url, source, source_checked_at, updated_at
  )
  select
    p.store_id,
    public.lamha_zoho_contact_id(p.api_data),
    p.api_data ->> 'accountingUrl',
    'lamha_api',
    coalesce(p.api_detail_checked_at, p.api_list_checked_at, p.updated_at),
    clock_timestamp()
  from public.lamha_store_profiles p
  where lower(coalesce(p.api_data ->> 'accountingProvider', '')) = 'zoho'
    and public.lamha_zoho_contact_id(p.api_data) is not null
  on conflict (store_id) do update set
    zoho_contact_id = excluded.zoho_contact_id,
    accounting_url = excluded.accounting_url,
    source = 'lamha_api',
    source_checked_at = excluded.source_checked_at,
    updated_at = clock_timestamp();

  delete from public.lamha_zoho_store_links current_link
  where not exists (
    select 1
    from public.lamha_store_profiles p
    where p.store_id = current_link.store_id
      and lower(coalesce(p.api_data ->> 'accountingProvider', '')) = 'zoho'
      and public.lamha_zoho_contact_id(p.api_data) = current_link.zoho_contact_id
  );

  -- Attach exact Zoho IDs to the legacy compatibility table only when the
  -- Zoho name resolves uniquely. No fuzzy/name normalization is involved.
  update public.customer_merchant_links legacy
  set zoho_contact_id = contact.zoho_id
  from public.zoho_contacts contact
  where legacy.customer_name = contact.contact_name
    and legacy.zoho_contact_id is distinct from contact.zoho_id;

  -- A renamed Zoho contact must not leave two rows claiming the same ID.
  update public.customer_merchant_links legacy
  set store_id = null,
      confidence = 0,
      match_method = 'unmatched',
      zoho_contact_id = null,
      linked_by = null,
      linked_at = clock_timestamp()
  where legacy.zoho_contact_id is not null
    and exists (
      select 1
      from public.lamha_zoho_store_links authority
      join public.zoho_contacts contact on contact.zoho_id = authority.zoho_contact_id
      where authority.zoho_contact_id = legacy.zoho_contact_id
        and contact.contact_name <> legacy.customer_name
    );

  -- Record and clear a Zoho contact that was attached to a store whose Lamha
  -- accounting ID points at another contact. Non-Zoho internal aliases remain.
  insert into public.lamha_zoho_link_audit (
    event_kind, store_id, zoho_contact_id, previous_store_id,
    previous_zoho_contact_id, source_checked_at
  )
  select distinct
    'conflicting_contact_unlinked', authority.store_id, authority.zoho_contact_id,
    legacy.store_id, legacy.zoho_contact_id, authority.source_checked_at
  from public.lamha_zoho_store_links authority
  join public.customer_merchant_links legacy on legacy.store_id = authority.store_id
  where legacy.zoho_contact_id is not null
    and legacy.zoho_contact_id <> authority.zoho_contact_id;
  get diagnostics v_conflicts = row_count;

  update public.customer_merchant_links legacy
  set store_id = null,
      confidence = 0,
      match_method = 'unmatched',
      linked_by = null,
      linked_at = clock_timestamp()
  from public.lamha_zoho_store_links authority
  where legacy.store_id = authority.store_id
    and legacy.zoho_contact_id is not null
    and legacy.zoho_contact_id <> authority.zoho_contact_id;

  -- Record the 34 missing and 19 historical-store cases (or their future
  -- equivalents) before the compatibility mirror is corrected.
  insert into public.lamha_zoho_link_audit (
    event_kind, store_id, zoho_contact_id, previous_store_id, source_checked_at
  )
  select
    case when legacy.customer_name is null or legacy.store_id is null
      then 'legacy_link_created' else 'legacy_store_corrected' end,
    authority.store_id,
    authority.zoho_contact_id,
    legacy.store_id,
    authority.source_checked_at
  from public.lamha_zoho_store_links authority
  join public.zoho_contacts contact on contact.zoho_id = authority.zoho_contact_id
  left join public.customer_merchant_links legacy on legacy.customer_name = contact.contact_name
  where legacy.store_id is distinct from authority.store_id;

  select count(*) filter (where legacy.customer_name is null or legacy.store_id is null),
         count(*) filter (where legacy.customer_name is not null and legacy.store_id is not null
                           and legacy.store_id <> authority.store_id)
  into v_created, v_corrected
  from public.lamha_zoho_store_links authority
  join public.zoho_contacts contact on contact.zoho_id = authority.zoho_contact_id
  left join public.customer_merchant_links legacy on legacy.customer_name = contact.contact_name
  where legacy.store_id is distinct from authority.store_id;

  insert into public.customer_merchant_links (
    customer_name, store_id, confidence, match_method, linked_by, linked_at, zoho_contact_id
  )
  select
    contact.contact_name,
    authority.store_id,
    1.0,
    'lamha-zoho-id',
    null,
    clock_timestamp(),
    authority.zoho_contact_id
  from public.lamha_zoho_store_links authority
  join public.zoho_contacts contact on contact.zoho_id = authority.zoho_contact_id
  on conflict (customer_name) do update set
    store_id = excluded.store_id,
    confidence = 1.0,
    match_method = 'lamha-zoho-id',
    linked_by = null,
    linked_at = clock_timestamp(),
    zoho_contact_id = excluded.zoho_contact_id;

  select count(*) into v_authoritative from public.lamha_zoho_store_links;
  return jsonb_build_object(
    'authoritative', v_authoritative,
    'legacyLinksCreated', v_created,
    'legacyStoresCorrected', v_corrected,
    'conflictingContactsUnlinked', v_conflicts,
    'source', 'lamha_accounting_url_zoho_contact_id'
  );
end;
$function$;

revoke all on function public.refresh_lamha_zoho_store_links() from public, anon, authenticated;
grant execute on function public.refresh_lamha_zoho_store_links() to service_role;

-- Initial exact backfill and correction. This produces the append-only proof
-- before the compatibility rows are changed.
select public.refresh_lamha_zoho_store_links();

create or replace function public.enforce_lamha_zoho_link_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_zoho_id text;
  v_store_id text;
begin
  select contact.zoho_id into v_zoho_id
  from public.zoho_contacts contact
  where contact.contact_name = new.customer_name;

  if v_zoho_id is null then
    return new;
  end if;

  new.zoho_contact_id := v_zoho_id;
  select authority.store_id into v_store_id
  from public.lamha_zoho_store_links authority
  where authority.zoho_contact_id = v_zoho_id;

  if v_store_id is not null then
    new.store_id := v_store_id;
    new.confidence := 1.0;
    new.match_method := 'lamha-zoho-id';
    new.linked_by := null;
    new.linked_at := clock_timestamp();
    return new;
  end if;

  if new.store_id is not null and exists (
    select 1 from public.lamha_zoho_store_links authority
    where authority.store_id = new.store_id
      and authority.zoho_contact_id <> v_zoho_id
  ) then
    raise exception 'store_has_different_lamha_zoho_contact';
  end if;

  return new;
end;
$function$;

drop trigger if exists customer_merchant_links_lamha_authority
  on public.customer_merchant_links;
create trigger customer_merchant_links_lamha_authority
before insert or update on public.customer_merchant_links
for each row execute function public.enforce_lamha_zoho_link_authority();

revoke all on function public.enforce_lamha_zoho_link_authority() from public, anon, authenticated;

-- Keep the canonical identity current after every Lamha list/detail batch.
create or replace function public.merge_lamha_store_profiles_from_api(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
  v_links jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'not_allowed';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'invalid_rows';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where nullif(btrim(item ->> 'store_id'), '') is null
       or jsonb_typeof(coalesce(item -> 'api_data', '{}'::jsonb)) <> 'object'
  ) then
    raise exception 'invalid_profile_row';
  end if;

  insert into public.lamha_store_profiles (
    store_id, api_data, api_list_checked_at, api_detail_checked_at,
    api_http_status, api_latency_ms, updated_at
  )
  select
    btrim(row_data.store_id),
    jsonb_strip_nulls(coalesce(row_data.api_data, '{}'::jsonb)),
    row_data.api_list_checked_at,
    row_data.api_detail_checked_at,
    row_data.api_http_status,
    row_data.api_latency_ms,
    clock_timestamp()
  from jsonb_to_recordset(p_rows) as row_data(
    store_id text,
    api_data jsonb,
    api_list_checked_at timestamptz,
    api_detail_checked_at timestamptz,
    api_http_status integer,
    api_latency_ms integer
  )
  on conflict (store_id) do update set
    api_data = public.lamha_store_profiles.api_data || excluded.api_data,
    api_list_checked_at = coalesce(excluded.api_list_checked_at, public.lamha_store_profiles.api_list_checked_at),
    api_detail_checked_at = coalesce(excluded.api_detail_checked_at, public.lamha_store_profiles.api_detail_checked_at),
    api_http_status = coalesce(excluded.api_http_status, public.lamha_store_profiles.api_http_status),
    api_latency_ms = coalesce(excluded.api_latency_ms, public.lamha_store_profiles.api_latency_ms),
    updated_at = clock_timestamp();

  get diagnostics v_count = row_count;
  v_links := public.refresh_lamha_zoho_store_links();
  return jsonb_build_object('merged', v_count, 'zohoLinks', v_links);
end;
$function$;

revoke execute on function public.merge_lamha_store_profiles_from_api(jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_lamha_store_profiles_from_api(jsonb)
  to service_role;

comment on function public.refresh_lamha_zoho_store_links() is
  'Rebuilds the exact Lamha Store ID to Zoho Contact ID authority and corrects the legacy name-keyed compatibility mirror without fuzzy/name/phone matching.';
comment on function public.merge_lamha_store_profiles_from_api(jsonb) is
  'Merges sanitized Lamha API profiles then refreshes the exact Lamha-supplied Zoho Contact ID identity map in the same transaction.';
