-- Lamha's authenticated /stores/export workbook is now the automatic source
-- for wallet/profile enrichment. Historical manual Excel remains readable as
-- a continuity fallback only until the first successful export-backed sync.

create or replace function public.lamha_store_profile_sources(p_store_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_store_ids text[];
begin
  if (select auth.uid()) is null
     or not (
       public.crm_has_permission('receivables.view')
       or public.crm_has_permission('merchants.view')
       or public.crm_has_permission('sales.view')
     ) then
    raise exception 'not_allowed';
  end if;

  select coalesce(array_agg(distinct btrim(value)), '{}'::text[])
  into v_store_ids
  from unnest(coalesce(p_store_ids, '{}'::text[])) value
  where nullif(btrim(value), '') is not null;

  if cardinality(v_store_ids) > 100 then
    raise exception 'too_many_store_ids';
  end if;

  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'storeId', profile.store_id,
        'walletSource', case
          when profile.api_data ? 'walletBalance' then 'lamha_export'
          when profile.excel_data ? 'walletBalance' then 'excel_legacy'
          else 'unavailable'
        end,
        'walletImportedAt', case
          when profile.api_data ? 'walletBalance' then profile.api_list_checked_at
          when profile.excel_data ? 'walletBalance' then profile.excel_imported_at
          else null
        end,
        'walletSourceFile', case
          when profile.api_data ? 'walletBalance' then '/api/v1/stores/export'
          when profile.excel_data ? 'walletBalance' then profile.excel_source_file
          else null
        end,
        'apiListCheckedAt', profile.api_list_checked_at
      ) order by profile.store_id)
      from public.lamha_store_profiles profile
      where profile.store_id = any(v_store_ids)
    ), '[]'::jsonb),
    'generatedAt', clock_timestamp()
  );
end;
$function$;

revoke all on function public.lamha_store_profile_sources(text[]) from public, anon;
grant execute on function public.lamha_store_profile_sources(text[]) to authenticated, service_role;

comment on function public.lamha_store_profile_sources(text[]) is
  'Read-only wallet provenance. Lamha authenticated export is primary; historical manually uploaded Excel is continuity fallback only.';

comment on column public.lamha_store_profiles.api_data is
  'Sanitized Lamha list, authenticated export and detail data. Never stores employee tokens or request headers.';

comment on column public.lamha_store_profiles.excel_data is
  'Historical manual stores.xlsx enrichment retained for audit/fallback; no longer required after a successful Lamha export sync.';
