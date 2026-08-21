-- Carrier-scoped, server-paginated audit shipment detail.
-- Modern audits read audit_shipments rows; historical audits page their
-- persisted results JSON. Neither path recalculates audit facts.

create or replace function public.carrier_360_audit_shipments_page(
  p_carrier_id text,
  p_audit_id text,
  p_filter text default 'all',
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := least(100, greatest(1, coalesce(p_page_size, 100)));
  v_period text;
  v_legacy_rows jsonb;
  v_stored_count integer := 0;
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_source text := 'audit_shipments';
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('audits.view') then raise exception 'not_allowed'; end if;

  select a.period, a.results
    into v_period, v_legacy_rows
  from public.audits a
  where a.id = p_audit_id and a.carrier_id = p_carrier_id;

  if not found then raise exception 'audit_not_found_or_forbidden'; end if;

  select count(*)::integer into v_stored_count
  from public.audit_shipments s
  where s.audit_id = p_audit_id;

  if v_stored_count > 0 then
    select count(*)::integer into v_total
    from public.audit_shipments s
    where s.audit_id = p_audit_id
      and (coalesce(p_filter, 'all') = 'all' or (p_filter = 'issues' and s.status <> 'ok'));

    select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
      into v_rows
    from (
      select s.*
      from public.audit_shipments s
      where s.audit_id = p_audit_id
        and (coalesce(p_filter, 'all') = 'all' or (p_filter = 'issues' and s.status <> 'ok'))
      order by s.id
      offset ((v_page - 1) * v_size)
      limit v_size
    ) r;
  else
    v_source := 'audits.results';

    with legacy as (
      select e.value as row_value, e.ordinality
      from jsonb_array_elements(
        case when jsonb_typeof(v_legacy_rows) = 'array' then v_legacy_rows else '[]'::jsonb end
      ) with ordinality e(value, ordinality)
      where coalesce(p_filter, 'all') = 'all'
        or (p_filter = 'issues' and coalesce(e.value->>'status', 'ok') <> 'ok')
    )
    select count(*)::integer into v_total from legacy;

    with legacy as (
      select e.value as row_value, e.ordinality
      from jsonb_array_elements(
        case when jsonb_typeof(v_legacy_rows) = 'array' then v_legacy_rows else '[]'::jsonb end
      ) with ordinality e(value, ordinality)
      where coalesce(p_filter, 'all') = 'all'
        or (p_filter = 'issues' and coalesce(e.value->>'status', 'ok') <> 'ok')
      order by e.ordinality
      offset ((v_page - 1) * v_size)
      limit v_size
    )
    select coalesce(jsonb_agg(row_value order by ordinality), '[]'::jsonb)
      into v_rows from legacy;
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'rowSource', v_source,
    'auditId', p_audit_id,
    'carrierId', p_carrier_id,
    'period', v_period,
    'page', v_page,
    'pageSize', v_size,
    'totalRows', v_total,
    'totalPages', greatest(1, ceil(v_total::numeric / v_size)::integer),
    'filter', coalesce(p_filter, 'all'),
    'readPath', 'carrier_360_audit_shipments_page'
  );
end;
$function$;

comment on function public.carrier_360_audit_shipments_page(text,text,text,integer,integer) is
  'Pages persisted Carrier audit shipment details across modern row storage and historical JSON storage without recalculation.';

revoke all on function public.carrier_360_audit_shipments_page(text,text,text,integer,integer) from public, anon;
grant execute on function public.carrier_360_audit_shipments_page(text,text,text,integer,integer) to authenticated, service_role;
