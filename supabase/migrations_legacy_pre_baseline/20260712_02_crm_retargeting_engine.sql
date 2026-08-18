-- CRM إعادة الاستهداف — المرحلة 1 (محرّك التصنيف).
-- عرض v_crm_retargeting: عميل فريد بالهاتف (دمج متاجره) + شريحة/أولوية/قناة من
-- أحدث snapshot للمتاجر. الأساس للداشبورد وصفحة الفرص.
-- الشرائح: negative_balance · topped_no_ship · linked_no_ship · new_active ·
--   registered_no_ship · active · stopped_recent(≤60ي) · stopped_long.
-- الأولوية A/B/C/D (+FIN للرصيد السالب، none للنشط). القناة: call/whatsapp/
--   whatsapp_balance/activation/grow/finance. high_value = ≥300 شحنة تراكمية.
create or replace view public.v_crm_retargeting as
with latest as (select snapshot_id from public.merchants order by uploaded_at desc limit 1),
m as (
  select * from public.merchants
  where snapshot_id = (select snapshot_id from latest)
    and phone is not null and btrim(phone) <> ''
),
cust as (
  select
    phone,
    count(*)::int as store_count,
    (array_agg(store_name order by coalesce(shipment_count,0) desc))[1] as primary_store,
    array_agg(distinct store_name) as store_names,
    sum(coalesce(shipment_count,0))::bigint as total_shipments,
    max(last_shipment_at) as last_shipment,
    round(sum(coalesce(wallet_balance,0))::numeric,2) as wallet,
    max(last_topup_at) as last_topup,
    min(created_at_platform) as created_at,
    bool_or(status = 'نشط') as any_active,
    (array_agg(integration_type order by coalesce(shipment_count,0) desc) filter (where integration_type is not null))[1] as integration_type,
    (array_agg(billing_type order by coalesce(shipment_count,0) desc) filter (where billing_type is not null))[1] as billing_type,
    bool_or(profile_status = 'مكتمل') as profile_done,
    bool_or(verification_status = 'موثق') as verified,
    bool_or(coalesce(vat_registered,false)) as vat_reg
  from m group by phone
),
classified as (
  select c.*,
    case when c.last_shipment is not null then (current_date - c.last_shipment::date)::int end as days_since_last,
    (c.total_shipments >= 300) as high_value,
    case
      when c.wallet < -0.5 then 'negative_balance'
      when c.total_shipments = 0 then
        case
          when c.last_topup is not null then 'topped_no_ship'
          when c.integration_type is not null then 'linked_no_ship'
          when c.any_active then 'new_active'
          else 'registered_no_ship'
        end
      when c.any_active then 'active'
      when (current_date - c.last_shipment::date) <= 60 then 'stopped_recent'
      else 'stopped_long'
    end as segment
  from cust c
)
select cl.*,
  case
    when segment = 'active' then null
    when segment = 'negative_balance' then 'FIN'
    when segment in ('stopped_recent','stopped_long') and (high_value or billing_type = 'دفع لاحق') then 'A'
    when segment = 'stopped_recent' and wallet > 0.5 then 'A'
    when segment in ('stopped_recent','topped_no_ship') then 'B'
    when segment = 'stopped_long' and total_shipments >= 50 then 'B'
    when segment in ('linked_no_ship','new_active','registered_no_ship') then 'C'
    else 'D'
  end as priority,
  case
    when segment = 'active' then 'grow'
    when segment = 'negative_balance' then 'finance'
    when high_value then 'call'
    when wallet > 0.5 then 'whatsapp_balance'
    when segment in ('linked_no_ship','new_active','registered_no_ship') then 'activation'
    else 'whatsapp'
  end as channel
from classified cl;

create or replace function public.crm_retargeting_summary()
returns json language sql stable security definer set search_path to public as $$
  with v as (select * from public.v_crm_retargeting),
  base as (
    select
      (select count(*) from public.merchants
        where snapshot_id = (select snapshot_id from public.merchants order by uploaded_at desc limit 1)) as total_stores,
      count(*) as unique_customers,
      count(*) filter (where segment = 'active') as active,
      count(*) filter (where segment in ('stopped_recent','stopped_long')) as stopped,
      count(*) filter (where segment in ('registered_no_ship','new_active','linked_no_ship','topped_no_ship')) as never_shipped,
      count(*) filter (where high_value) as high_value,
      count(*) filter (where wallet > 0.5) as with_balance,
      count(*) filter (where segment = 'negative_balance') as negative_balance,
      count(*) filter (where priority = 'A') as prio_a,
      round(coalesce(sum(wallet) filter (where wallet > 0.5), 0)::numeric, 2) as balance_total,
      coalesce(sum(total_shipments), 0) as total_shipments
    from v
  )
  select json_build_object(
    'stats', (select row_to_json(base) from base),
    'segments',     (select coalesce(json_object_agg(segment, cnt), '{}') from (select segment, count(*) cnt from v group by segment) s),
    'priorities',   (select coalesce(json_object_agg(coalesce(priority,'none'), cnt), '{}') from (select priority, count(*) cnt from v group by priority) p),
    'integrations', (select coalesce(json_object_agg(coalesce(integration_type,'(بلا ربط)'), cnt), '{}') from (select integration_type, count(*) cnt from v group by integration_type) i)
  );
$$;

revoke all on function public.crm_retargeting_summary() from public;
grant execute on function public.crm_retargeting_summary() to authenticated;
