-- Raw cold-lead inventory is not an assigned employee task. Keep it visible as
-- a separate pool and reserve "unassigned" for actionable inbound requests.
create or replace function public.management_daily_snapshot()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with invoice_stats as materialized (
    select
      count(*) filter (
        where balance > 0.5
          and coalesce(due_date, date) < current_date
          and lower(coalesce(status, '')) not in ('paid', 'void', 'draft')
      ) as overdue_invoices,
      coalesce(sum(balance) filter (
        where balance > 0.5
          and coalesce(due_date, date) < current_date
          and lower(coalesce(status, '')) not in ('paid', 'void', 'draft')
      ), 0) as overdue_amount,
      count(*) filter (
        where einvoice_status = 'yet_to_be_pushed'
          and date <= current_date
      ) as zatca_pending,
      max(synced_at) as zoho_last_sync
    from public.zoho_invoices
  ),
  lead_stats as materialized (
    select
      count(*) filter (
        where received_at >= date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'
      ) as new_leads_today,
      count(*) filter (
        where owner_id is null
          and lead_kind = 'inbound'
          and coalesce(status, 'new') not in ('won', 'lost', 'converted')
      ) as unassigned_leads,
      count(*) filter (
        where lead_kind = 'cold'
          and coalesce(status, 'new') = 'new'
      ) as cold_lead_pool
    from public.crm_leads
  ),
  task_stats as materialized (
    select count(*) filter (
      where status not in ('done', 'completed', 'cancelled')
        and due_at < now()
    ) as overdue_tasks
    from public.crm_tasks
  ),
  agent_stats as materialized (
    select count(*) filter (
      where status in ('failed', 'partial')
        and started_at >= now() - interval '24 hours'
    ) as agent_failures_24h
    from public.work_agent_runs
  )
  select jsonb_build_object(
    'generated_at', now(),
    'overdue_invoices', invoice_stats.overdue_invoices,
    'overdue_amount', invoice_stats.overdue_amount,
    'zatca_pending', invoice_stats.zatca_pending,
    'new_leads_today', lead_stats.new_leads_today,
    'unassigned_leads', lead_stats.unassigned_leads,
    'cold_lead_pool', lead_stats.cold_lead_pool,
    'overdue_tasks', task_stats.overdue_tasks,
    'agent_failures_24h', agent_stats.agent_failures_24h,
    'zoho_last_sync', invoice_stats.zoho_last_sync
  )
  from invoice_stats
  cross join lead_stats
  cross join task_stats
  cross join agent_stats
$$;

revoke all on function public.management_daily_snapshot() from public, anon, authenticated;
grant execute on function public.management_daily_snapshot() to service_role;
