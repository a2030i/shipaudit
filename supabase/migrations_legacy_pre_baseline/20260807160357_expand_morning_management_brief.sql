-- Read-only, service-role snapshot for the scheduled morning brief.  The
-- function is intentionally not exposed to browser roles: the Edge Function
-- authenticates the requesting manager, then reads this one stable snapshot.
create or replace function public.morning_brief_management_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer jsonb;
  v_finance jsonb;
  v_collections jsonb;
  v_operations jsonb;
  v_sales jsonb;
  v_system jsonb;
begin
  select public.customer_money_dashboard()::jsonb into v_customer;

  with linked as materialized (
    select distinct link.zoho_account_id, link.internal_bank_name
    from public.zoho_financial_account_links link
    where link.source_type = 'bank_account'
      and link.link_kind = 'bank'
  ), latest_statements as materialized (
    select distinct on (summary.bank)
      summary.bank,
      summary.closing_balance,
      summary.period_to
    from public.bank_statement_summaries summary
    join linked on linked.internal_bank_name = summary.bank
    order by summary.bank, summary.period_to desc, summary.created_at desc
  ), bank_totals as materialized (
    select
      count(*)::int as linked_count,
      coalesce(sum(account.book_balance), 0)::numeric as book_balance,
      coalesce(sum(account.uncategorized_count), 0)::int as uncategorized_operations,
      max(account.synced_at) as bank_synced_at
    from linked
    join public.zoho_bank_accounts account
      on account.zoho_id = linked.zoho_account_id
  ), statement_totals as materialized (
    select
      count(*)::int as statement_count,
      coalesce(sum(closing_balance), 0)::numeric as statement_balance,
      max(period_to) as statement_as_of
    from latest_statements
  ), vendor_totals as materialized (
    select
      count(*) filter (where outstanding_payable > 0.5)::int as payable_vendors,
      coalesce(sum(outstanding_payable), 0)::numeric as outstanding_payable,
      coalesce(sum(unused_credits_payable), 0)::numeric as vendor_credits
    from public.zoho_contacts
    where contact_type = 'vendor'
  ), bill_totals as materialized (
    select
      count(*) filter (where balance > 0.5)::int as open_count,
      coalesce(sum(balance) filter (where balance > 0.5), 0)::numeric as open_balance,
      count(*) filter (where balance > 0.5 and due_date < current_date)::int as overdue_count,
      coalesce(sum(balance) filter (where balance > 0.5 and due_date < current_date), 0)::numeric as overdue_balance
    from public.zoho_bills
  )
  select jsonb_build_object(
    'linked_bank_accounts', bank.linked_count,
    'statement_count', statement.statement_count,
    'statement_balance', round(statement.statement_balance, 2),
    'book_balance', round(bank.book_balance, 2),
    'statement_vs_book_difference', round(statement.statement_balance - bank.book_balance, 2),
    'uncategorized_bank_operations', bank.uncategorized_operations,
    'statement_as_of', statement.statement_as_of,
    'bank_synced_at', bank.bank_synced_at,
    'payable_vendors', vendor.payable_vendors,
    'vendor_outstanding', round(vendor.outstanding_payable, 2),
    'vendor_credits', round(vendor.vendor_credits, 2),
    'vendor_net_payable', round(vendor.outstanding_payable - vendor.vendor_credits, 2),
    'open_bills', bills.open_count,
    'open_bills_balance', round(bills.open_balance, 2),
    'overdue_bills', bills.overdue_count,
    'overdue_bills_balance', round(bills.overdue_balance, 2)
  ) into v_finance
  from bank_totals bank
  cross join statement_totals statement
  cross join vendor_totals vendor
  cross join bill_totals bills;

  with latest_snapshot as materialized (
    select snapshot_id from public.merchants order by uploaded_at desc limit 1
  ), merchant_context as materialized (
    select
      link.customer_name,
      bool_or(coalesce(merchant.billing_type, '') = 'دفع مسبق') as prepaid
    from public.customer_merchant_links link
    join public.merchants merchant
      on merchant.store_id = link.store_id
     and merchant.snapshot_id = (select snapshot_id from latest_snapshot)
    group by link.customer_name
  ), debtors as materialized (
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
  ), candidates as materialized (
    select * from debtors
    where prepaid or debt > 10000 or days_outstanding > 30
  ), open_tasks as materialized (
    select
      task.customer_name,
      bool_or(task.assigned_to is not null) as has_assignee
    from public.collection_tasks task
    where task.stage in ('todo', 'contacted', 'promised', 'snoozed')
      and task.done_at is null
    group by task.customer_name
  )
  select jsonb_build_object(
    'open_tasks', (select count(*) from open_tasks),
    'assigned_customers', (select count(*) from open_tasks where has_assignee),
    'unassigned_customers', (select count(*) from open_tasks where not has_assignee),
    'candidates', (select count(*) from candidates),
    'candidate_debt', round(coalesce((select sum(debt) from candidates), 0), 2),
    'missing_tasks', (select count(*) from candidates candidate where not exists (
      select 1 from open_tasks task where task.customer_name = candidate.customer_name
    )),
    'missing_task_debt', round(coalesce((select sum(candidate.debt) from candidates candidate where not exists (
      select 1 from open_tasks task where task.customer_name = candidate.customer_name
    )), 0), 2),
    'promises_due_today', (select count(*) from public.collection_tasks
      where stage = 'promised' and done_at is null and promise_date = current_date),
    'broken_promises', (select count(*) from public.collection_tasks
      where stage = 'promised' and done_at is null and promise_date < current_date)
  ) into v_collections;

  with active_carriers as materialized (
    select c.id, c.name, nullif(c.file_signature ->> 'file_kind', '') as file_kind
    from public.carriers c
    where jsonb_typeof(c.contracts) = 'array'
      and exists (
        select 1 from jsonb_array_elements(c.contracts) contract
        where case
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
  ), requirements as materialized (
    select carrier.id, carrier.name, required.task_kind
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
  ), missing as materialized (
    select requirement.*
    from requirements requirement
    where requirement.task_kind = 'classification'
       or not exists (
        select 1 from public.carrier_task_schedules schedule
        where schedule.carrier_id = requirement.id
          and schedule.task_kind = requirement.task_kind
          and schedule.active
          and schedule.schedule_basis in ('weekday', 'month_days')
          and cardinality(schedule.due_days) > 0
          and (
            (schedule.schedule_basis = 'weekday' and schedule.due_days <@ array[0,1,2,3,4,5,6]::smallint[])
            or (schedule.schedule_basis = 'month_days' and schedule.due_days <@ array(select generate_series(1,31)::smallint))
          )
      )
  )
  select jsonb_build_object(
    'contracted_carriers', (select count(*) from active_carriers),
    'missing_carrier_schedules', (select count(distinct id) from missing),
    'missing_schedule_requirements', (select count(*) from missing),
    'current_month_events', (select count(*) from public.accounting_cycle_events
      where period = date_trunc('month', current_date)::date and status = 'success'),
    'cycle_status', coalesce((select status from public.accounting_cycles
      where period = date_trunc('month', current_date)::date), 'not_started'),
    'closed_cycles', (select count(*) from public.accounting_cycles where status = 'closed')
  ) into v_operations;

  select jsonb_build_object(
    'new_leads_today', count(*) filter (
      where received_at >= date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'
    ),
    'unassigned_inbound_leads', count(*) filter (
      where owner_id is null and lead_kind = 'inbound'
        and coalesce(status, 'new') not in ('won', 'lost', 'converted')
    ),
    'cold_lead_pool', count(*) filter (
      where lead_kind = 'cold' and coalesce(status, 'new') = 'new'
    ),
    'unassigned_followups', (select count(*) from public.retargeting_followups
      where status = 'needs_followup' and owner_id is null),
    'overdue_crm_tasks', (select count(*) from public.crm_tasks
      where status not in ('done', 'completed', 'cancelled') and due_at < now()),
    'unassigned_crm_tasks', (select count(*) from public.crm_tasks
      where status not in ('done', 'completed', 'cancelled') and assigned_to is null)
  ) into v_sales
  from public.crm_leads;

  with latest_zatca as materialized (
    select
      coalesce(nullif(run.details ->> 'failed', '')::int, 0) as pending,
      run.summary,
      run.started_at as checked_at
    from public.work_agent_runs run
    join public.work_agents agent on agent.id = run.agent_id
    where agent.agent_key = 'zatca_nightly'
    order by run.started_at desc
    limit 1
  ), latest_integration as materialized (
    select
      coalesce(nullif(run.failed_count, 0), 0) as issue_count,
      run.summary,
      run.started_at as checked_at
    from public.work_agent_runs run
    join public.work_agents agent on agent.id = run.agent_id
    where agent.agent_key = 'integration_health'
    order by run.started_at desc
    limit 1
  )
  select jsonb_build_object(
    'zatca_pending', coalesce((select pending from latest_zatca), 0),
    'zatca_summary', (select summary from latest_zatca),
    'zatca_checked_at', (select checked_at from latest_zatca),
    'integration_issues', coalesce((select issue_count from latest_integration), 0),
    'integration_summary', (select summary from latest_integration),
    'integration_checked_at', (select checked_at from latest_integration),
    'agent_failures_24h', (select count(*) from public.work_agent_runs
      where status in ('failed', 'partial', 'error') and started_at >= now() - interval '24 hours'),
    'pending_webhooks', (select count(*) from public.webhook_events
      where processed_at is null and audit_id is null and status is distinct from 'failed'),
    'zoho_last_sync', greatest(
      (select max(synced_at) from public.zoho_invoices),
      (select max(synced_at) from public.zoho_payments),
      (select max(synced_at) from public.zoho_bank_accounts)
    ),
    'platform_last_snapshot', (select max(uploaded_at) from public.merchants)
  ) into v_system;

  return jsonb_build_object(
    'generated_at', now(),
    'customer', coalesce(v_customer, '{}'::jsonb),
    'finance', coalesce(v_finance, '{}'::jsonb),
    'collections', coalesce(v_collections, '{}'::jsonb),
    'operations', coalesce(v_operations, '{}'::jsonb),
    'sales', coalesce(v_sales, '{}'::jsonb),
    'system', coalesce(v_system, '{}'::jsonb)
  );
end;
$$;

comment on function public.morning_brief_management_snapshot() is
  'Read-only management snapshot used by the scheduled morning brief Edge Function.';

revoke all on function public.morning_brief_management_snapshot() from public, anon, authenticated;
grant execute on function public.morning_brief_management_snapshot() to service_role;
