-- Token-scoped outbound Lamha API throttle.
--
-- Every Edge Function, device and endpoint using the same Lamha credential
-- shares one server-side budget. The raw token never leaves the Edge runtime;
-- callers send only a SHA-256 fingerprint to this function.

create table if not exists private.lamha_api_token_rate_limit_state (
  credential_key text primary key,
  next_request_at timestamptz not null default '-infinity'::timestamptz,
  total_claims bigint not null default 0,
  last_source text,
  last_claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint lamha_api_token_rate_limit_key_check check (credential_key ~ '^[0-9a-f]{64}$'),
  constraint lamha_api_token_rate_limit_total_claims_check check (total_claims >= 0),
  constraint lamha_api_token_rate_limit_source_length_check check (last_source is null or length(last_source) <= 120)
);

comment on table private.lamha_api_token_rate_limit_state is
  'One global outbound Lamha API throttle per hashed credential, shared across functions, endpoints and devices.';

revoke all on table private.lamha_api_token_rate_limit_state from public, anon, authenticated;
grant select, insert, update on table private.lamha_api_token_rate_limit_state to service_role;

create or replace function public.claim_lamha_api_request(
  p_credential_key text,
  p_source text
)
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
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'not_allowed';
  end if;

  if p_credential_key is null or p_credential_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_credential_key';
  end if;

  insert into private.lamha_api_token_rate_limit_state (credential_key)
  values (p_credential_key)
  on conflict (credential_key) do nothing;

  select next_request_at
  into v_next
  from private.lamha_api_token_rate_limit_state
  where credential_key = p_credential_key
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

  update private.lamha_api_token_rate_limit_state
  set next_request_at = v_now + interval '2100 milliseconds',
      total_claims = total_claims + 1,
      last_source = v_source,
      last_claimed_at = v_now,
      updated_at = v_now
  where credential_key = p_credential_key;

  return jsonb_build_object(
    'allowed', true,
    'retry_after_ms', 0,
    'next_request_at', v_now + interval '2100 milliseconds',
    'limit_per_minute', 30
  );
end;
$$;

comment on function public.claim_lamha_api_request(text, text) is
  'Claims one Lamha API slot for a hashed credential. Service-role only; raw tokens must never be passed.';

revoke all on function public.claim_lamha_api_request(text, text) from public, anon, authenticated;
grant execute on function public.claim_lamha_api_request(text, text) to service_role;
