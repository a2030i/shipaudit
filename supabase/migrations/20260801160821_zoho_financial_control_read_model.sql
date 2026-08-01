-- Zoho financial control read model.
-- Read-only mirrors for bank accounts, chart of accounts and vendor credits,
-- plus explicit account mapping and API/capability telemetry.

create table if not exists public.zoho_bank_accounts (
  zoho_id text primary key,
  account_name text not null,
  account_code text,
  account_type text,
  currency_code text,
  status text,
  book_balance numeric(18, 2) not null default 0,
  bank_balance numeric(18, 2),
  bcy_balance numeric(18, 2),
  uncategorized_count integer not null default 0,
  feed_status text,
  last_refreshed_at timestamptz,
  last_modified timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create table if not exists public.zoho_chart_accounts (
  zoho_id text primary key,
  account_name text not null,
  account_code text,
  account_type text,
  account_type_formatted text,
  currency_code text,
  status text,
  current_balance numeric(18, 2),
  is_user_created boolean,
  last_modified timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create table if not exists public.zoho_vendor_credits (
  zoho_id text primary key,
  credit_number text,
  vendor_id text,
  vendor_name text,
  date date,
  total numeric(18, 2) not null default 0,
  balance numeric(18, 2) not null default 0,
  status text,
  reference_number text,
  last_modified timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists public.zoho_integration_capabilities (
  capability text primary key,
  endpoint text not null,
  required_scope text,
  status text not null default 'unknown'
    check (status in ('unknown', 'available', 'needs_reauthorization', 'unavailable', 'error')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.zoho_api_daily_usage (
  usage_date date not null default current_date,
  org_id text not null,
  api_calls integer not null default 0 check (api_calls >= 0),
  rate_limited_count integer not null default 0 check (rate_limited_count >= 0),
  configured_budget integer,
  last_call_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (usage_date, org_id)
);

create table if not exists public.zoho_financial_account_links (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('bank_account', 'chart_account')),
  zoho_account_id text not null,
  link_kind text not null check (link_kind in ('bank', 'cod_treasury', 'cash')),
  internal_bank_name text,
  carrier_id text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, zoho_account_id),
  constraint zoho_financial_link_target_check check (
    (link_kind = 'bank' and nullif(btrim(internal_bank_name), '') is not null and carrier_id is null)
    or (link_kind = 'cod_treasury' and nullif(btrim(carrier_id), '') is not null and internal_bank_name is null)
    or (link_kind = 'cash' and carrier_id is null and internal_bank_name is null)
  )
);

create index if not exists zoho_bank_accounts_synced_idx
  on public.zoho_bank_accounts (synced_at desc);
create index if not exists zoho_chart_accounts_type_idx
  on public.zoho_chart_accounts (account_type, account_name);
create index if not exists zoho_vendor_credits_open_idx
  on public.zoho_vendor_credits (vendor_id, date desc)
  where balance > 0.5;
create index if not exists zoho_financial_links_kind_idx
  on public.zoho_financial_account_links (link_kind, zoho_account_id);
create unique index if not exists zoho_financial_links_bank_unique_idx
  on public.zoho_financial_account_links (lower(btrim(internal_bank_name)))
  where link_kind = 'bank';

insert into public.zoho_integration_capabilities (capability, endpoint, required_scope, status)
values
  ('banking_read', '/books/v3/bankaccounts', 'ZohoBooks.banking.READ', 'unknown'),
  ('chart_of_accounts_read', '/books/v3/chartofaccounts', 'ZohoBooks.accountants.READ', 'unknown'),
  ('vendor_credits_read', '/books/v3/vendorcredits', 'ZohoBooks.debitnotes.READ', 'unknown')
on conflict (capability) do nothing;

alter table public.zoho_bank_accounts enable row level security;
alter table public.zoho_chart_accounts enable row level security;
alter table public.zoho_vendor_credits enable row level security;
alter table public.zoho_integration_capabilities enable row level security;
alter table public.zoho_api_daily_usage enable row level security;
alter table public.zoho_financial_account_links enable row level security;

revoke all on table public.zoho_bank_accounts from public, anon, authenticated;
revoke all on table public.zoho_chart_accounts from public, anon, authenticated;
revoke all on table public.zoho_vendor_credits from public, anon, authenticated;
revoke all on table public.zoho_integration_capabilities from public, anon, authenticated;
revoke all on table public.zoho_api_daily_usage from public, anon, authenticated;
revoke all on table public.zoho_financial_account_links from public, anon, authenticated;

grant select on table public.zoho_bank_accounts to authenticated;
grant select on table public.zoho_chart_accounts to authenticated;
grant select on table public.zoho_vendor_credits to authenticated;
grant select on table public.zoho_integration_capabilities to authenticated;
grant select on table public.zoho_api_daily_usage to authenticated;
grant select on table public.zoho_financial_account_links to authenticated;

grant all on table public.zoho_bank_accounts to service_role;
grant all on table public.zoho_chart_accounts to service_role;
grant all on table public.zoho_vendor_credits to service_role;
grant all on table public.zoho_integration_capabilities to service_role;
grant all on table public.zoho_api_daily_usage to service_role;
grant all on table public.zoho_financial_account_links to service_role;

create policy zoho_bank_accounts_read on public.zoho_bank_accounts
  for select to authenticated
  using (public.crm_has_permission('zoho.view') or public.crm_has_permission('money.pnl'));
create policy zoho_chart_accounts_read on public.zoho_chart_accounts
  for select to authenticated
  using (public.crm_has_permission('zoho.view') or public.crm_has_permission('money.pnl'));
create policy zoho_vendor_credits_read on public.zoho_vendor_credits
  for select to authenticated
  using (public.crm_has_permission('zoho.view') or public.crm_has_permission('money.pnl'));
create policy zoho_capabilities_read on public.zoho_integration_capabilities
  for select to authenticated
  using (public.crm_has_permission('zoho.view') or public.crm_has_permission('money.pnl'));
create policy zoho_api_usage_read on public.zoho_api_daily_usage
  for select to authenticated
  using (public.crm_has_permission('zoho.view') or public.crm_has_permission('money.pnl'));
create policy zoho_financial_links_read on public.zoho_financial_account_links
  for select to authenticated
  using (public.crm_has_permission('zoho.view') or public.crm_has_permission('money.pnl'));

create or replace function public.zoho_record_api_usage(
  p_org_id text,
  p_api_calls integer,
  p_rate_limited integer default 0,
  p_budget integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(p_org_id), '') is null then return; end if;
  insert into public.zoho_api_daily_usage (
    usage_date, org_id, api_calls, rate_limited_count,
    configured_budget, last_call_at, updated_at
  ) values (
    current_date, p_org_id, greatest(coalesce(p_api_calls, 0), 0),
    greatest(coalesce(p_rate_limited, 0), 0), p_budget, now(), now()
  )
  on conflict (usage_date, org_id) do update set
    api_calls = public.zoho_api_daily_usage.api_calls + excluded.api_calls,
    rate_limited_count = public.zoho_api_daily_usage.rate_limited_count + excluded.rate_limited_count,
    configured_budget = coalesce(excluded.configured_budget, public.zoho_api_daily_usage.configured_budget),
    last_call_at = excluded.last_call_at,
    updated_at = now();
end;
$$;
revoke all on function public.zoho_record_api_usage(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.zoho_record_api_usage(text, integer, integer, integer)
  to service_role;

create or replace function public.zoho_set_financial_account_link(
  p_source_type text,
  p_zoho_account_id text,
  p_link_kind text default null,
  p_internal_bank_name text default null,
  p_carrier_id text default null,
  p_notes text default null
)
returns public.zoho_financial_account_links
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.zoho_financial_account_links;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('zoho.configure') then raise exception 'not_allowed'; end if;
  if p_source_type not in ('bank_account', 'chart_account') then raise exception 'invalid_source_type'; end if;
  if nullif(btrim(p_zoho_account_id), '') is null then raise exception 'account_required'; end if;

  if p_link_kind is null then
    delete from public.zoho_financial_account_links
    where source_type = p_source_type and zoho_account_id = p_zoho_account_id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.zoho_financial_account_links (
    source_type, zoho_account_id, link_kind, internal_bank_name,
    carrier_id, notes, created_by, updated_by
  ) values (
    p_source_type, p_zoho_account_id, p_link_kind,
    nullif(btrim(p_internal_bank_name), ''), nullif(btrim(p_carrier_id), ''),
    nullif(btrim(p_notes), ''), auth.uid(), auth.uid()
  )
  on conflict (source_type, zoho_account_id) do update set
    link_kind = excluded.link_kind,
    internal_bank_name = excluded.internal_bank_name,
    carrier_id = excluded.carrier_id,
    notes = excluded.notes,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.zoho_set_financial_account_link(text, text, text, text, text, text)
  from public, anon;
grant execute on function public.zoho_set_financial_account_link(text, text, text, text, text, text)
  to authenticated, service_role;

create or replace function public.zoho_financial_control_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not (public.crm_has_permission('zoho.view') or public.crm_has_permission('money.pnl')) then
    raise exception 'not_allowed';
  end if;

  select jsonb_build_object(
    'banks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zoho_id', b.zoho_id,
        'account_name', b.account_name,
        'account_code', b.account_code,
        'account_type', b.account_type,
        'currency_code', b.currency_code,
        'book_balance', b.book_balance,
        'bank_balance', b.bank_balance,
        'feed_available', (b.feed_status is not null or b.last_refreshed_at is not null),
        'variance', case when b.feed_status is null and b.last_refreshed_at is null then null else round((b.bank_balance - b.book_balance)::numeric, 2) end,
        'uncategorized_count', b.uncategorized_count,
        'feed_status', b.feed_status,
        'last_refreshed_at', b.last_refreshed_at,
        'synced_at', b.synced_at,
        'display_kind', case
          when l.link_kind is not null then l.link_kind
          when b.account_name like 'خزينة%' then 'operating_treasury'
          else 'unclassified'
        end,
        'internal_bank_name', l.internal_bank_name,
        'internal_balance', ib.balance,
        'internal_source', ib.source,
        'internal_as_of', ib.as_of,
        'internal_vs_book', case when ib.balance is null then null else round((ib.balance - b.book_balance)::numeric, 2) end,
        'internal_vs_feed', case when ib.balance is null or b.bank_balance is null then null else round((ib.balance - b.bank_balance)::numeric, 2) end
      ) order by abs(b.book_balance) desc)
      from public.zoho_bank_accounts b
      left join public.zoho_financial_account_links l
        on l.source_type = 'bank_account' and l.zoho_account_id = b.zoho_id
      left join lateral (
        select x.balance, x.as_of, x.source
        from (
          select m.balance, m.recorded_at as as_of, 'manual'::text as source
          from public.bank_balance_log m where m.bank = l.internal_bank_name
          union all
          select s.closing_balance as balance, s.period_to::timestamptz as as_of, 'statement'::text as source
          from public.bank_statement_summaries s where s.bank = l.internal_bank_name
        ) x
        order by x.as_of desc nulls last
        limit 1
      ) ib on true
    ), '[]'::jsonb),
    'bank_summary', (
      select jsonb_build_object(
        'count', count(*),
        'linked_count', count(l.id),
        'linked_bank_count', count(*) filter (where l.link_kind = 'bank'),
        'expected_bank_count', 3,
        'operating_treasury_count', count(*) filter (where b.account_name like 'خزينة%'),
        'unclassified_count', count(*) filter (where l.id is null and b.account_name not like 'خزينة%'),
        'feed_available_count', count(*) filter (where b.feed_status is not null or b.last_refreshed_at is not null),
        'book_balance', coalesce(round(sum(b.book_balance)::numeric, 2), 0),
        'bank_balance', case when count(*) filter (where b.feed_status is not null or b.last_refreshed_at is not null) = 0 then null
          else round((sum(b.bank_balance) filter (where b.feed_status is not null or b.last_refreshed_at is not null))::numeric, 2) end,
        'variance', case when count(*) filter (where b.feed_status is not null or b.last_refreshed_at is not null) = 0 then null
          else round((sum(b.bank_balance - b.book_balance) filter (where b.feed_status is not null or b.last_refreshed_at is not null))::numeric, 2) end,
        'internal_count', count(ib.balance),
        'internal_balance', case when count(ib.balance) = 0 then null else round(sum(ib.balance)::numeric, 2) end,
        'internal_vs_book', case when count(ib.balance) = 0 then null else round(sum(ib.balance - b.book_balance)::numeric, 2) end,
        'uncategorized_count', coalesce(sum(b.uncategorized_count), 0),
        'stale_count', count(*) filter (where b.synced_at < now() - interval '2 hours')
      )
      from public.zoho_bank_accounts b
      left join public.zoho_financial_account_links l
        on l.source_type = 'bank_account' and l.zoho_account_id = b.zoho_id
      left join lateral (
        select x.balance
        from (
          select m.balance, m.recorded_at as as_of
          from public.bank_balance_log m where m.bank = l.internal_bank_name
          union all
          select s.closing_balance as balance, s.period_to::timestamptz as as_of
          from public.bank_statement_summaries s where s.bank = l.internal_bank_name
        ) x
        order by x.as_of desc nulls last
        limit 1
      ) ib on true
    ),
    'treasuries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zoho_id', a.zoho_id,
        'account_name', a.account_name,
        'current_balance', a.current_balance,
        'carrier_id', l.carrier_id,
        'synced_at', a.synced_at
      ) order by abs(coalesce(a.current_balance, 0)) desc)
      from public.zoho_financial_account_links l
      join public.zoho_chart_accounts a on a.zoho_id = l.zoho_account_id
      where l.source_type = 'chart_account' and l.link_kind = 'cod_treasury'
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.updated_at desc)
      from public.zoho_financial_account_links l
    ), '[]'::jsonb),
    'vendor_summary', (
      select jsonb_build_object(
        'vendors', count(*) filter (where contact_type = 'vendor'),
        'payable_vendors', count(*) filter (where outstanding_payable > 0.5),
        'credit_vendors', count(*) filter (where unused_credits_payable > 0.5),
        'outstanding_payable', coalesce(round(sum(outstanding_payable)::numeric, 2), 0),
        'unused_credits', coalesce(round(sum(unused_credits_payable)::numeric, 2), 0),
        'net_payable', coalesce(round(sum(outstanding_payable - unused_credits_payable)::numeric, 2), 0),
        'synced_at', max(synced_at)
      ) from public.zoho_contacts where contact_type = 'vendor'
    ),
    'vendor_positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zoho_id', v.zoho_id,
        'vendor_name', v.contact_name,
        'gross_payable', v.outstanding_payable,
        'credit_balance', v.unused_credits_payable,
        'net_payable', round((v.outstanding_payable - v.unused_credits_payable)::numeric, 2),
        'status', v.status,
        'synced_at', v.synced_at
      ) order by abs(v.outstanding_payable - v.unused_credits_payable) desc, v.outstanding_payable desc)
      from public.zoho_contacts v
      where v.contact_type = 'vendor'
        and (abs(v.outstanding_payable) > 0.01 or abs(v.unused_credits_payable) > 0.01)
    ), '[]'::jsonb),
    'bills_summary', (
      select jsonb_build_object(
        'open_count', count(*) filter (where balance > 0.5),
        'open_balance', coalesce(round((sum(balance) filter (where balance > 0.5))::numeric, 2), 0),
        'overdue_count', count(*) filter (where balance > 0.5 and due_date < current_date),
        'overdue_balance', coalesce(round((sum(balance) filter (where balance > 0.5 and due_date < current_date))::numeric, 2), 0),
        'oldest_due_date', min(due_date) filter (where balance > 0.5),
        'synced_at', max(synced_at)
      ) from public.zoho_bills
    ),
    'vendor_credits', (
      select jsonb_build_object(
        'open_count', count(*) filter (where balance > 0.5),
        'open_balance', coalesce(round((sum(balance) filter (where balance > 0.5))::numeric, 2), 0),
        'synced_at', max(synced_at)
      ) from public.zoho_vendor_credits
    ),
    'capabilities', coalesce((
      select jsonb_object_agg(capability, jsonb_build_object(
        'status', status,
        'required_scope', required_scope,
        'last_checked_at', last_checked_at,
        'last_success_at', last_success_at,
        'error_message', error_message
      )) from public.zoho_integration_capabilities
    ), '{}'::jsonb),
    'api_usage', (
      select to_jsonb(u) from public.zoho_api_daily_usage u
      where u.usage_date = current_date
      order by u.updated_at desc limit 1
    ),
    'internal_banks', coalesce((
      select jsonb_agg(x.bank order by x.bank) from (
        select distinct nullif(btrim(bank), '') as bank from public.bank_balance_log
        union
        select distinct nullif(btrim(bank), '') as bank from public.bank_statement_summaries
      ) x where x.bank is not null
    ), '[]'::jsonb),
    'carriers', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      from public.carriers
    ), '[]'::jsonb),
    'generated_at', now()
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.zoho_financial_control_dashboard() from public, anon;
grant execute on function public.zoho_financial_control_dashboard() to authenticated, service_role;

comment on table public.zoho_bank_accounts is
  'Read-only Zoho Books bank-account mirror. Never accepts bank-statement writes.';
comment on table public.zoho_financial_account_links is
  'Explicit operator-approved mapping; financial accounts are never matched by fuzzy name.';
