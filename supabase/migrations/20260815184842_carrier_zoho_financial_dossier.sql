-- Explicit carrier ↔ Zoho vendor identity and a read model for the unified
-- carrier financial dossier. COD treasury links continue to use the existing
-- zoho_financial_account_links table so there is one source of truth.

create table if not exists public.carrier_zoho_vendor_links (
  carrier_id text primary key references public.carriers(id) on delete cascade,
  zoho_vendor_id text not null unique,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zoho_vendor_payments_vendor_date_idx
  on public.zoho_vendor_payments (vendor_id, date desc)
  where vendor_id is not null;
create index if not exists zoho_vendor_credits_vendor_date_idx
  on public.zoho_vendor_credits (vendor_id, date desc)
  where vendor_id is not null;
create index if not exists zoho_financial_links_carrier_kind_idx
  on public.zoho_financial_account_links (carrier_id, link_kind)
  where carrier_id is not null;

alter table public.carrier_zoho_vendor_links enable row level security;
revoke all on table public.carrier_zoho_vendor_links from public, anon, authenticated;
grant select on table public.carrier_zoho_vendor_links to authenticated;
grant all on table public.carrier_zoho_vendor_links to service_role;

create policy carrier_zoho_vendor_links_read
  on public.carrier_zoho_vendor_links
  for select to authenticated
  using (
    public.crm_has_permission('carriers.view')
    and public.crm_has_permission('zoho.view')
  );

create or replace function public.set_carrier_zoho_financial_links(
  p_carrier_id text,
  p_zoho_vendor_id text default null,
  p_treasury_account_id text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_vendor_id text := nullif(btrim(p_zoho_vendor_id), '');
  v_treasury_id text := nullif(btrim(p_treasury_account_id), '');
  v_conflict_carrier text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('zoho.configure') then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.carriers where id = p_carrier_id) then
    raise exception 'carrier_not_found';
  end if;

  if v_vendor_id is not null and not exists (
    select 1 from public.zoho_contacts
    where zoho_id = v_vendor_id and contact_type = 'vendor'
  ) then
    raise exception 'zoho_vendor_not_found';
  end if;

  if v_treasury_id is not null and not exists (
    select 1 from public.zoho_chart_accounts where zoho_id = v_treasury_id
  ) then
    raise exception 'zoho_treasury_not_found';
  end if;

  select carrier_id into v_conflict_carrier
  from public.zoho_financial_account_links
  where source_type = 'chart_account'
    and zoho_account_id = v_treasury_id
    and link_kind = 'cod_treasury'
    and carrier_id is distinct from p_carrier_id
  limit 1;
  if v_conflict_carrier is not null then
    raise exception 'treasury_already_linked:%', v_conflict_carrier;
  end if;

  if v_vendor_id is null then
    delete from public.carrier_zoho_vendor_links where carrier_id = p_carrier_id;
  else
    insert into public.carrier_zoho_vendor_links (
      carrier_id, zoho_vendor_id, notes, created_by, updated_by
    ) values (
      p_carrier_id, v_vendor_id, nullif(btrim(p_notes), ''), v_uid, v_uid
    )
    on conflict (carrier_id) do update set
      zoho_vendor_id = excluded.zoho_vendor_id,
      notes = excluded.notes,
      updated_by = v_uid,
      updated_at = now();
  end if;

  delete from public.zoho_financial_account_links
  where carrier_id = p_carrier_id and link_kind = 'cod_treasury'
    and (v_treasury_id is null or zoho_account_id <> v_treasury_id);

  if v_treasury_id is not null then
    insert into public.zoho_financial_account_links (
      source_type, zoho_account_id, link_kind, carrier_id,
      notes, created_by, updated_by
    ) values (
      'chart_account', v_treasury_id, 'cod_treasury', p_carrier_id,
      nullif(btrim(p_notes), ''), v_uid, v_uid
    )
    on conflict (source_type, zoho_account_id) do update set
      link_kind = 'cod_treasury',
      carrier_id = p_carrier_id,
      internal_bank_name = null,
      notes = excluded.notes,
      updated_by = v_uid,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'carrier_id', p_carrier_id,
    'zoho_vendor_id', v_vendor_id,
    'treasury_account_id', v_treasury_id,
    'updated_at', now()
  );
end;
$$;
revoke all on function public.set_carrier_zoho_financial_links(text, text, text, text)
  from public, anon;
grant execute on function public.set_carrier_zoho_financial_links(text, text, text, text)
  to authenticated, service_role;

