-- Production additive read path for Store 360.
-- This script creates one read-only RPC. It does not alter existing tables,
-- views, policies, services, data, or business calculations.

create or replace function public.store_360_core(p_store_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2000ms'
as $function$
declare
  v_uid uuid := auth.uid();
  v_store_id text := btrim(p_store_id);
  v_identity_allowed boolean;
  v_finance_allowed boolean;
  v_collections_allowed boolean;
  v_sales_allowed boolean;
  v_sales_see_all boolean;
  v_collections_see_all boolean;
  v_store public.merchants%rowtype;
  v_link_count integer := 0;
  v_resolved_count integer := 0;
  v_customer_name text;
  v_zoho_id text;
  v_link_status text;
  v_link_data jsonb;
  v_finance jsonb;
  v_payment jsonb;
  v_task jsonb;
  v_sales jsonb;
  v_shared_contact_stores jsonb := '[]'::jsonb;
  v_inv_sync public.zoho_sync_state%rowtype;
  v_pay_sync public.zoho_sync_state%rowtype;
  v_identity_source jsonb;
  v_finance_source jsonb;
  v_payment_source jsonb;
  v_collection_source jsonb;
  v_sales_source jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated';
  end if;
  if v_store_id is null or v_store_id = '' or length(v_store_id) > 64 then
    raise exception using errcode = '22023', message = 'invalid_store_id';
  end if;

  v_identity_allowed := public.app_has_any_permission(array[
    'merchants.view','receivables.view','sales.view','crm.view','support.view'
  ]);
  v_finance_allowed := public.app_has_any_permission(array['receivables.view']);
  v_collections_allowed := public.app_has_any_permission(array['collections.view']);
  v_sales_allowed := public.app_has_any_permission(array['sales.view','crm.view']);
  v_sales_see_all := public.app_has_any_permission(array['crm.view_all']);
  v_collections_see_all := public.app_has_any_permission(array['collections.view_all']);

  if not (v_identity_allowed or v_finance_allowed or v_collections_allowed or v_sales_allowed) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select m.* into v_store
  from public.merchants m
  where m.snapshot_id = (
    select lm.snapshot_id
    from public.merchants lm
    order by lm.uploaded_at desc
    limit 1
  )
    and m.store_id = v_store_id
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'store_not_found';
  end if;

  v_identity_source := jsonb_build_object(
    'source','lamha.merchant_snapshot',
    'dataAsOf',v_store.uploaded_at,
    'lastSuccessfulSyncAt',v_store.uploaded_at,
    'availabilityStatus','available',
    'freshnessStatus',case
      when now() - v_store.uploaded_at <= interval '18 hours' then 'fresh'
      when now() - v_store.uploaded_at <= interval '24 hours' then 'delayed'
      else 'stale'
    end,
    'errorCode',null
  );

  if v_identity_allowed and nullif(regexp_replace(coalesce(v_store.phone,''),'\D','','g'),'') is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'storeId',m.store_id,
      'storeName',m.store_name,
      'phone',m.phone,
      'shipmentCount',coalesce(m.shipment_count,0),
      'lastShipmentAt',m.last_shipment_at,
      'integrationType',m.integration_type,
      'billingType',m.billing_type,
      'status',m.status,
      'walletBalance',coalesce(m.wallet_balance,0),
      'createdAt',m.created_at_platform,
      'lastTopupAt',m.last_topup_at
    ) order by m.store_id), '[]'::jsonb)
    into v_shared_contact_stores
    from public.merchants m
    where m.snapshot_id = v_store.snapshot_id
      and m.store_id <> v_store_id
      and regexp_replace(regexp_replace(coalesce(m.phone,''),'\D','','g'),'^(00966|966|0)','') =
          regexp_replace(regexp_replace(coalesce(v_store.phone,''),'\D','','g'),'^(00966|966|0)','');
  end if;

  select count(*)::integer, min(l.customer_name)
  into v_link_count, v_customer_name
  from public.customer_merchant_links l
  where l.store_id = v_store_id;

  if v_link_count = 1 then
    select count(*)::integer, min(ar.zoho_id)
    into v_resolved_count, v_zoho_id
    from public.customer_ar ar
    where ar.contact_name = v_customer_name;
  end if;

  v_link_status := case
    when v_link_count = 0 then 'unlinked'
    when v_link_count > 1 then 'ambiguous'
    when v_resolved_count = 0 then 'unresolved'
    when v_resolved_count > 1 then 'ambiguous'
    else 'resolved'
  end;

  v_link_data := case v_link_status
    when 'resolved' then jsonb_build_object(
      'status','resolved','accountCount',1,
      'customerName',v_customer_name,'zohoContactId',v_zoho_id
    )
    when 'unlinked' then jsonb_build_object('status','unlinked','accountCount',0)
    else jsonb_build_object('status',v_link_status,'accountCount',greatest(v_link_count,v_resolved_count))
  end;

  select * into v_inv_sync
  from public.zoho_sync_state
  where entity = 'invoices';
  select * into v_pay_sync
  from public.zoho_sync_state
  where entity = 'customerpayments';

  v_finance_source := jsonb_build_object(
    'source','zoho.customer_ar+customer_collectible_lines',
    'dataAsOf',v_inv_sync.last_sync,
    'lastSuccessfulSyncAt',v_inv_sync.last_sync,
    'availabilityStatus',case when v_inv_sync.last_sync is null then 'unavailable' else 'available' end,
    'freshnessStatus',case
      when v_inv_sync.last_sync is null then 'unavailable'
      when lower(coalesce(v_inv_sync.last_status,'')) in ('failed','error') then 'failed'
      when now() - v_inv_sync.last_sync <= interval '45 minutes' then 'fresh'
      when now() - v_inv_sync.last_sync <= interval '90 minutes' then 'delayed'
      else 'stale'
    end,
    'errorCode',case when lower(coalesce(v_inv_sync.last_status,'')) in ('failed','error') then 'source_failed' else null end
  );
  v_payment_source := jsonb_build_object(
    'source','zoho.customerpayments',
    'dataAsOf',v_pay_sync.last_sync,
    'lastSuccessfulSyncAt',v_pay_sync.last_sync,
    'availabilityStatus',case when v_pay_sync.last_sync is null then 'unavailable' else 'available' end,
    'freshnessStatus',case
      when v_pay_sync.last_sync is null then 'unavailable'
      when lower(coalesce(v_pay_sync.last_status,'')) in ('failed','error') then 'failed'
      when now() - v_pay_sync.last_sync <= interval '45 minutes' then 'fresh'
      when now() - v_pay_sync.last_sync <= interval '90 minutes' then 'delayed'
      else 'stale'
    end,
    'errorCode',case when lower(coalesce(v_pay_sync.last_status,'')) in ('failed','error') then 'source_failed' else null end
  );

  if v_finance_allowed and v_link_status = 'resolved' then
    select jsonb_build_object(
      'zohoContactId',ar.zoho_id,
      'collectibleDue',round(ar.collectible_due,2),
      'overdue',round(coalesce(a.overdue,0),2),
      'oldestAgeDays',coalesce(a.oldest_age_days,0),
      'openInvoiceCount',coalesce(a.invoice_count,0),
      'balanceSyncIssue',exists(
        select 1 from public.customer_balance_integrity_issues bi
        where bi.zoho_id = ar.zoho_id
      ),
      'aging',jsonb_build_object(
        'dueToday',round(coalesce(a.due_today,0),2),
        'invoice1To15',round(coalesce(a.inv_1_15,0),2),
        'invoice16To30',round(coalesce(a.inv_16_30,0),2),
        'invoice31To60',round(coalesce(a.inv_31_60,0),2),
        'invoice61To90',round(coalesce(a.inv_61_90,0),2),
        'invoiceOver90',round(coalesce(a.inv_90p,0),2),
        'openingBalance',round(coalesce(a.opening_balance,0),2),
        'bucketsTotal',round(coalesce(a.bucket_sum,0),2),
        'unallocatedDifference',round(ar.collectible_due-coalesce(a.bucket_sum,0),2),
        'reconciledTotal',round(coalesce(a.bucket_sum,0)+(ar.collectible_due-coalesce(a.bucket_sum,0)),2),
        'reconciliationStatus',case
          when abs(ar.collectible_due-coalesce(a.bucket_sum,0)) <= 0.01 then 'matched'
          else 'needs_review'
        end
      ),
      'fieldSources',jsonb_build_object(
        'collectibleDue','customer_ar.collectible_due',
        'overdue','customer_collectible_lines',
        'aging','customer_collectible_lines',
        'oldestAgeDays','customer_collectible_lines',
        'openInvoiceCount','customer_collectible_lines',
        'balanceSyncIssue','customer_balance_integrity_issues'
      )
    ) into v_finance
    from public.customer_ar ar
    left join lateral (
      select
        sum(l.collectible_amount) filter(
          where l.line_kind='opening_balance' or lower(coalesce(l.status,''))='overdue'
        ) overdue,
        max(l.age_days) filter(where l.collectible_amount>0.005) oldest_age_days,
        count(*) filter(where l.line_kind='invoice' and l.collectible_amount>0.5)::integer invoice_count,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days=0) due_today,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days between 1 and 15) inv_1_15,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days between 16 and 30) inv_16_30,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days between 31 and 60) inv_31_60,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days between 61 and 90) inv_61_90,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days>90) inv_90p,
        sum(l.collectible_amount) filter(where l.line_kind='opening_balance') opening_balance,
        sum(l.collectible_amount) bucket_sum
      from public.customer_collectible_lines l
      where l.contact_id=ar.zoho_id and l.collectible_amount>0.005
    ) a on true
    where ar.zoho_id=v_zoho_id
      and ar.collectible_due>0.5;

    if v_finance is not null then
      select jsonb_build_object(
        'date',p.date,'amount',round(p.amount,2),
        'fieldSources',jsonb_build_object('date','zoho_payments.date','amount','zoho_payments.amount')
      ) into v_payment
      from (
        select zp.date,sum(zp.amount) amount
        from public.zoho_payments zp
        where zp.customer_name=v_customer_name
          and zp.date=(
            select max(zp2.date) from public.zoho_payments zp2
            where zp2.customer_name=v_customer_name
          )
        group by zp.date
      ) p;
    end if;
  end if;

  if v_collections_allowed and v_link_status='resolved' then
    select jsonb_build_object(
      'taskId',t.id,'trigger',t.trigger,'stage',t.stage,'assignedTo',t.assigned_to,
      'promiseAmount',t.promise_amount,'promiseDate',t.promise_date,
      'promiseStatus',t.promise_status,'snoozeUntil',t.snooze_until,
      'updatedAt',t.updated_at,
      'fieldSources',jsonb_build_object(
        'stage','collection_tasks','promise','collection_tasks','owner','collection_tasks'
      )
    ) into v_task
    from public.collection_tasks t
    where t.customer_name=v_customer_name
      and t.stage in ('todo','contacted','promised','snoozed')
      and t.done_at is null
      and (v_collections_see_all or t.assigned_to=v_uid)
    order by t.updated_at desc
    limit 1;
  end if;
  v_collection_source := jsonb_build_object(
    'source','local.collection_tasks',
    'dataAsOf',case when v_task is null then null else (v_task->>'updatedAt')::timestamptz end,
    'lastSuccessfulSyncAt',null,
    'availabilityStatus','available','freshnessStatus','fresh','errorCode',null
  );

  if v_sales_allowed then
    select jsonb_build_object(
      'stage',f.sales_stage,'lastOutcome',f.status,'ownerId',f.owner_id,
      'ownerName',owner_profile.name,
      'nextActionAt',f.next_action_at,'nextActionType',f.next_action_type,
      'lastTouchAt',f.last_touch_at,'updatedAt',f.updated_at,
      'association','contact_point',
      'fieldSources',jsonb_build_object(
        'stage','retargeting_followups','owner','retargeting_followups',
        'nextAction','retargeting_followups'
      )
    ) into v_sales
    from public.retargeting_followups f
    left join public.profiles owner_profile on owner_profile.id=f.owner_id
    where f.phone=v_store.phone
      and (v_sales_see_all or f.owner_id is null or f.owner_id=v_uid)
    limit 1;
  end if;
  v_sales_source := jsonb_build_object(
    'source','local.retargeting_followups+lamha.merchant_snapshot',
    'dataAsOf',greatest(v_store.uploaded_at,coalesce((v_sales->>'updatedAt')::timestamptz,v_store.uploaded_at)),
    'lastSuccessfulSyncAt',v_store.uploaded_at,
    'availabilityStatus','available',
    'freshnessStatus',case
      when now()-greatest(v_store.uploaded_at,coalesce((v_sales->>'updatedAt')::timestamptz,v_store.uploaded_at)) <= interval '18 hours' then 'fresh'
      when now()-greatest(v_store.uploaded_at,coalesce((v_sales->>'updatedAt')::timestamptz,v_store.uploaded_at)) <= interval '24 hours' then 'delayed'
      else 'stale'
    end,
    'errorCode',null
  );

  return jsonb_build_object(
    'contractVersion',1,'storeId',v_store_id,'generatedAt',now(),
    'sections',jsonb_build_object(
      'identity',case when v_identity_allowed then jsonb_build_object(
        'visibility','visible','status','available',
        'data',jsonb_build_object(
          'storeId',v_store.store_id,'storeName',v_store.store_name,'phone',v_store.phone,
          'status',v_store.status,'integrationType',v_store.integration_type,
          'billingType',v_store.billing_type,'shipmentCount',coalesce(v_store.shipment_count,0),
          'lastShipmentAt',v_store.last_shipment_at,'walletBalance',coalesce(v_store.wallet_balance,0),
          'createdAt',v_store.created_at_platform,'lastTopupAt',v_store.last_topup_at,
          'profileStatus',v_store.profile_status,'vatRegistered',v_store.vat_registered,
          'zatcaCompleted',v_store.zatca_completed,'verificationStatus',v_store.verification_status,
          'sharedContactStores',v_shared_contact_stores
        ),
        'source',v_identity_source,
        'fieldSources',jsonb_build_object(
          'storeId','merchants.store_id','identity','merchants','operatingMetrics','merchants',
          'sharedContactStores','merchants.phone_contact_association'
        )
      ) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'financialLink',case when v_finance_allowed then jsonb_build_object(
        'visibility','visible','status',v_link_status,'data',v_link_data,
        'source',jsonb_build_object(
          'source','customer_merchant_links','dataAsOf',(
            select max(l.linked_at) from public.customer_merchant_links l where l.store_id=v_store_id
          ),
          'lastSuccessfulSyncAt',null,'availabilityStatus','available',
          'freshnessStatus','fresh','errorCode',null
        )
      ) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'finance',case when v_finance_allowed then jsonb_build_object(
        'visibility','visible',
        'status',case
          when v_link_status<>'resolved' then v_link_status
          when v_finance is null then 'empty'
          when v_finance#>>'{aging,reconciliationStatus}'='needs_review' then 'needs_review'
          else 'available'
        end,
        'data',v_finance,'source',v_finance_source
      ) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'lastPayment',case when v_finance_allowed then jsonb_build_object(
        'visibility','visible',
        'status',case when v_link_status<>'resolved' then v_link_status when v_payment is null then 'empty' else 'available' end,
        'data',v_payment,'source',v_payment_source
      ) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'collections',case when v_collections_allowed then jsonb_build_object(
        'visibility','visible',
        'status',case when v_link_status<>'resolved' then v_link_status when v_task is null then 'empty' else 'available' end,
        'data',v_task,'source',v_collection_source
      ) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'sales',case when v_sales_allowed then jsonb_build_object(
        'visibility','visible','status',case when v_sales is null then 'empty' else 'available' end,
        'data',v_sales,'source',v_sales_source
      ) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end
    )
  );
end;
$function$;

comment on function public.store_360_core(text) is
  'Read-only Store 360 core projection. Exact store_id only; no name/phone identity fallback.';

revoke all on function public.store_360_core(text) from public;
revoke all on function public.store_360_core(text) from anon;
grant execute on function public.store_360_core(text) to authenticated;
