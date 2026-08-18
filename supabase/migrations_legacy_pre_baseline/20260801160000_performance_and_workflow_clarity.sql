-- Performance + workflow clarity (2026-08-01)
--
-- 1) Aggregate the CRM board in Postgres instead of downloading ~94k leads.
-- 2) Return forecast receivable buckets and carrier balances as small rollups.
-- 3) Search merchants + Zoho invoices in one request.
-- 4) Retire historical Hatif inbound-reply tasks. Hatif owns those replies;
--    explicit IVR callback requests and employee-created tasks remain untouched.

create or replace function public.crm_board_stats()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with
  params as (
    select now() - interval '7 days' as week_ago
  ),
  lead_by_owner as (
    select
      l.owner_id,
      count(*)::bigint as assigned_leads,
      count(*) filter (where l.status not in ('converted', 'lost', 'existing_customer'))::bigint as open_leads,
      count(*) filter (where l.matched_store_id is not null or l.status = 'existing_customer')::bigint as existing_customers
    from public.crm_leads l
    group by l.owner_id
  ),
  activity_by_owner as (
    select a.owner_id, count(*)::bigint as touches_this_week
    from public.crm_activities a, params p
    where a.occurred_at >= p.week_ago
      and a.kind in ('call', 'whatsapp', 'note', 'visit', 'meeting')
    group by a.owner_id
  ),
  task_by_owner as (
    select
      t.assigned_to as owner_id,
      count(*) filter (where t.status = 'open')::bigint as tasks_open,
      count(*) filter (
        where t.status = 'done'
          and t.completed_at >= (select week_ago from params)
      )::bigint as tasks_done_this_week
    from public.crm_tasks t
    group by t.assigned_to
  ),
  deal_by_owner as (
    select
      d.owner_id,
      count(*) filter (where d.status = 'open')::bigint as deals_open,
      count(*) filter (where d.status = 'won')::bigint as deals_won,
      coalesce(sum(d.value) filter (where d.status = 'won'), 0)::numeric as won_value
    from public.crm_deals d
    group by d.owner_id
  ),
  owner_ids as (
    select owner_id from lead_by_owner
    union select owner_id from activity_by_owner
    union select owner_id from task_by_owner
    union select owner_id from deal_by_owner
  ),
  owner_rows as (
    select
      o.owner_id,
      coalesce(l.assigned_leads, 0) as assigned_leads,
      coalesce(l.open_leads, 0) as open_leads,
      coalesce(l.existing_customers, 0) as existing_customers,
      coalesce(a.touches_this_week, 0) as touches_this_week,
      coalesce(t.tasks_open, 0) as tasks_open,
      coalesce(t.tasks_done_this_week, 0) as tasks_done_this_week,
      coalesce(d.deals_open, 0) as deals_open,
      coalesce(d.deals_won, 0) as deals_won,
      coalesce(d.won_value, 0) as won_value
    from owner_ids o
    left join lead_by_owner l on l.owner_id is not distinct from o.owner_id
    left join activity_by_owner a on a.owner_id is not distinct from o.owner_id
    left join task_by_owner t on t.owner_id is not distinct from o.owner_id
    left join deal_by_owner d on d.owner_id is not distinct from o.owner_id
  ),
  lead_total as (
    select
      count(*)::bigint as total,
      count(*) filter (where status not in ('converted', 'lost', 'existing_customer'))::bigint as open_count,
      count(*) filter (where matched_store_id is not null or status = 'existing_customer')::bigint as existing_count,
      count(*) filter (where duplicate_count > 1)::bigint as duplicate_count
    from public.crm_leads
  ),
  activity_total as (
    select count(*)::bigint as touches
    from public.crm_activities a, params p
    where a.occurred_at >= p.week_ago
      and a.kind in ('call', 'whatsapp', 'note', 'visit', 'meeting')
  ),
  promise_total as (
    select
      count(*) filter (where promise_status = 'open')::bigint as open_count,
      count(*) filter (where promise_status = 'kept')::bigint as kept_count,
      count(*) filter (where promise_status = 'broken')::bigint as broken_count
    from public.crm_activities
    where kind = 'promise'
  ),
  deal_total as (
    select
      count(*) filter (where status = 'open')::bigint as open_count,
      coalesce(sum(value) filter (where status = 'open'), 0)::numeric as pipeline_value,
      coalesce(sum(value) filter (where status = 'won'), 0)::numeric as won_value
    from public.crm_deals
  )
select jsonb_build_object(
  'touchesThisWeek', (select touches from activity_total),
  'promisesOpen', (select open_count from promise_total),
  'promisesKept', (select kept_count from promise_total),
  'promisesBroken', (select broken_count from promise_total),
  'dealsOpenCount', (select open_count from deal_total),
  'pipelineValue', (select pipeline_value from deal_total),
  'wonValue', (select won_value from deal_total),
  'leadsTotal', (select total from lead_total),
  'leadsOpen', (select open_count from lead_total),
  'leadsExistingCustomers', (select existing_count from lead_total),
  'leadsDuplicateRows', (select duplicate_count from lead_total),
  'byOwner', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'ownerId', owner_id,
        'assignedLeads', assigned_leads,
        'openLeads', open_leads,
        'existingCustomers', existing_customers,
        'touchesThisWeek', touches_this_week,
        'tasksOpen', tasks_open,
        'tasksDoneThisWeek', tasks_done_this_week,
        'dealsOpen', deals_open,
        'dealsWon', deals_won,
        'wonValue', won_value
      ) order by touches_this_week desc, open_leads desc
    )
    from owner_rows
  ), '[]'::jsonb)
);
$function$;

