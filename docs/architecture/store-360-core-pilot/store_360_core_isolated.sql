-- store_360_core isolated prototype.
-- TEST ONLY: this file is not a migration and must never be applied to Production.

create schema if not exists auth;
create schema if not exists pilot_store360;

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create table pilot_store360.profiles (
  id uuid primary key,
  name text not null,
  role text not null default 'accountant',
  permissions jsonb not null default '{}'::jsonb
);

create table pilot_store360.merchants (
  id bigint generated always as identity primary key,
  snapshot_id text not null,
  snapshot_date date not null,
  store_id text not null,
  store_name text not null,
  phone text,
  shipment_count integer not null default 0,
  last_shipment_at timestamptz,
  integration_type text,
  billing_type text,
  status text,
  created_at_platform timestamptz,
  last_topup_at timestamptz,
  wallet_balance numeric(14,2) not null default 0,
  uploaded_at timestamptz not null
);

create unique index merchants_snapshot_store_uidx
  on pilot_store360.merchants(snapshot_id, store_id);
create index merchants_store_id_idx
  on pilot_store360.merchants(store_id);
create index merchants_uploaded_at_snapshot_idx
  on pilot_store360.merchants(uploaded_at desc, snapshot_id);

create table pilot_store360.customer_merchant_links (
  customer_name text primary key,
  store_id text,
  confidence numeric(3,2),
  match_method text,
  linked_at timestamptz not null default now()
);
create index customer_merchant_links_store_idx
  on pilot_store360.customer_merchant_links(store_id);

create table pilot_store360.zoho_contacts (
  zoho_id text primary key,
  contact_name text,
  contact_type text,
  outstanding_receivable numeric not null default 0,
  unused_credits_receivable numeric not null default 0,
  status text,
  synced_at timestamptz,
  opening_balance_configured numeric,
  opening_balance_checked_at timestamptz
);

create table pilot_store360.zoho_invoices (
  zoho_id text primary key,
  invoice_number text,
  customer_name text,
  customer_id text,
  date date,
  due_date date,
  balance numeric,
  status text,
  synced_at timestamptz,
  invoice_type text
);
create index zoho_invoices_customer_name_idx
  on pilot_store360.zoho_invoices(customer_name);
create index zoho_invoices_customer_id_idx
  on pilot_store360.zoho_invoices(customer_id) where customer_id is not null;

create table pilot_store360.zoho_payments (
  zoho_id text primary key,
  customer_name text,
  customer_id text,
  date date,
  amount numeric,
  synced_at timestamptz
);
create index zoho_payments_customer_date_idx
  on pilot_store360.zoho_payments(customer_name, date desc);
create index zoho_payments_customer_id_idx
  on pilot_store360.zoho_payments(customer_id) where customer_id is not null;

create table pilot_store360.zoho_sync_state (
  entity text primary key,
  last_sync timestamptz,
  last_status text,
  last_error text,
  updated_at timestamptz not null default now()
);

create table pilot_store360.collection_tasks (
  id uuid primary key,
  customer_name text not null,
  trigger text not null,
  stage text not null,
  debt_at_creation numeric not null default 0,
  promise_amount numeric,
  promise_date date,
  promise_status text,
  snooze_until timestamptz,
  assigned_to uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  done_at timestamptz
);
create unique index collection_tasks_open_unique
  on pilot_store360.collection_tasks(customer_name, trigger)
  where stage in ('todo','contacted','promised','snoozed');
create index collection_tasks_assignee_open_idx
  on pilot_store360.collection_tasks(assigned_to, stage, promise_date, created_at desc)
  where stage in ('todo','contacted','promised','snoozed');

create table pilot_store360.retargeting_followups (
  phone text primary key,
  status text not null default 'new',
  owner_id uuid,
  next_action_at timestamptz,
  last_touch_at timestamptz,
  updated_at timestamptz not null,
  sales_stage text not null default 'new',
  next_action_type text not null default 'call'
);
create index retargeting_followups_owner_next_open_idx
  on pilot_store360.retargeting_followups(owner_id, next_action_at)
  where sales_stage not in ('won','disqualified');

