-- Split the recent customer-debt bucket so collection campaigns can target
-- 16–30 day balances without also including 0–15 day balances.
-- Keep the former 0–30 aggregate in the JSON contract for older consumers.

create or replace function public.customer_money_dashboard()
returns json
language sql
stable security invoker
set search_path to 'public'
as $function$
  with latest_merch as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  merch as (
    select m.store_id, m.store_name, m.phone, normalize_arabic_name(m.store_name) norm,
           m.billing_type, m.status platform_status, m.wallet_balance, m.last_shipment_at
    from merchants m where m.snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as (select customer_name, store_id from customer_merchant_links where store_id is not null),
  line_agg as (
    select l.contact_name,
      sum(l.collectible_amount) filter (
        where l.line_kind = 'opening_balance' or lower(coalesce(l.status,'')) = 'overdue'
      ) as overdue_amt,
      count(*) filter (where l.line_kind = 'invoice' and l.collectible_amount > 0.5)::int as inv_cnt,
      max(l.age_days) filter (where l.collectible_amount > 0.005) as oldest_days,
      sum(l.collectible_amount) filter (where l.age_days between 0 and 15) as b0_15,
      sum(l.collectible_amount) filter (where l.age_days between 16 and 30) as b16_30,
      sum(l.collectible_amount) filter (where l.age_days between 31 and 60) as b1,
      sum(l.collectible_amount) filter (where l.age_days between 61 and 90) as b2,
      sum(l.collectible_amount) filter (where l.age_days > 90) as b3,
      sum(l.collectible_amount) filter (where l.line_kind = 'opening_balance') as opening_balance
    from customer_collectible_lines l
    where l.collectible_amount > 0.005
    group by l.contact_name
  ),
  cust as (
    select ar.contact_name customer_name,
      ar.total_due gross_due,
      greatest(coalesce(ar.unused_credits,0),0) unused_credit,
      ar.credit_offset,
      ar.collectible_due owed,
      ar.credit_surplus,
      ar.needs_zoho_settlement,
      coalesce(a.overdue_amt,0) overdue_amt,
      coalesce(a.inv_cnt,0) inv_cnt,
      coalesce(a.oldest_days,0) oldest_days,
      coalesce(a.b0_15,0) b0_15,
      coalesce(a.b16_30,0) b16_30,
      coalesce(a.b1,0) b1, coalesce(a.b2,0) b2, coalesce(a.b3,0) b3,
      coalesce(a.opening_balance,0) opening_balance,
      greatest(coalesce(ar.opening_due,0),0) opening_gross
    from customer_ar ar
    left join line_agg a on a.contact_name = ar.contact_name
    where ar.collectible_due > 0.5
  ),
  settlement_base as (
    select ar.contact_name customer_name,
      ar.total_due gross_due,
      greatest(coalesce(ar.unused_credits,0),0) unused_credit,
      ar.credit_offset,
      ar.collectible_due,
      ar.credit_surplus,
      greatest(coalesce(ar.opening_due,0),0) opening_gross,
      coalesce((select collectible_amount from customer_collectible_lines l
        where l.contact_name=ar.contact_name and l.line_kind='opening_balance' limit 1),0) opening_collectible
    from customer_ar ar
    where ar.total_due > 0.5 and ar.credit_offset > 0.005
  ),
  last_pay as (select customer_name,max(date) last_date from zoho_payments where customer_name is not null group by customer_name),
  last_pay_amt as (
    select p.customer_name,p.date,sum(p.amount) amount from zoho_payments p join last_pay lp
      on lp.customer_name=p.customer_name and p.date=lp.last_date group by p.customer_name,p.date
  ),
  cust_full as (
    select distinct on (c.customer_name) c.*,lpa.date last_payment_date,lpa.amount last_payment_amount,
      m.store_id,m.phone,m.store_name,m.billing_type,m.platform_status,m.wallet_balance,m.last_shipment_at
    from cust c left join last_pay_amt lpa on lpa.customer_name=c.customer_name
    left join links l on l.customer_name=c.customer_name
    left join merch m on m.store_id=l.store_id or (l.store_id is null and m.norm=normalize_arabic_name(c.customer_name))
    order by c.customer_name,(l.store_id is not null) desc
  ),
  settlement_full as (
    select distinct on (s.customer_name) s.*,m.store_id,m.phone,m.store_name
    from settlement_base s
    left join links l on l.customer_name=s.customer_name
    left join merch m on m.store_id=l.store_id or (l.store_id is null and m.norm=normalize_arabic_name(s.customer_name))
    order by s.customer_name,(l.store_id is not null) desc
  ),
  monthly_col as (
    select to_char(date,'YYYY-MM') ym,sum(amount) amount,count(*)::int cnt from zoho_payments
    where date >= current_date-interval '12 months' group by 1 order by 1 desc
  )
  select json_build_object(
    'gross_outstanding',(select coalesce(round(sum(total_due)::numeric,2),0) from customer_ar where total_due > 0.5),
    'credit_offset',(select coalesce(round(sum(credit_offset)::numeric,2),0) from customer_ar where total_due > 0.5),
    'unused_credits',(select coalesce(round(sum(greatest(coalesce(unused_credits,0),0))::numeric,2),0) from customer_ar),
    'credit_surplus',(select coalesce(round(sum(credit_surplus)::numeric,2),0) from customer_ar),
    'outstanding',(select coalesce(round(sum(owed)::numeric,2),0) from cust),
    'outstanding_cnt',(select count(*) from cust),
    'settlement_count',(select count(*) from settlement_base),
    'settlement_total',(select coalesce(round(sum(credit_offset)::numeric,2),0) from settlement_base),
    'overdue_amt',(select coalesce(round(sum(overdue_amt)::numeric,2),0) from cust),
    'aging',json_build_object(
      'b0_15',(select coalesce(round(sum(b0_15)::numeric,2),0) from cust),
      'b16_30',(select coalesce(round(sum(b16_30)::numeric,2),0) from cust),
      'b0_30',(select coalesce(round(sum(b0_15 + b16_30)::numeric,2),0) from cust),
      'b31_60',(select coalesce(round(sum(b1)::numeric,2),0) from cust),
      'b61_90',(select coalesce(round(sum(b2)::numeric,2),0) from cust),
      'b90p',(select coalesce(round(sum(b3)::numeric,2),0) from cust),
      'opening_balance',(select coalesce(round(sum(opening_balance)::numeric,2),0) from cust),
      'opening_gross',(select coalesce(round(sum(opening_gross)::numeric,2),0) from cust)),
    'collected_this_month',(select coalesce(round(sum(amount)::numeric,2),0) from zoho_payments where date>=date_trunc('month',current_date) and date<date_trunc('month',current_date)+interval '1 month'),
    'collected_prev_month',(select coalesce(round(sum(amount)::numeric,2),0) from zoho_payments where date>=date_trunc('month',current_date)-interval '1 month' and date<date_trunc('month',current_date)),
    'monthly_collected',(select coalesce(json_agg(row_to_json(m)),'[]') from monthly_col m),
    'customers',(select coalesce(json_agg(json_build_object(
      'name',cf.customer_name,'store_name',cf.store_name,'store_id',cf.store_id,'phone',cf.phone,
      'gross_due',round(cf.gross_due::numeric,2),'unused_credit',round(cf.unused_credit::numeric,2),
      'credit_offset',round(cf.credit_offset::numeric,2),'credit_surplus',round(cf.credit_surplus::numeric,2),
      'needs_zoho_settlement',cf.needs_zoho_settlement,
      'owed',round(cf.owed::numeric,2),'overdue',coalesce(round(cf.overdue_amt::numeric,2),0),
      'inv_cnt',cf.inv_cnt,'oldest_days',cf.oldest_days,
      'b0_15',round(cf.b0_15::numeric,2),'b16_30',round(cf.b16_30::numeric,2),
      'b0',round((cf.b0_15 + cf.b16_30)::numeric,2),
      'b1',round(cf.b1::numeric,2),'b2',round(cf.b2::numeric,2),'b3',round(cf.b3::numeric,2),
      'opening_balance',round(cf.opening_balance::numeric,2),'opening_gross',round(cf.opening_gross::numeric,2),
      'last_payment_date',cf.last_payment_date,'last_payment_amount',coalesce(round(cf.last_payment_amount::numeric,2),0),
      'billing_type',cf.billing_type,'platform_status',cf.platform_status,
      'wallet_balance',round(coalesce(cf.wallet_balance,0)::numeric,2),'last_shipment_at',cf.last_shipment_at
    ) order by cf.owed desc),'[]') from cust_full cf),
    'settlements',(select coalesce(json_agg(json_build_object(
      'name',sf.customer_name,'store_name',sf.store_name,'store_id',sf.store_id,'phone',sf.phone,
      'gross_due',round(sf.gross_due::numeric,2),'unused_credit',round(sf.unused_credit::numeric,2),
      'credit_offset',round(sf.credit_offset::numeric,2),'collectible_due',round(sf.collectible_due::numeric,2),
      'credit_surplus',round(sf.credit_surplus::numeric,2),
      'opening_gross',round(sf.opening_gross::numeric,2),'opening_collectible',round(sf.opening_collectible::numeric,2),
      'covered_fully',sf.collectible_due <= 0.5
    ) order by sf.credit_offset desc),'[]') from settlement_full sf)
  );
$function$;

revoke all on function public.customer_money_dashboard() from public, anon;
grant execute on function public.customer_money_dashboard() to authenticated;
