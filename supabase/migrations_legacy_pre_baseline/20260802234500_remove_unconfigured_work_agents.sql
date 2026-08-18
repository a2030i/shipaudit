-- Remove only the three unconfigured draft agents. Active production agents are preserved.
delete from public.work_agents
where status='draft'
  and agent_key in ('new_leads','bank_reconciliation','monthly_close');
