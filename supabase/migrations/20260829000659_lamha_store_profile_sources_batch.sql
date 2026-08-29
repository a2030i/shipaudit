-- Read-only provenance for operational wallet decisions. Wallet balance is an
-- Excel-only enrichment; this RPC exposes source/freshness without returning
-- the full private Lamha profile or creating N+1 requests in result sets.

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
        'walletSource', case when profile.excel_data ? 'walletBalance' then 'excel' else 'unavailable' end,
        'walletImportedAt', case when profile.excel_data ? 'walletBalance' then profile.excel_imported_at else null end,
        'walletSourceFile', case when profile.excel_data ? 'walletBalance' then profile.excel_source_file else null end,
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
  'Read-only batch provenance for Lamha wallet decisions. It exposes Excel wallet freshness and API list freshness, not profile values.';
