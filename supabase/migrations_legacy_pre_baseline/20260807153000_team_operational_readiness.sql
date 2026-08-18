-- Live, read-only readiness snapshot for moving accounting, finance and sales
-- into ShipAudit. This function never mutates balances, assignments or cycles.

create or replace function public.team_operational_readiness_snapshot()
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

  with active_carriers as (
    select
      c.id,
      c.name,
      nullif(c.file_signature ->> 'file_kind', '') as file_kind
    from public.carriers c
    where jsonb_typeof(c.contracts) = 'array'
      and exists (
        select 1
        from jsonb_array_elements(c.contracts) contract
        where
          case
            when coalesce(contract ->> 'startDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
              then (contract ->> 'startDate')::date <= current_date
            else true
          end
          and case
            when coalesce(contract ->> 'endDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
              then (contract ->> 'endDate')::date >= date_trunc('month', current_date)::date
            else true
          end
      )
  ), requirements as (
    select carrier.id, carrier.name, carrier.file_kind, required.task_kind
    from active_carriers carrier
    cross join lateral unnest(
      case carrier.file_kind
        when 'audit_with_cod' then array['invoice']::text[]
        when 'audit_only' then array['invoice']::text[]
        when 'audit_and_cod_separate' then array['invoice', 'cod_remittance']::text[]
        when 'cod_only' then array['cod_remittance']::text[]
        else array['classification']::text[]
      end
    ) required(task_kind)
  ), missing as (
    select requirement.*
    from requirements requirement
    where requirement.task_kind = 'classification'
       or not exists (
         select 1
         from public.carrier_task_schedules schedule
         where schedule.carrier_id = requirement.id
           and schedule.task_kind = requirement.task_kind
           and schedule.active
           and schedule.schedule_basis in ('weekday', 'month_days')
           and cardinality(schedule.due_days) > 0
           and (
             (schedule.schedule_basis = 'weekday'
               and schedule.due_days <@ array[0,1,2,3,4,5,6]::smallint[])
             or (schedule.schedule_basis = 'month_days'
               and schedule.due_days <@ array(select generate_series(1,31)::smallint))
           )
       )
  ), missing_by_carrier as (
    select
      id,
      max(name) as name,
      jsonb_agg(task_kind order by task_kind) as missing_kinds
    from missing
    group by id
  ), counts as (
    select
      (select count(*) from active_carriers)::int as contracted_carriers,
      (select count(*) from missing)::int as missing_schedules,
      (select count(*) from missing_by_carrier)::int as missing_carriers,
      (select count(*) from public.accounting_cycles where status = 'closed')::int as closed_cycles,
      (select count(*) from public.accounting_cycle_events
        where period = date_trunc('month', current_date)::date)::int as current_month_events
  )
  select jsonb_build_object(
    'status', case
      when counts.missing_schedules > 0 then 'blocked'
      when counts.closed_cycles = 0 then 'pilot'
      else 'ready'
    end,
    'contracted_carriers', counts.contracted_carriers,
    'missing_schedules', counts.missing_schedules,
    'missing_carriers', counts.missing_carriers,
    'closed_cycles', counts.closed_cycles,
    'current_month_events', counts.current_month_events,
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'carrier_id', row.id,
        'carrier_name', row.name,
        'kinds', row.missing_kinds
      ) order by row.name)
      from missing_by_carrier row
    ), '[]'::jsonb)
  )
  into v_accounting
  from counts;

  with linked as (
    select distinct link.zoho_account_id, link.internal_bank_name
    from public.zoho_financial_account_links link
    where link.source_type = 'bank_account'
      and link.link_kind = 'bank'
  ), latest_statements as (
    select distinct on (summary.bank)
      summary.bank,
      summary.closing_balance,
      summary.period_to
    from public.bank_statement_summaries summary
    order by summary.bank, summary.period_to desc, summary.created_at desc
  ), finance_counts as (
    select
      (select count(*) from public.customer_balance_integrity_issues)::int as integrity_issues,
      (select count(*) from linked)::int as linked_bank_accounts,
      coalesce((
        select sum(coalesce(account.uncategorized_count, 0))
        from linked link
        join public.zoho_bank_accounts account on account.zoho_id = link.zoho_account_id
      ), 0)::int as uncategorized_operations,
      coalesce((select sum(statement.closing_balance) from latest_statements statement), 0)::numeric as statement_balance,
      coalesce((
        select sum(account.book_balance)
        from linked link
        join public.zoho_bank_accounts account on account.zoho_id = link.zoho_account_id
      ), 0)::numeric as book_balance,
      (select max(statement.period_to) from latest_statements statement) as statement_as_of
  )
  select jsonb_build_object(
    'status', case
      when counts.integrity_issues > 0 then 'blocked'
      when counts.uncategorized_operations > 0 or counts.linked_bank_accounts < 2 then 'pilot'
      else 'ready'
    end,
    'customer_integrity_issues', counts.integrity_issues,
    'linked_bank_accounts', counts.linked_bank_accounts,
    'uncategorized_bank_operations', counts.uncategorized_operations,
    'statement_balance', round(counts.statement_balance, 2),
    'book_balance', round(counts.book_balance, 2),
    'statement_vs_book_difference', round(counts.statement_balance - counts.book_balance, 2),
    'statement_as_of', counts.statement_as_of
  )
  into v_finance
  from finance_counts counts;

  with sales_counts as (
    select
      (select count(*) from public.collection_tasks
        where stage = 'todo' and done_at is null and assigned_to is null)::int as unassigned_collections,
      coalesce((select sum(debt_at_creation) from public.collection_tasks
        where stage = 'todo' and done_at is null and assigned_to is null), 0)::numeric as unassigned_collection_debt,
      (select count(*) from public.retargeting_followups
        where status = 'needs_followup' and owner_id is null)::int as unassigned_followups,
      (select count(*) from public.crm_tasks
        where status not in ('done', 'completed', 'cancelled') and assigned_to is null)::int as unassigned_crm_tasks,
      (select count(*) from public.profiles
        where accepts_campaign_leads
          and nullif(btrim(lead_notification_phone), '') is not null)::int as campaign_recipients,
      (select count(*) from public.crm_leads
        where coalesce(lead_kind, 'cold') <> 'cold'
          and status not in ('won', 'lost', 'converted')
          and owner_id is null)::int as unassigned_inbound_leads
  )
  select jsonb_build_object(
    'status', case
      when counts.unassigned_collections > 0
        or counts.unassigned_followups > 0
        or counts.unassigned_crm_tasks > 0
        or counts.unassigned_inbound_leads > 0
        or counts.campaign_recipients = 0 then 'pilot'
      else 'ready'
    end,
    'unassigned_collections', counts.unassigned_collections,
    'unassigned_collection_debt', round(counts.unassigned_collection_debt, 2),
    'unassigned_followups', counts.unassigned_followups,
    'unassigned_crm_tasks', counts.unassigned_crm_tasks,
    'campaign_recipients', counts.campaign_recipients,
    'unassigned_inbound_leads', counts.unassigned_inbound_leads
  )
  into v_sales
  from sales_counts counts;

  return jsonb_build_object(
    'checked_at', now(),
    'accounting', v_accounting,
    'finance', v_finance,
    'sales', v_sales
  );
end;
$$;

comment on function public.team_operational_readiness_snapshot() is
  'Read-only management snapshot for accounting, finance and sales operational readiness.';

revoke all on function public.team_operational_readiness_snapshot() from public, anon;
grant execute on function public.team_operational_readiness_snapshot() to authenticated, service_role;
