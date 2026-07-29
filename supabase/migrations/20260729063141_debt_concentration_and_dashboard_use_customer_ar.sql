-- تركّز المديونيات: الإجمالي من `customer_ar` لا من جمع الفواتير
-- (يشمل الرصيد الافتتاحي — §1.52). عدد الفواتير يبقى للعرض.
create or replace function public.customer_debt_concentration(p_limit integer default 10)
 returns table(customer_name text, debt numeric, invoice_count integer, share_pct numeric, rank_order integer)
 language sql stable security definer set search_path to 'public'
as $function$
  with per_customer as (
    select ar.contact_name as customer_name,
           ar.total_due::numeric   as debt,
           ar.open_invoices::int   as invoice_count
    from customer_ar ar where ar.total_due > 0.5
  ),
  total as (select nullif(sum(debt), 0) as s from per_customer)
  select pc.customer_name, pc.debt, pc.invoice_count,
    coalesce((pc.debt / total.s * 100)::numeric(6,2), 0) as share_pct,
    row_number() over (order by pc.debt desc)::int as rank_order
  from per_customer pc, total
  order by pc.debt desc
  limit p_limit;
$function$;

-- لوحة فواتير زوهو: `open_ar` و«أعلى المدينين» يصيران من `customer_ar`
-- (الإجمالي الحقيقي). أرقام الفواتير نفسها (مسوّدة/متأخرة/شهري) تبقى من
-- `zoho_invoices` لأنها **عن الفواتير** لا عن ذمّة العميل.
create or replace function public.zoho_invoice_dashboard()
 returns json language sql stable security definer set search_path to 'public'
as $function$
  with base as (
    select to_char(date, 'YYYY-MM') as ym,
      coalesce(total,0)::numeric as total, coalesce(balance,0)::numeric as balance,
      lower(coalesce(status,'')) as st, nullif(trim(customer_name),'') as cust
    from zoho_invoices where date is not null
  ),
  monthly as (
    select ym, count(*) as cnt, sum(total) as total,
      sum(case when balance > 0.5 then balance else 0 end) as remaining,
      count(*) filter (where st = 'draft')   as draft_cnt,
      count(*) filter (where st = 'overdue') as overdue_cnt,
      count(*) filter (where balance > 0.5)  as open_cnt
    from base group by ym
  ),
  debtors as (
    select ar.contact_name as cust, ar.total_due as owed, ar.open_invoices as open_cnt
    from customer_ar ar where ar.total_due > 0.5
    order by ar.total_due desc limit 20
  )
  select json_build_object(
    'open_ar',      (select coalesce(sum(total_due),0) from customer_ar where total_due > 0.5),
    'open_cnt',     (select count(*) from base where balance > 0.5),
    'draft_cnt',    (select count(*) from base where st = 'draft'),
    'draft_total',  (select coalesce(sum(total),0) from base where st = 'draft'),
    'overdue_cnt',  (select count(*) from base where st = 'overdue'),
    'overdue_amt',  (select coalesce(sum(case when balance>0.5 then balance else 0 end),0) from base where st = 'overdue'),
    'total_cnt',    (select count(*) from base),
    'monthly',      (select coalesce(json_agg(row_to_json(m) order by m.ym desc),'[]') from monthly m),
    'debtors',      (select coalesce(json_agg(row_to_json(d)),'[]') from debtors d)
  );
$function$;
