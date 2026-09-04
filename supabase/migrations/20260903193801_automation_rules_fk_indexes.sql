-- Cover audit ownership foreign keys before the version/run history grows.
create index if not exists automation_rules_created_by_idx on public.automation_rules(created_by) where created_by is not null;
create index if not exists automation_rules_updated_by_idx on public.automation_rules(updated_by) where updated_by is not null;
create index if not exists automation_rule_versions_created_by_idx on public.automation_rule_versions(created_by) where created_by is not null;
create index if not exists automation_runs_approved_by_idx on public.automation_runs(approved_by) where approved_by is not null;
