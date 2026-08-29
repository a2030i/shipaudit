-- Lamha store profile registry.
--
-- Keeps the complete read-only Lamha payload independently from the merchant
-- snapshot used by operational/financial workflows. Excel is retained as a
-- fallback source: non-null API values win when the effective profile is read.

create table if not exists public.lamha_store_profiles (
  store_id text primary key,
  api_data jsonb not null default '{}'::jsonb,
  excel_data jsonb not null default '{}'::jsonb,
  api_list_checked_at timestamptz,
  api_detail_checked_at timestamptz,
  api_http_status integer,
  api_latency_ms integer,
  excel_imported_at timestamptz,
  excel_source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lamha_store_profiles_api_object check (jsonb_typeof(api_data) = 'object'),
  constraint lamha_store_profiles_excel_object check (jsonb_typeof(excel_data) = 'object'),
  constraint lamha_store_profiles_http_status check (api_http_status is null or api_http_status between 100 and 599),
  constraint lamha_store_profiles_latency check (api_latency_ms is null or api_latency_ms >= 0)
);

create index if not exists lamha_store_profiles_detail_refresh_idx
  on public.lamha_store_profiles (api_detail_checked_at asc nulls first, store_id);

alter table public.lamha_store_profiles enable row level security;
revoke all on table public.lamha_store_profiles from public, anon, authenticated;
grant all on table public.lamha_store_profiles to service_role;