create or replace function public.carrier_zoho_financial_dossier(p_carrier_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_vendor_id text;
  v_cod_expected numeric := 0;
  v_cod_received numeric := 0;
  v_treasury_balance numeric := 0;
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not (
    public.crm_has_permission('carriers.view')
    and public.crm_has_permission('zoho.view')
  ) then raise exception 'not_allowed'; end if;

  select zoho_vendor_id into v_vendor_id
  from public.carrier_zoho_vendor_links where carrier_id = p_carrier_id;

  select
    coalesce(sum(amount) filter (where direction = 'out'), 0),
    coalesce(sum(amount) filter (where direction = 'in'), 0)
  into v_cod_expected, v_cod_received
  from public.cod_settlement where carrier_id = p_carrier_id;

  select coalesce(sum(abs(coalesce(a.current_balance, 0))), 0)
  into v_treasury_balance
  from public.zoho_financial_account_links l
  join public.zoho_chart_accounts a on a.zoho_id = l.zoho_account_id
  where l.carrier_id = p_carrier_id and l.link_kind = 'cod_treasury';

  select jsonb_build_object(
    'carrier_id', p_carrier_id,
    'linked', v_vendor_id is not null,
    'vendor', (
      select jsonb_build_object(
        'zoho_id', c.zoho_id,
        'name', c.contact_name,
        'status', c.status,
        'gross_payable', coalesce(c.outstanding_payable, 0),
        'credits', coalesce(c.unused_credits_payable, 0),
        'net_payable', round((coalesce(c.outstanding_payable, 0) - coalesce(c.unused_credits_payable, 0))::numeric, 2),
        'synced_at', c.synced_at
      ) from public.zoho_contacts c where c.zoho_id = v_vendor_id
    ),
    'bills', jsonb_build_object(
      'count', count(*),
      'open_count', count(*) filter (where b.balance > 0.5),
      'total', coalesce(round(sum(b.total)::numeric, 2), 0),
      'open_balance', coalesce(round((sum(b.balance) filter (where b.balance > 0.5))::numeric, 2), 0),
      'overdue_count', count(*) filter (where b.balance > 0.5 and b.due_date < current_date),
      'overdue_balance', coalesce(round((sum(b.balance) filter (where b.balance > 0.5 and b.due_date < current_date))::numeric, 2), 0),
      'oldest_due_date', min(b.due_date) filter (where b.balance > 0.5)
    ),
    'payments', (
      select jsonb_build_object(
        'count', count(*),
        'total', coalesce(round(sum(p.amount)::numeric, 2), 0),
        'last_date', max(p.date),
        'last_amount', (array_agg(p.amount order by p.date desc nulls last, p.zoho_id desc))[1]
      ) from public.zoho_vendor_payments p where p.vendor_id = v_vendor_id
    ),
    'vendor_credits', (
      select jsonb_build_object(
        'count', count(*),
        'open_balance', coalesce(round((sum(vc.balance) filter (where vc.balance > 0.5))::numeric, 2), 0)
      ) from public.zoho_vendor_credits vc where vc.vendor_id = v_vendor_id
    ),
    'cod', jsonb_build_object(
      'expected', round(v_cod_expected, 2),
      'received', round(v_cod_received, 2),
      'outstanding', round(v_cod_expected - v_cod_received, 2),
      'treasury_balance', round(v_treasury_balance, 2),
      'treasury_gap', round((v_cod_expected - v_cod_received) - v_treasury_balance, 2)
    ),
    'treasuries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zoho_id', a.zoho_id,
        'name', a.account_name,
        'code', a.account_code,
        'balance', a.current_balance,
        'currency', a.currency_code,
        'synced_at', a.synced_at
      ) order by a.account_name)
      from public.zoho_financial_account_links l
      join public.zoho_chart_accounts a on a.zoho_id = l.zoho_account_id
      where l.carrier_id = p_carrier_id and l.link_kind = 'cod_treasury'
    ), '[]'::jsonb),
    'recent_activity', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.activity_date desc nulls last, x.id desc)
      from (
        select 'bill'::text kind, b.zoho_id id, b.date activity_date,
          b.bill_number reference, b.total amount, b.balance balance, b.status
        from public.zoho_bills b where b.vendor_id = v_vendor_id
        union all
        select 'payment', p.zoho_id, p.date, p.reference_number,
          p.amount, 0::numeric, coalesce(p.mode, 'paid')
        from public.zoho_vendor_payments p where p.vendor_id = v_vendor_id
        union all
        select 'credit', vc.zoho_id, vc.date, vc.credit_number,
          vc.total, vc.balance, vc.status
        from public.zoho_vendor_credits vc where vc.vendor_id = v_vendor_id
        order by activity_date desc nulls last, id desc
        limit 30
      ) x
    ), '[]'::jsonb),
    'generated_at', now()
  ) into v_out
  from public.zoho_bills b
  where b.vendor_id = v_vendor_id;

  return v_out;
end;
$$;
revoke all on function public.carrier_zoho_financial_dossier(text) from public, anon;
grant execute on function public.carrier_zoho_financial_dossier(text) to authenticated, service_role;

comment on table public.carrier_zoho_vendor_links is
  'Explicit identity link between a ShipAudit carrier and one Zoho Books vendor contact.';
comment on function public.carrier_zoho_financial_dossier(text) is
  'Unified read model: Zoho vendor position, bills, payments, credits, COD and linked treasury balances.';
