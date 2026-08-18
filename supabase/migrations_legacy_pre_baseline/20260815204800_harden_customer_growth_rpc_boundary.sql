-- Keep privileged implementations outside the exposed API schema. Public RPCs
-- are SECURITY INVOKER wrappers; the private implementations still perform
-- explicit auth.uid() and permission checks before reading or writing.

create index if not exists customer_growth_outcomes_recorded_by_idx
  on public.customer_growth_outcomes(recorded_by, recorded_at desc)
  where recorded_by is not null;

alter function public.customer_growth_action_queue(integer, text, text)
  set schema private;
alter function public.customer_growth_operating_snapshot(integer)
  set schema private;
alter function public.customer_growth_profile(text)
  set schema private;
alter function public.record_customer_growth_outcome(text, text, text, timestamptz, text, text)
  set schema private;

revoke all on function private.customer_growth_action_queue(integer, text, text) from public, anon;
revoke all on function private.customer_growth_operating_snapshot(integer) from public, anon;
revoke all on function private.customer_growth_profile(text) from public, anon;
revoke all on function private.record_customer_growth_outcome(text, text, text, timestamptz, text, text) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.customer_growth_action_queue(integer, text, text) to authenticated, service_role;
grant execute on function private.customer_growth_operating_snapshot(integer) to authenticated, service_role;
grant execute on function private.customer_growth_profile(text) to authenticated, service_role;
grant execute on function private.record_customer_growth_outcome(text, text, text, timestamptz, text, text) to authenticated, service_role;

create or replace function public.customer_growth_action_queue(
  p_limit integer default 400,
  p_owner text default null,
  p_journey text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.customer_growth_action_queue(p_limit, p_owner, p_journey) $$;

create or replace function public.customer_growth_operating_snapshot(
  p_days integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.customer_growth_operating_snapshot(p_days) $$;

create or replace function public.customer_growth_profile(p_phone text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.customer_growth_profile(p_phone) $$;

create or replace function public.record_customer_growth_outcome(
  p_phone text,
  p_reason_code text,
  p_outcome text,
  p_next timestamptz default null,
  p_activity_type text default 'call',
  p_note text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_customer_growth_outcome(
    p_phone, p_reason_code, p_outcome, p_next, p_activity_type, p_note
  )
$$;

revoke all on function public.customer_growth_action_queue(integer, text, text) from public, anon;
revoke all on function public.customer_growth_operating_snapshot(integer) from public, anon;
revoke all on function public.customer_growth_profile(text) from public, anon;
revoke all on function public.record_customer_growth_outcome(text, text, text, timestamptz, text, text) from public, anon;
grant execute on function public.customer_growth_action_queue(integer, text, text) to authenticated, service_role;
grant execute on function public.customer_growth_operating_snapshot(integer) to authenticated, service_role;
grant execute on function public.customer_growth_profile(text) to authenticated, service_role;
grant execute on function public.record_customer_growth_outcome(text, text, text, timestamptz, text, text) to authenticated, service_role;
