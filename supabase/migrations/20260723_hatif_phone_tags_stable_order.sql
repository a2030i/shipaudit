-- إصلاح فخّ ترقيم الصفحات (§1.34/§6): بلا ORDER BY ثابت، تصفّح .range() في hatif-tag-sync
-- يتداخل ويُسقط ~1506 صفاً باستمرار فلا تُطبَّق تاقاتها أبداً. نضيف ORDER BY phone ثابت.
CREATE OR REPLACE FUNCTION public.hatif_phone_tags()
 RETURNS TABLE(phone text, tags text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with latest as (select max(snapshot_id) sid from merchants),
  convs as (select distinct phone from whatsapp_campaign_sends where conversation_id is not null),
  mnorm as (
    select norm_sa_phone(phone) ph, coalesce(shipment_count,0) shipment_count, status,
      last_shipment_at, billing_type, wallet_balance, created_at_platform,
      row_number() over (partition by norm_sa_phone(phone) order by coalesce(shipment_count,0) desc) rn
    from merchants where snapshot_id = (select sid from latest) and phone is not null
  ),
  prim as (select * from mnorm where rn = 1),                    -- المتجر الأعلى شحناً
  agg  as (select ph, max(shipment_count) max_ship, min(wallet_balance) min_wallet from mnorm group by ph),
  debt as (                                                       -- دين زوهو مفتوح
    select distinct norm_sa_phone(m.phone) ph
    from customer_merchant_links l
    join merchants m on m.store_id = l.store_id and m.snapshot_id = (select sid from latest)
    where exists (select 1 from zoho_invoices zi
      where lower(regexp_replace(coalesce(zi.customer_name,''),'\s+','','g')) = lower(regexp_replace(coalesce(l.customer_name,''),'\s+','','g'))
        and coalesce(zi.balance,0) > 0.5)
  ),
  overdue as (                                                    -- فاتورة متأخرة (>45 يوم)
    select distinct norm_sa_phone(m.phone) ph
    from customer_merchant_links l
    join merchants m on m.store_id = l.store_id and m.snapshot_id = (select sid from latest)
    where exists (select 1 from zoho_invoices zi
      where lower(regexp_replace(coalesce(zi.customer_name,''),'\s+','','g')) = lower(regexp_replace(coalesce(l.customer_name,''),'\s+','','g'))
        and coalesce(zi.balance,0) > 0.5 and zi.date < (now() - interval '45 days'))
  ),
  leadph as (select distinct whatsapp_normalized ph from crm_leads where whatsapp_normalized is not null),
  blk as (select distinct norm_sa_phone(phone) ph from campaign_phone_blocklist where phone is not null)
  select c.phone,
    array_remove(array[
      case when dbt.ph is not null then 'عليه مديونية' end,
      case when od.ph is not null then 'متأخر سداد' end,
      case when ag.min_wallet < -0.5 then 'رصيد سالب' end,
      case when ag.max_ship > 1000 then 'VIP' end,
      case when pr.status = 'نشط' then 'نشط' end,
      case when pr.status = 'غير نشط' and pr.shipment_count > 0 then 'متوقف' end,
      case when pr.shipment_count = 0 and pr.created_at_platform is not null and pr.created_at_platform >= (now() - interval '30 days') then 'جديد' end,
      case when pr.billing_type = 'دفع مسبق' then 'دفع مسبق' end,
      case when pr.billing_type = 'دفع لاحق' then 'دفع لاحق' end,
      case when pr.ph is null and lp.ph is not null then 'عميل محتمل' end,
      case when bl.ph is not null then 'بلاك لست' end
    ], null) as tags
  from convs c
  left join prim pr on pr.ph = c.phone
  left join agg  ag on ag.ph = c.phone
  left join debt dbt on dbt.ph = c.phone
  left join overdue od on od.ph = c.phone
  left join leadph lp on lp.ph = c.phone
  left join blk bl on bl.ph = c.phone
  order by c.phone;                                               -- ثابت — يمنع تداخل/إسقاط صفحات .range()
$function$;