create table pilot_store360.merchant_lifecycle_events (
  id bigint generated always as identity primary key,
  snapshot_id text not null,
  previous_snapshot_id text not null,
  store_id text not null,
  event_type text not null,
  observed_at timestamptz not null
);
create index merchant_lifecycle_events_store_observed_idx
  on pilot_store360.merchant_lifecycle_events(store_id, observed_at desc);

create or replace view pilot_store360.customer_ar as
select
  c.contact_name,
  c.zoho_id,
  coalesce(c.outstanding_receivable, 0::numeric) as total_due,
  coalesce(inv.invoiced_due, 0::numeric) as invoiced_due,
  round(least(greatest(calc.balance_residual, 0::numeric), greatest(coalesce(c.opening_balance_configured, 0::numeric), 0::numeric)), 2) as opening_due,
  coalesce(inv.open_count, 0::bigint) as open_invoices,
  inv.oldest_invoice_date,
  coalesce(inv.days_oldest, 0) as days_oldest,
  coalesce(c.unused_credits_receivable, 0::numeric) as unused_credits,
  c.status,
  round(greatest(coalesce(c.outstanding_receivable, 0::numeric) - greatest(coalesce(c.unused_credits_receivable, 0::numeric), 0::numeric), 0::numeric), 2) as collectible_due,
  case
    when abs(calc.balance_residual) <= 0.5 then 'valid'::text
    when greatest(coalesce(c.unused_credits_receivable, 0::numeric), 0::numeric) >= greatest(coalesce(c.outstanding_receivable, 0::numeric), 0::numeric) - 0.005 then 'valid'::text
    when c.opening_balance_checked_at is null then 'unchecked'::text
    else 'mismatch'::text
  end as balance_integrity_status
from pilot_store360.zoho_contacts c
left join lateral (
  select coalesce(sum(i.balance), 0::numeric) invoiced_due,
         count(*) open_count,
         min(i.date) oldest_invoice_date,
         current_date - min(i.date) days_oldest
  from pilot_store360.zoho_invoices i
  where (i.customer_id = c.zoho_id or (i.customer_id is null and i.customer_name = c.contact_name))
    and i.balance > 0.5
) inv on true
cross join lateral (
  select round(coalesce(c.outstanding_receivable, 0::numeric) - coalesce(inv.invoiced_due, 0::numeric), 2) balance_residual
) calc
where c.contact_type = 'customer';

create or replace view pilot_store360.customer_collectible_lines as
with balances as (
  select ar.contact_name, ar.zoho_id contact_id,
         greatest(coalesce(ar.opening_due,0),0) opening_gross,
         greatest(coalesce(ar.unused_credits,0),0) available_credit,
         least(greatest(coalesce(ar.opening_due,0),0), greatest(coalesce(ar.unused_credits,0),0)) opening_credit,
         greatest(greatest(coalesce(ar.unused_credits,0),0)-greatest(coalesce(ar.opening_due,0),0),0) invoice_credit
  from pilot_store360.customer_ar ar
  where ar.balance_integrity_status='valid'
), invoice_base as (
  select b.contact_name,b.contact_id,i.zoho_id line_id,i.invoice_number,i.date line_date,
         coalesce(i.due_date,i.date) due_date,i.status,i.balance gross_amount,b.invoice_credit,
         coalesce(sum(i.balance) over(partition by b.contact_id order by coalesce(i.due_date,i.date),i.date,i.zoho_id rows between unbounded preceding and 1 preceding),0) prior_gross
  from balances b
  join pilot_store360.zoho_invoices i on i.customer_id=b.contact_id or (i.customer_id is null and i.customer_name=b.contact_name)
  where i.balance>0.5
), invoice_lines as (
  select contact_name,contact_id,'invoice'::text line_kind,line_id,invoice_number,line_date,due_date,status,gross_amount,
         least(gross_amount,greatest(invoice_credit-prior_gross,0)) allocated_credit
  from invoice_base
), opening_lines as (
  select contact_name,contact_id,'opening_balance'::text line_kind,null::text line_id,null::text invoice_number,
         date '2026-01-10' line_date,date '2026-01-10' due_date,'opening_balance'::text status,
         opening_gross gross_amount,opening_credit allocated_credit
  from balances where opening_gross>0.005
)
select contact_name,contact_id,line_kind,line_id,invoice_number,line_date,due_date,status,
       round(gross_amount,2) gross_amount,round(allocated_credit,2) allocated_credit,
       round(greatest(gross_amount-allocated_credit,0),2) collectible_amount,
       greatest(current_date-due_date,0) age_days
