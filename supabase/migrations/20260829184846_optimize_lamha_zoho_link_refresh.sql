-- A live Store status check persists the returned detail profile. Do not turn
-- that read into a 1,000-row identity refresh when accountingUrl did not
-- change. The full authoritative refresh remains atomic when an ID is new,
-- changed, or Lamha explicitly removes Zoho as accounting provider.

create or replace function public.merge_lamha_store_profiles_from_api(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
  v_links jsonb;
  v_refresh_links boolean := false;
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

  select exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming(store_id text, api_data jsonb)
    left join public.lamha_zoho_store_links current_link
      on current_link.store_id = btrim(incoming.store_id)
    where (
      public.lamha_zoho_contact_id(incoming.api_data) is not null
      and current_link.zoho_contact_id is distinct from public.lamha_zoho_contact_id(incoming.api_data)
    ) or (
      current_link.store_id is not null
      and incoming.api_data ? 'accountingProvider'
      and lower(coalesce(incoming.api_data ->> 'accountingProvider', '')) <> 'zoho'
    )
  ) into v_refresh_links;

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
  if v_refresh_links then
    v_links := public.refresh_lamha_zoho_store_links();
  else
    v_links := jsonb_build_object(
      'skipped', true,
      'reason', 'lamha_zoho_identity_unchanged',
      'source', 'lamha_accounting_url_zoho_contact_id'
    );
  end if;
  return jsonb_build_object('merged', v_count, 'zohoLinks', v_links);
end;
$function$;

revoke execute on function public.merge_lamha_store_profiles_from_api(jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_lamha_store_profiles_from_api(jsonb)
  to service_role;

comment on function public.merge_lamha_store_profiles_from_api(jsonb) is
  'Merges sanitized Lamha API profiles and refreshes exact Store/Zoho identity only when the incoming accounting authority is new, changed, or explicitly removed.';