revoke all on function public.crm_board_stats() from public, anon;
grant execute on function public.crm_board_stats() to authenticated, service_role;

create or replace function public.forecast_receivables_rollup(
  p_horizon_days integer default 30,
  p_terms_days integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with prepared as (
  select
    (z.date + greatest(0, least(p_terms_days, 365)))::date as expected_date,
    coalesce(z.balance, 0)::numeric as balance
  from public.zoho_invoices z
  where z.balance > 0.5
    and z.date is not null
), buckets as (
  select expected_date, round(sum(balance), 2) as amount
  from prepared
  where expected_date >= current_date
    and expected_date <= current_date + greatest(1, least(p_horizon_days, 120))
  group by expected_date
  order by expected_date
)
select jsonb_build_object(
  'buckets', coalesce((
    select jsonb_agg(jsonb_build_object('date', expected_date, 'amount', amount) order by expected_date)
    from buckets
  ), '[]'::jsonb),
  'withinTotal', coalesce((select round(sum(amount), 2) from buckets), 0),
  'overdue', coalesce((select round(sum(balance), 2) from prepared where expected_date < current_date), 0)
);
$function$;

revoke all on function public.forecast_receivables_rollup(integer, integer) from public, anon;
grant execute on function public.forecast_receivables_rollup(integer, integer) to authenticated, service_role;

create or replace function public.carrier_open_balances_all()
returns table(
  carrier_id text,
  balance numeric,
  paid numeric,
  pending integer,
  disputed integer,
  reviewing integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    o.carrier_id,
    coalesce(sum(o.amount_dr - o.amount_cr) filter (where o.status is distinct from 'paid'), 0)::numeric as balance,
    coalesce(sum(o.amount_dr - o.amount_cr) filter (where o.status = 'paid'), 0)::numeric as paid,
    count(*) filter (where o.status = 'pending')::integer as pending,
    count(*) filter (where o.status = 'disputed')::integer as disputed,
    count(*) filter (where o.status = 'reviewing')::integer as reviewing
  from public.carrier_operations o
  group by o.carrier_id;
$function$;

revoke all on function public.carrier_open_balances_all() from public, anon;
grant execute on function public.carrier_open_balances_all() to authenticated, service_role;

create or replace function public.global_entity_search(
  p_term text,
  p_limit integer default 8
)
returns table(entity_kind text, payload jsonb)
language sql
stable
security invoker
set search_path = ''
as $function$
with params as (
  select
    btrim(regexp_replace(coalesce(p_term, ''), '[%,]+', ' ', 'g')) as term,
    regexp_replace(coalesce(p_term, ''), '\D', '', 'g') as digits,
    greatest(1, least(coalesce(p_limit, 8), 12)) as lim
), latest_snapshot as (
  select m.snapshot_id
  from public.merchants m
  order by m.uploaded_at desc
  limit 1
), merchant_hits as (
  select
    'merchant'::text as entity_kind,
    jsonb_build_object(
      'store_id', m.store_id,
      'store_name', m.store_name,
      'phone', m.phone,
      'status', m.status,
      'billing_type', m.billing_type,
      'shipment_count', m.shipment_count,
      'last_shipment_at', m.last_shipment_at,
      'wallet_balance', m.wallet_balance
    ) as payload,
    case
      when lower(m.store_name) = lower(p.term) or lower(m.store_id) = lower(p.term) then 0
      when lower(m.store_name) like lower(p.term) || '%' then 1
      else 2
    end as rank_no,
    coalesce(m.shipment_count, 0) as volume
  from public.merchants m
  cross join params p
  where m.snapshot_id = (select snapshot_id from latest_snapshot)
    and length(p.term) >= 2
    and (
      m.store_name ilike '%' || p.term || '%'
      or m.store_id ilike '%' || p.term || '%'
      or (length(p.digits) >= 4 and m.phone ilike '%' || p.digits || '%')
    )
  order by rank_no, volume desc
  limit (select lim from params)
), invoice_hits as (
  select
    'invoice'::text as entity_kind,
    jsonb_build_object(
      'zoho_id', z.zoho_id,
      'invoice_number', z.invoice_number,
      'customer_name', z.customer_name,
      'date', z.date,
      'due_date', z.due_date,
      'status', z.status,
      'total', z.total,
      'balance', z.balance
    ) as payload,
    case
      when lower(z.invoice_number) = lower(p.term) then 0
      when lower(z.invoice_number) like lower(p.term) || '%' then 1
      else 2
    end as rank_no,
    z.date
  from public.zoho_invoices z
  cross join params p
  where length(p.term) >= 2
    and (
      z.invoice_number ilike '%' || p.term || '%'
      or z.customer_name ilike '%' || p.term || '%'
    )
  order by rank_no, z.date desc nulls last
  limit (select lim from params)
)
select m.entity_kind, m.payload from merchant_hits m
union all
select i.entity_kind, i.payload from invoice_hits i;
$function$;

revoke all on function public.global_entity_search(text, integer) from public, anon;
grant execute on function public.global_entity_search(text, integer) to authenticated, service_role;

-- These rows were generated by the retired “inbound Hatif reply => CRM task”
-- flow. The exact entity/kind/title predicate protects employee-created tasks
-- and explicit IVR callback requests.
update public.crm_tasks
set status = 'cancelled', updated_at = now()
where status = 'open'
  and entity_type = 'retargeting'
  and kind = 'followup'
  and title like '↩️ ردّ وارد من %— تابِعه الآن';
