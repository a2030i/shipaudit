-- Zoho trial-balance (ميزان المراجعة) treasury rows: each carrier's COD
-- "خزينة" account balance, for accountant-registration monitoring (does the
-- accountant drain each carrier's collected COD?). Snapshot model: latest
-- upload wins (newest uploaded_at). See reconciliationService.js
-- (parseZohoTrialBalanceTreasury / uploadTreasurySnapshot / loadTreasuryBalances)
-- and the treasury section in the Reconciliation page's Vendors tab.

create table if not exists public.cod_treasury_balances (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null,
  raw_name    text not null,          -- account name from the report e.g. "خزينة سمسا"
  carrier_id  text,                   -- matched carrier id, null if not in our system
  debit       numeric not null default 0,   -- صافي الرصيد المدين
  credit      numeric not null default 0,   -- صافي الرصيد الدائن
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid
);

create index if not exists cod_treasury_balances_snap_idx
  on public.cod_treasury_balances (snapshot_id);

alter table public.cod_treasury_balances enable row level security;
drop policy if exists cod_treasury_balances_all on public.cod_treasury_balances;
create policy cod_treasury_balances_all on public.cod_treasury_balances
  for all to authenticated using (true) with check (true);
