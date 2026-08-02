-- أعمار المديونيات من تاريخ استحقاق الفواتير المفتوحة فقط.
-- الرصيد الافتتاحي يبقى ضمن إجمالي الذمة، لكنه بعمر غير معروف ولا يدخل في +90 أو المتأخر.
create or replace function public.customer_money_dashboard()
 returns json language sql stable security definer set search_path to 'public'
as $function$
  with latest_merch as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  merch as (
    select m.store_id, m.store_name, m.phone, normalize_arabic_name(m.store_name) norm,
           m.billing_type, m.status platform_status, m.wallet_balance, m.last_shipment_at
    from merchants m where m.snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as (select customer_name, store_id from customer_merchant_links where store_id is not null),
  open_inv as (
    select customer_name, balance, lower(coalesce(status,'')) st,
           (current_date - coalesce(due_date, date))::int age
    from zoho_invoices where balance > 0.5 and customer_name is not null
  ),
  inv_agg as (
    select o.customer_name,
      sum(o.balance) filter (where o.st = 'overdue')            overdue_amt,
      count(*)::int                                             inv_cnt,
      max(o.age)                                                oldest_days,
      sum(o.balance) filter (where o.age <= 30)                 b0,
      sum(o.balance) filter (where o.age between 31 and 60)     b1,
      sum(o.balance) filter (where o.age between 61 and 90)     b2,
      sum(o.balance) filter (where o.age > 90)                  b3
    from open_inv o group by o.customer_name
  ),
  cust as (
    select ar.contact_name as customer_name,
      ar.total_due                         owed,
      coalesce(i.overdue_amt,0)            overdue_amt,
      coalesce(i.inv_cnt,0)                inv_cnt,
      coalesce(i.oldest_days,0)            oldest_days,
      coalesce(i.b0,0) b0, coalesce(i.b1,0) b1, coalesce(i.b2,0) b2,
      coalesce(i.b3,0) b3,
      ar.opening_due opening_balance
    from customer_ar ar
    left join inv_agg i on i.customer_name = ar.contact_name
    where ar.total_due > 0.5
  ),
  last_pay as (
    select customer_name, max(date) last_date
    from zoho_payments where customer_name is not null group by customer_name
  ),
  last_pay_amt as (
    select p.customer_name, p.date, sum(p.amount) amount
    from zoho_payments p join last_pay lp
      on lp.customer_name = p.customer_name and p.date = lp.last_date
    group by p.customer_name, p.date
  ),
  cust_full as (
    select distinct on (c.customer_name) c.*,
      lpa.date last_payment_date, lpa.amount last_payment_amount,
      m.store_id, m.phone, m.store_name, m.billing_type, m.platform_status,
      m.wallet_balance, m.last_shipment_at
    from cust c
    left join last_pay_amt lpa on lpa.customer_name = c.customer_name
    left join links l on l.customer_name = c.customer_name
    left join merch m on m.store_id = l.store_id
      or (l.store_id is null and m.norm = normalize_arabic_name(c.customer_name))
    order by c.customer_name, (l.store_id is not null) desc
  ),
  monthly_col as (
    select to_char(date,'YYYY-MM') ym, sum(amount) amount, count(*)::int cnt
    from zoho_payments where date >= (current_date - interval '12 months')
    group by 1 order by 1 desc
  )
  select json_build_object(
    'outstanding',     (select coalesce(round(sum(owed)::numeric,2),0) from cust),
    'outstanding_cnt', (select count(*) from cust),
    'overdue_amt',     (select coalesce(round(sum(overdue_amt)::numeric,2),0) from cust),
    'aging', json_build_object(
      'b0_30',          (select coalesce(round(sum(b0)::numeric,2),0) from cust),
      'b31_60',         (select coalesce(round(sum(b1)::numeric,2),0) from cust),
      'b61_90',         (select coalesce(round(sum(b2)::numeric,2),0) from cust),
      'b90p',           (select coalesce(round(sum(b3)::numeric,2),0) from cust),
      'opening_balance',(select coalesce(round(sum(opening_balance)::numeric,2),0) from cust)
    ),
    'collected_this_month', (select coalesce(round(sum(amount)::numeric,2),0) from zoho_payments
                             where date >= date_trunc('month', current_date)
                               and date < date_trunc('month', current_date) + interval '1 month'),
    'collected_prev_month', (select coalesce(round(sum(amount)::numeric,2),0) from zoho_payments
                             where date >= date_trunc('month', current_date) - interval '1 month'
                               and date < date_trunc('month', current_date)),
    'monthly_collected', (select coalesce(json_agg(row_to_json(m)),'[]') from monthly_col m),
    'customers', (select coalesce(json_agg(json_build_object(
        'name', cf.customer_name, 'store_name', cf.store_name,
        'store_id', cf.store_id, 'phone', cf.phone,
        'owed', round(cf.owed::numeric,2),
        'overdue', coalesce(round(cf.overdue_amt::numeric,2),0),
        'inv_cnt', cf.inv_cnt, 'oldest_days', cf.oldest_days,
        'b0', round(cf.b0::numeric,2), 'b1', round(cf.b1::numeric,2),
        'b2', round(cf.b2::numeric,2), 'b3', round(cf.b3::numeric,2),
        'opening_balance', round(cf.opening_balance::numeric,2),
        'last_payment_date', cf.last_payment_date,
        'last_payment_amount', coalesce(round(cf.last_payment_amount::numeric,2),0),
        'billing_type', cf.billing_type, 'platform_status', cf.platform_status,
        'wallet_balance', round(coalesce(cf.wallet_balance,0)::numeric,2),
        'last_shipment_at', cf.last_shipment_at
      ) order by cf.owed desc),'[]') from cust_full cf)
  );
$function$;
