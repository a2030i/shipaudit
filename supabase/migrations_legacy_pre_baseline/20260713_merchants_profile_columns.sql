-- stores.xlsx v2 profile/compliance columns.
-- Snapshot-safe: existing rows stay null/false; new uploads populate them.

alter table public.merchants
  add column if not exists profile_status text,
  add column if not exists vat_registered boolean not null default false,
  add column if not exists zatca_completed boolean not null default false,
  add column if not exists verification_status text;

create index if not exists merchants_snapshot_verification_idx
  on public.merchants (snapshot_id, verification_status);

create index if not exists merchants_snapshot_zatca_idx
  on public.merchants (snapshot_id, zatca_completed);
