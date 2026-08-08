-- Track the manual bank-statement hand-off to Zoho without creating a second
-- write path into the bank ledger.  The browser can read these rows, but only
-- the authenticated Edge Function (service role + explicit app permission)
-- records or verifies a batch.

create table if not exists public.zoho_bank_export_batches (
  id uuid primary key default gen_random_uuid(),
  zoho_account_id text not null,
  internal_bank_name text not null,
  idempotency_key text not null unique,
  file_name text not null,
  row_count integer not null check (row_count > 0),
  status text not null default 'exported'
    check (status in ('exported','verified','partial','needs_review','failed')),
  exported_by uuid references public.profiles(id) on delete set null,
  exported_at timestamptz not null default now(),
  last_verified_at timestamptz,
  seen_count integer not null default 0 check (seen_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  verification_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zoho_bank_export_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.zoho_bank_export_batches(id) on delete cascade,
  bank_transaction_id uuid not null references public.bank_transactions(id) on delete restrict,
  reference_number text,
  transaction_date date not null,
  direction text not null check (direction in ('debit','credit')),
  amount numeric(18,2) not null check (amount > 0),
  fingerprint text,
  status text not null default 'exported'
    check (status in ('exported','seen_in_zoho','missing','duplicate','invalid')),
  zoho_transaction_id text,
  match_method text check (match_method is null or match_method in ('reference','fingerprint','transaction_id')),
  verified_at timestamptz,
  verification_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, bank_transaction_id)
);

create index if not exists zoho_bank_export_batches_account_idx
  on public.zoho_bank_export_batches (zoho_account_id, exported_at desc);
create index if not exists zoho_bank_export_batches_bank_idx
  on public.zoho_bank_export_batches (lower(btrim(internal_bank_name)), exported_at desc);
create index if not exists zoho_bank_export_items_status_idx
  on public.zoho_bank_export_items (batch_id, status);
create index if not exists zoho_bank_export_items_transaction_idx
  on public.zoho_bank_export_items (bank_transaction_id, created_at desc);

alter table public.zoho_bank_export_batches enable row level security;
alter table public.zoho_bank_export_items enable row level security;

revoke all on public.zoho_bank_export_batches, public.zoho_bank_export_items
  from public, anon, authenticated;
grant select on public.zoho_bank_export_batches, public.zoho_bank_export_items
  to authenticated;
grant all on public.zoho_bank_export_batches, public.zoho_bank_export_items
  to service_role;

drop policy if exists zoho_bank_export_batches_read on public.zoho_bank_export_batches;
create policy zoho_bank_export_batches_read
  on public.zoho_bank_export_batches for select to authenticated
  using (public.app_has_any_permission(array['bank.view','zoho.bank_import']));

drop policy if exists zoho_bank_export_items_read on public.zoho_bank_export_items;
create policy zoho_bank_export_items_read
  on public.zoho_bank_export_items for select to authenticated
  using (public.app_has_any_permission(array['bank.view','zoho.bank_import']));

comment on table public.zoho_bank_export_batches is
  'Audit trail for manual Excel hand-offs to a linked Zoho bank account; never imports statements itself.';
comment on table public.zoho_bank_export_items is
  'Per-transaction verification state for a manual Zoho bank export batch.';
