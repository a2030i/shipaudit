-- Lazy, read-only sections for the production overview_core_lite cutover.
-- They intentionally return summaries only. No customer/store lists, bank
-- histories, external calls, writes, or new financial calculations live here.

create or replace function public.overview_merchant_pulse_lite(
  p_period text default to_char(current_date, 'YYYY-MM')
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
set statement_timeout to '2000ms'
as $function$
declare
  v_period text := coalesce(nullif(btrim(p_period), ''), to_char(current_date, 'YYYY-MM'));
  v_generated_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if auth.uid() is null or not public.crm_has_permission('overview.view') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_period';
  end if;

  with
  latest_merch as materialized (
    select snapshot_id, uploaded_at
    from public.merchants
    order by uploaded_at desc
    limit 1
  ),
  merch as materialized (
    select m.*
    from public.merchants m
    where m.snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as materialized (
    select customer_name, store_id
    from public.customer_merchant_links
    where store_id is not null
  ),
  last_pay as materialized (
    select customer_name, max(date) last_date
    from public.zoho_payments
    where customer_name is not null
    group by customer_name
  ),
  -- This reproduces the existing dashboard metric only. The name fallback is
  -- not exposed as identity and is never used for a write or financial link.
  paid_customers as materialized (
    select distinct on (a.contact_name)
      a.contact_name, a.zoho_id, lp.last_date, m.store_id
    from public.customer_ar a
    left join last_pay lp on lp.customer_name = a.contact_name
    left join links l on l.customer_name = a.contact_name
    left join merch m on m.store_id = l.store_id
      or (l.store_id is null
        and public.normalize_arabic_name(m.store_name) = public.normalize_arabic_name(a.contact_name))
    where a.collectible_due > 0.5
    order by a.contact_name, (l.store_id is not null) desc
  ),
  stopped_with_wallet as materialized (
    select count(*)::integer count, coalesce(sum(wallet_balance), 0)::numeric amount
    from merch
    where replace(lower(coalesce(status, '')), ' ', '') not in ('نشط', 'active', 'مفعل')
      and coalesce(wallet_balance, 0) > 0.5
  ),
  balance_upload as materialized (
    select id, file_name, row_count, total_balance, uploaded_at
    from public.store_balance_snapshots
    where source = 'internal'
    order by uploaded_at desc
    limit 1
  )
  select jsonb_build_object(
    'contractVersion', 1,
    'period', v_period,
    'generatedAt', v_generated_at,
    'readPath', 'overview_merchant_pulse_lite',
    'merchantPulse', jsonb_build_object(
      'available', (select snapshot_id is not null from latest_merch),
      'snapshotAt', (select uploaded_at from latest_merch),
      'total', count(*)::integer,
      'active', count(*) filter (
        where replace(lower(coalesce(status, '')), ' ', '') in ('نشط', 'active', 'مفعل')
      )::integer,
      'inactive', count(*) filter (
        where replace(lower(coalesce(status, '')), ' ', '') not in ('نشط', 'active', 'مفعل')
      )::integer,
      'newThisPeriod', count(*) filter (
        where to_char(created_at_platform, 'YYYY-MM') = v_period
      )::integer,
      'recentFiveDays', count(*) filter (
        where last_shipment_at between
          (select uploaded_at from latest_merch) - interval '5 days'
          and (select uploaded_at from latest_merch)
      )::integer,
      'neverShipped', count(*) filter (
        where shipment_count = 0 or last_shipment_at is null
      )::integer,
      'stoppedWithWallet', (select count from stopped_with_wallet),
      'stoppedWalletAmount', round((select amount from stopped_with_wallet), 2),
      'paidThisPeriod', (
        select count(distinct coalesce(store_id, zoho_id, contact_name))::integer
        from paid_customers
        where to_char(last_date, 'YYYY-MM') = v_period
      )
    ),
    'lamhaUploads', jsonb_build_object(
      'merchants', jsonb_build_object(
        'uploadedAt', (select uploaded_at from latest_merch),
        'rowCount', count(*)::integer,
        'available', (select snapshot_id is not null from latest_merch)
      ),
      'balance', jsonb_build_object(
        'uploadedAt', (select uploaded_at from balance_upload),
        'fileName', (select file_name from balance_upload),
        'rowCount', (select row_count from balance_upload),
        'available', exists(select 1 from balance_upload)
      )
    ),
    'source', jsonb_build_object(
      'status', case
        when not exists(select 1 from latest_merch) then 'empty'
        when v_generated_at - (select uploaded_at from latest_merch) > interval '24 hours' then 'stale'
        else 'fresh'
      end,
      'dataAsOf', (select uploaded_at from latest_merch),
      'lastSuccessfulSyncAt', (select uploaded_at from latest_merch)
    )
  ) into v_result
  from merch;

  return v_result;
end;
$function$;

comment on function public.overview_merchant_pulse_lite(text) is
  'Lazy local summary for the overview merchant movement section; no detail rows or external calls.';

revoke all on function public.overview_merchant_pulse_lite(text) from public, anon;
grant execute on function public.overview_merchant_pulse_lite(text) to authenticated, service_role;


create or replace function public.overview_cash_lite()
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
set statement_timeout to '2000ms'
as $function$
declare
  v_generated_at timestamptz := clock_timestamp();
  v_total_ap numeric := 0;
  v_result jsonb;
begin
  if auth.uid() is null or not public.crm_has_permission('overview.view') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- Preserve the existing AP source exactly; only its already-computed total
  -- is returned. Heavy carrier/customer detail arrays remain outside overview.
  select coalesce(w.total_ap, 0)
  into v_total_ap
  from public.working_capital_now() w
  limit 1;

  with
  manual as materialized (
    select distinct on (coalesce(nullif(btrim(bank), ''), 'بنك الإنماء'))
      coalesce(nullif(btrim(bank), ''), 'بنك الإنماء') bank,
      balance, recorded_at as as_of, 'manual'::text source
    from public.bank_balance_log
    order by coalesce(nullif(btrim(bank), ''), 'بنك الإنماء'), recorded_at desc
  ),
  statement as materialized (
    select distinct on (coalesce(nullif(btrim(bank), ''), 'بنك الإنماء'))
      coalesce(nullif(btrim(bank), ''), 'بنك الإنماء') bank,
      closing_balance balance, period_to::timestamptz as as_of, 'statement'::text source
    from public.bank_statement_summaries
    order by coalesce(nullif(btrim(bank), ''), 'بنك الإنماء'), period_to desc
  ),
  chosen as materialized (
    select
      coalesce(m.bank, s.bank) bank,
      case
        when s.bank is null then m.balance
        when m.bank is null then s.balance
        when m.as_of > s.as_of then m.balance
        else s.balance
      end balance,
      case
        when s.bank is null then m.as_of
        when m.bank is null then s.as_of
        when m.as_of > s.as_of then m.as_of
        else s.as_of
      end as_of,
      case
        when s.bank is null then m.source
        when m.bank is null then s.source
        when m.as_of > s.as_of then m.source
        else s.source
      end source
    from manual m
    full join statement s using (bank)
  ),
  summary as materialized (
    select
      count(*)::integer expected_count,
      count(*) filter (where balance is null)::integer missing_count,
      round(coalesce(sum(balance), 0)::numeric, 2) known_balance,
      max(as_of) as_of,
      case when count(distinct source) = 1 then min(source) else 'mixed' end source,
      coalesce(jsonb_agg(bank order by bank) filter (where balance is null), '[]'::jsonb) missing_banks
    from chosen
  )
  select jsonb_build_object(
    'contractVersion', 1,
    'generatedAt', v_generated_at,
    'readPath', 'overview_cash_lite',
    'cashPosition', jsonb_build_object(
      'bankBalance', case when expected_count = 0 or missing_count > 0 then null else known_balance end,
      'bankKnownBalance', known_balance,
      'bankBalanceComplete', expected_count > 0 and missing_count = 0,
      'bankExpectedCount', expected_count,
      'bankMissingAccounts', missing_banks,
      'bankUpdated', as_of,
      'bankSource', source,
      'bankNotes', case
        when expected_count = 0 then 'لا يوجد رصيد بنكي موثق'
        when missing_count > 0 then 'الرصيد غير مكتمل'
        when expected_count = 1 then 'إجمالي بنك مسجّل واحد'
        else 'إجمالي ' || expected_count || ' بنوك مسجّلة'
      end,
      'totalAP', round(v_total_ap::numeric, 2)
    ),
    'source', jsonb_build_object(
      'status', case
        when expected_count = 0 or missing_count > 0 then 'unavailable'
        else 'fresh'
      end,
      'dataAsOf', as_of,
      'lastSuccessfulSyncAt', as_of
    )
  ) into v_result
  from summary;

  return v_result;
end;
$function$;

comment on function public.overview_cash_lite() is
  'Lazy local bank/AP summary for overview; no histories, account rows or external calls.';

revoke all on function public.overview_cash_lite() from public, anon;
grant execute on function public.overview_cash_lite() to authenticated, service_role;
