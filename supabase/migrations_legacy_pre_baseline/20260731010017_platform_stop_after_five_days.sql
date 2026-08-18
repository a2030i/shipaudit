-- A platform merchant is still within the normal operating window through day 5.
-- Escalate recovery only after the last shipment is older than five days.
--
-- Keep the existing `recent_stop` column name for RPC/backward compatibility,
-- but correct its business meaning at the single routing source of truth.

do $migration$
declare
  previous_definition text;
  corrected_definition text;
begin
  select pg_get_viewdef('public.v_platform_commercial_routing'::regclass, true)
    into previous_definition;

  corrected_definition := replace(
    previous_definition,
    'merchant_rollup.days_since_last >= 1 AND merchant_rollup.days_since_last <= 5',
    'merchant_rollup.days_since_last > 5'
  );

  if corrected_definition = previous_definition then
    raise exception
      'Expected 1-5 day stop rule was not found in v_platform_commercial_routing';
  end if;

  execute format(
    'create or replace view public.v_platform_commercial_routing '
    'with (security_invoker = true) as %s',
    corrected_definition
  );
end;
$migration$;

revoke all on public.v_platform_commercial_routing
  from public, anon, authenticated;
grant select on public.v_platform_commercial_routing to service_role;

comment on view public.v_platform_commercial_routing is
  'Commercial routing for platform merchants. Recovery becomes important only when the last shipment is older than five days.';
