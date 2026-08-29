-- Read-only actionable suspension summary for the executive command center.
-- The latest documented Lamha financial action overrides a stale merchant snapshot.
-- Amount qualification remains strict: operational overdue must be greater than p_min_overdue.

create or replace function public.overview_actionable_suspension_lite(
  p_min_overdue numeric default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '3000ms'
as $function$
declare
  v_summary jsonb;
begin
  if auth.uid() is null or not public.crm_has_permission('overview.view') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_min_overdue is null or p_min_overdue < 0 then
    raise exception 'invalid_min_overdue';
  end if;

  with
  latest_merch as materialized (
    select snapshot_id
    from public.merchants
    order by uploaded_at desc
    limit 1
  ),
  merch as materialized (
    select m.store_id, m.store_name,
      public.normalize_arabic_name(m.store_name) norm,
      m.billing_type, m.status platform_status
    from public.merchants m
    where m.snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as materialized (
    select customer_name, store_id
    from public.customer_merchant_links
    where store_id is not null
  ),
  lines as materialized (
    select l.contact_name,
      count(*) filter (
        where l.line_kind = 'invoice' and l.collectible_amount > 0.5
      )::integer inv_cnt,
      coalesce(sum(l.collectible_amount) filter (where l.age_days between 31 and 60), 0) b31_60,
      coalesce(sum(l.collectible_amount) filter (where l.age_days between 61 and 90), 0) b61_90,
      coalesce(sum(l.collectible_amount) filter (where l.age_days > 90), 0) b90p
    from public.customer_collectible_lines l
    where l.collectible_amount > 0.005
    group by l.contact_name
  ),
  cust as materialized (
    select a.contact_name,
      coalesce(l.inv_cnt, 0) inv_cnt,
      coalesce(l.b31_60, 0) b31_60,
      coalesce(l.b61_90, 0) b61_90,
      coalesce(l.b90p, 0) b90p
    from public.customer_ar a
    left join lines l on l.contact_name = a.contact_name
    where a.collectible_due > 0.5
  ),
  cust_full as materialized (
    select distinct on (c.contact_name)
      c.*, m.store_id, m.billing_type, m.platform_status
    from cust c
    left join links l on l.customer_name = c.contact_name
    left join merch m on m.store_id = l.store_id
      or (l.store_id is null and m.norm = public.normalize_arabic_name(c.contact_name))
    order by c.contact_name, (l.store_id is not null) desc
  ),
  latest_lamha_action as materialized (
    select distinct on ((ual.detail->>'store_id')::bigint)
      (ual.detail->>'store_id')::bigint store_id,
      coalesce(
        nullif(ual.detail->>'automation_action', ''),
        case when ual.action like '%تشغيل%' then 'activate' else 'deactivate' end
      ) action_kind,
      (
        ual.detail->>'automation_key' = 'lamha_financial_guard'
        or ual.detail->>'context' = 'financial_policy'
      ) is_financial
    from public.user_activity_log ual
    where ual.kind = 'action'
      and ual.action ilike '%حساب متجر%لمحة%'
      and coalesce(ual.detail->>'store_id', '') ~ '^[0-9]+$'
    order by (ual.detail->>'store_id')::bigint, ual.created_at desc, ual.id desc
  ),
  financial_holds as materialized (
    select store_id
    from latest_lamha_action
    where is_financial and action_kind = 'deactivate'
  ),
  candidates as materialized (
    select (c.b31_60 + c.b61_90 + c.b90p)::numeric overdue30
    from cust_full c
    where replace(lower(coalesce(c.billing_type, '')), ' ', '') in ('دفعلاحق', 'postpaid')
      and replace(lower(coalesce(c.platform_status, '')), ' ', '') in ('نشط', 'active', 'مفعل')
      and c.b31_60 + c.b61_90 + c.b90p > p_min_overdue
      and c.inv_cnt > 0
      and c.store_id is not null
      and not exists (
        select 1
        from financial_holds h
        where h.store_id::text = c.store_id::text
      )
  )
  select jsonb_build_object(
    'count', count(*)::integer,
    'amount', round(coalesce(sum(overdue30), 0)::numeric, 2),
    'minOverdueExclusive', p_min_overdue,
    'generatedAt', clock_timestamp()
  )
  into v_summary
  from candidates;

  return v_summary;
end;
$function$;

revoke all on function public.overview_actionable_suspension_lite(numeric) from public, anon;
grant execute on function public.overview_actionable_suspension_lite(numeric) to authenticated, service_role;

comment on function public.overview_actionable_suspension_lite(numeric) is
  'Read-only operational suspension summary. Uses strict overdue threshold and excludes the latest documented Lamha financial holds.';
