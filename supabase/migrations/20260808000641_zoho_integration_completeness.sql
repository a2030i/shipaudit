-- Complete the Zoho operational mirror without changing the existing
-- receivables/accounting calculations.  This migration adds provenance,
-- purchase detail, aging read models, bank classification controls and
-- monitoring.  All Zoho writes remain server-side.

-- ── Purchase detail and traceability ──────────────────────────────────────
alter table public.zoho_bills add column if not exists sub_total numeric(18,2);
alter table public.zoho_bills add column if not exists tax_total numeric(18,2);
alter table public.zoho_bills add column if not exists currency_code text;
alter table public.zoho_bills add column if not exists exchange_rate numeric(18,6);
alter table public.zoho_bills add column if not exists purchaseorder_ids jsonb not null default '[]'::jsonb;
alter table public.zoho_bills add column if not exists line_items jsonb not null default '[]'::jsonb;
alter table public.zoho_bills add column if not exists taxes jsonb not null default '[]'::jsonb;
alter table public.zoho_bills add column if not exists raw_detail jsonb not null default '{}'::jsonb;
alter table public.zoho_bills add column if not exists detail_synced_at timestamptz;

alter table public.zoho_vendor_payments add column if not exists bills jsonb not null default '[]'::jsonb;
alter table public.zoho_vendor_payments add column if not exists paid_through_account_id text;
alter table public.zoho_vendor_payments add column if not exists paid_through_account_name text;
alter table public.zoho_vendor_payments add column if not exists currency_code text;
alter table public.zoho_vendor_payments add column if not exists exchange_rate numeric(18,6);
alter table public.zoho_vendor_payments add column if not exists unused_amount numeric(18,2) not null default 0;
alter table public.zoho_vendor_payments add column if not exists raw_detail jsonb not null default '{}'::jsonb;
alter table public.zoho_vendor_payments add column if not exists detail_synced_at timestamptz;

alter table public.zoho_expenses add column if not exists vendor_id text;
alter table public.zoho_expenses add column if not exists currency_code text;
alter table public.zoho_expenses add column if not exists exchange_rate numeric(18,6);
alter table public.zoho_expenses add column if not exists tax_total numeric(18,2);
alter table public.zoho_expenses add column if not exists paid_through_account_id text;
alter table public.zoho_expenses add column if not exists paid_through_account_name text;
alter table public.zoho_expenses add column if not exists line_items jsonb not null default '[]'::jsonb;
alter table public.zoho_expenses add column if not exists raw_detail jsonb not null default '{}'::jsonb;
alter table public.zoho_expenses add column if not exists detail_synced_at timestamptz;

alter table public.zoho_journals add column if not exists line_items jsonb not null default '[]'::jsonb;
alter table public.zoho_journals add column if not exists raw_detail jsonb not null default '{}'::jsonb;
alter table public.zoho_journals add column if not exists detail_synced_at timestamptz;

create table if not exists public.zoho_purchase_orders (
  zoho_id text primary key,
  purchaseorder_number text,
  vendor_id text,
  vendor_name text,
  date date,
  delivery_date date,
  total numeric(18,2) not null default 0,
  status text,
  currency_code text,
  exchange_rate numeric(18,6),
  reference_number text,
  line_items jsonb not null default '[]'::jsonb,
  raw_detail jsonb not null default '{}'::jsonb,
  last_modified timestamptz,
  synced_at timestamptz not null default now(),
  detail_synced_at timestamptz
);

