-- Additive, read-only first-screen projection for the operational home page.
-- It deliberately excludes customer/store lists, accounting-cycle histories,
-- carrier detail, charts and any other drill-down payload.

create or replace function public.overview_core_lite(
  p_period text default to_char(current_date, 'YYYY-MM')
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '3000ms'
as $function$
declare
  v_period text := coalesce(nullif(btrim(p_period), ''), to_char(current_date, 'YYYY-MM'));
  v_period_date date;
  v_period_end date;
  v_period_label text;
  v_generated_at timestamptz := clock_timestamp();
  v_financial jsonb := '{}'::jsonb;
  v_actions jsonb := '{}'::jsonb;
  v_merchants jsonb := '{}'::jsonb;
  v_vat jsonb := null;
  v_invoice_ops jsonb := null;
  v_zatca jsonb := null;
  v_zoho_sync jsonb := null;
  v_balance_source jsonb := null;
  v_source_times jsonb := '{}'::jsonb;
  v_sources jsonb := '{}'::jsonb;
  v_close jsonb := '{}'::jsonb;
  v_has_weight_storage boolean := false;
  v_audits_complete boolean := false;
  v_weights_complete boolean := false;
  v_shipments_complete boolean := false;
  v_lamha_sources_complete boolean := false;
  v_carrier_collections_complete boolean := false;
  v_lamha_collections_complete boolean := false;
  v_close_ready boolean := false;
  v_close_completed integer := 0;
  v_first_blocker jsonb := null;
  v_finance_as_of timestamptz;
  v_merchants_as_of timestamptz;
  v_vat_as_of timestamptz;
  v_cycle_as_of timestamptz;
  v_finance_status text := 'empty';
  v_merchants_status text := 'empty';
  v_vat_status text := 'empty';
begin
  if auth.uid() is null or not public.crm_has_permission('overview.view') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_period';
  end if;

  v_period_date := (v_period || '-01')::date;
  v_period_end := (v_period_date + interval '1 month')::date;
  v_period_label := (array['يناير','فبراير','مارس','أبريل','مايو','يونيو',
    'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'])[extract(month from v_period_date)::int]
    || ' ' || extract(year from v_period_date)::int::text;

  -- Same financial sources and bucket boundaries as customer_money_dashboard.
  -- The customer rows and invoice details are intentionally not materialized.
  with
  latest_merch as materialized (
    select snapshot_id, uploaded_at
    from public.merchants
    order by uploaded_at desc
    limit 1
  ),
  merch as materialized (
    select m.store_id, m.store_name, public.normalize_arabic_name(m.store_name) norm,
           m.billing_type, m.status platform_status, m.wallet_balance
    from public.merchants m
    where m.snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as materialized (
    select customer_name, store_id
    from public.customer_merchant_links
    where store_id is not null
  ),
  lines as materialized (
    select l.contact_name,
      count(*) filter (where l.line_kind='invoice' and l.collectible_amount>0.5)::integer inv_cnt,
      coalesce(sum(l.collectible_amount) filter (where l.age_days between 0 and 15),0) b0_15,
      coalesce(sum(l.collectible_amount) filter (where l.age_days between 16 and 30),0) b16_30,
      coalesce(sum(l.collectible_amount) filter (where l.age_days between 31 and 60),0) b31_60,
      coalesce(sum(l.collectible_amount) filter (where l.age_days between 61 and 90),0) b61_90,
      coalesce(sum(l.collectible_amount) filter (where l.age_days > 90),0) b90p,
      coalesce(sum(l.collectible_amount) filter (where l.line_kind='opening_balance'),0) opening_balance
    from public.customer_collectible_lines l
    where l.collectible_amount > 0.005
    group by l.contact_name
  ),
  cust as materialized (
    select a.contact_name, a.zoho_id, a.collectible_due owed,
      coalesce(l.inv_cnt,0) inv_cnt,
      coalesce(l.b0_15,0) b0_15, coalesce(l.b16_30,0) b16_30,
      coalesce(l.b31_60,0) b31_60, coalesce(l.b61_90,0) b61_90,
      coalesce(l.b90p,0) b90p, coalesce(l.opening_balance,0) opening_balance
    from public.customer_ar a
    left join lines l on l.contact_name=a.contact_name
    where a.collectible_due > 0.5
  ),
  cust_full as materialized (
    select distinct on (c.contact_name)
      c.*, m.store_id, m.billing_type, m.platform_status, m.wallet_balance
    from cust c
    left join links l on l.customer_name=c.contact_name
    left join merch m on m.store_id=l.store_id
      or (l.store_id is null and m.norm=public.normalize_arabic_name(c.contact_name))
    order by c.contact_name, (l.store_id is not null) desc
  ),
  financial as materialized (
    select
      round(greatest(coalesce(sum(owed),0)-coalesce(sum(opening_balance),0),0)::numeric,2) collectible_due,
      round(coalesce(sum(b31_60+b61_90+greatest(b90p-opening_balance,0)),0)::numeric,2) overdue,
      round(coalesce(sum(b0_15),0)::numeric,2) b0_15,
      round(coalesce(sum(b16_30),0)::numeric,2) b16_30,
      round(coalesce(sum(b31_60),0)::numeric,2) b31_60,
      round(coalesce(sum(b61_90),0)::numeric,2) b61_90,
      round(coalesce(sum(greatest(b90p-opening_balance,0)),0)::numeric,2) b90p,
      round(coalesce(sum(opening_balance),0)::numeric,2) opening_excluded,
      count(*)::integer customer_count
    from cust
  ),
  customer_actions as materialized (
    select
      count(*) filter (
        where replace(lower(coalesce(billing_type,'')),' ','') in ('دفعلاحق','postpaid')
          and replace(lower(coalesce(platform_status,'')),' ','') in ('نشط','active','مفعل')
          and b31_60+b61_90+b90p > 0.5 and inv_cnt > 0
      )::integer stop_count,
      round(coalesce(sum(b31_60+b61_90+b90p) filter (
        where replace(lower(coalesce(billing_type,'')),' ','') in ('دفعلاحق','postpaid')
          and replace(lower(coalesce(platform_status,'')),' ','') in ('نشط','active','مفعل')
          and b31_60+b61_90+b90p > 0.5 and inv_cnt > 0
      ),0)::numeric,2) stop_amount,
      count(*) filter (
        where replace(lower(coalesce(billing_type,'')),' ','') in ('دفعمسبق','prepaid')
          and coalesce(wallet_balance,0)>0.5 and owed>0.5 and inv_cnt>0
      )::integer deduct_count,
      round(coalesce(sum(least(coalesce(wallet_balance,0),owed)) filter (
        where replace(lower(coalesce(billing_type,'')),' ','') in ('دفعمسبق','prepaid')
          and coalesce(wallet_balance,0)>0.5 and owed>0.5 and inv_cnt>0
      ),0)::numeric,2) deduct_amount,
      count(distinct store_id) filter (
        where store_id is not null
          and replace(lower(coalesce(billing_type,'')),' ','') in ('دفعلاحق','postpaid')
          and replace(lower(coalesce(platform_status,'')),' ','') in ('غيرنشط','inactive','موقوف','متوقف')
          and b31_60+b61_90+b90p <= 0.5
      )::integer activate_linked_count
    from cust_full
  ),
  activate_unlinked as materialized (
    select count(*)::integer count
    from merch m
    where m.store_id is not null
      and replace(lower(coalesce(m.billing_type,'')),' ','') in ('دفعلاحق','postpaid')
      and replace(lower(coalesce(m.platform_status,'')),' ','') in ('غيرنشط','inactive','موقوف','متوقف')
      and not exists (select 1 from cust_full c where c.store_id=m.store_id)
  ),
  merchant_summary as materialized (
    select
      count(*)::integer row_count,
      count(*) filter (where replace(lower(coalesce(platform_status,'')),' ','') in ('نشط','active','مفعل'))::integer active_count,
      count(*) filter (where replace(lower(coalesce(platform_status,'')),' ','') not in ('نشط','active','مفعل'))::integer inactive_count
    from merch
  )
  select
    jsonb_build_object(
      'collectibleDue',f.collectible_due,
      'overdue',f.overdue,
      'customerCount',f.customer_count,
      'aging',jsonb_build_object(
        'b0_15',f.b0_15,'b16_30',f.b16_30,'b31_60',f.b31_60,
        'b61_90',f.b61_90,'b90p',f.b90p,
        'openingBalanceExcluded',f.opening_excluded,
        'total',round((f.b0_15+f.b16_30+f.b31_60+f.b61_90+f.b90p)::numeric,2)
      )
    ),
    jsonb_build_object(
      'stopPostpaid',jsonb_build_object('count',a.stop_count,'amount',a.stop_amount),
      'deductPrepaid',jsonb_build_object('count',a.deduct_count,'amount',a.deduct_amount),
      'activatePostpaid',jsonb_build_object('count',a.activate_linked_count+u.count)
    ),
    jsonb_build_object(
      'rowCount',m.row_count,'activeCount',m.active_count,'inactiveCount',m.inactive_count,
      'snapshotAt',(select uploaded_at from latest_merch)
    )
  into v_financial, v_actions, v_merchants
  from financial f cross join customer_actions a cross join activate_unlinked u cross join merchant_summary m;

  begin
    select to_jsonb(v) into v_vat from public.vat_current_quarter() v limit 1;
  exception when others then
    v_vat := null;
  end;
  begin
    v_invoice_ops := public.zoho_invoice_dashboard()::jsonb;
  exception when others then
    v_invoice_ops := null;
  end;
  begin
    v_zatca := public.zatca_pending_today();
  exception when others then
    v_zatca := null;
  end;

  select to_jsonb(s), s.last_sync
  into v_zoho_sync, v_finance_as_of
  from public.zoho_sync_state s
  where s.entity='invoices'
  limit 1;
  select max(m.uploaded_at) into v_merchants_as_of from public.merchants m;
  v_vat_as_of := nullif(v_vat->>'fetched_at','')::timestamptz;
  select greatest(
    coalesce((select max(a.created_at) from public.audits a where a.period in (v_period,v_period_label)),'-infinity'::timestamptz),
    coalesce((select max(e.created_at) from public.accounting_cycle_events e where e.period=v_period_date),'-infinity'::timestamptz),
    coalesce((select max(i.uploaded_at) from public.lamha_shipment_imports i where i.period=v_period_date),'-infinity'::timestamptz)
  ) into v_cycle_as_of;
  if v_cycle_as_of='-infinity'::timestamptz then v_cycle_as_of:=null; end if;

  if v_zoho_sync is null then
    v_finance_status := 'empty';
  elsif coalesce(v_zoho_sync->>'last_status','')='error' or nullif(v_zoho_sync->>'last_error','') is not null then
    v_finance_status := 'unavailable';
  elsif v_finance_as_of is null or v_generated_at-v_finance_as_of>interval '45 minutes' then
    v_finance_status := 'stale';
  else v_finance_status := 'fresh'; end if;
  if coalesce((v_merchants->>'rowCount')::integer,0)=0 then v_merchants_status:='empty';
  elsif v_merchants_as_of is null or v_generated_at-v_merchants_as_of>interval '24 hours' then v_merchants_status:='stale';
  else v_merchants_status:='fresh'; end if;
  if v_vat is null then v_vat_status:='unavailable';
  elsif v_vat_as_of is null or v_generated_at-v_vat_as_of>interval '90 minutes' then v_vat_status:='stale';
  else v_vat_status:='fresh'; end if;

  -- Compact close-readiness projection. It reads counts/existence only; no
  -- accounting-cycle histories, shipment lists or carrier rows are returned.
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='weight_billing_exports' and column_name='storage_bucket'
  ) into v_has_weight_storage;

  with audit_stats as (
    select
      count(*)::integer total,
      count(*) filter (where review_status='approved')::integer approved,
      count(*) filter (where review_status='pending')::integer pending,
      count(*) filter (where review_status='approved' and not (
        coalesce((col_map->'__control'->>'version')::numeric,0)>=3
        and coalesce((col_map->'__control'->>'valid')::boolean,false)
        and nullif(col_map->'__control'->>'sourceHash','') is not null
        and nullif(col_map->'__control'->>'sourcePath','') is not null
        and nullif(file_name,'') is not null and nullif(contract_label,'') is not null
      ))::integer legacy,
      count(*) filter (where review_status='approved' and
        coalesce((col_map->'__control'->>'version')::numeric,0)>=3
        and coalesce((col_map->'__control'->>'valid')::boolean,false)
        and nullif(col_map->'__control'->>'sourceHash','') is not null
        and nullif(col_map->'__control'->>'sourcePath','') is not null
        and nullif(file_name,'') is not null and nullif(contract_label,'') is not null
      )::integer verified,
      count(*) filter (where review_status='approved' and weight_billing_status='pending')::integer weight_pending
    from public.audits where period in (v_period,v_period_label)
  ),
  invoice_required as (
    select exists (
      select 1 from public.carriers c
      where coalesce(c.file_signature->>'file_kind','') <> 'cod_only'
        and (
          exists (select 1 from public.carrier_task_schedules s where s.carrier_id=c.id and s.active and s.task_kind='invoice')
          or exists (select 1 from public.audits a where a.carrier_id=c.id and a.period in (v_period,v_period_label))
          or exists (
            select 1 from jsonb_array_elements(coalesce(c.contracts,'[]'::jsonb)) x
            where coalesce(nullif(x->>'startDate','')::date,v_period_date) < v_period_end
              and coalesce(nullif(x->>'endDate','')::date,v_period_end) >= v_period_date
          )
        )
    ) value
  ),
  verified_ids as (
    select a.id from public.audits a
    where a.period in (v_period,v_period_label) and a.review_status='approved'
      and coalesce((a.col_map->'__control'->>'version')::numeric,0)>=3
      and coalesce((a.col_map->'__control'->>'valid')::boolean,false)
      and nullif(a.col_map->'__control'->>'sourceHash','') is not null
      and nullif(a.col_map->'__control'->>'sourcePath','') is not null
      and nullif(a.file_name,'') is not null and nullif(a.contract_label,'') is not null
  ),
  shipment_coverage as (
    select
      count(distinct s.awb) filter (where s.awb is not null and not s.is_cod and s.weight_kg>0)::integer expected,
      count(distinct s.awb) filter (where s.awb is not null and not s.is_cod and s.weight_kg>0
        and exists (select 1 from public.lamha_shipments l where l.period=v_period_date and l.awb=s.awb))::integer imported
    from public.audit_shipments s where s.audit_id in (select id from verified_ids)
  ),
  source_presence as (
    select
      (exists (select 1 from public.accounting_cycle_events e where e.period=v_period_date and e.stage='lamha_sources' and e.source_kind='internal_settlement' and e.status='success')
       or exists (select 1 from public.store_balance_snapshots b where b.source='internal' and b.uploaded_at>=v_period_date and b.uploaded_at<v_period_end)) balance_ok,
      (exists (select 1 from public.accounting_cycle_events e where e.period=v_period_date and e.stage='lamha_sources' and e.source_kind='merchants' and e.status='success')
       or exists (select 1 from public.merchants m where m.uploaded_at>=v_period_date and m.uploaded_at<v_period_end)) merchants_ok,
      (exists (select 1 from public.accounting_cycle_events e where e.period=v_period_date and e.stage='lamha_collections' and e.status='success')
       or exists (select 1 from public.cod_settlement c where c.direction='out' and
         ((c.upload_date>=v_period_date and c.upload_date<v_period_end) or (c.schedule_slot>=v_period_date and c.schedule_slot<v_period_end)))) lamha_collection_ok,
      (exists (select 1 from public.carrier_task_schedules s where s.active)
       or exists (select 1 from public.audits a where a.period in (v_period,v_period_label))
       or exists (select 1 from public.accounting_cycle_events e where e.period=v_period_date and e.stage='carrier_collections' and e.status in ('success','warning'))
       or exists (select 1 from public.cod_settlement c where c.direction='in' and
         ((c.upload_date>=v_period_date and c.upload_date<v_period_end) or (c.schedule_slot>=v_period_date and c.schedule_slot<v_period_end)))) carrier_collection_ok
  )
  select
    (case when not i.value then true else s.verified>0 and s.pending=0 and s.legacy=0 end),
    (case when not i.value then true else s.approved>0 and s.weight_pending=0 and s.legacy=0 end),
    (case when not i.value then true when c.expected=0 then s.verified>0 else c.expected=c.imported end),
    p.balance_ok and p.merchants_ok,
    p.carrier_collection_ok,
    p.lamha_collection_ok
  into v_audits_complete,v_weights_complete,v_shipments_complete,
       v_lamha_sources_complete,v_carrier_collections_complete,v_lamha_collections_complete
  from audit_stats s cross join invoice_required i cross join shipment_coverage c cross join source_presence p;

  if not v_has_weight_storage then
    v_weights_complete:=false;
    v_first_blocker:=jsonb_build_object('source','ملفات الأوزان','reason','column weight_billing_exports.storage_bucket does not exist');
  elsif not v_audits_complete then
    v_first_blocker:=jsonb_build_object('source','مراجعات فواتير الناقلين','reason','المرحلة غير مكتملة للفترة المحددة.');
  elsif not v_weights_complete then
    v_first_blocker:=jsonb_build_object('source','تصدير الأوزان','reason','المرحلة غير مكتملة للفترة المحددة.');
  elsif not v_shipments_complete then
    v_first_blocker:=jsonb_build_object('source','شحنات لمحة','reason','المرحلة غير مكتملة للفترة المحددة.');
  elsif not v_lamha_sources_complete then
    v_first_blocker:=jsonb_build_object('source','مصادر لمحة','reason','المرحلة غير مكتملة للفترة المحددة.');
  elsif not v_carrier_collections_complete then
    v_first_blocker:=jsonb_build_object('source','تحصيلات شركات الشحن','reason','المرحلة غير مكتملة للفترة المحددة.');
  elsif not v_lamha_collections_complete then
    v_first_blocker:=jsonb_build_object('source','تحصيل لمحة','reason','المرحلة غير مكتملة للفترة المحددة.');
  end if;
  v_close_completed := v_audits_complete::integer+v_weights_complete::integer+v_shipments_complete::integer
    +v_lamha_sources_complete::integer+v_carrier_collections_complete::integer+v_lamha_collections_complete::integer;
  v_close_ready := v_close_completed=6 and v_has_weight_storage;
  v_close := jsonb_build_object(
    'ready',v_close_ready,'completed',v_close_completed,'required',6,'checkedAt',v_generated_at,
    'blockers',case when v_first_blocker is null then '[]'::jsonb else jsonb_build_array(v_first_blocker) end
  );

  v_sources := jsonb_build_object(
    'finance',jsonb_build_object('status',v_finance_status,'dataAsOf',v_finance_as_of,'lastSuccessfulSyncAt',v_finance_as_of),
    'merchants',jsonb_build_object('status',v_merchants_status,'dataAsOf',v_merchants_as_of,'lastSuccessfulSyncAt',v_merchants_as_of,'recordCount',coalesce((v_merchants->>'rowCount')::integer,0)),
    'vat',jsonb_build_object('status',v_vat_status,'dataAsOf',v_vat_as_of,'lastSuccessfulSyncAt',v_vat_as_of),
    'accountingCycle',jsonb_build_object('status','fresh','dataAsOf',v_cycle_as_of,'lastSuccessfulSyncAt',v_cycle_as_of)
  );
  v_actions := v_actions || jsonb_build_object(
    'zatca',jsonb_build_object(
      'count',coalesce((v_zatca->>'today_count')::integer,0)+coalesce((v_zatca->>'overdue_count')::integer,0),
      'amount',round((coalesce((v_zatca->>'today_total')::numeric,0)+coalesce((v_zatca->>'overdue_total')::numeric,0))::numeric,2),
      'available',v_zatca is not null
    ),
    'draftInvoices',jsonb_build_object('count',coalesce((v_invoice_ops->>'draft_cnt')::integer,0),'amount',coalesce((v_invoice_ops->>'draft_total')::numeric,0)),
    'refreshLamhaSources',jsonb_build_object('count',case when v_merchants_status='fresh' then 0 else 1 end),
    'closePeriod',jsonb_build_object('count',case when v_close_ready then 0 else 1 end)
  );

  return jsonb_build_object(
    'contractVersion',1,'period',v_period,'generatedAt',v_generated_at,'readPath','overview_core_lite',
    'financial',v_financial,
    'vat',v_vat,
    'actions',v_actions,
    'closeReadiness',v_close,
    'sources',v_sources,
    'drilldowns',jsonb_build_object(
      'receivables','/customer-money','vat','/zoho-data?tab=reports',
      'zatca','/zoho-data?tab=customers','lamhaSources','/accounting-cycle?period='||v_period||'&stage=lamha_sources',
      'accountingCycle','/accounting-cycle?period='||v_period
    )
  );
end;
$function$;

revoke all on function public.overview_core_lite(text) from public, anon;
grant execute on function public.overview_core_lite(text) to authenticated, service_role;
comment on function public.overview_core_lite(text) is
  'Read-only first-screen overview projection. Local aggregates only; no detail rows, external calls or mutations.';
