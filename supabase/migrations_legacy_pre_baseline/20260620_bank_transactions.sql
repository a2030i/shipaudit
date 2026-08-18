-- Persistent bank-statement ledger so uploads accumulate across periods
-- (the BankStatement page was previously in-memory only). Smart merge by
-- dedup_key: re-uploading an overlapping period merges shared rows instead
-- of duplicating them. See src/lib/bankTransactionsService.js.

create table if not exists public.bank_transactions (
  id          uuid primary key default gen_random_uuid(),
  dedup_key   text not null,
  txn_date    text,
  reference   text,
  description text,
  debit       numeric not null default 0,
  credit      numeric not null default 0,
  fees        numeric not null default 0,
  tax         numeric not null default 0,
  source_file text,
  period_from text,
  period_to   text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- FULL (non-partial) unique index so PostgREST upsert onConflict='dedup_key'
-- never hits the 42P10 trap that partial indexes cause (see CLAUDE.md §6).
create unique index if not exists bank_transactions_dedup_key_uidx
  on public.bank_transactions (dedup_key);

create index if not exists bank_transactions_txn_date_idx
  on public.bank_transactions (txn_date);

alter table public.bank_transactions enable row level security;

drop policy if exists bank_transactions_all on public.bank_transactions;
create policy bank_transactions_all on public.bank_transactions
  for all to authenticated using (true) with check (true);
