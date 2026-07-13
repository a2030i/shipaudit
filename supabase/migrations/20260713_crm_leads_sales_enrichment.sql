-- CRM leads enrichment for external Saudi ecommerce directories.
-- Keeps the original crm_leads flow intact while adding cleaned phones,
-- dedupe diagnostics, source metadata, and platform-customer matching.

alter table public.crm_leads
  add column if not exists phone_normalized text,
  add column if not exists whatsapp_normalized text,
  add column if not exists name_en text,
  add column if not exists category text,
  add column if not exists address text,
  add column if not exists website text,
  add column if not exists platform text,
  add column if not exists store_url text,
  add column if not exists social_links jsonb not null default '{}'::jsonb,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb,
  add column if not exists source_row_number int,
  add column if not exists duplicate_key text,
  add column if not exists duplicate_count int not null default 1,
  add column if not exists duplicate_names text[] not null default '{}',
  add column if not exists matched_store_id text,
  add column if not exists matched_store_name text,
  add column if not exists matched_store_status text,
  add column if not exists matched_store_billing_type text,
  add column if not exists matched_store_shipments int,
  add column if not exists matched_store_last_shipment_at timestamptz,
  add column if not exists matched_store_wallet numeric(14,2);

create index if not exists ix_crm_leads_phone_norm
  on public.crm_leads (phone_normalized)
  where phone_normalized is not null;

create index if not exists ix_crm_leads_snapshot_phone
  on public.crm_leads (snapshot_id, phone_normalized)
  where snapshot_id is not null and phone_normalized is not null;

create index if not exists ix_crm_leads_category
  on public.crm_leads (category)
  where category is not null;

create index if not exists ix_crm_leads_matched_store
  on public.crm_leads (matched_store_id)
  where matched_store_id is not null;
