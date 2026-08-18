-- Immutable, read-only captures of Daftra's official Clients Balance Report.
-- Historical closing balances cannot be reconstructed safely from the current
-- invoices API, so each audited period is stored with its full report totals.

create table if not exists public.daftra_client_balance_snapshots (
  period_start date not null,
  period_end date not null,
  daftra_client_id text not null,
  client_number text,
  account_number text,
  client_name text not null,
  manual_status text,
  employee_name text,
  opening_balance numeric(18, 2) not null default 0,
  total_sales numeric(18, 2) not null default 0,
  total_returns numeric(18, 2) not null default 0,
  net_sales numeric(18, 2) not null default 0,
  total_payments numeric(18, 2) not null default 0,
  settlements numeric(18, 2) not null default 0,
  closing_balance numeric(18, 2) not null default 0,
  currency_code text not null default 'SAR',
  source text not null default 'daftra_clients_balance_report',
  captured_at timestamptz not null default now(),
  primary key (period_end, daftra_client_id),
  constraint daftra_client_balance_period_valid check (period_end >= period_start)
);

create index if not exists daftra_client_balance_snapshots_period_idx
  on public.daftra_client_balance_snapshots (period_start, period_end);

alter table public.daftra_client_balance_snapshots enable row level security;

drop policy if exists "reconciliation staff read Daftra balance snapshots"
  on public.daftra_client_balance_snapshots;
create policy "reconciliation staff read Daftra balance snapshots"
  on public.daftra_client_balance_snapshots
  for select
  to authenticated
  using (public.crm_has_permission('reconciliation.view'));

revoke insert, update, delete, truncate
  on public.daftra_client_balance_snapshots from anon, authenticated;
grant select on public.daftra_client_balance_snapshots to authenticated;
grant all on public.daftra_client_balance_snapshots to service_role;

comment on table public.daftra_client_balance_snapshots is
  'Read-only audited snapshots from Daftra Clients Balance Report; not current invoice totals.';
