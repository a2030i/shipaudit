-- The first growth queue version used `action` as both the row alias and a
-- column name. PostgreSQL resolved `to_jsonb(action)` to the text column, so
-- the RPC returned an array of action strings instead of customer objects.

create or replace function private.customer_growth_action_queue(
  p_limit integer default 400,
  p_owner text default null,
  p_journey text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null
     or not public.app_has_any_permission(array[
       'collections.view', 'sales.view', 'overview.view', 'crm.view'
     ]) then
    raise exception 'not_allowed';
  end if;

  return (
    with actions as (
      select *
      from public.customer_engagement_next_actions(
        greatest(1, least(coalesce(p_limit, 400), 1000)), p_owner, p_journey
      )
    ), latest_outcome as (
      select distinct on (public.norm_sa_phone(outcome.phone), outcome.reason_code)
        public.norm_sa_phone(outcome.phone) as phone,
        outcome.reason_code,
        outcome.sales_stage,
        outcome.next_action_at,
        outcome.recorded_at
      from public.customer_growth_outcomes outcome
      order by public.norm_sa_phone(outcome.phone), outcome.reason_code, outcome.recorded_at desc
    )
    select coalesce(
      jsonb_agg(
        to_jsonb(queued_action)
        order by queued_action.priority desc, queued_action.amount desc nulls last
      ),
      '[]'::jsonb
    )
    from actions queued_action
    left join latest_outcome outcome
      on outcome.phone = public.norm_sa_phone(queued_action.phone)
     and outcome.reason_code = queued_action.reason_code
    where outcome.phone is null
       or (
         outcome.sales_stage not in ('won', 'lost')
         and (outcome.next_action_at is null or outcome.next_action_at <= now())
       )
       or outcome.recorded_at < now() - interval '90 days'
  );
end;
$function$;

revoke all on function private.customer_growth_action_queue(integer, text, text) from public, anon;
grant execute on function private.customer_growth_action_queue(integer, text, text) to authenticated, service_role;

comment on function private.customer_growth_action_queue(integer, text, text) is
  'Protected customer action queue implementation returning full JSON objects; never sends messages.';
