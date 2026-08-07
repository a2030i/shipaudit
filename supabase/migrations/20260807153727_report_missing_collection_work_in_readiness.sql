-- Read-only coverage check for the collection queue. It answers a different
-- question from collection_tasks itself: which customers should have work,
-- which already have an open task, and which are explicitly assigned.
create or replace function public.collection_work_readiness_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
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

  with latest_snapshot as (
    select m.snapshot_id
    from public.merchants m
    order by m.uploaded_at desc
    limit 1
  ), merchant_context as (
    select
      link.customer_name,
      bool_or(coalesce(merchant.billing_type, '') = 'دفع مسبق') as prepaid
    from public.customer_merchant_links link
    join public.merchants merchant
      on merchant.store_id = link.store_id
     and merchant.snapshot_id = (select snapshot_id from latest_snapshot)
    group by link.customer_name
  ), debtors as (
    select
      ar.contact_name as customer_name,
      ar.collectible_due as debt,
      greatest(coalesce(age.days_outstanding, 0), 0) as days_outstanding,
      coalesce(context.prepaid, false) as prepaid
    from public.customer_ar ar
    left join merchant_context context on context.customer_name = ar.contact_name
    left join lateral (
      select max(line.age_days) as days_outstanding
      from public.customer_collectible_lines line
      where line.contact_name = ar.contact_name
        and line.collectible_amount > 0.005
    ) age on true
    where ar.collectible_due > 0.5
  ), candidates as (
    select debtor.*
    from debtors debtor
    where debtor.prepaid
       or debtor.debt > 10000
       or debtor.days_outstanding > 30
  ), open_tasks as (
    select
      task.customer_name,
      bool_or(task.assigned_to is not null) as has_assignee
    from public.collection_tasks task
    where task.stage in ('todo', 'contacted', 'promised', 'snoozed')
      and task.done_at is null
    group by task.customer_name
  ), totals as (
    select
      (select count(*) from debtors)::int as debtors,
      coalesce((select sum(debt) from debtors), 0)::numeric as total_debt,
      (select count(*) from candidates)::int as candidates,
      coalesce((select sum(debt) from candidates), 0)::numeric as candidate_debt,
      (select count(*) from candidates candidate
        where exists (
          select 1 from open_tasks task
          where task.customer_name = candidate.customer_name
        ))::int as covered,
      (select count(*) from candidates candidate
        where not exists (
          select 1 from open_tasks task
          where task.customer_name = candidate.customer_name
        ))::int as missing_tasks,
      coalesce((select sum(candidate.debt) from candidates candidate
        where not exists (
          select 1 from open_tasks task
          where task.customer_name = candidate.customer_name
        )), 0)::numeric as missing_task_debt,
      (select count(*) from candidates candidate
        join open_tasks task on task.customer_name = candidate.customer_name
        where task.has_assignee)::int as assigned,
      (select count(*) from candidates candidate
        join open_tasks task on task.customer_name = candidate.customer_name
        where not task.has_assignee)::int as unassigned,
      coalesce((select sum(candidate.debt) from candidates candidate
        join open_tasks task on task.customer_name = candidate.customer_name
        where not task.has_assignee), 0)::numeric as unassigned_debt
  )
  select jsonb_build_object(
    'checked_at', now(),
    'debtors', totals.debtors,
    'total_debt', round(totals.total_debt, 2),
    'collection_candidates', totals.candidates,
    'candidate_debt', round(totals.candidate_debt, 2),
    'covered_collection_tasks', totals.covered,
    'missing_collection_tasks', totals.missing_tasks,
    'missing_collection_debt', round(totals.missing_task_debt, 2),
    'assigned_collection_customers', totals.assigned,
    'unassigned_collection_customers', totals.unassigned,
    'unassigned_collection_debt', round(totals.unassigned_debt, 2)
  )
  into v_result
  from totals;

  return v_result;
end;
$function$;

comment on function public.collection_work_readiness_snapshot() is
  'Read-only coverage of collectible customers by open and explicitly assigned collection tasks.';

revoke all on function public.collection_work_readiness_snapshot() from public, anon;
grant execute on function public.collection_work_readiness_snapshot() to authenticated, service_role;
