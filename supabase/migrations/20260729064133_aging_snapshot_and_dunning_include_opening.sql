-- تكملة §1.52: الأعمار المؤرشفة وحملة المتأخرين.
-- الرصيد الافتتاحي بلا تاريخ فاتورة → شريحة +90 (أقدم دين بحكم تعريفه).

create or replace function public.capture_ar_aging_snapshot()
 returns json language sql security definer set search_path to 'public'
as $function$
  with inv as (
    select
      coalesce(sum(balance) filter (where (current_date - date)::int <= 30), 0) b0,
      coalesce(sum(balance) filter (where (current_date - date)::int between 31 and 60), 0) b1,
      coalesce(sum(balance) filter (where (current_date - date)::int between 61 and 90), 0) b2,
      coalesce(sum(balance) filter (where (current_date - date)::int > 90), 0) b3
    from public.zoho_invoices where balance > 0.5
  ),
  opening as (select coalesce(sum(opening_due),0) op from public.customer_ar where opening_due > 0.5),
  agg as (
    select b0, b1, b2, b3 + op b3, b0 + b1 + b2 + b3 + op tot
    from inv, opening
  ), up as (
    insert into public.ar_aging_snapshots (period, b0_30, b31_60, b61_90, b90p, total, captured_at)
    select to_char(current_date, 'YYYY-MM'),
      round(b0::numeric,2), round(b1::numeric,2), round(b2::numeric,2), round(b3::numeric,2), round(tot::numeric,2), now()
    from agg
    on conflict (period) do update set
      b0_30 = excluded.b0_30, b31_60 = excluded.b31_60, b61_90 = excluded.b61_90,
      b90p = excluded.b90p, total = excluded.total, captured_at = now()
    returning *
  )
  select row_to_json(up) from up;
$function$;

-- حملة المتأخرين: العميل صاحب رصيد افتتاحي كان **يختفي تماماً** من الحملة
-- (لا فاتورة متأخرة ← لا صفّ). الآن يدخل بمبلغه، وسطر فواتيره يوضّح أنه رصيد
-- سابق بلا فاتورة.
create or replace function public.zoho_overdue_campaign()
 returns table(customer_name text, phone text, store_name text, owed numeric, inv_count integer,
               oldest date, oldest_age_days integer, invoice_list text)
 language sql stable security definer set search_path to 'public'
as $function$
  with latest_merch as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  merch as (
    select m.store_id, m.store_name, m.phone, normalize_arabic_name(m.store_name) norm
    from merchants m where m.snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as (select customer_name, store_id from customer_merchant_links where store_id is not null),
  inv as (
    select z.customer_name, sum(z.balance) owed, count(*)::int cnt, min(z.date) oldest,
      string_agg(z.invoice_number || ' (' || round(z.balance,2) || ')', ' · ' order by z.date) invs
    from zoho_invoices z
    where z.balance > 0.5 and lower(coalesce(z.status,'')) = 'overdue'
    group by z.customer_name
  ),
  op as (select contact_name, opening_due from customer_ar where opening_due > 0.5),
  overdue as (
    select coalesce(i.customer_name, o.contact_name) customer_name,
      coalesce(i.owed,0) + coalesce(o.opening_due,0) owed,
      coalesce(i.cnt,0) cnt, i.oldest,
      trim(both ' · ' from concat_ws(' · ', i.invs,
        case when o.opening_due is not null then 'رصيد سابق بلا فاتورة (' || round(o.opening_due,2) || ')' end)) invs
    from inv i full outer join op o on o.contact_name = i.customer_name
  )
  select o.customer_name, m.phone, m.store_name,
    round(o.owed::numeric, 2) as owed, o.cnt as inv_count, o.oldest,
    (current_date - o.oldest)::int as oldest_age_days, o.invs as invoice_list
  from overdue o
  left join links l on l.customer_name = o.customer_name
  left join merch m on m.store_id = l.store_id
    or (l.store_id is null and m.norm = normalize_arabic_name(o.customer_name))
  order by o.owed desc;
$function$;