from (select * from opening_lines union all select * from invoice_lines) lines;

create or replace function pilot_store360.has_permission(p_uid uuid, p_key text)
returns boolean
language sql
stable
set search_path=''
as $$
  select exists(
    select 1 from pilot_store360.profiles p
    where p.id=p_uid and (p.role='admin' or coalesce((p.permissions->>p_key)::boolean,false))
  )
$$;

create or replace function pilot_store360.has_any_permission(p_uid uuid, p_keys text[])
returns boolean
language sql
stable
set search_path=''
as $$
  select exists(
    select 1 from pilot_store360.profiles p
    where p.id=p_uid and (p.role='admin' or exists(
      select 1 from unnest(coalesce(p_keys,'{}'::text[])) k
      where coalesce((p.permissions->>k)::boolean,false)
    ))
  )
$$;

create or replace function pilot_store360.source_state(
  p_source text,
  p_data_as_of timestamptz,
  p_last_success timestamptz,
  p_last_status text,
  p_fresh interval,
  p_stale interval,
  p_error text default null
)
returns jsonb
language sql
stable
set search_path=''
as $$
  select jsonb_build_object(
    'source',p_source,
    'dataAsOf',p_data_as_of,
    'lastSuccessfulSyncAt',p_last_success,
    'availabilityStatus',case when p_data_as_of is null then 'unavailable' else 'available' end,
    'freshnessStatus',case
      when p_data_as_of is null then 'failed'
      when lower(coalesce(p_last_status,'succeeded')) in ('failed','error') then 'failed'
      when now()-p_data_as_of<=p_fresh then 'fresh'
      when now()-p_data_as_of<=p_stale then 'delayed'
      else 'stale' end,
    'errorCode',case when lower(coalesce(p_last_status,'succeeded')) in ('failed','error') then coalesce(p_error,'source_failed') else null end
  )
$$;

