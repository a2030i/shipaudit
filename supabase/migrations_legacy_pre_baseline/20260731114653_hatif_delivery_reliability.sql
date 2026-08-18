-- Durable inbox for the two official Hatif/Voxa webhooks.
-- The raw request is authenticated before it reaches this table.  A digest of
-- source + exact body is the idempotency key, so provider retries are harmless.
create table if not exists public.hatif_webhook_inbox (
  event_key        text primary key,
  source           text not null check (source in ('whatsapp', 'call')),
  event_type       text,
  message_id       text,
  call_id          text,
  conversation_id  text,
  contact_id       text,
  payload          jsonb not null,
  status           text not null default 'processing'
                   check (status in ('processing', 'processed', 'ignored', 'unmatched', 'failed')),
  attempt_count    integer not null default 1 check (attempt_count > 0),
  received_at      timestamptz not null default now(),
  last_attempt_at  timestamptz not null default now(),
  processed_at     timestamptz,
  last_error       text
);

create index if not exists hatif_webhook_inbox_attention_idx
  on public.hatif_webhook_inbox (last_attempt_at, source)
  where status in ('processing', 'unmatched', 'failed');

alter table public.hatif_webhook_inbox enable row level security;
revoke all on table public.hatif_webhook_inbox from public, anon, authenticated;
grant select, insert, update, delete on table public.hatif_webhook_inbox to service_role;

-- Workspace events may be replayed when a later write fails.  Tie their raw
-- audit row to the durable inbox so such retries remain idempotent too.
alter table if exists public.hatif_events
  add column if not exists inbox_event_key text;
create unique index if not exists hatif_events_inbox_event_key_uidx
  on public.hatif_events (inbox_event_key);

-- A claim is written before calling Hatif.  If the Edge Function is killed or
-- the network response is ambiguous, the same recipient cannot be sent twice.
create table if not exists public.hatif_send_claims (
  idempotency_key    text primary key,
  source             text not null check (source in ('immediate', 'scheduled', 'drip')),
  phone              text not null,
  template_name      text not null,
  campaign_name      text,
  source_reference   text,
  status              text not null default 'sending'
                      check (status in ('sending', 'sent', 'failed', 'unknown')),
  attempt_count       integer not null default 1 check (attempt_count > 0),
  provider_message_id text,
  provider_contact_id text,
  provider_conversation_id text,
  provider_status     text,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists hatif_send_claims_attention_idx
  on public.hatif_send_claims (updated_at, source)
  where status in ('sending', 'unknown', 'failed');

alter table public.hatif_send_claims enable row level security;
revoke all on table public.hatif_send_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.hatif_send_claims to service_role;