create table if not exists public.zoho_items (
  zoho_id text primary key,
  item_id text generated always as (zoho_id) stored,
  name text not null,
  sku text,
  item_type text,
  status text,
  rate numeric(18,2),
  purchase_rate numeric(18,2),
  tax_id text,
  tax_name text,
  tax_percentage numeric(9,4),
  account_id text,
  purchase_account_id text,
  raw jsonb not null default '{}'::jsonb,
  last_modified timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists zoho_bills_detail_queue_idx
  on public.zoho_bills (detail_synced_at nulls first, balance desc);
create index if not exists zoho_vendor_payments_detail_queue_idx
  on public.zoho_vendor_payments (detail_synced_at nulls first, date desc);
create index if not exists zoho_expenses_vendor_idx
  on public.zoho_expenses (vendor_id, date desc) where vendor_id is not null;
create index if not exists zoho_purchase_orders_vendor_idx
  on public.zoho_purchase_orders (vendor_id, date desc);

-- The list API omitted IDs for many historic purchase rows.  Backfill only
-- exact, unique vendor-name matches; ambiguous names remain null for live
-- detail enrichment instead of being guessed.
with unique_vendors as (
  select lower(btrim(contact_name)) as vendor_key, min(zoho_id) as zoho_id
  from public.zoho_contacts
  where contact_type = 'vendor' and nullif(btrim(contact_name), '') is not null
  group by lower(btrim(contact_name))
  having count(*) = 1
)
update public.zoho_bills b
set vendor_id = v.zoho_id
from unique_vendors v
where b.vendor_id is null and lower(btrim(b.vendor_name)) = v.vendor_key;

with unique_vendors as (
  select lower(btrim(contact_name)) as vendor_key, min(zoho_id) as zoho_id
  from public.zoho_contacts
  where contact_type = 'vendor' and nullif(btrim(contact_name), '') is not null
  group by lower(btrim(contact_name))
  having count(*) = 1
)
update public.zoho_vendor_payments p
set vendor_id = v.zoho_id
from unique_vendors v
where p.vendor_id is null and lower(btrim(p.vendor_name)) = v.vendor_key;

-- ── Deletion/reconciliation audit trail ───────────────────────────────────
create table if not exists public.zoho_mirror_tombstones (
  id bigint generated always as identity primary key,
  entity text not null,
  zoho_id text not null,
  snapshot jsonb not null default '{}'::jsonb,
  sync_run_id bigint references public.zoho_sync_runs(id) on delete set null,
  detected_at timestamptz not null default now(),
  unique (entity, zoho_id, detected_at)
);
create index if not exists zoho_mirror_tombstones_recent_idx
  on public.zoho_mirror_tombstones (detected_at desc, entity);

-- Restore statuses known by a newer durable webhook event.  A list sync must
-- never replace these with null merely because Zoho omitted the field.
with latest as (
  select distinct on (entity_id)
    entity_id,
    lower(nullif(payload #>> '{invoice,einvoice_details,status}', '')) as status
  from public.zoho_webhook_inbox
  where entity_type in ('invoice','invoices')
    and status = 'processed'
    and nullif(payload #>> '{invoice,einvoice_details,status}', '') is not null
  order by entity_id, received_at desc
)
update public.zoho_invoices i
set einvoice_status = l.status
from latest l
where i.zoho_id = l.entity_id
  and l.status is not null
  and i.einvoice_status is distinct from l.status;

-- ── Financial snapshots and aging ─────────────────────────────────────────
create table if not exists public.zoho_financial_report_snapshots (
  id bigint generated always as identity primary key,
  report_key text not null,
  period_from date,
  period_to date,
  payload jsonb not null,
  source text not null default 'zoho_books_api',
  fetched_at timestamptz not null default now()
);
create index if not exists zoho_financial_report_snapshots_lookup_idx
  on public.zoho_financial_report_snapshots (report_key, period_to desc, fetched_at desc);

create or replace view public.zoho_ar_aging_current
with (security_invoker = true) as
select
  coalesce(customer_id, 'name:' || lower(btrim(coalesce(customer_name, '')))) as customer_key,
  max(customer_id) as customer_id,
  max(customer_name) as customer_name,
  count(*)::integer as invoice_count,
  round(sum(balance), 2) as balance,
  round(sum(balance) filter (where due_date is null or due_date >= current_date), 2) as current_amount,
  round(sum(balance) filter (where current_date - due_date between 1 and 30), 2) as days_1_30,
  round(sum(balance) filter (where current_date - due_date between 31 and 60), 2) as days_31_60,
  round(sum(balance) filter (where current_date - due_date between 61 and 90), 2) as days_61_90,
  round(sum(balance) filter (where current_date - due_date > 90), 2) as days_over_90,
  min(due_date) filter (where balance > 0.005) as oldest_due_date
from public.zoho_invoices
where balance > 0.005
group by coalesce(customer_id, 'name:' || lower(btrim(coalesce(customer_name, ''))));

create or replace view public.zoho_ap_aging_current
with (security_invoker = true) as
select
  coalesce(vendor_id, 'name:' || lower(btrim(coalesce(vendor_name, '')))) as vendor_key,
  max(vendor_id) as vendor_id,
  max(vendor_name) as vendor_name,
  count(*)::integer as bill_count,
  round(sum(balance), 2) as balance,
  round(sum(balance) filter (where due_date is null or due_date >= current_date), 2) as current_amount,
  round(sum(balance) filter (where current_date - due_date between 1 and 30), 2) as days_1_30,
  round(sum(balance) filter (where current_date - due_date between 31 and 60), 2) as days_31_60,
  round(sum(balance) filter (where current_date - due_date between 61 and 90), 2) as days_61_90,
  round(sum(balance) filter (where current_date - due_date > 90), 2) as days_over_90,
  min(due_date) filter (where balance > 0.005) as oldest_due_date
from public.zoho_bills
where balance > 0.005
group by coalesce(vendor_id, 'name:' || lower(btrim(coalesce(vendor_name, ''))));

-- ── Bank classification and explicit human approval ───────────────────────
alter table public.bank_transactions add column if not exists classification_status text not null default 'unclassified'
  check (classification_status in ('unclassified','suggested','classified','matched','ignored'));
alter table public.bank_transactions add column if not exists classification_type text;
alter table public.bank_transactions add column if not exists matched_entity_type text;
alter table public.bank_transactions add column if not exists matched_entity_id text;
alter table public.bank_transactions add column if not exists matched_at timestamptz;
alter table public.bank_transactions add column if not exists classified_by uuid references public.profiles(id) on delete set null;
alter table public.bank_transactions add column if not exists classification_note text;
alter table public.bank_transactions add column if not exists zoho_import_status text;
alter table public.bank_transactions add column if not exists zoho_bank_account_id text;

create table if not exists public.bank_classification_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  priority integer not null default 100,
  direction text not null default 'any' check (direction in ('any','debit','credit')),
  description_pattern text,
  min_amount numeric(18,2),
  max_amount numeric(18,2),
  classification_type text not null,
  target_entity_type text,
  target_entity_id text,
  auto_apply boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_transaction_matches (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  amount numeric(18,2) not null,
  confidence numeric(5,4),
  status text not null default 'approved' check (status in ('suggested','approved','rejected','revoked')),
  source text not null default 'manual' check (source in ('manual','rule','system')),
  rule_id uuid references public.bank_classification_rules(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists bank_transaction_matches_active_uidx
  on public.bank_transaction_matches (bank_transaction_id)
  where status = 'approved';
create index if not exists bank_transactions_classification_idx
  on public.bank_transactions (bank, classification_status, txn_date desc);

-- ── API budget and freshness monitoring ───────────────────────────────────
create table if not exists public.zoho_api_monitor_config (
  id boolean primary key default true check (id),
  warning_calls integer not null default 1800 check (warning_calls > 0),
  critical_calls integer not null default 2500 check (critical_calls >= warning_calls),
  vat_max_age_minutes integer not null default 90 check (vat_max_age_minutes >= 30),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.zoho_api_monitor_config (id) values (true) on conflict (id) do nothing;

create or replace function public.zoho_financial_health_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with cfg as (
  select * from public.zoho_api_monitor_config where id = true
), usage as (
  select coalesce(sum(api_calls),0)::integer calls,
         coalesce(sum(rate_limited_count),0)::integer rate_limited,
         max(last_call_at) last_call_at
  from public.zoho_api_daily_usage where usage_date = current_date
), vat as (
  select
    (select fetched_at from public.vat_snapshots order by fetched_at desc limit 1) as fetched_at,
    (select net_due from public.vat_snapshots order by fetched_at desc limit 1) as net_due,
    (select quarter from public.vat_snapshots order by fetched_at desc limit 1) as quarter
), ar as (
  select coalesce(sum(balance),0) total,
         coalesce(sum(days_over_90),0) over_90,
         count(*) customers from public.zoho_ar_aging_current
), ap as (
  select coalesce(sum(balance),0) total,
         coalesce(sum(days_over_90),0) over_90,
         count(*) vendors from public.zoho_ap_aging_current
)
select jsonb_build_object(
  'generated_at', now(),
  'ar', jsonb_build_object('total', ar.total, 'over_90', ar.over_90, 'customers', ar.customers),
  'ap', jsonb_build_object('total', ap.total, 'over_90', ap.over_90, 'vendors', ap.vendors),
  'vat', jsonb_build_object('quarter', vat.quarter, 'net_due', vat.net_due, 'fetched_at', vat.fetched_at,
    'age_minutes', case when vat.fetched_at is null then null else floor(extract(epoch from now()-vat.fetched_at)/60) end,
    'healthy', vat.fetched_at >= now() - make_interval(mins => cfg.vat_max_age_minutes)),
  'api', jsonb_build_object('calls', usage.calls, 'rate_limited', usage.rate_limited,
    'last_call_at', usage.last_call_at, 'warning_calls', cfg.warning_calls, 'critical_calls', cfg.critical_calls,
    'status', case when usage.calls >= cfg.critical_calls then 'critical' when usage.calls >= cfg.warning_calls then 'warning' else 'healthy' end)
)
from cfg, usage, vat, ar, ap;
$$;

create or replace function public.integration_health_snapshot(
  p_zoho_minutes integer default 90,
  p_hatif_minutes integer default 20,
  p_platform_hours integer default 72
)
returns jsonb
language sql
security definer
set search_path = public, cron, pg_temp
stable
as $$
with cfg as (select * from public.zoho_api_monitor_config where id=true), x as (
  select
    (select max(finished_at) from public.zoho_sync_runs where status='succeeded') zoho_at,
    (select status from public.zoho_sync_runs order by started_at desc limit 1) zoho_last_status,
    (select max(synced_at) from public.hatif_call_log) hatif_at,
    (select max(uploaded_at) from public.merchants) platform_at,
    (select count(*) from public.profiles where accepts_campaign_leads and nullif(btrim(lead_notification_phone),'') is not null) lead_recipients,
    (select count(*) from public.campaign_lead_inbox) lead_events,
    (select max(received_at) from public.campaign_lead_inbox) lead_last_received,
    (select count(*) from public.campaign_lead_inbox where status='failed') lead_failed,
    (select count(*) from public.webhook_events where status='failed' and received_at>=now()-interval '24 hours') webhook_failed,
    (select count(*) from public.webhook_events where status in ('pending','processing') and processed_at is null and received_at<now()-interval '2 hours') webhook_stuck,
    (select count(*) from public.zoho_sync_runs where status='failed' and started_at>=now()-interval '24 hours') zoho_failures,
    (select count(*) from cron.job where active) active_jobs,
    (select count(*) from cron.job where active and jobname in ('zoho-sync-entities','hatif-pull-calls','work-agent-integration-health','zoho-vat-refresh','zatca-auto-push-2345-riyadh')) active_required_jobs,
    (select max(fetched_at) from public.vat_snapshots) vat_at,
    (select coalesce(sum(api_calls),0)::integer from public.zoho_api_daily_usage where usage_date=current_date) api_calls,
    (select coalesce(sum(rate_limited_count),0)::integer from public.zoho_api_daily_usage where usage_date=current_date) api_rate_limited
)
select jsonb_build_object(
  'checked_at',now(),
  'zoho',jsonb_build_object('last_sync',zoho_at,'healthy',zoho_at>=now()-make_interval(mins=>p_zoho_minutes),'max_age_minutes',p_zoho_minutes),
  'hatif',jsonb_build_object('last_sync',hatif_at,'healthy',hatif_at>=now()-make_interval(mins=>p_hatif_minutes),'max_age_minutes',p_hatif_minutes),
  'platform',jsonb_build_object('last_sync',platform_at,'healthy',platform_at>=now()-make_interval(hours=>p_platform_hours),'max_age_hours',p_platform_hours),
  'lead_intake',jsonb_build_object('configured_recipients',lead_recipients,'received_events',lead_events,'last_received',lead_last_received,'failed',lead_failed,'healthy',lead_recipients>0 and lead_failed=0),
  'webhooks',jsonb_build_object('failed_24h',webhook_failed,'stuck',webhook_stuck,'healthy',webhook_failed=0 and webhook_stuck=0),
  'zoho_runs',jsonb_build_object('failed_24h',zoho_failures,'last_status',zoho_last_status,'healthy',zoho_last_status='succeeded'),
  'cron',jsonb_build_object('active_jobs',active_jobs,'required_jobs',5,'active_required_jobs',active_required_jobs,'healthy',active_required_jobs=5),
  'vat',jsonb_build_object('last_refresh',vat_at,'max_age_minutes',cfg.vat_max_age_minutes,'healthy',vat_at>=now()-make_interval(mins=>cfg.vat_max_age_minutes)),
  'zoho_api',jsonb_build_object('calls_today',api_calls,'rate_limited',api_rate_limited,'warning_calls',cfg.warning_calls,'critical_calls',cfg.critical_calls,
    'healthy',api_calls<cfg.warning_calls,'status',case when api_calls>=cfg.critical_calls then 'critical' when api_calls>=cfg.warning_calls then 'warning' else 'healthy' end),
  'issue_count',
    (case when zoho_at is null or zoho_at<now()-make_interval(mins=>p_zoho_minutes) then 1 else 0 end)+
    (case when hatif_at is null or hatif_at<now()-make_interval(mins=>p_hatif_minutes) then 1 else 0 end)+
    (case when platform_at is null or platform_at<now()-make_interval(hours=>p_platform_hours) then 1 else 0 end)+
    (case when lead_recipients=0 or lead_failed>0 then 1 else 0 end)+
    (case when webhook_failed>0 or webhook_stuck>0 then 1 else 0 end)+
    (case when zoho_last_status is distinct from 'succeeded' then 1 else 0 end)+
    (case when active_required_jobs<>5 then 1 else 0 end)+
    (case when vat_at is null or vat_at<now()-make_interval(mins=>cfg.vat_max_age_minutes) then 1 else 0 end)+
    (case when api_calls>=cfg.warning_calls then 1 else 0 end)
)
from x,cfg;
$$;

-- Pending = status explicitly reported by Zoho.  Recent blank statuses are a
-- separate verification queue and are never presented as definitely pending.
create or replace function public.zatca_pending_today()
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with sd as (select (now() at time zone 'Asia/Riyadh')::date as d),
  pending as (
    select * from public.zoho_invoices
    where lower(coalesce(einvoice_status,'')) = 'yet_to_be_pushed'
  ), verify as (
    select * from public.zoho_invoices
    where nullif(btrim(coalesce(einvoice_status,'')), '') is null
      and date between (select d-1 from sd) and (select d from sd)
      and invoice_number not ilike '%الرصيد الافتتاحي%'
  )
  select jsonb_build_object(
    'saudi_date', (select d from sd),
    'today_count', (select count(*) from pending where date=(select d from sd)),
    'today_total', coalesce((select sum(total) from pending where date=(select d from sd)),0),
    'overdue_count', (select count(*) from pending where date<(select d from sd)),
    'overdue_total', coalesce((select sum(total) from pending where date<(select d from sd)),0),
    'needs_live_check_count', (select count(*) from verify),
    'invoices', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('invoice_number',invoice_number,'customer',customer_name,'total',total,'date',date,'overdue',date<(select d from sd)) x
      from pending order by date desc,total desc limit 100
    ) s),'[]'::jsonb)
  );
$$;

-- ── RLS / grants ───────────────────────────────────────────────────────────
alter table public.zoho_purchase_orders enable row level security;
alter table public.zoho_items enable row level security;
alter table public.zoho_mirror_tombstones enable row level security;
alter table public.zoho_financial_report_snapshots enable row level security;
alter table public.bank_classification_rules enable row level security;
alter table public.bank_transaction_matches enable row level security;
alter table public.zoho_api_monitor_config enable row level security;

revoke all on public.zoho_purchase_orders, public.zoho_items,
  public.zoho_mirror_tombstones, public.zoho_financial_report_snapshots,
  public.bank_classification_rules, public.bank_transaction_matches,
  public.zoho_api_monitor_config from public, anon, authenticated;
grant select on public.zoho_purchase_orders, public.zoho_items,
  public.zoho_mirror_tombstones, public.zoho_financial_report_snapshots,
  public.bank_classification_rules, public.bank_transaction_matches,
  public.zoho_api_monitor_config to authenticated;
grant insert, update, delete on public.bank_classification_rules, public.bank_transaction_matches to authenticated;
grant all on public.zoho_purchase_orders, public.zoho_items,
  public.zoho_mirror_tombstones, public.zoho_financial_report_snapshots,
  public.bank_classification_rules, public.bank_transaction_matches,
  public.zoho_api_monitor_config to service_role;
grant usage, select on sequence public.zoho_mirror_tombstones_id_seq,
  public.zoho_financial_report_snapshots_id_seq to service_role;

create policy zoho_purchase_orders_read on public.zoho_purchase_orders for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','reports.view_financial']));
create policy zoho_items_read on public.zoho_items for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','reports.view_financial']));
create policy zoho_tombstones_read on public.zoho_mirror_tombstones for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','system.view_audit_log']));
create policy zoho_report_snapshots_read on public.zoho_financial_report_snapshots for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','reports.view_financial']));
create policy bank_rules_read on public.bank_classification_rules for select to authenticated
  using (public.crm_has_permission('bank.view'));
create policy bank_rules_insert on public.bank_classification_rules for insert to authenticated
  with check (public.crm_has_permission('bank.reconcile'));
create policy bank_rules_update on public.bank_classification_rules for update to authenticated
  using (public.crm_has_permission('bank.reconcile')) with check (public.crm_has_permission('bank.reconcile'));
create policy bank_rules_delete on public.bank_classification_rules for delete to authenticated
  using (public.crm_has_permission('bank.reconcile'));
create policy bank_matches_read on public.bank_transaction_matches for select to authenticated
  using (public.crm_has_permission('bank.view'));
create policy bank_matches_insert on public.bank_transaction_matches for insert to authenticated
  with check (public.crm_has_permission('bank.reconcile'));
create policy bank_matches_update on public.bank_transaction_matches for update to authenticated
  using (public.crm_has_permission('bank.reconcile')) with check (public.crm_has_permission('bank.reconcile'));
create policy bank_matches_delete on public.bank_transaction_matches for delete to authenticated
  using (public.crm_has_permission('bank.reconcile'));
create policy zoho_api_monitor_read on public.zoho_api_monitor_config for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','reports.view_financial']));

create or replace function public.classify_bank_transaction(
  p_transaction_id uuid,
  p_classification_type text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_note text default null
)
returns public.bank_transactions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_row public.bank_transactions;
begin
  if not public.crm_has_permission('bank.reconcile') then
    raise exception 'not_allowed:bank.reconcile';
  end if;
  if nullif(btrim(coalesce(p_classification_type,'')), '') is null then
    raise exception 'classification_type_required';
  end if;
  if (p_entity_type is null) <> (p_entity_id is null) then
    raise exception 'match_requires_entity_type_and_id';
  end if;

  update public.bank_transaction_matches
     set status='revoked'
   where bank_transaction_id=p_transaction_id and status='approved';

  update public.bank_transactions
     set classification_status=case when p_entity_type is not null then 'matched' else 'classified' end,
         classification_type=btrim(p_classification_type),
         matched_entity_type=nullif(btrim(coalesce(p_entity_type,'')),''),
         matched_entity_id=nullif(btrim(coalesce(p_entity_id,'')),''),
         matched_at=case when p_entity_type is not null then now() else null end,
         classified_by=auth.uid(),
         classification_note=nullif(btrim(coalesce(p_note,'')),''),
         updated_at=now()
   where id=p_transaction_id
   returning * into v_row;
  if not found then raise exception 'bank_transaction_not_found'; end if;

  if p_entity_type is not null then
    insert into public.bank_transaction_matches(
      bank_transaction_id,entity_type,entity_id,amount,confidence,status,source,approved_by,approved_at,note
    ) values (
      p_transaction_id,btrim(p_entity_type),btrim(p_entity_id),greatest(v_row.debit,v_row.credit),1,'approved','manual',auth.uid(),now(),nullif(btrim(coalesce(p_note,'')),'')
    );
  end if;
  return v_row;
end;
$$;

create or replace function public.clear_bank_transaction_classification(p_transaction_id uuid)
returns public.bank_transactions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_row public.bank_transactions;
begin
  if not public.crm_has_permission('bank.reconcile') then
    raise exception 'not_allowed:bank.reconcile';
  end if;
  update public.bank_transaction_matches set status='revoked'
   where bank_transaction_id=p_transaction_id and status='approved';
  update public.bank_transactions
     set classification_status='unclassified', classification_type=null,
         matched_entity_type=null, matched_entity_id=null, matched_at=null,
         classified_by=null, classification_note=null, updated_at=now()
   where id=p_transaction_id returning * into v_row;
  if not found then raise exception 'bank_transaction_not_found'; end if;
  return v_row;
end;
$$;

grant select on public.zoho_ar_aging_current, public.zoho_ap_aging_current to authenticated, service_role;
revoke all on function public.zoho_financial_health_summary() from public, anon;
grant execute on function public.zoho_financial_health_summary() to authenticated, service_role;
revoke all on function public.integration_health_snapshot(integer,integer,integer) from public,anon,authenticated;
grant execute on function public.integration_health_snapshot(integer,integer,integer) to service_role;
revoke all on function public.zatca_pending_today() from public, anon;
grant execute on function public.zatca_pending_today() to authenticated, service_role;
revoke all on function public.classify_bank_transaction(uuid,text,text,text,text) from public, anon;
grant execute on function public.classify_bank_transaction(uuid,text,text,text,text) to authenticated, service_role;
revoke all on function public.clear_bank_transaction_classification(uuid) from public, anon;
grant execute on function public.clear_bank_transaction_classification(uuid) to authenticated, service_role;

-- A reconciler may change only the new classification/match columns.  Upload
-- and note permissions retain their previous behaviour.
create or replace function public.enforce_bank_transaction_action_permission()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not public.crm_has_permission('bank.upload_statement') then raise exception 'not_allowed:bank.upload_statement'; end if;
    return new;
  elsif tg_op = 'DELETE' then
    if not public.crm_has_permission('bank.delete_transaction') then raise exception 'not_allowed:bank.delete_transaction'; end if;
    return old;
  end if;

  if (to_jsonb(new) - 'note' - 'updated_at') = (to_jsonb(old) - 'note' - 'updated_at') then
    if not public.app_has_any_permission(array['bank.edit_note','bank.upload_statement']) then raise exception 'not_allowed:bank.edit_note'; end if;
  elsif (to_jsonb(new) - 'classification_status' - 'classification_type' - 'matched_entity_type'
         - 'matched_entity_id' - 'matched_at' - 'classified_by' - 'classification_note'
         - 'zoho_import_status' - 'zoho_bank_account_id' - 'updated_at')
        = (to_jsonb(old) - 'classification_status' - 'classification_type' - 'matched_entity_type'
         - 'matched_entity_id' - 'matched_at' - 'classified_by' - 'classification_note'
         - 'zoho_import_status' - 'zoho_bank_account_id' - 'updated_at') then
    if not public.crm_has_permission('bank.reconcile') then raise exception 'not_allowed:bank.reconcile'; end if;
  elsif not public.crm_has_permission('bank.upload_statement') then
    raise exception 'not_allowed:bank.upload_statement';
  end if;
  return new;
end;
$$;

-- Weekly full reconciliation makes hard deletes visible in the tombstone
-- ledger.  The function already uses X-Cron-Key and an anon JWT at the gateway.
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='zoho-full-reconcile-weekly';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('zoho-full-reconcile-weekly','15 1 * * 5',$cron$
    select net.http_post(
      url := 'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/zoho-sync',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Cron-Key',(select cron_key from public.zoho_auth where id=1)),
      body := jsonb_build_object('action','sync','full',true),
      timeout_milliseconds := 300000);
  $cron$);
exception when others then
  raise notice 'weekly reconciliation schedule needs deployment review: %', sqlerrm;
end $$;
