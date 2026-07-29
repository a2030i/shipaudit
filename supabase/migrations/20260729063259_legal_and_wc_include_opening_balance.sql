-- التصعيد القانوني: الرصيد الافتتاحي دين **بلا تاريخ فاتورة** فلا يمكن
-- تقادمه بالحساب — لكنه بحكم تعريفه أقدم دين لدى العميل (من التأسيس).
-- فيُحتسب ضمن شريحة **+90 يوم** ويدخل قائمة التصعيد. تجاهله كان يُخفي
-- 59 ألفاً من أقدم الديون عن الشاشة المخصّصة لأقدمها (§1.52).
create or replace function public.legal_escalation_dashboard()
 returns json language sql stable security definer set search_path to 'public'
as $function$
  with latest_merch as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  merch as (
    select store_id, store_name, phone, billing_type, status, wallet_balance, last_shipment_at,
           normalize_arabic_name(store_name) norm
    from merchants where snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as (select customer_name, store_id from customer_merchant_links where store_id is not null),
  open_inv as (
    select customer_name, balance, (current_date - date)::int as age
    from zoho_invoices where balance > 0.5 and customer_name is not null
  ),
  -- الرصيد الافتتاحي لكل عميل (فرق إجمالي زوهو عن مجموع فواتيره)
  opening as (
    select contact_name as customer_name, opening_due
    from customer_ar where opening_due > 0.5
  ),
  aging as (
    select
      coalesce(sum(balance) filter (where age between 31 and 60), 0) as b31_60,
      coalesce(sum(balance) filter (where age between 61 and 90), 0) as b61_90,
      coalesce(sum(balance) filter (where age > 90), 0)
        + (select coalesce(sum(opening_due),0) from opening)          as b90plus
    from open_inv
  ),
  over90 as (
    select coalesce(o.customer_name, op.customer_name) as customer_name,
      round((coalesce(sum(o.balance) filter (where o.age > 90), 0)
             + coalesce(max(op.opening_due), 0))::numeric, 2)         as amount_90,
      round((coalesce(sum(o.balance), 0)
             + coalesce(max(op.opening_due), 0))::numeric, 2)         as total_open,
      max(o.age)      as oldest_days,
      count(o.*)::int as inv_cnt
    from open_inv o
    full outer join opening op on op.customer_name = o.customer_name
    group by coalesce(o.customer_name, op.customer_name)
    having coalesce(sum(o.balance) filter (where o.age > 90), 0)
           + coalesce(max(op.opening_due), 0) > 0.5
  ),
  over90_full as (
    select ov.*, m.phone, m.store_name
    from over90 ov
    left join links l on l.customer_name = ov.customer_name
    left join merch m on m.store_id = l.store_id
      or (l.store_id is null and m.norm = normalize_arabic_name(ov.customer_name))
  ),
  prepaid_neg as (
    select store_id, store_name, phone, round(wallet_balance::numeric, 2) as wallet, status, last_shipment_at
    from merch where billing_type = 'دفع مسبق' and wallet_balance < -0.5
  )
  select json_build_object(
    'aging', (select json_build_object(
      'b31_60', round(b31_60::numeric, 2), 'b61_90', round(b61_90::numeric, 2), 'b90plus', round(b90plus::numeric, 2),
      'target_31_60', 50000, 'target_61_90', 25000, 'target_90plus', 0) from aging),
    'overdue90', (select coalesce(json_agg(json_build_object(
      'name', customer_name, 'store_name', store_name, 'phone', phone,
      'amount_90', amount_90, 'total_open', total_open, 'oldest_days', oldest_days, 'inv_cnt', inv_cnt
    ) order by amount_90 desc), '[]') from over90_full),
    'prepaid_negative', (select coalesce(json_agg(json_build_object(
      'store_id', store_id, 'store_name', store_name, 'phone', phone,
      'wallet', wallet, 'status', status, 'last_shipment_at', last_shipment_at
    ) order by wallet asc), '[]') from prepaid_neg)
  );
$function$;

-- رأس المال العامل: `total_ar` صار الذمّة الكاملة (شاملة الرصيد الافتتاحي).
-- ⚠️ أمّا **متوسط أيام التحصيل** فيُحسَب من الفواتير وحدها — الرصيد
-- الافتتاحي بلا تاريخ، وافتراض عمرٍ له يُلوّث المؤشّر بلا سند.
create or replace function public.working_capital_now()
 returns table(dso_days numeric, dpo_days numeric, ccc_days numeric, total_ar numeric, total_ap numeric,
               customers_with_debt integer, carriers_with_debt integer,
               top_slow_customers jsonb, top_slow_carriers jsonb)
 language sql stable security definer set search_path to 'public'
as $function$
  with
  ar_lines as (
    select z.customer_name, z.balance::numeric as bal,
      greatest(0, (current_date - z.date))::numeric as age_days
    from zoho_invoices z where z.balance > 0.5 and z.date is not null
  ),
  ar_per_customer as (
    select customer_name, sum(bal) as bal_total,
      sum(bal * age_days) / nullif(sum(bal), 0) as weighted_days
    from ar_lines group by customer_name
  ),
  ar_totals as (
    select (select coalesce(sum(total_due),0) from customer_ar where total_due > 0.5) as ar_total,
      case when sum(bal_total) > 0 then sum(bal_total * weighted_days) / sum(bal_total) else 0 end as dso,
      (select count(*)::int from customer_ar where total_due > 0.5) as n_customers
    from ar_per_customer
  ),
  ap_lines as (
    select carrier_id, (amount_dr - amount_cr)::numeric as net,
      greatest(0, (current_date - doc_date))::numeric as age_days
    from carrier_operations where status is distinct from 'paid' and doc_date is not null
  ),
  ap_per_carrier as (
    select carrier_id, sum(net) as net_total,
      sum(net * age_days) / nullif(sum(net), 0) as weighted_days
    from ap_lines group by carrier_id having sum(net) > 0.5
  ),
  ap_totals as (
    select sum(net_total) as ap_total,
      case when sum(net_total) > 0 then sum(net_total * weighted_days) / sum(net_total) else 0 end as dpo,
      count(*)::int as n_carriers
    from ap_per_carrier
  ),
  top_cust as (
    select jsonb_agg(j order by (j->>'days')::numeric desc) as arr
    from (select jsonb_build_object('name', customer_name, 'total', round(bal_total, 2),
            'days', round(weighted_days, 1),
            'share_pct', round((bal_total / nullif((select ar_total from ar_totals), 0)) * 100, 1)) as j
          from ar_per_customer where bal_total > 0 order by weighted_days desc limit 5) sub
  ),
  top_carr as (
    select jsonb_agg(j order by (j->>'days')::numeric desc) as arr
    from (select jsonb_build_object('carrier_id', carrier_id, 'total', round(net_total, 2),
            'days', round(weighted_days, 1),
            'share_pct', round((net_total / nullif((select ap_total from ap_totals), 0)) * 100, 1)) as j
          from ap_per_carrier order by weighted_days desc limit 5) sub
  )
  select round(art.dso, 1), round(apt.dpo, 1), round(art.dso - apt.dpo, 1),
    coalesce(art.ar_total, 0)::numeric, coalesce(apt.ap_total, 0)::numeric,
    coalesce(art.n_customers, 0), coalesce(apt.n_carriers, 0),
    coalesce(top_cust.arr, '[]'::jsonb), coalesce(top_carr.arr, '[]'::jsonb)
  from ar_totals art, ap_totals apt, top_cust, top_carr;
$function$;
