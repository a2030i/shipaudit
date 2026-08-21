-- Additive, read-only core for the currently reachable home command center.
-- Existing RPCs remain the financial/operational source of truth. Heavy
-- details are returned only as the minimum raw facts needed to run the same
-- established JavaScript projections; no external API is called here.

create or replace function public.overview_core(
  p_period text default to_char(current_date, 'YYYY-MM'),
  p_top_n integer default 5
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8000ms'
as $function$
declare
  v_period text := coalesce(nullif(btrim(p_period), ''), to_char(current_date, 'YYYY-MM'));
  v_prev_period text;
  v_period_date date;
  v_period_end date;
  v_period_label text;
  v_latest_snapshot text;
  v_latest_snapshot_date date;
  v_latest_snapshot_at timestamptz;
  v_audit_ids text[] := array[]::text[];
  v_verified_audit_ids text[] := array[]::text[];
  v_sources jsonb;
  v_accounting jsonb;
  v_source_status jsonb := '{}'::jsonb;
  v_zoho_financial jsonb;
  v_team_readiness jsonb;
  v_team_staffing jsonb;
  v_collection_work jsonb;
  v_vat jsonb;
begin
  if auth.uid() is null or not public.crm_has_permission('overview.view') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_period';
  end if;

  v_period_date := (v_period || '-01')::date;
  v_period_end := (v_period_date + interval '1 month')::date;
  v_prev_period := to_char(v_period_date - interval '1 month', 'YYYY-MM');
  v_period_label := (array['يناير','فبراير','مارس','أبريل','مايو','يونيو',
    'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'])[extract(month from v_period_date)::int]
    || ' ' || extract(year from v_period_date)::int::text;

  select m.snapshot_id, m.snapshot_date, m.uploaded_at
  into v_latest_snapshot, v_latest_snapshot_date, v_latest_snapshot_at
  from public.merchants m
  order by m.uploaded_at desc
  limit 1;

  select coalesce(array_agg(a.id), array[]::text[]),
         coalesce(array_agg(a.id) filter (
           where a.review_status='approved'
             and coalesce((a.col_map->'__control'->>'version')::numeric,0) >= 3
             and coalesce((a.col_map->'__control'->>'valid')::boolean,false)
             and nullif(a.col_map->'__control'->>'sourceHash','') is not null
             and nullif(a.col_map->'__control'->>'sourcePath','') is not null
             and nullif(a.file_name,'') is not null
             and nullif(a.contract_label,'') is not null
         ), array[]::text[])
  into v_audit_ids, v_verified_audit_ids
  from public.audits a
  where a.period in (v_period, v_period_label);

  v_accounting := jsonb_build_object(
    'period', v_period,
    'audits', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (
      select id,carrier_id,carrier_name,file_name,period,review_status,row_count,
             weight_billing_status,col_map,created_at,approved_at,contract_label
      from public.audits where period in (v_period,v_period_label)
    ) a), '[]'::jsonb),
    'weightExports', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at desc) from (
      select id,audit_ids,row_count,file_name,file_path,status,exported_at,created_at
      from public.weight_billing_exports
      where cardinality(v_audit_ids)>0 and audit_ids && v_audit_ids
    ) w), '[]'::jsonb),
    'shipmentImports', coalesce((select jsonb_agg(to_jsonb(i) order by i.uploaded_at desc)
      from public.lamha_shipment_imports i where i.period=v_period_date), '[]'::jsonb),
    'auditShipments', coalesce((select jsonb_agg(to_jsonb(s) order by s.id)
      from (select id,audit_id,awb,weight_kg,is_cod from public.audit_shipments
            where cardinality(v_verified_audit_ids)>0 and audit_id=any(v_verified_audit_ids)) s), '[]'::jsonb),
    'lamhaShipments', coalesce((select jsonb_agg(to_jsonb(s) order by s.id)
      from (select id,awb from public.lamha_shipments where period=v_period_date and awb is not null) s), '[]'::jsonb),
    'balanceSnapshot', (select to_jsonb(b) from (
      select id,file_name,row_count,matched_count,total_balance,uploaded_at
      from public.store_balance_snapshots where source='internal'
        and uploaded_at>=v_period_date and uploaded_at<v_period_end
      order by uploaded_at desc limit 1
    ) b),
    'merchantSnapshot', (select to_jsonb(m) from (
      select snapshot_id,uploaded_at from public.merchants
      where uploaded_at>=v_period_date and uploaded_at<v_period_end
      order by uploaded_at desc limit 1
    ) m),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from public.accounting_cycle_events e where e.period=v_period_date), '[]'::jsonb),
    'cycle', (select to_jsonb(c) from public.accounting_cycles c where c.period=v_period_date limit 1),
    'carriers', coalesce((select jsonb_agg(to_jsonb(c) order by c.name)
      from (select id,name,file_signature,contracts from public.carriers) c), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(to_jsonb(s) order by s.carrier_id,s.task_kind)
      from public.carrier_task_schedules s where s.active), '[]'::jsonb),
    'codInRows', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from (
      select upload_id,upload_date,source_file,settlement_ref,schedule_slot,created_at,carrier_id
      from public.cod_settlement where direction='in' and (
        (upload_date>=v_period_date and upload_date<v_period_end)
        or (schedule_slot>=v_period_date and schedule_slot<v_period_end)
      )
    ) c), '[]'::jsonb),
    'codInCount', (select count(*) from public.cod_settlement where direction='in' and (
      (upload_date>=v_period_date and upload_date<v_period_end)
      or (schedule_slot>=v_period_date and schedule_slot<v_period_end))),
    'codOutRows', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from (
      select upload_id,upload_date,source_file,settlement_ref,schedule_slot,created_at,carrier_id
      from public.cod_settlement where direction='out' and (
        (upload_date>=v_period_date and upload_date<v_period_end)
        or (schedule_slot>=v_period_date and schedule_slot<v_period_end)
      )
    ) c), '[]'::jsonb),
    'codOutCount', (select count(*) from public.cod_settlement where direction='out' and (
      (upload_date>=v_period_date and upload_date<v_period_end)
      or (schedule_slot>=v_period_date and schedule_slot<v_period_end))),
    -- Production currently lacks weight_billing_exports.storage_bucket while
    -- the legacy reader requests it. Preserve the same readiness blocker in
    -- the shadow result instead of silently changing close readiness.
    'sourceErrors', jsonb_build_array(jsonb_build_object(
      'stage','weight_export','source','weight_billing_exports','label','ملفات الأوزان',
      'message','column weight_billing_exports.storage_bucket does not exist'
    ))
  );

  -- These sources have narrower permissions than overview.view. Match the
  -- legacy page's per-source failure isolation rather than failing the whole
  -- core response or widening access.
  begin
    v_zoho_financial := public.zoho_financial_control_dashboard();
  exception when others then
    v_zoho_financial := null;
    v_source_status := v_source_status || jsonb_build_object('zohoFinancial',
      jsonb_build_object('status','unavailable','error',sqlerrm));
  end;
  begin
    v_team_readiness := public.team_operational_readiness_snapshot();
  exception when others then
    v_team_readiness := null;
    v_source_status := v_source_status || jsonb_build_object('teamReadiness',
      jsonb_build_object('status','unavailable','error',sqlerrm));
  end;
  begin
    v_team_staffing := public.team_staffing_readiness_snapshot();
  exception when others then
    v_team_staffing := null;
    v_source_status := v_source_status || jsonb_build_object('teamStaffing',
      jsonb_build_object('status','unavailable','error',sqlerrm));
  end;
  begin
    v_collection_work := public.collection_work_readiness_snapshot();
  exception when others then
    v_collection_work := null;
    v_source_status := v_source_status || jsonb_build_object('collectionWork',
      jsonb_build_object('status','unavailable','error',sqlerrm));
  end;
  begin
    select to_jsonb(v) into v_vat from public.vat_current_quarter() v limit 1;
  exception when others then
    v_vat := null;
    v_source_status := v_source_status || jsonb_build_object('vat',
      jsonb_build_object('status','unavailable','error',sqlerrm));
  end;

  v_sources := jsonb_build_object(
    'monthly', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_financial_snapshot(v_period) x), '[]'::jsonb),
    'previousMonth', coalesce((select jsonb_agg(to_jsonb(x)) from public.monthly_financial_snapshot(v_prev_period) x), '[]'::jsonb),
    'apAging', coalesce((select jsonb_agg(to_jsonb(x)) from public.ap_aging_by_carrier() x), '[]'::jsonb),
    'carrierSpend', coalesce((select jsonb_agg(to_jsonb(x)) from public.carrier_spend_concentration(v_period) x), '[]'::jsonb),
    'customerDebt', coalesce((select jsonb_agg(to_jsonb(x)) from public.customer_debt_concentration(least(greatest(coalesce(p_top_n,5),1),20)) x), '[]'::jsonb),
    'carrierHealth', coalesce((select jsonb_agg(to_jsonb(x)) from public.carrier_health_kpis() x), '[]'::jsonb),
    'workingCapital', coalesce((select jsonb_agg(to_jsonb(x)) from public.working_capital_now() x), '[]'::jsonb),
    'banks', jsonb_build_object(
      'manualRows', coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at desc) from (
        select bank,balance,notes,recorded_at from public.bank_balance_log
      ) x), '[]'::jsonb),
      'statementRows', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_to desc) from (
        select bank,period_to,closing_balance from public.bank_statement_summaries
      ) x), '[]'::jsonb)
    ),
    'carrierCod', coalesce((select jsonb_agg(to_jsonb(x)) from public.carrier_cod_net_balances() x), '[]'::jsonb),
    'zohoInvoices', public.zoho_invoice_dashboard()::jsonb,
    'zatcaPending', public.zatca_pending_today(),
    'customerMoney', public.customer_money_dashboard()::jsonb,
    'merchants', jsonb_build_object(
      'snapshot', case when v_latest_snapshot is null then null else jsonb_build_object(
        'id',v_latest_snapshot,'date',v_latest_snapshot_date,'uploadedAt',v_latest_snapshot_at) end,
      'merchants', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from (
        select id,store_id,store_name,phone,shipment_count,last_shipment_at,integration_type,
          billing_type,status,profile_status,vat_registered,zatca_completed,verification_status,
          created_at_platform,last_topup_at,wallet_balance
        from public.merchants where snapshot_id=v_latest_snapshot
      ) m), '[]'::jsonb)
    ),
    'lamhaBalance', (select to_jsonb(b) from (
      select id,file_name,row_count,total_balance,uploaded_at from public.store_balance_snapshots
      where source='internal' order by uploaded_at desc limit 1
    ) b),
    'accountingCycleRaw', v_accounting,
    'zohoInvoiceSync', (select to_jsonb(s) from (
      select last_sync,last_status,last_error from public.zoho_sync_state where entity='invoices' limit 1
    ) s),
    'zohoFinancial', v_zoho_financial,
    'teamReadiness', v_team_readiness,
    'teamStaffing', v_team_staffing,
    'collectionWork', v_collection_work,
    'vat', v_vat
  );

  return jsonb_build_object(
    'period',v_period,
    'prevPeriod',v_prev_period,
    'generatedAt',clock_timestamp(),
    'sources',v_sources,
    'sourceStatus',v_source_status,
    'readPath','overview_core'
  );
end;
$function$;

revoke all on function public.overview_core(text,integer) from public, anon;
grant execute on function public.overview_core(text,integer) to authenticated, service_role;
comment on function public.overview_core(text,integer) is
  'Read-only local core for the home command center. Existing source RPCs remain authoritative; no external API or mutation.';
