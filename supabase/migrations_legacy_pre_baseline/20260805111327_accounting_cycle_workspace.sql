-- مركز دورة تشغيل المحاسب الشهرية.
-- الحالة لا تُحفظ كقائمة تحقق يدوية؛ تُشتق من السجلات التشغيلية، بينما
-- يحفظ هذا المخطط فقط ملفات لمحة الجديدة وسجل نتيجة كل فعل وإقفال الشهر.

create table if not exists public.accounting_cycles (
  period date primary key,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  close_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period = date_trunc('month', period)::date)
);

create table if not exists public.accounting_cycle_events (
  id bigint generated always as identity primary key,
  period date not null,
  stage text not null check (stage in (
    'carrier_audits', 'weight_export', 'lamha_shipments',
    'lamha_sources', 'carrier_collections', 'lamha_collections', 'period_close'
  )),
  event_type text not null,
  status text not null default 'success' check (status in ('success', 'warning', 'error')),
  source_kind text,
  file_name text,
  row_count integer,
  total numeric(18,2),
  result jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period = date_trunc('month', period)::date)
);

create index if not exists accounting_cycle_events_period_stage_idx
  on public.accounting_cycle_events (period, stage, created_at desc);

create table if not exists public.lamha_shipment_imports (
  id uuid primary key default gen_random_uuid(),
  period date not null,
  source_hash text not null unique,
  file_name text not null,
  row_count integer not null default 0,
  duplicate_count integer not null default 0,
  outside_period_count integer not null default 0,
  min_order_date date,
  max_order_date date,
  order_total numeric(18,2) not null default 0,
  shipping_cost_total numeric(18,2) not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  check (period = date_trunc('month', period)::date)
);

create index if not exists lamha_shipment_imports_period_uploaded_idx
  on public.lamha_shipment_imports (period, uploaded_at desc);

create table if not exists public.lamha_shipments (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.lamha_shipment_imports(id) on delete cascade,
  period date not null,
  order_no text,
  store_name text,
  order_date timestamptz,
  order_amount numeric(18,2),
  payment_method text,
  order_status text,
  city text,
  carrier_name text,
  customer_phone text,
  customer_name text,
  awb text,
  pickup_at timestamptz,
  delivered_at timestamptz,
  shipping_cost numeric(18,2),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (period = date_trunc('month', period)::date)
);

create index if not exists lamha_shipments_import_idx on public.lamha_shipments (import_id);
create index if not exists lamha_shipments_period_awb_idx on public.lamha_shipments (period, awb);
create index if not exists lamha_shipments_period_store_idx on public.lamha_shipments (period, store_name);
create index if not exists lamha_shipments_period_carrier_idx on public.lamha_shipments (period, carrier_name);

alter table public.accounting_cycles enable row level security;
alter table public.accounting_cycle_events enable row level security;
alter table public.lamha_shipment_imports enable row level security;
alter table public.lamha_shipments enable row level security;

drop policy if exists accounting_cycles_select on public.accounting_cycles;
drop policy if exists accounting_cycles_insert on public.accounting_cycles;
drop policy if exists accounting_cycles_update on public.accounting_cycles;
create policy accounting_cycles_select on public.accounting_cycles
  for select to authenticated
  using (public.app_has_any_permission(array[
    'audits.view','internal_exports.view','uploads.view','cod.view','system.period_close'
  ]));
create policy accounting_cycles_insert on public.accounting_cycles
  for insert to authenticated
  with check (public.app_has_any_permission(array['system.period_close']));
create policy accounting_cycles_update on public.accounting_cycles
  for update to authenticated
  using (public.app_has_any_permission(array['system.period_close']))
  with check (public.app_has_any_permission(array['system.period_close']));

drop policy if exists accounting_cycle_events_select on public.accounting_cycle_events;
drop policy if exists accounting_cycle_events_insert on public.accounting_cycle_events;
create policy accounting_cycle_events_select on public.accounting_cycle_events
  for select to authenticated
  using (public.app_has_any_permission(array[
    'audits.view','internal_exports.view','uploads.view','cod.view'
  ]));
create policy accounting_cycle_events_insert on public.accounting_cycle_events
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.app_has_any_permission(array[
      'audits.create','internal_exports.pull','uploads.upload_file','cod.upload_in','cod.upload_out','system.period_close'
    ])
  );

drop policy if exists lamha_shipment_imports_select on public.lamha_shipment_imports;
drop policy if exists lamha_shipment_imports_insert on public.lamha_shipment_imports;
drop policy if exists lamha_shipment_imports_recent_cleanup on public.lamha_shipment_imports;
create policy lamha_shipment_imports_select on public.lamha_shipment_imports
  for select to authenticated
  using (public.app_has_any_permission(array['uploads.view','uploads.upload_file']));
create policy lamha_shipment_imports_insert on public.lamha_shipment_imports
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.app_has_any_permission(array['uploads.upload_file'])
  );
create policy lamha_shipment_imports_recent_cleanup on public.lamha_shipment_imports
  for delete to authenticated
  using (
    uploaded_by = auth.uid()
    and uploaded_at > now() - interval '10 minutes'
    and public.app_has_any_permission(array['uploads.upload_file'])
  );

drop policy if exists lamha_shipments_select on public.lamha_shipments;
drop policy if exists lamha_shipments_insert on public.lamha_shipments;
create policy lamha_shipments_select on public.lamha_shipments
  for select to authenticated
  using (public.app_has_any_permission(array['uploads.view','uploads.upload_file']));
create policy lamha_shipments_insert on public.lamha_shipments
  for insert to authenticated
  with check (public.app_has_any_permission(array['uploads.upload_file']));

revoke all on table public.accounting_cycles from anon;
revoke all on table public.accounting_cycle_events from anon;
revoke all on table public.lamha_shipment_imports from anon;
revoke all on table public.lamha_shipments from anon;
grant select, insert, update on table public.accounting_cycles to authenticated;
grant select, insert on table public.accounting_cycle_events to authenticated;
grant select, insert, delete on table public.lamha_shipment_imports to authenticated;
grant select, insert on table public.lamha_shipments to authenticated;
grant usage, select on sequence public.accounting_cycle_events_id_seq to authenticated;
grant usage, select on sequence public.lamha_shipments_id_seq to authenticated;
