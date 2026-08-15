-- Focused collection-campaign slices. These amounts are intentionally kept
-- separate from the general accounting aging contract:
--   * invoice buckets contain overdue invoice lines only (day 1+)
--   * opening balances have their own explicit bucket
-- This prevents an opening balance dated in January from leaking into the
-- "+90 invoice" campaign and prevents not-yet-due invoices (age_days = 0)
-- from leaking into the first overdue bucket.

create or replace function public.customer_collection_campaign_buckets()
returns json
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with bucketed as materialized (
    select
      l.contact_id::text as zoho_id,
      l.contact_name,
      coalesce(sum(l.collectible_amount) filter (
        where l.line_kind = 'invoice' and l.age_days between 1 and 15
      ), 0) as inv_1_15,
      coalesce(sum(l.collectible_amount) filter (
        where l.line_kind = 'invoice' and l.age_days between 16 and 30
      ), 0) as inv_16_30,
      coalesce(sum(l.collectible_amount) filter (
        where l.line_kind = 'invoice' and l.age_days between 31 and 60
      ), 0) as inv_31_60,
      coalesce(sum(l.collectible_amount) filter (
        where l.line_kind = 'invoice' and l.age_days between 61 and 90
      ), 0) as inv_61_90,
      coalesce(sum(l.collectible_amount) filter (
        where l.line_kind = 'invoice' and l.age_days > 90
      ), 0) as inv_90p,
      coalesce(sum(l.collectible_amount) filter (
        where l.line_kind = 'opening_balance'
      ), 0) as opening_balance
    from public.customer_collectible_lines l
    where l.collectible_amount > 0.005
    group by l.contact_id, l.contact_name
  ), eligible as materialized (
    select *
    from bucketed b
    where b.inv_1_15 + b.inv_16_30 + b.inv_31_60
        + b.inv_61_90 + b.inv_90p + b.opening_balance > 0.005
  )
  select json_build_object(
    'aging', json_build_object(
      'inv_1_15', coalesce(round(sum(e.inv_1_15)::numeric, 2), 0),
      'inv_16_30', coalesce(round(sum(e.inv_16_30)::numeric, 2), 0),
      'inv_31_60', coalesce(round(sum(e.inv_31_60)::numeric, 2), 0),
      'inv_61_90', coalesce(round(sum(e.inv_61_90)::numeric, 2), 0),
      'inv_90p', coalesce(round(sum(e.inv_90p)::numeric, 2), 0),
      'opening_balance', coalesce(round(sum(e.opening_balance)::numeric, 2), 0)
    ),
    'customers', coalesce(json_agg(json_build_object(
      'zoho_id', e.zoho_id,
      'name', e.contact_name,
      'inv_1_15', round(e.inv_1_15::numeric, 2),
      'inv_16_30', round(e.inv_16_30::numeric, 2),
      'inv_31_60', round(e.inv_31_60::numeric, 2),
      'inv_61_90', round(e.inv_61_90::numeric, 2),
      'inv_90p', round(e.inv_90p::numeric, 2),
      'opening_balance', round(e.opening_balance::numeric, 2)
    ) order by (
      e.inv_1_15 + e.inv_16_30 + e.inv_31_60
      + e.inv_61_90 + e.inv_90p + e.opening_balance
    ) desc), '[]'::json)
  )
  from eligible e;
$function$;

comment on function public.customer_collection_campaign_buckets() is
  'Read-only, invoice-only overdue campaign buckets plus a separate unpaid opening-balance bucket.';

revoke all on function public.customer_collection_campaign_buckets() from public, anon;
grant execute on function public.customer_collection_campaign_buckets() to authenticated;
