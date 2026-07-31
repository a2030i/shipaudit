-- Zoho Books integration reliability layer.
-- Additive only: no existing read policy or business table behaviour is changed.

create table if not exists public.zoho_webhook_inbox (
  event_key text primary key,
  source text not null default 'zoho_books',
  event_type text,
  entity_type text,
  entity_id text,
  provider_modified_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  received_at timestamptz not null default now(),
  processing_started_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create index if not exists zoho_webhook_inbox_attention_idx
  on public.zoho_webhook_inbox (status, received_at desc)
  where status in ('processing', 'failed');

create table if not exists public.zoho_sync_runs (
  id bigint generated always as identity primary key,
  run_key text not null unique,
  trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'cron', 'full_rebuild')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  requested_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  results jsonb not null default '{}'::jsonb,
  api_calls integer not null default 0 check (api_calls >= 0),
  error text
);

create index if not exists zoho_sync_runs_recent_idx
  on public.zoho_sync_runs (started_at desc);
create index if not exists zoho_sync_runs_attention_idx
  on public.zoho_sync_runs (status, started_at desc)
  where status in ('running', 'partial', 'failed');

create table if not exists public.zoho_write_operations (
  id bigint generated always as identity primary key,
  idempotency_key text not null unique,
  action text not null,
  contact_id text,
  requested_by uuid references public.profiles(id) on delete set null,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed', 'unknown')),
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  applied_amount numeric(18,2) not null default 0 check (applied_amount >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text
);

create index if not exists zoho_write_operations_attention_idx
  on public.zoho_write_operations (status, started_at desc)
  where status in ('running', 'partial', 'failed', 'unknown');

alter table public.zoho_invoices add column if not exists customer_id text;
alter table public.zoho_invoices add column if not exists due_date date;
alter table public.zoho_payments add column if not exists customer_id text;
alter table public.zoho_creditnotes add column if not exists customer_id text;
alter table public.zoho_bills add column if not exists vendor_id text;
alter table public.zoho_vendor_payments add column if not exists vendor_id text;

create index if not exists zoho_invoices_customer_id_idx
  on public.zoho_invoices (customer_id) where customer_id is not null;
create index if not exists zoho_payments_customer_id_idx
  on public.zoho_payments (customer_id) where customer_id is not null;
create index if not exists zoho_creditnotes_customer_id_idx
  on public.zoho_creditnotes (customer_id) where customer_id is not null;
create index if not exists zoho_bills_vendor_id_idx
  on public.zoho_bills (vendor_id) where vendor_id is not null;
create index if not exists zoho_vendor_payments_vendor_id_idx
  on public.zoho_vendor_payments (vendor_id) where vendor_id is not null;
create index if not exists zoho_invoices_open_due_idx
  on public.zoho_invoices (due_date, customer_name)
  where balance > 0.5;

alter table public.zoho_sync_state add column if not exists last_status text;
alter table public.zoho_sync_state add column if not exists last_error text;
alter table public.zoho_sync_state add column if not exists last_run_id bigint;

alter table public.zoho_webhook_inbox enable row level security;
alter table public.zoho_sync_runs enable row level security;
alter table public.zoho_write_operations enable row level security;

revoke all on table public.zoho_webhook_inbox from public, anon, authenticated;
revoke all on table public.zoho_sync_runs from public, anon, authenticated;
revoke all on table public.zoho_write_operations from public, anon, authenticated;
revoke all on sequence public.zoho_sync_runs_id_seq from public, anon, authenticated;
revoke all on sequence public.zoho_write_operations_id_seq from public, anon, authenticated;

grant all on table public.zoho_webhook_inbox to service_role;
grant all on table public.zoho_sync_runs to service_role;
grant all on table public.zoho_write_operations to service_role;
grant all on sequence public.zoho_sync_runs_id_seq to service_role;
grant all on sequence public.zoho_write_operations_id_seq to service_role;

comment on table public.zoho_webhook_inbox is
  'Durable, deduplicated inbox for Zoho Books webhooks. Service-role only.';
comment on table public.zoho_sync_runs is
  'One durable health record per Zoho mirror synchronization run.';
comment on table public.zoho_write_operations is
  'Idempotency and audit ledger for writes performed against Zoho Books.';
