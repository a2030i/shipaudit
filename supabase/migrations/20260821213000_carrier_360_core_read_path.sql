-- Carrier 360 central local read path.
-- Additive/read-only: this function does not mutate carrier, audit, COD,
-- claims, ledger, webhook, contract, or Zoho data.

create or replace function public.carrier_360_core(p_carrier_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_carrier public.carriers%rowtype;
  v_can_audits boolean := false;
  v_can_ledger boolean := false;
  v_can_cod boolean := false;
  v_can_webhooks boolean := false;
  v_can_claims boolean := false;
  v_can_zoho boolean := false;
  v_audits jsonb := '{}'::jsonb;
  v_ledger jsonb := '{}'::jsonb;
  v_cod jsonb := '{}'::jsonb;
  v_webhooks jsonb := '{}'::jsonb;
  v_claims jsonb := '{}'::jsonb;
  v_zoho jsonb := null;
  v_contract jsonb := null;
  v_contract_status text := 'missing';
  v_setup_gaps jsonb := '[]'::jsonb;
  v_setup_completeness integer := 0;
  v_last_activity timestamptz := null;
begin
  if p_carrier_id is null or btrim(p_carrier_id) = '' then
    raise exception 'carrier_id_required';
  end if;
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_carrier
  from public.carriers
  where id = p_carrier_id;
  if not found then
    raise exception 'carrier_not_found_or_forbidden';
  end if;

  v_can_audits := public.crm_has_permission('audits.view');
  v_can_ledger := public.app_has_any_permission(array[
    'ledger.view','carriers.view','overview.view','reports.view_financial',
    'reports.view_operational','payments.view'
  ]::text[]);
  v_can_cod := public.crm_has_permission('cod.view');
  v_can_webhooks := public.crm_has_permission('webhook.view');
  v_can_claims := v_can_audits;
  v_can_zoho := public.crm_has_permission('carriers.view')
    and public.crm_has_permission('zoho.view');

  -- Contract is descriptive only. No pricing or audit rule is evaluated here.
  select x.value into v_contract
  from jsonb_array_elements(coalesce(v_carrier.contracts, '[]'::jsonb)) x(value)
  where coalesce(x.value->>'startDate', '0001-01-01') <= current_date::text
    and (nullif(x.value->>'endDate', '') is null or x.value->>'endDate' >= current_date::text)
  order by coalesce(x.value->>'startDate', '0001-01-01') desc
  limit 1;
  if v_contract is not null then
    v_contract_status := 'active';
  elsif jsonb_array_length(coalesce(v_carrier.contracts, '[]'::jsonb)) > 0 then
    if exists (
      select 1 from jsonb_array_elements(v_carrier.contracts) x(value)
      where nullif(x.value->>'startDate', '') is not null
        and x.value->>'startDate' > current_date::text
    ) then v_contract_status := 'upcoming';
    else v_contract_status := 'expired';
    end if;
  end if;

  if jsonb_array_length(coalesce(v_carrier.contracts, '[]'::jsonb)) > 0 then
    v_setup_completeness := v_setup_completeness + 50;
  else v_setup_gaps := v_setup_gaps || to_jsonb('عقد'::text); end if;
  if jsonb_array_length(coalesce(v_carrier.file_signature->'email_from', '[]'::jsonb)) > 0 then
    v_setup_completeness := v_setup_completeness + 25;
  else v_setup_gaps := v_setup_gaps || to_jsonb('بصمة Webhook (email_from)'::text); end if;
  if nullif(v_carrier.file_signature->>'file_kind', '') is not null then
    v_setup_completeness := v_setup_completeness + 25;
  else v_setup_gaps := v_setup_gaps || to_jsonb('نوع الملفات (file_kind)'::text); end if;

  if v_can_ledger then
    select jsonb_build_object(
      'balance', round(coalesce(sum(case when status <> 'paid' then
        case when coalesce(amount_dr,0)-coalesce(amount_cr,0) >= 0
          then greatest(0, coalesce(amount_dr,0)-coalesce(amount_cr,0)-coalesce(amount_paid,0))
          else coalesce(amount_dr,0)-coalesce(amount_cr,0) end else 0 end),0)::numeric,2),
      'totalDr', round(coalesce(sum(amount_dr),0)::numeric,2),
      'totalCr', round(coalesce(sum(amount_cr),0)::numeric,2),
      'docCounts', jsonb_build_object(
        'INV', count(*) filter (where upper(coalesce(doc_type,'OTHER'))='INV'),
        'COD', count(*) filter (where upper(coalesce(doc_type,'OTHER'))='COD'),
        'PAY', count(*) filter (where upper(coalesce(doc_type,'OTHER'))='PAY'),
        'ADJ', count(*) filter (where upper(coalesce(doc_type,'OTHER'))='ADJ'),
        'OTHER', count(*) filter (where upper(coalesce(doc_type,'OTHER')) not in ('INV','COD','PAY','ADJ'))
      ),
      'count', count(*),
      'dataAsOf', max(coalesce(updated_at,created_at)),
      'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.activity_at desc, r.id desc)
        from (select id,doc_type,doc_no,doc_date,amount_dr,amount_cr,amount_paid,status,
          audit_id,payment_id,due_date,paid_at,notes,created_at,updated_at,
          coalesce(updated_at,created_at) activity_at
          from public.carrier_operations where carrier_id=p_carrier_id
          order by coalesce(updated_at,created_at) desc,id desc limit 10) r), '[]'::jsonb)
    ) into v_ledger
    from public.carrier_operations where carrier_id=p_carrier_id;
  else
    v_ledger := jsonb_build_object('restricted',true,'balance',null,'totalDr',null,'totalCr',null,
      'docCounts',null,'count',null,'dataAsOf',null,'recent','[]'::jsonb);
  end if;

  if v_can_cod then
    select jsonb_build_object(
      'outstanding', round((coalesce(sum(amount) filter(where direction='out'),0)
        - coalesce(sum(amount) filter(where direction<>'out' or direction is null),0))::numeric,2),
      'out', round(coalesce(sum(amount) filter(where direction='out'),0)::numeric,2),
      'in', round(coalesce(sum(amount) filter(where direction<>'out' or direction is null),0)::numeric,2),
      'outCount', count(*) filter(where direction='out'),
      'inCount', count(*) filter(where direction<>'out' or direction is null),
      'count', count(*),
      'dataAsOf', max(coalesce(created_at,upload_date::timestamptz))
    ) into v_cod
    from public.cod_settlement where carrier_id=p_carrier_id;
  else
    v_cod := jsonb_build_object('restricted',true,'outstanding',null,'out',null,'in',null,
      'outCount',null,'inCount',null,'count',null,'dataAsOf',null);
  end if;

  if v_can_audits then
    with facts as (
      select a.*,
        case when coalesce((a.col_map->'__control'->>'version')::numeric,0) >= 3
          and coalesce((a.col_map->'__control'->>'valid')::boolean,false)
          and nullif(a.col_map->'__control'->>'sourceHash','') is not null
          and nullif(a.col_map->'__control'->>'sourcePath','') is not null
          and nullif(a.file_name,'') is not null and nullif(a.contract_label,'') is not null
          then coalesce(a.review_status,'pending') else 'legacy_unverified' end effective_status
      from public.audits a where a.carrier_id=p_carrier_id
    )
    select jsonb_build_object(
      'count', count(*),
      'needsAction', count(*) filter(where effective_status not in ('approved','rejected')),
      'totalVariance', round(coalesce(sum(diff),0)::numeric,2),
      'totalObjection', round(coalesce(sum(greatest(coalesce(diff,0),0)),0)::numeric,2),
      'byStatus', jsonb_build_object(
        'pending',count(*) filter(where effective_status='pending'),
        'draft',count(*) filter(where effective_status='draft'),
        'approved',count(*) filter(where effective_status='approved'),
        'rejected',count(*) filter(where effective_status='rejected'),
        'legacy_unverified',count(*) filter(where effective_status='legacy_unverified')
      ),
      'dataAsOf', max(created_at),
      'latest', (select to_jsonb(l) from (select id,file_name,contract_label,period,row_count,issue_count,
        total_expected,total_billed,total_tax,diff,mismatch_count,drift_pre_tax,drift_tax,audit_type,
        review_status,approved_at,rejected_at,rejected_reason,created_at,col_map,effective_status
        from facts order by created_at desc,id desc limit 1) l),
      'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc)
        from (select id,file_name,contract_label,period,row_count,issue_count,total_expected,total_billed,
          total_tax,diff,mismatch_count,drift_pre_tax,drift_tax,audit_type,review_status,approved_at,
          rejected_at,rejected_reason,created_at,col_map,effective_status
          from facts order by created_at desc,id desc limit 8) r), '[]'::jsonb)
    ) into v_audits from facts;
  else
    v_audits := jsonb_build_object('restricted',true,'count',null,'needsAction',null,
      'totalVariance',null,'totalObjection',null,'byStatus',null,'dataAsOf',null,
      'latest',null,'recent','[]'::jsonb);
  end if;

  if v_can_webhooks then
    select jsonb_build_object(
      'count', count(*),
      'pending', count(*) filter(where status in ('awaiting_assignment','pending')),
      'dataAsOf', max(received_at),
      'latestFile', (select to_jsonb(l) from (select id,sender,subject,file_name,file_size,status,audit_id,
        received_at,file_path from public.webhook_events where detected_carrier_id=p_carrier_id
        order by received_at desc,id desc limit 1) l),
      'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.received_at desc,r.id desc)
        from (select id,sender,subject,file_name,file_size,status,audit_id,received_at,file_path
          from public.webhook_events where detected_carrier_id=p_carrier_id
          order by received_at desc,id desc limit 6) r), '[]'::jsonb)
    ) into v_webhooks from public.webhook_events where detected_carrier_id=p_carrier_id;
  else
    v_webhooks := jsonb_build_object('restricted',true,'count',null,'pending',null,'dataAsOf',null,
      'latestFile',null,'recent','[]'::jsonb);
  end if;

  if v_can_claims then
    select jsonb_build_object(
      'openCount', count(*) filter(where status in ('open','submitted')),
      'openAmount', round(coalesce(sum(amount) filter(where status in ('open','submitted')),0)::numeric,2),
      'dataAsOf', max(updated_at)
    ) into v_claims from public.audit_claims where carrier_id=p_carrier_id;
  else
    v_claims := jsonb_build_object('restricted',true,'openCount',null,'openAmount',null,'dataAsOf',null);
  end if;

  if v_can_zoho then
    begin
      v_zoho := public.carrier_zoho_financial_dossier(p_carrier_id);
      v_zoho := jsonb_build_object('available',true) || coalesce(v_zoho,'{}'::jsonb);
    exception when others then
      v_zoho := jsonb_build_object('available',false,'error','source_unavailable');
    end;
  else
    v_zoho := jsonb_build_object('available',false,'restricted',true);
  end if;

  v_last_activity := greatest(
    nullif(v_ledger->>'dataAsOf','')::timestamptz,
    nullif(v_cod->>'dataAsOf','')::timestamptz,
    nullif(v_audits->>'dataAsOf','')::timestamptz,
    nullif(v_webhooks->>'dataAsOf','')::timestamptz,
    nullif(v_claims->>'dataAsOf','')::timestamptz
  );

  return jsonb_build_object(
    'carrier', jsonb_build_object(
      'id',v_carrier.id,'name',v_carrier.name,'logo',v_carrier.logo,'color',v_carrier.color,
      'contracts',coalesce(v_carrier.contracts,'[]'::jsonb),'file_signature',coalesce(v_carrier.file_signature,'{}'::jsonb),
      'contact_email',v_carrier.contact_email,'contact_phone',v_carrier.contact_phone,
      'account_manager',v_carrier.account_manager,'iban',v_carrier.iban,'bank_name',v_carrier.bank_name,
      'status','available','updatedAt',v_carrier.updated_at
    ),
    'contract',jsonb_build_object('status',v_contract_status,'current',v_contract),
    'summary',jsonb_build_object(
      'balance',v_ledger->'balance','totalDr',v_ledger->'totalDr','totalCr',v_ledger->'totalCr',
      'docCounts',v_ledger->'docCounts','codOutstanding',v_cod->'outstanding','codOut',v_cod->'out',
      'codIn',v_cod->'in','codOutCount',v_cod->'outCount','codInCount',v_cod->'inCount',
      'audits',v_audits->'count','auditsByStatus',v_audits->'byStatus','auditsNeedAction',v_audits->'needsAction',
      'totalVariance',v_audits->'totalVariance','totalObjection',v_audits->'totalObjection',
      'openClaims',v_claims->'openCount','openClaimsAmount',v_claims->'openAmount',
      'webhooks',v_webhooks->'count','webhookPending',v_webhooks->'pending',
      'setupCompleteness',v_setup_completeness,'setupGaps',v_setup_gaps,'lastActivityAt',v_last_activity,
      'netPosition',case when v_can_ledger and v_can_cod then
        round(((v_ledger->>'balance')::numeric-(v_cod->>'outstanding')::numeric),2) else null end
    ),
    'latestAudit',v_audits->'latest','lastFile',v_webhooks->'latestFile',
    'recent',jsonb_build_object('audits',v_audits->'recent','webhooks',v_webhooks->'recent','ops',v_ledger->'recent'),
    'zohoFinancial',v_zoho,
    'permissions',jsonb_build_object('audits',v_can_audits,'ledger',v_can_ledger,'cod',v_can_cod,
      'webhooks',v_can_webhooks,'claims',v_can_claims,'zoho',v_can_zoho),
    'sources',jsonb_build_object(
      'carrier',jsonb_build_object('status','available','dataAsOf',v_carrier.updated_at),
      'audits',jsonb_build_object('status',case when v_can_audits then case when (v_audits->>'count')::int=0 then 'empty' else 'available' end else 'restricted' end,'dataAsOf',v_audits->'dataAsOf'),
      'ledger',jsonb_build_object('status',case when v_can_ledger then case when (v_ledger->>'count')::int=0 then 'empty' else 'available' end else 'restricted' end,'dataAsOf',v_ledger->'dataAsOf'),
      'cod',jsonb_build_object('status',case when v_can_cod then case when (v_cod->>'count')::int=0 then 'empty' else 'available' end else 'restricted' end,'dataAsOf',v_cod->'dataAsOf'),
      'claims',jsonb_build_object('status',case when v_can_claims then 'available' else 'restricted' end,'dataAsOf',v_claims->'dataAsOf'),
      'webhooks',jsonb_build_object('status',case when v_can_webhooks then case when (v_webhooks->>'count')::int=0 then 'empty' else 'available' end else 'restricted' end,'dataAsOf',v_webhooks->'dataAsOf'),
      'zoho',jsonb_build_object('status',case when not v_can_zoho then 'restricted' when coalesce((v_zoho->>'available')::boolean,false)=false then 'failed'
        when nullif(v_zoho#>>'{vendor,synced_at}','') is null then 'empty'
        when (v_zoho#>>'{vendor,synced_at}')::timestamptz >= now()-interval '2 hours' then 'fresh'
        when (v_zoho#>>'{vendor,synced_at}')::timestamptz >= now()-interval '24 hours' then 'delayed' else 'stale' end,
        'dataAsOf',v_zoho#>'{vendor,synced_at}')
    ),
    'generatedAt',now(),
    'readPath','carrier_360_core'
  );
end;
$function$;

comment on function public.carrier_360_core(text) is
  'Read-only local Carrier 360 summary. Stored audit/COD/ledger values only; heavy details remain paginated.';

revoke all on function public.carrier_360_core(text) from public, anon;
grant execute on function public.carrier_360_core(text) to authenticated, service_role;
