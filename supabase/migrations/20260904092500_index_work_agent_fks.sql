-- Cover actor foreign keys used by audit and lifecycle maintenance queries.
create index if not exists work_agent_runs_approved_by_idx
  on public.work_agent_runs(approved_by)
  where approved_by is not null;

create index if not exists work_agents_created_by_idx
  on public.work_agents(created_by)
  where created_by is not null;