create or replace function public.merge_lamha_store_profiles_from_api(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
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
  return jsonb_build_object('merged', v_count);
end;
$function$;

revoke execute on function public.merge_lamha_store_profiles_from_api(jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_lamha_store_profiles_from_api(jsonb)
  to service_role;

create or replace function public.merge_lamha_store_profiles_from_excel(
  p_rows jsonb,
  p_source_file text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if (select auth.uid()) is null
     or not public.crm_has_permission('merchants.upload') then
    raise exception 'not_allowed';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'invalid_rows';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where nullif(btrim(item ->> 'store_id'), '') is null
       or jsonb_typeof(coalesce(item -> 'excel_data', '{}'::jsonb)) <> 'object'
  ) then
    raise exception 'invalid_profile_row';
  end if;

  insert into public.lamha_store_profiles (
    store_id, excel_data, excel_imported_at, excel_source_file, updated_at
  )
  select
    btrim(row_data.store_id),
    jsonb_strip_nulls(coalesce(row_data.excel_data, '{}'::jsonb)),
    clock_timestamp(),
    nullif(left(btrim(coalesce(p_source_file, '')), 300), ''),
    clock_timestamp()
  from jsonb_to_recordset(p_rows) as row_data(store_id text, excel_data jsonb)
  on conflict (store_id) do update set
    excel_data = public.lamha_store_profiles.excel_data || excluded.excel_data,
    excel_imported_at = excluded.excel_imported_at,
    excel_source_file = excluded.excel_source_file,
    updated_at = clock_timestamp();

  get diagnostics v_count = row_count;
  return jsonb_build_object('merged', v_count);
end;
$function$;

revoke execute on function public.merge_lamha_store_profiles_from_excel(jsonb, text)
  from public, anon;
grant execute on function public.merge_lamha_store_profiles_from_excel(jsonb, text)
  to authenticated, service_role;

create or replace function public.lamha_store_profile(p_store_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_profile public.lamha_store_profiles%rowtype;
begin
  if (select auth.uid()) is null
     or not (
       public.crm_has_permission('merchants.view')
       or public.crm_has_permission('merchants.upload')
       or public.crm_has_permission('sales.view')
     ) then
    raise exception 'not_allowed';
  end if;
  select * into v_profile
  from public.lamha_store_profiles
  where store_id = btrim(p_store_id);
  if not found then return null; end if;

  return jsonb_build_object(
    'storeId', v_profile.store_id,
    'data', jsonb_strip_nulls(v_profile.excel_data) || jsonb_strip_nulls(v_profile.api_data),
    'sources', jsonb_build_object(
      'apiListCheckedAt', v_profile.api_list_checked_at,
      'apiDetailCheckedAt', v_profile.api_detail_checked_at,
      'apiHttpStatus', v_profile.api_http_status,
      'apiLatencyMs', v_profile.api_latency_ms,
      'excelImportedAt', v_profile.excel_imported_at,
      'excelSourceFile', v_profile.excel_source_file
    ),
    'updatedAt', v_profile.updated_at
  );
end;
$function$;

revoke execute on function public.lamha_store_profile(text) from public, anon;
grant execute on function public.lamha_store_profile(text) to authenticated, service_role;

comment on table public.lamha_store_profiles is
  'Read-only Lamha store profile registry. api_data wins over excel_data for non-null fields; Excel fills API gaps.';
comment on column public.lamha_store_profiles.api_data is
  'Sanitized Lamha store object only. Never stores employee tokens or request headers.';
comment on column public.lamha_store_profiles.excel_data is
  'Canonical and raw Excel values retained as fallback when Lamha API omits a field.';

-- Unify the two Lite read models with Lamha's account-switch contract.
-- Only inactive/غير نشط is disabled. idle/stopped remain enabled account
-- states; stopped is retained separately as a lifecycle segment.
create or replace function public.lamha_account_enabled(p_status text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select case
    when nullif(btrim(p_status), '') is null then null
    when replace(lower(p_status), ' ', '') in ('inactive', 'غيرنشط') then false
    else true
  end
$function$;

do $migration$
declare
  v_definition text;
  v_original text;
begin
  v_definition := pg_get_functiondef('public.overview_core_lite(text)'::regprocedure);
  v_original := v_definition;
  v_definition := replace(v_definition,
    'replace(lower(coalesce(platform_status,'''')),'' '','''') in (''غيرنشط'',''inactive'',''موقوف'',''متوقف'')',
    'replace(lower(coalesce(platform_status,'''')),'' '','''') in (''غيرنشط'',''inactive'')');
  v_definition := replace(v_definition,
    'replace(lower(coalesce(m.platform_status,'''')),'' '','''') in (''غيرنشط'',''inactive'',''موقوف'',''متوقف'')',
    'replace(lower(coalesce(m.platform_status,'''')),'' '','''') in (''غيرنشط'',''inactive'')');
  v_definition := replace(v_definition,
    'count(*) filter (where replace(lower(coalesce(platform_status,'''')),'' '','''') in (''نشط'',''active'',''مفعل''))::integer active_count',
    'count(*) filter (where public.lamha_account_enabled(platform_status) = true)::integer active_count');
  v_definition := replace(v_definition,
    'count(*) filter (where replace(lower(coalesce(platform_status,'''')),'' '','''') not in (''نشط'',''active'',''مفعل''))::integer inactive_count',
    'count(*) filter (where public.lamha_account_enabled(platform_status) = false)::integer inactive_count');
  if v_definition = v_original then
    raise exception 'overview_core_lite_status_contract_not_found';
  end if;
  execute v_definition;

  v_definition := pg_get_functiondef('public.overview_merchant_pulse_lite(text)'::regprocedure);
  v_original := v_definition;
  v_definition := replace(v_definition,
    'where replace(lower(coalesce(status, '''')), '' '', '''') not in (''نشط'', ''active'', ''مفعل'')' || chr(10) ||
      '      and coalesce(wallet_balance, 0) > 0.5',
    'where lower(btrim(coalesce(status, ''''))) = ''stopped''' || chr(10) ||
      '      and coalesce(wallet_balance, 0) > 0.5');
  v_definition := replace(v_definition,
    'replace(lower(coalesce(status, '''')), '' '', '''') in (''نشط'', ''active'', ''مفعل'')',
    'public.lamha_account_enabled(status) = true');
  v_definition := replace(v_definition,
    'replace(lower(coalesce(status, '''')), '' '', '''') not in (''نشط'', ''active'', ''مفعل'')',
    'public.lamha_account_enabled(status) = false');
  if v_definition = v_original then
    raise exception 'overview_merchant_pulse_lite_status_contract_not_found';
  end if;
  execute v_definition;
end;
$migration$;

revoke execute on function public.lamha_account_enabled(text) from anon;
grant execute on function public.lamha_account_enabled(text) to authenticated, service_role;
