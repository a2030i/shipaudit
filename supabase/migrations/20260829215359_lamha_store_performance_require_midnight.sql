-- Production applied the midnight-only correction as a separate migration.
-- The authoritative function body is consolidated in the immediately previous
-- migration so a clean rebuild reaches the final production state deterministically.

do $migration_contract$
begin
  if to_regprocedure('public.lamha_store_performance_command_center(text,text,integer,integer)') is null then
    raise exception 'lamha_store_performance_command_center_missing';
  end if;
end;
$migration_contract$;

comment on function public.lamha_store_performance_command_center(text,text,integer,integer) is
  'Read-only Lamha store performance command center; daily movement requires canonical Riyadh-midnight snapshots.';
