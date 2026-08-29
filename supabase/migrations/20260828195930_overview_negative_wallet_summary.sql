-- Read-only Command Center signal for Lamha wallets below the current -0.50
-- operational threshold. This does not infer account status and never writes
-- to Lamha; live account eligibility remains a separate preflight check.
create or replace function public.overview_merchant_pulse_lite(
  p_period text default to_char(current_date, 'YYYY-MM')
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '2000ms'
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
    where lower(btrim(coalesce(status, ''))) = 'stopped'
      and coalesce(wallet_balance, 0) > 0.5
  ),
  negative_wallet as materialized (
    select count(*)::integer count, coalesce(sum(abs(wallet_balance)), 0)::numeric amount
    from merch
    where coalesce(wallet_balance, 0) < -0.5
  ),
  balance_upload as materialized (
    select id, file_name, row_count, total_balance, uploaded_at
    from public.store_balance_snapshots
    where source = 'internal'
    order by uploaded_at desc
    limit 1
  )
  select jsonb_build_object(
    'contractVersion', 2,
    'period', v_period,
    'generatedAt', v_generated_at,
    'readPath', 'overview_merchant_pulse_lite',
    'merchantPulse', jsonb_build_object(
      'available', (select snapshot_id is not null from latest_merch),
      'snapshotAt', (select uploaded_at from latest_merch),
      'total', count(*)::integer,
      'active', count(*) filter (where public.lamha_account_enabled(status) = true)::integer,
      'inactive', count(*) filter (where public.lamha_account_enabled(status) = false)::integer,
      'newThisPeriod', count(*) filter (where to_char(created_at_platform, 'YYYY-MM') = v_period)::integer,
      'recentFiveDays', count(*) filter (
        where last_shipment_at between
          (select uploaded_at from latest_merch) - interval '5 days'
          and (select uploaded_at from latest_merch)
      )::integer,
      'neverShipped', count(*) filter (where shipment_count = 0 or last_shipment_at is null)::integer,
      'stoppedWithWallet', (select count from stopped_with_wallet),
      'stoppedWalletAmount', round((select amount from stopped_with_wallet), 2),
      'negativeWallet', (select count from negative_wallet),
      'negativeWalletAmount', round((select amount from negative_wallet), 2),
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

revoke all on function public.overview_merchant_pulse_lite(text) from public, anon;
grant execute on function public.overview_merchant_pulse_lite(text) to authenticated, service_role;

comment on function public.overview_merchant_pulse_lite(text) is
  'Lazy read-only merchant pulse for Command Center, including negative wallet count/amount; no identities or external writes.';
