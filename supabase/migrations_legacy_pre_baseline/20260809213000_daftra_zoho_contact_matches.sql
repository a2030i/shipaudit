-- Manual identity confirmations between Daftra clients and Zoho customers.
-- This table only resolves contact identity; it never changes balances in
-- either system. A Zoho customer may not be assigned to two Daftra clients.

create table if not exists public.daftra_zoho_contact_matches (
  daftra_client_id text primary key,
  zoho_contact_id text not null unique,
  daftra_client_name text not null,
  zoho_contact_name text not null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  source text not null default 'manual_confirmation',
  note text,
  constraint daftra_zoho_contact_matches_ids_not_blank check (
    btrim(daftra_client_id) <> '' and btrim(zoho_contact_id) <> ''
  )
);

alter table public.daftra_zoho_contact_matches enable row level security;

drop policy if exists "reconciliation staff read confirmed contact matches"
  on public.daftra_zoho_contact_matches;
create policy "reconciliation staff read confirmed contact matches"
  on public.daftra_zoho_contact_matches
  for select
  to authenticated
  using (public.crm_has_permission('reconciliation.view'));

revoke insert, update, delete, truncate
  on public.daftra_zoho_contact_matches from anon, authenticated;
grant select on public.daftra_zoho_contact_matches to authenticated;
grant all on public.daftra_zoho_contact_matches to service_role;

comment on table public.daftra_zoho_contact_matches is
  'Approved Daftra-to-Zoho contact identity mappings; read-only reconciliation metadata with no financial side effects.';
comment on column public.daftra_zoho_contact_matches.daftra_client_id is
  'Stable external Daftra client identifier.';
comment on column public.daftra_zoho_contact_matches.zoho_contact_id is
  'Stable external Zoho customer identifier; unique to prevent double linking.';
