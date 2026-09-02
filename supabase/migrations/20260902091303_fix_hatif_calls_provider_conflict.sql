-- PostgREST upsert(onConflict: 'provider_call_id') requires a non-partial
-- unique constraint/index whose key matches the conflict target exactly.
-- The previous partial index caused every post-call webhook upsert to fail
-- with 42P10, which made Hatif disable the callback after three HTTP 500s.
drop index if exists public.hatif_calls_provider_idx;

create unique index hatif_calls_provider_idx
  on public.hatif_calls (provider_call_id);

comment on index public.hatif_calls_provider_idx is
  'Full unique conflict target for idempotent Hatif call webhook upserts; NULL provider IDs remain allowed.';
