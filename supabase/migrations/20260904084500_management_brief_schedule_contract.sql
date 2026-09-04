-- Align the editable first-run time with the already active 09:00/21:00 KSA
-- schedule. This changes metadata only; it does not execute the report.
update public.work_agents set
  config=coalesce(config,'{}'::jsonb)||'{"hour":9,"hours":[9,21],"minute":0,"delivery":"in_app","external_write":false}'::jsonb,
  updated_at=now()
where agent_key='management_daily_report';
