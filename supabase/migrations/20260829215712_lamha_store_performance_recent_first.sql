-- Production applied the recent-first ordering correction as a separate migration.
-- The final ORDER BY is already consolidated in 20260829215247 for clean rebuilds.

do $migration_contract$
begin
  if to_regprocedure('public.lamha_store_performance_command_center(text,text,integer,integer)') is null then
    raise exception 'lamha_store_performance_command_center_missing';
  end if;
end;
$migration_contract$;

comment on function public.lamha_store_performance_command_center(text,text,integer,integer) is
  'Read-only Lamha store performance command center; order keeps recent operational activity first except explicit exception views.';