create or replace function pilot_store360.store_360_core(p_store_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_store_id text := btrim(p_store_id);
  v_identity_allowed boolean;
  v_finance_allowed boolean;
  v_collections_allowed boolean;
  v_sales_allowed boolean;
  v_sales_see_all boolean;
  v_collections_see_all boolean;
  v_store pilot_store360.merchants%rowtype;
  v_link_count integer := 0;
  v_resolved_count integer := 0;
  v_customer_name text;
  v_zoho_id text;
  v_link jsonb;
  v_finance jsonb;
  v_payment jsonb;
  v_task jsonb;
  v_sales jsonb;
  v_identity_source jsonb;
  v_finance_source jsonb;
  v_payment_source jsonb;
  v_collection_source jsonb;
  v_sales_source jsonb;
  v_inv_sync pilot_store360.zoho_sync_state%rowtype;
  v_pay_sync pilot_store360.zoho_sync_state%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_store_id is null or v_store_id='' or length(v_store_id)>64 then raise exception 'invalid_store_id'; end if;

  v_identity_allowed := pilot_store360.has_any_permission(v_uid,array['merchants.view','receivables.view','sales.view','crm.view']);
  v_finance_allowed := pilot_store360.has_permission(v_uid,'receivables.view');
  v_collections_allowed := pilot_store360.has_permission(v_uid,'collections.view');
  v_sales_allowed := pilot_store360.has_any_permission(v_uid,array['sales.view','crm.view']);
  v_sales_see_all := pilot_store360.has_permission(v_uid,'crm.view_all');
  v_collections_see_all := pilot_store360.has_permission(v_uid,'collections.view_all');
  if not (v_identity_allowed or v_finance_allowed or v_collections_allowed or v_sales_allowed) then raise exception 'not_allowed'; end if;

  select m.* into v_store
  from pilot_store360.merchants m
  where m.snapshot_id=(select snapshot_id from pilot_store360.merchants order by uploaded_at desc limit 1)
    and m.store_id=v_store_id
  limit 1;
  if not found then raise exception 'store_not_found'; end if;

  v_identity_source := pilot_store360.source_state('lamha.merchant_snapshot',v_store.uploaded_at,v_store.uploaded_at,'succeeded',interval '18 hours',interval '24 hours');

  select count(*)::int,min(l.customer_name) into v_link_count,v_customer_name
  from pilot_store360.customer_merchant_links l where l.store_id=v_store_id;
  if v_link_count=1 then
    select count(*)::int,min(ar.zoho_id) into v_resolved_count,v_zoho_id
    from pilot_store360.customer_ar ar where ar.contact_name=v_customer_name;
  end if;

  v_link := case
    when v_link_count=0 then jsonb_build_object('status','unlinked','accountCount',0)
    when v_link_count>1 then jsonb_build_object('status','ambiguous','accountCount',v_link_count)
    when v_resolved_count=0 then jsonb_build_object('status','unresolved','accountCount',1)
    when v_resolved_count>1 then jsonb_build_object('status','ambiguous','accountCount',v_resolved_count)
    else jsonb_build_object('status','resolved','accountCount',1,'zohoContactId',v_zoho_id)
  end;

  select * into v_inv_sync from pilot_store360.zoho_sync_state where entity='invoices';
  select * into v_pay_sync from pilot_store360.zoho_sync_state where entity='customerpayments';
  v_finance_source := pilot_store360.source_state('zoho.customer_ar+customer_collectible_lines',v_inv_sync.last_sync,v_inv_sync.last_sync,v_inv_sync.last_status,interval '45 minutes',interval '90 minutes',v_inv_sync.last_error);
  v_payment_source := pilot_store360.source_state('zoho.customerpayments',v_pay_sync.last_sync,v_pay_sync.last_sync,v_pay_sync.last_status,interval '45 minutes',interval '90 minutes',v_pay_sync.last_error);

  if v_finance_allowed and v_link->>'status'='resolved' then
    select jsonb_build_object(
      'zohoContactId',ar.zoho_id,
      'collectibleDue',round(ar.collectible_due,2),
      'overdue',round(coalesce(a.overdue,0),2),
      'oldestAgeDays',coalesce(a.oldest_age_days,0),
      'openInvoiceCount',coalesce(a.invoice_count,0),
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
        'reconciliationStatus',case when abs(ar.collectible_due-coalesce(a.bucket_sum,0))<=0.01 then 'matched' else 'needs_review' end
      ),
      'fieldSources',jsonb_build_object(
        'collectibleDue','customer_ar.collectible_due',
        'overdue','customer_collectible_lines',
        'aging','customer_collectible_lines',
        'oldestAgeDays','customer_collectible_lines',
        'openInvoiceCount','customer_collectible_lines'
      )
    ) into v_finance
    from pilot_store360.customer_ar ar
    left join lateral (
      select
        sum(l.collectible_amount) filter(where l.line_kind='opening_balance' or lower(coalesce(l.status,''))='overdue') overdue,
        max(l.age_days) filter(where l.collectible_amount>0.005) oldest_age_days,
        count(*) filter(where l.line_kind='invoice' and l.collectible_amount>0.5)::int invoice_count,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days=0) due_today,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days between 1 and 15) inv_1_15,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days between 16 and 30) inv_16_30,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days between 31 and 60) inv_31_60,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days between 61 and 90) inv_61_90,
        sum(l.collectible_amount) filter(where l.line_kind='invoice' and l.age_days>90) inv_90p,
        sum(l.collectible_amount) filter(where l.line_kind='opening_balance') opening_balance,
        sum(l.collectible_amount) bucket_sum
      from pilot_store360.customer_collectible_lines l
      where l.contact_id=ar.zoho_id and l.collectible_amount>0.005
    ) a on true
    where ar.zoho_id=v_zoho_id
      and ar.collectible_due>0.5;

    if v_finance is not null then
      select jsonb_build_object(
        'date',p.date,'amount',round(p.amount,2),'fieldSources',jsonb_build_object('date','zoho_payments.date','amount','zoho_payments.amount')
      ) into v_payment
      from (
        select date,sum(amount) amount from pilot_store360.zoho_payments
        where customer_name=v_customer_name
          and date=(select max(date) from pilot_store360.zoho_payments where customer_name=v_customer_name)
        group by date
      ) p;
    end if;
  end if;

  if v_collections_allowed and v_link->>'status'='resolved' then
    select jsonb_build_object(
      'taskId',t.id,'stage',t.stage,'assignedTo',t.assigned_to,
      'promiseAmount',t.promise_amount,'promiseDate',t.promise_date,'promiseStatus',t.promise_status,
      'snoozeUntil',t.snooze_until,'updatedAt',t.updated_at,
      'fieldSources',jsonb_build_object('stage','collection_tasks','promise','collection_tasks','owner','collection_tasks')
    ) into v_task
    from pilot_store360.collection_tasks t
    where t.customer_name=v_customer_name
      and t.stage in ('todo','contacted','promised','snoozed') and t.done_at is null
      and (v_collections_see_all or t.assigned_to=v_uid)
    order by t.updated_at desc limit 1;
  end if;
  v_collection_source := pilot_store360.source_state('local.collection_tasks',coalesce((v_task->>'updatedAt')::timestamptz,now()),null,'succeeded',interval '365 days',interval '365 days');

  if v_sales_allowed then
    select jsonb_build_object(
      'stage',f.sales_stage,'lastOutcome',f.status,'ownerId',f.owner_id,
      'nextActionAt',f.next_action_at,'nextActionType',f.next_action_type,
      'lastTouchAt',f.last_touch_at,'updatedAt',f.updated_at,
      'fieldSources',jsonb_build_object('stage','retargeting_followups','owner','retargeting_followups','nextAction','retargeting_followups')
    ) into v_sales
    from pilot_store360.retargeting_followups f
    where f.phone=v_store.phone and (v_sales_see_all or f.owner_id is null or f.owner_id=v_uid)
    limit 1;
  end if;
  v_sales_source := pilot_store360.source_state('local.retargeting_followups+lamha.merchant_snapshot',greatest(v_store.uploaded_at,coalesce((v_sales->>'updatedAt')::timestamptz,v_store.uploaded_at)),v_store.uploaded_at,'succeeded',interval '18 hours',interval '24 hours');

  return jsonb_build_object(
    'contractVersion',1,
    'storeId',v_store_id,
    'generatedAt',now(),
    'sections',jsonb_build_object(
      'identity',case when v_identity_allowed then jsonb_build_object(
        'visibility','visible','status','available','data',jsonb_build_object(
          'storeId',v_store.store_id,'storeName',v_store.store_name,'phone',v_store.phone,
          'status',v_store.status,'integrationType',v_store.integration_type,'billingType',v_store.billing_type,
          'shipmentCount',v_store.shipment_count,'lastShipmentAt',v_store.last_shipment_at,
          'walletBalance',v_store.wallet_balance,'createdAt',v_store.created_at_platform,'lastTopupAt',v_store.last_topup_at
        ),'source',v_identity_source,
        'fieldSources',jsonb_build_object('storeId','merchants.store_id','storeName','merchants.store_name','phone','merchants.phone','status','merchants.status','operatingMetrics','merchants')
      ) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'financialLink',case when v_finance_allowed then jsonb_build_object('visibility','visible','status',v_link->>'status','data',v_link,'source',jsonb_build_object('source','customer_merchant_links','dataAsOf',(select max(linked_at) from pilot_store360.customer_merchant_links where store_id=v_store_id),'lastSuccessfulSyncAt',null,'freshnessStatus','fresh','availabilityStatus','available')) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'finance',case when v_finance_allowed then jsonb_build_object('visibility','visible','status',case when v_link->>'status'='resolved' then case when v_finance is null then 'empty' when v_finance#>>'{aging,reconciliationStatus}'='needs_review' then 'needs_review' else 'available' end else v_link->>'status' end,'data',v_finance,'source',v_finance_source) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'lastPayment',case when v_finance_allowed then jsonb_build_object('visibility','visible','status',case when v_link->>'status'='resolved' then case when v_payment is null then 'empty' else 'available' end else v_link->>'status' end,'data',v_payment,'source',v_payment_source) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'collections',case when v_collections_allowed then jsonb_build_object('visibility','visible','status',case when v_link->>'status'='resolved' then case when v_task is null then 'empty' else 'available' end else v_link->>'status' end,'data',v_task,'source',v_collection_source) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end,
      'sales',case when v_sales_allowed then jsonb_build_object('visibility','visible','status',case when v_sales is null then 'empty' else 'available' end,'data',v_sales,'source',v_sales_source) else jsonb_build_object('visibility','restricted','status','restricted','data',null,'source',null) end
    )
  );
end;
$$;

revoke all on function pilot_store360.store_360_core(text) from public,anon;
grant execute on function pilot_store360.store_360_core(text) to authenticated;

-- Production-like synthetic volume: 51k merchant history, 1.1k contacts,
-- 6k invoices/payments, 89 collection tasks and 234 sales followups.
insert into pilot_store360.profiles(id,name,role,permissions) values
('00000000-0000-0000-0000-000000000001','Admin','admin','{}'),
('00000000-0000-0000-0000-000000000002','Identity','accountant','{"merchants.view":true}'),
('00000000-0000-0000-0000-000000000003','Finance','accountant','{"receivables.view":true}'),
('00000000-0000-0000-0000-000000000004','Collector','accountant','{"receivables.view":true,"collections.view":true}'),
('00000000-0000-0000-0000-000000000005','Sales','accountant','{"sales.view":true}'),
('00000000-0000-0000-0000-000000000006','None','accountant','{}'),
('00000000-0000-0000-0000-000000000007','Other collector','accountant','{"collections.view":true}');

insert into pilot_store360.merchants(snapshot_id,snapshot_date,store_id,store_name,phone,shipment_count,last_shipment_at,integration_type,billing_type,status,created_at_platform,last_topup_at,wallet_balance,uploaded_at)
select 'snapshot-'||lpad(s::text,2,'0'),current_date-(34-s),g::text,'Store '||g,
       case when g in (1499,1500) then '+966500000000' else '+9665'||lpad(g::text,8,'0') end,
       (g*7+s)%9000,now()-(((g+s)%250)||' days')::interval,
       case when g%3=0 then 'salla' else 'direct' end,
       case when g%5=0 then 'دفع مسبق' else 'دفع آجل' end,
       case when g%7=0 then 'غير نشط' else 'نشط' end,
       now()-(((g%1200)+40)||' days')::interval,
       now()-(((g%120)+1)||' days')::interval,
       ((g*17)%10000)::numeric/10,
       now()-((34-s)||' days')::interval
from generate_series(1,34) s cross join generate_series(1,1500) g;

insert into pilot_store360.zoho_contacts(zoho_id,contact_name,contact_type,outstanding_receivable,unused_credits_receivable,status,synced_at,opening_balance_configured,opening_balance_checked_at)
select 'ZC'||g,'Customer '||g,'customer',0,case when g%20=0 then 25 else 0 end,'active',now(),case when g%10=0 then 100 else 0 end,now()
from generate_series(1,1088) g;
insert into pilot_store360.zoho_contacts(zoho_id,contact_name,contact_type,outstanding_receivable,unused_credits_receivable,status,synced_at,opening_balance_configured,opening_balance_checked_at)
select 'ZA'||g,'Alt Customer '||g,'customer',0,0,'active',now(),0,now() from generate_series(1,33) g;

insert into pilot_store360.customer_merchant_links(customer_name,store_id,confidence,match_method,linked_at)
select 'Customer '||g,g::text,1,'manual',now()-interval '30 days' from generate_series(1,994) g;
insert into pilot_store360.customer_merchant_links(customer_name,store_id,confidence,match_method,linked_at)
select 'Alt Customer '||g,g::text,1,'manual',now()-interval '20 days' from generate_series(1,33) g;

insert into pilot_store360.zoho_invoices(zoho_id,invoice_number,customer_name,customer_id,date,due_date,balance,status,synced_at,invoice_type)
select 'ZI'||i,'INV-'||i,'Customer '||g,'ZC'||g,current_date-((i*11)%200),current_date-((i*7)%181),
       ((i*37)%490+10)::numeric,
       case when ((i*7)%181)=0 then 'sent' else 'overdue' end,now(),'invoice'
from generate_series(1,6077) i cross join lateral (select ((i-1)%900)+1 g) x;

update pilot_store360.zoho_contacts c
set outstanding_receivable=coalesce(x.invoice_sum,0)+coalesce(c.opening_balance_configured,0)
from (select customer_id,sum(balance) invoice_sum from pilot_store360.zoho_invoices group by customer_id) x
where c.zoho_id=x.customer_id;

insert into pilot_store360.zoho_payments(zoho_id,customer_name,customer_id,date,amount,synced_at)
select 'ZP'||i,'Customer '||g,'ZC'||g,current_date-(i%300),((i*19)%800+20)::numeric,now()
from generate_series(1,6072) i cross join lateral (select ((i-1)%900)+1 g) x;

insert into pilot_store360.collection_tasks(id,customer_name,trigger,stage,debt_at_creation,promise_amount,promise_date,promise_status,snooze_until,assigned_to,created_at,updated_at)
select ('10000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'Customer '||g,'aging',
       case when g%3=0 then 'promised' else 'todo' end,1000+g,
       case when g%3=0 then 500+g else null end,case when g%3=0 then current_date+7 else null end,
       case when g%3=0 then 'open' else null end,null,
       case when g%2=0 then '00000000-0000-0000-0000-000000000004'::uuid else '00000000-0000-0000-0000-000000000007'::uuid end,
       now()-interval '5 days',now()-((g%24)||' hours')::interval
from generate_series(1,89) g;

insert into pilot_store360.retargeting_followups(phone,status,owner_id,next_action_at,last_touch_at,updated_at,sales_stage,next_action_type)
select '+9665'||lpad(g::text,8,'0'),'contacted','00000000-0000-0000-0000-000000000005',now()+((g%10)||' days')::interval,now()-((g%20)||' days')::interval,now()-((g%10)||' hours')::interval,'qualified','call'
from generate_series(1,234) g;

insert into pilot_store360.merchant_lifecycle_events(snapshot_id,previous_snapshot_id,store_id,event_type,observed_at)
select 'snapshot-34','snapshot-33',((g-1)%1500+1)::text,case when g%2=0 then 'shipping_resumed' else 'status_changed' end,now()-((g%60)||' days')::interval
from generate_series(1,2955) g;

insert into pilot_store360.zoho_sync_state(entity,last_sync,last_status,last_error)
values ('invoices',now()-interval '10 minutes','succeeded',null),('customerpayments',now()-interval '12 minutes','succeeded',null);

analyze pilot_store360.merchants;
analyze pilot_store360.customer_merchant_links;
analyze pilot_store360.zoho_contacts;
analyze pilot_store360.zoho_invoices;
analyze pilot_store360.zoho_payments;
analyze pilot_store360.collection_tasks;
analyze pilot_store360.retargeting_followups;
