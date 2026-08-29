-- Lamha API is authoritative. Excel is a narrow enrichment source for fields
-- the API does not currently expose, and never replaces identity/account data.

create or replace function public.lamha_excel_enrichment(p_excel jsonb)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select
    (case when coalesce(p_excel, '{}'::jsonb) ? '_excel'
      then jsonb_build_object('_excel', coalesce(p_excel -> '_excel', '{}'::jsonb))
      else '{}'::jsonb end)
    || (case when coalesce(p_excel, '{}'::jsonb) ? 'profileStatus'
      then jsonb_build_object('profileStatus', p_excel -> 'profileStatus') else '{}'::jsonb end)
    || (case when coalesce(p_excel, '{}'::jsonb) ? 'vatRegistered'
      then jsonb_build_object('vatRegistered', p_excel -> 'vatRegistered') else '{}'::jsonb end)
    || (case when coalesce(p_excel, '{}'::jsonb) ? 'zatcaCompleted'
      then jsonb_build_object('zatcaCompleted', p_excel -> 'zatcaCompleted') else '{}'::jsonb end)
    || (case when coalesce(p_excel, '{}'::jsonb) ? 'lastTopupAt'
      then jsonb_build_object('lastTopupAt', p_excel -> 'lastTopupAt') else '{}'::jsonb end)
    || (case when coalesce(p_excel, '{}'::jsonb) ? 'walletBalance'
      then jsonb_build_object('walletBalance', p_excel -> 'walletBalance') else '{}'::jsonb end)
$function$;

revoke all on function public.lamha_excel_enrichment(jsonb) from public, anon;
grant execute on function public.lamha_excel_enrichment(jsonb) to authenticated, service_role;

update public.lamha_store_profiles
set excel_data = public.lamha_excel_enrichment(excel_data),
    updated_at = clock_timestamp()
where excel_data <> public.lamha_excel_enrichment(excel_data);

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
    public.lamha_excel_enrichment(coalesce(row_data.excel_data, '{}'::jsonb)),
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
  return jsonb_build_object('merged', v_count, 'source', 'excel_enrichment_only');
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
  v_api jsonb;
  v_excel jsonb;
  v_effective jsonb;
  v_verified text;
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

  v_api := jsonb_strip_nulls(v_profile.api_data);
  v_excel := jsonb_strip_nulls(v_profile.excel_data - '_excel');
  v_effective := v_excel || v_api;
  v_verified := lower(coalesce(v_api ->> 'verified', ''));
  if v_verified in ('true', 'false') then
    v_effective := v_effective || jsonb_build_object(
      'verificationStatus',
      case when v_verified = 'true' then 'موثق' else 'غير موثق' end
    );
  end if;

  return jsonb_build_object(
    'storeId', v_profile.store_id,
    'data', v_effective,
    'rawExcel', coalesce(v_profile.excel_data -> '_excel', '{}'::jsonb),
    'fieldSources', jsonb_build_object(
      'api', coalesce((
        select jsonb_agg(key order by key)
        from jsonb_object_keys(v_api) key
      ), '[]'::jsonb),
      'excelEnrichment', coalesce((
        select jsonb_agg(key order by key)
        from jsonb_object_keys(v_excel) key
      ), '[]'::jsonb)
    ),
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

comment on column public.lamha_store_profiles.excel_data is
  'Excel-only enrichment: profile completion, VAT, ZATCA, last top-up and wallet balance. Shared Lamha fields remain only in raw _excel for audit and never override API.';
comment on function public.lamha_store_profile(text) is
  'Effective Lamha profile. API is authoritative; Excel contributes only fields unavailable from API and includes explicit field provenance.';

do $block$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname = 'lamha-profile-details-catchup-readonly'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end
$block$;

select cron.schedule(
  'lamha-profile-details-catchup-readonly',
  '7,22,37,52 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/lamha-financial-guard',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'lamha_financial_guard_cron_secret')
      ),
      body := '{"action":"sync-profile-details"}'::jsonb,
      timeout_milliseconds := 180000
    );
  $job$
);
