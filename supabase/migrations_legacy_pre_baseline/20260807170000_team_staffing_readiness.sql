-- Read-only permission coverage for the accounting, finance, sales and
-- collections cutover. Admin is intentionally excluded: the question is
-- whether the operating team can work without relying on the system owner.

create or replace function public.team_staffing_readiness_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_accounting jsonb;
  v_finance jsonb;
  v_sales jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not (
    public.crm_has_permission('overview.view')
    or public.crm_has_permission('system.manage_employees')
  ) then
    raise exception 'not_allowed';
  end if;

  with staff as (
    select id, name, email, coalesce(permissions, '{}'::jsonb) as permissions
    from public.profiles
    where role <> 'admin'
  ), coverage as (
    select
      count(*) filter (where permissions @> '{
        "audits.view": true,
        "audits.create": true,
        "audits.approve": true,
        "internal_exports.view": true,
        "internal_exports.pull": true,
        "uploads.view": true,
        "uploads.upload_file": true,
        "cod.view": true
      }'::jsonb)::int as cycle_operators,
      count(*) filter (where permissions @> '{"system.period_close": true}'::jsonb)::int as cycle_closers
    from staff
  )
  select jsonb_build_object(
    'status', case
      when cycle_operators = 0 then 'blocked'
      when cycle_closers = 0 then 'pilot'
      else 'ready'
    end,
    'cycle_operators', cycle_operators,
    'cycle_closers', cycle_closers
  )
  into v_accounting
  from coverage;

  with staff as (
    select id, name, email, coalesce(permissions, '{}'::jsonb) as permissions
    from public.profiles
    where role <> 'admin'
  ), coverage as (
    select
      count(*) filter (where permissions @> '{
        "zoho.view": true,
        "bank.view": true,
        "reconciliation.view": true,
        "money.pnl": true,
        "reports.view_financial": true
      }'::jsonb)::int as finance_viewers,
      count(*) filter (where permissions @> '{
        "zoho.view": true,
        "bank.view": true,
        "bank.upload_statement": true,
        "bank.reconcile": true,
        "reconciliation.view": true,
        "reconciliation.link": true
      }'::jsonb)::int as finance_operators,
      count(*) filter (where permissions @> '{"reports.view_financial": true}'::jsonb)::int as financial_report_viewers
    from staff
  )
  select jsonb_build_object(
    'status', case
      when finance_viewers = 0 or finance_operators = 0 then 'blocked'
      when financial_report_viewers = 0 then 'pilot'
      else 'ready'
    end,
    'finance_viewers', finance_viewers,
    'finance_operators', finance_operators,
    'financial_report_viewers', financial_report_viewers
  )
  into v_finance
  from coverage;

  with staff as (
    select id, name, email, coalesce(permissions, '{}'::jsonb) as permissions
    from public.profiles
    where role <> 'admin'
  ), coverage as (
    select
      count(*) filter (where permissions @> '{"sales.view": true, "sales.manage": true}'::jsonb)::int as sales_operators,
      count(*) filter (where permissions @> '{"collections.view": true, "collections.update_stage": true}'::jsonb)::int as collection_operators,
      count(*) filter (where permissions @> '{"collections.view_all": true, "collections.assign": true}'::jsonb)::int as collection_supervisors
    from staff
  )
  select jsonb_build_object(
    'status', case
      when sales_operators = 0 or collection_operators = 0 then 'blocked'
      when collection_supervisors = 0 then 'pilot'
      else 'ready'
    end,
    'sales_operators', sales_operators,
    'collection_operators', collection_operators,
    'collection_supervisors', collection_supervisors
  )
  into v_sales
  from coverage;

  return jsonb_build_object(
    'checked_at', now(),
    'accounting', v_accounting,
    'finance', v_finance,
    'sales', v_sales
  );
end;
$$;

comment on function public.team_staffing_readiness_snapshot() is
  'Read-only permission coverage for team cutover; excludes admin accounts.';

revoke all on function public.team_staffing_readiness_snapshot() from public, anon;
grant execute on function public.team_staffing_readiness_snapshot() to authenticated, service_role;
