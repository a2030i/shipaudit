-- Paginated detail adapter for Carrier 360 invoice reviews.
-- Uses persisted audit scalar results; it does not re-run the audit engine.

create or replace function public.carrier_360_audits_page(
  p_carrier_id text,
  p_filter text default 'all',
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_page integer := greatest(1,coalesce(p_page,1));
  v_size integer := least(100,greatest(1,coalesce(p_page_size,20)));
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('audits.view') then raise exception 'not_allowed'; end if;
  if not exists(select 1 from public.carriers where id=p_carrier_id) then
    raise exception 'carrier_not_found_or_forbidden';
  end if;

  with facts as (
    select a.*,
      case when coalesce((a.col_map->'__control'->>'version')::numeric,0) >= 3
        and coalesce((a.col_map->'__control'->>'valid')::boolean,false)
        and nullif(a.col_map->'__control'->>'sourceHash','') is not null
        and nullif(a.col_map->'__control'->>'sourcePath','') is not null
        and nullif(a.file_name,'') is not null and nullif(a.contract_label,'') is not null
        then coalesce(a.review_status,'pending') else 'legacy_unverified' end effective_status
    from public.audits a where a.carrier_id=p_carrier_id
  ), filtered as (
    select * from facts where coalesce(p_filter,'all')='all'
      or (p_filter='needs_action' and effective_status not in ('approved','rejected'))
      or effective_status=p_filter
  )
  select count(*) into v_total from filtered;

  with facts as (
    select a.*,
      case when coalesce((a.col_map->'__control'->>'version')::numeric,0) >= 3
        and coalesce((a.col_map->'__control'->>'valid')::boolean,false)
        and nullif(a.col_map->'__control'->>'sourceHash','') is not null
        and nullif(a.col_map->'__control'->>'sourcePath','') is not null
        and nullif(a.file_name,'') is not null and nullif(a.contract_label,'') is not null
        then coalesce(a.review_status,'pending') else 'legacy_unverified' end effective_status
    from public.audits a where a.carrier_id=p_carrier_id
  ), filtered as (
    select * from facts where coalesce(p_filter,'all')='all'
      or (p_filter='needs_action' and effective_status not in ('approved','rejected'))
      or effective_status=p_filter
  ), page_rows as (
    select id,file_name,contract_label,period,row_count,issue_count,total_expected,total_billed,
      total_tax,diff,mismatch_count,drift_pre_tax,drift_tax,audit_type,review_status,approved_at,
      rejected_at,rejected_reason,created_at,col_map,effective_status
    from filtered order by created_at desc,id desc
    offset ((v_page-1)*v_size) limit v_size
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb)
    into v_rows from page_rows r;

  return jsonb_build_object(
    'rows',v_rows,'page',v_page,'pageSize',v_size,'totalRows',v_total,
    'totalPages',greatest(1,ceil(v_total::numeric/v_size)::integer),
    'filter',coalesce(p_filter,'all'),'readPath','carrier_360_audits_page'
  );
end;
$function$;

comment on function public.carrier_360_audits_page(text,text,integer,integer) is
  'Server-paginated Carrier 360 review list using persisted audit results and effective review status.';

revoke all on function public.carrier_360_audits_page(text,text,integer,integer) from public, anon;
grant execute on function public.carrier_360_audits_page(text,text,integer,integer) to authenticated, service_role;
