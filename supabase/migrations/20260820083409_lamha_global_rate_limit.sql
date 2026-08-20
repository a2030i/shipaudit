-- Global outbound Lamha API throttle.
--
-- Lamha allows at most 30 requests/minute for the shared employee/API
-- credentials. Keep the state in Postgres so separate Edge Function workers,
-- browser tabs and cron invocations cannot each create their own budget.
-- A 2.1 second spacing is intentionally conservative around minute-boundary
-- and clock jitter while remaining within the approved 30/minute ceiling.

create table if not exists private.lamha_api_rate_limit_state (
  singleton_id smallint primary key default 1,
  next_request_at timestamptz not null default '-infinity'::timestamptz,
  total_claims bigint not null default 0,
  last_source text,
  last_claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint lamha_api_rate_limit_singleton_check check (singleton_id = 1),
  constraint lamha_api_rate_limit_total_claims_check check (total_claims >= 0),
  constraint lamha_api_rate_limit_source_length_check check (last_source is null or length(last_source) <= 120)
);

comment on table private.lamha_api_rate_limit_state is
  'Single server-owned throttle shared by every outbound Lamha API caller. Never exposed to browser roles.';

revoke all on table private.lamha_api_rate_limit_state from public, anon, authenticated;
grant select, insert, update on table private.lamha_api_rate_limit_state to service_role;

insert into private.lamha_api_rate_limit_state (singleton_id)
values (1)
on conflict (singleton_id) do nothing;

create or replace function public.claim_lamha_api_request(p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_next timestamptz;
  v_retry_ms integer;
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'unknown'), 120);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_allowed';
  end if;

  insert into private.lamha_api_rate_limit_state (singleton_id)
  values (1)
  on conflict (singleton_id) do nothing;

  select next_request_at
  into v_next
  from private.lamha_api_rate_limit_state
  where singleton_id = 1
  for update;

  if v_next > v_now then
    v_retry_ms := greatest(1, ceil(extract(epoch from (v_next - v_now)) * 1000)::integer);
    return jsonb_build_object(
      'allowed', false,
      'retry_after_ms', v_retry_ms,
      'next_request_at', v_next,
      'limit_per_minute', 30
    );
  end if;

  update private.lamha_api_rate_limit_state
  set next_request_at = v_now + interval '2100 milliseconds',
      total_claims = total_claims + 1,
      last_source = v_source,
      last_claimed_at = v_now,
      updated_at = v_now
  where singleton_id = 1;

  return jsonb_build_object(
    'allowed', true,
    'retry_after_ms', 0,
    'next_request_at', v_now + interval '2100 milliseconds',
    'limit_per_minute', 30
  );
end;
$$;

comment on function public.claim_lamha_api_request(text) is
  'Claims one globally spaced outbound Lamha API slot. Service-role only; callers must not contact Lamha unless allowed=true.';

revoke all on function public.claim_lamha_api_request(text) from public, anon, authenticated;
grant execute on function public.claim_lamha_api_request(text) to service_role;
