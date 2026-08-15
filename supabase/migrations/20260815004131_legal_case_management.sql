-- Legal escalation workspace: case register + immutable action timeline.
-- Financial balances remain read-only snapshots from Zoho/Lamha; these tables
-- store workflow evidence only and never alter invoices, balances, or wallets.

create table if not exists public.legal_cases (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('overdue_90', 'negative_wallet', 'manual')),
  source_key text not null,
  customer_name text not null,
  store_id text,
  phone text,
  claim_amount numeric(14,2) not null default 0,
  stage text not null default 'review'
    check (stage in ('review', 'notice', 'filed', 'hearing', 'judgment', 'settlement', 'closed')),
  status text not null default 'open'
    check (status in ('open', 'on_hold', 'settled', 'won', 'lost', 'closed')),
  case_number text,
  authority text,
  owner_name text,
  opened_at timestamptz not null default now(),
  next_action text,
  next_action_at timestamptz,
  result text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists legal_cases_active_source_uidx
  on public.legal_cases(source_kind, source_key)
  where status in ('open', 'on_hold');
create index if not exists legal_cases_next_action_idx
  on public.legal_cases(status, next_action_at nulls last);
create index if not exists legal_cases_customer_idx
  on public.legal_cases(customer_name);

create table if not exists public.legal_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  event_type text not null
    check (event_type in ('review', 'notice', 'contact', 'filed', 'hearing', 'judgment', 'settlement', 'payment', 'document', 'note', 'status_change')),
  occurred_at timestamptz not null default now(),
  title text not null,
  details text,
  outcome text,
  next_action_at timestamptz,
  document_name text,
  document_url text,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists legal_case_events_timeline_idx
  on public.legal_case_events(case_id, occurred_at desc, created_at desc);

create or replace function public.touch_legal_case_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists legal_cases_touch_updated_at on public.legal_cases;
create trigger legal_cases_touch_updated_at
before update on public.legal_cases
for each row execute function public.touch_legal_case_updated_at();

alter table public.legal_cases enable row level security;
alter table public.legal_case_events enable row level security;

drop policy if exists legal_cases_select on public.legal_cases;
drop policy if exists legal_cases_insert on public.legal_cases;
drop policy if exists legal_cases_update on public.legal_cases;
create policy legal_cases_select on public.legal_cases
  for select to authenticated using (
    public.crm_has_permission('legal.view') or public.crm_has_permission('receivables.view')
  );
create policy legal_cases_insert on public.legal_cases
  for insert to authenticated with check (
    public.crm_has_permission('legal.manage') and created_by = auth.uid()
  );
create policy legal_cases_update on public.legal_cases
  for update to authenticated
  using (public.crm_has_permission('legal.manage'))
  with check (public.crm_has_permission('legal.manage'));

drop policy if exists legal_case_events_select on public.legal_case_events;
drop policy if exists legal_case_events_insert on public.legal_case_events;
create policy legal_case_events_select on public.legal_case_events
  for select to authenticated using (
    public.crm_has_permission('legal.view') or public.crm_has_permission('receivables.view')
  );
create policy legal_case_events_insert on public.legal_case_events
  for insert to authenticated with check (
    public.crm_has_permission('legal.manage') and created_by = auth.uid()
  );

-- No UPDATE/DELETE policy for events: the legal timeline is append-only evidence.
grant select, insert, update on public.legal_cases to authenticated;
grant select, insert on public.legal_case_events to authenticated;
revoke delete on public.legal_cases, public.legal_case_events from authenticated;
revoke update, delete on public.legal_case_events from authenticated;

drop trigger if exists ual_legal_cases on public.legal_cases;
create trigger ual_legal_cases
after insert or update on public.legal_cases
for each row execute function public.log_sensitive_change();

drop trigger if exists ual_legal_case_events on public.legal_case_events;
create trigger ual_legal_case_events
after insert on public.legal_case_events
for each row execute function public.log_sensitive_change();
