-- الإيقاف الائتماني: `total_open` صار الذمّة الكاملة من `customer_ar`
-- (شاملة الرصيد الافتتاحي) — وإلا نجا من الإيقاف عميلٌ دينه 6 آلاف
-- لأن فواتيره المفتوحة 80 ريالاً فقط (§1.52).
-- والرصيد الافتتاحي يُعدّ **متأخّراً** بحكم تعريفه (دين من التأسيس).
create or replace function public.credit_stop_list(p_limit numeric default 10000, p_overdue integer default 30)
 returns json language sql stable security definer set search_path to 'public'
as $function$
  with latest_merch as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  merch as (
    select store_id, store_name, phone, billing_type, status, wallet_balance,
           normalize_arabic_name(store_name) norm
    from merchants where snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as (select customer_name, store_id from customer_merchant_links where store_id is not null),
  open_inv as (
    select customer_name, balance, (current_date - date)::int as age
    from zoho_invoices where balance > 0.5 and customer_name is not null
  ),
  inv_agg as (
    select customer_name,
      coalesce(sum(balance) filter (where age > p_overdue),0) as overdue_inv,
      max(age) as oldest_days, count(*)::int as inv_cnt
    from open_inv group by customer_name
  ),
  per_cust as (
    select ar.contact_name as customer_name,
      round(ar.total_due::numeric,2) as total_open,
      -- المتأخّر = فواتير تجاوزت المهلة + الرصيد الافتتاحي (متأخّر حتماً)
      round((coalesce(i.overdue_inv,0) + ar.opening_due)::numeric,2) as overdue_amount,
      greatest(coalesce(i.oldest_days,0), case when ar.opening_due > 0.5 then p_overdue + 1 else 0 end) as oldest_days,
      coalesce(i.inv_cnt,0) as inv_cnt
    from customer_ar ar
    left join inv_agg i on i.customer_name = ar.contact_name
    where ar.total_due > 0.5
  ),
  breached as (select * from per_cust where total_open > p_limit or oldest_days > p_overdue),
  joined as (
    select distinct on (b.customer_name)
      b.customer_name, b.total_open, b.overdue_amount, b.oldest_days, b.inv_cnt,
      m.store_id, m.store_name, m.phone, m.billing_type, m.status,
      round(coalesce(m.wallet_balance,0)::numeric,2) as wallet,
      (m.status = 'نشط') as active,
      case when b.total_open > p_limit and b.oldest_days > p_overdue then 'both'
           when b.total_open > p_limit then 'over_limit'
           else 'overdue' end as reason
    from breached b
    left join links l on l.customer_name = b.customer_name
    left join merch m on m.store_id = l.store_id
       or (l.store_id is null and m.norm = normalize_arabic_name(b.customer_name))
    order by b.customer_name, (l.store_id is not null) desc
  ),
  filtered as (select * from joined where coalesce(billing_type,'') <> 'دفع مسبق')
  select json_build_object(
    'limit', p_limit, 'overdue_days', p_overdue,
    'summary', (select json_build_object(
       'count', count(*), 'total', round(coalesce(sum(total_open),0)::numeric,2),
       'active_count', count(*) filter (where active),
       'active_total', round(coalesce(sum(total_open) filter (where active),0)::numeric,2)
     ) from filtered),
    'rows', (select coalesce(json_agg(json_build_object(
       'customer_name', customer_name, 'store_name', store_name, 'store_id', store_id, 'phone', phone,
       'billing_type', billing_type, 'status', status, 'active', active, 'wallet', wallet,
       'total_open', total_open, 'overdue_amount', overdue_amount, 'oldest_days', oldest_days,
       'inv_cnt', inv_cnt, 'reason', reason
     ) order by active desc, total_open desc), '[]') from filtered)
  );
$function$;
