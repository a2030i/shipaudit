-- (٣) بروفايل جهة الاتصال في هاتف
create or replace function public.hatif_contact_profile()
 returns table(phone text, name text, status_val text, class_val text, debt_val text, debt numeric,
               wallet numeric, store_count integer, shipments bigint, last_shipment_at date, joined_at date,
               details text, followup_val text, followup_note text, whatsapp_val text)
 language sql stable set search_path to 'public'
as $function$
  with latest as (select snapshot_id from public.merchants order by uploaded_at desc limit 1),
  store_debt as (
    select distinct on (cml.customer_name) cml.store_id, d.bal
    from (select contact_name customer_name, total_due bal from public.customer_ar where total_due > 0.5) d
    join public.customer_merchant_links cml on cml.customer_name = d.customer_name
    join public.merchants m on m.store_id = cml.store_id and m.snapshot_id = (select snapshot_id from latest)
    order by cml.customer_name, m.shipment_count desc nulls last
  ),
  s as (
    select public.norm_sa_phone(m.phone) as np, m.store_id, m.store_name,
           coalesce(m.shipment_count, 0) as ships, m.last_shipment_at::date as last_ship,
           m.created_at_platform::date as joined, m.status, m.billing_type,
           coalesce(m.wallet_balance, 0) as wal, coalesce(sd.bal, 0) as sdebt
    from public.merchants m
    left join store_debt sd on sd.store_id = m.store_id
    where m.snapshot_id = (select snapshot_id from latest)
      and public.norm_sa_phone(m.phone) is not null
      and (public.norm_sa_phone(m.phone) ~ '^9665[0-9]{8}$'
           or (left(public.norm_sa_phone(m.phone), 3) <> '966'
               and length(public.norm_sa_phone(m.phone)) between 10 and 15))
  ),
  agg as (
    select np, sum(ships)::bigint as shipments, round(sum(wal), 2) as wallet,
      round(sum(sdebt), 2) as debt, count(*)::int as store_count,
      max(last_ship) as last_shipment_at, min(joined) as joined_at,
      bool_or(status = 'نشط') as any_active
    from s group by np
  ),
  dom as (select distinct on (np) np, store_name, billing_type from s order by np, ships desc nulls last),
  det as (
    select np, string_agg(line, ' | ' order by ships desc) as details
    from (
      select np, ships,
        store_name || ' — ' || case when ships = 0 then 'لم يشحن' else ships || ' شحنة' end
        || case when last_ship is not null then ' · آخر شحنة ' || to_char(last_ship, 'YYYY-MM-DD') else '' end
        || case when sdebt > 0.5 then ' · عليه ' || round(sdebt)::text || ' ر.س' else ' · لا مديونية' end
        || case when status is not null and status <> 'نشط' then ' · (' || status || ')' else '' end as line
      from s
    ) x group by np
  ),
  wa as (
    select phone, bool_or(delivered_at is not null or read_at is not null or replied_at is not null) as delivered
    from public.whatsapp_campaign_sends where phone is not null group by phone
  )
  select a.np as phone, d.store_name as name,
    case when a.shipments = 0 then 'جديد' when a.any_active then 'نشط' else 'متوقف' end as status_val,
    case when a.shipments >= 300 then 'VIP' else 'عادي' end as class_val,
    case when a.debt > 0.5 then 'عليه مديونية' else 'سليم' end as debt_val,
    a.debt, a.wallet, a.store_count, a.shipments, a.last_shipment_at, a.joined_at,
    case when a.store_count > 1 then a.store_count || ' متاجر: ' else '' end || t.details as details,
    case fu.status
      when 'needs_followup' then 'متابعة مطلوبة' when 'interested' then 'مهتم'
      when 'converted' then 'تحوّل' when 'returned' then 'تحوّل'
      when 'not_interested' then 'غير مهتم' when 'blacklist' then 'بلاك لست'
      when 'whatsapp_sent' then 'تم التواصل' else null end as followup_val,
    nullif(trim(coalesce(fu.notes, '')
      || case when fu.next_action_at is not null then ' · موعد المتابعة: ' || to_char(fu.next_action_at, 'YYYY-MM-DD') else '' end
      || case when pr.name is not null then ' · المسؤول: ' || pr.name else '' end), '') as followup_note,
    case when wa.delivered then 'نعم' when nw.phone is not null then 'لا' else null end as whatsapp_val
  from agg a
  join dom d on d.np = a.np
  left join det t on t.np = a.np
  left join public.retargeting_followups fu on fu.phone = a.np
  left join public.profiles pr on pr.id = fu.owner_id
  left join wa on wa.phone = a.np
  left join public.v_no_whatsapp nw on nw.phone = a.np;
$function$;

-- (٤) تاقات هاتف — «عليه مديونية» و«متأخر سداد».
-- الرصيد الافتتاحي بلا تاريخ فيُعدّ **متأخراً بحكم تعريفه** (أقدم دين).
create or replace function public.hatif_phone_tags()
 returns table(phone text, tags text[])
 language sql stable security definer set search_path to 'public','pg_temp'
as $function$
  with latest as (select max(snapshot_id) sid from merchants),
  convs as (select distinct phone from whatsapp_campaign_sends where conversation_id is not null),
  mnorm as (
    select norm_sa_phone(phone) ph, coalesce(shipment_count,0) shipment_count, status,
      last_shipment_at, billing_type, wallet_balance, created_at_platform,
      row_number() over (partition by norm_sa_phone(phone) order by coalesce(shipment_count,0) desc) rn
    from merchants where snapshot_id = (select sid from latest) and phone is not null
  ),
  prim as (select * from mnorm where rn = 1),
  agg  as (select ph, max(shipment_count) max_ship, min(wallet_balance) min_wallet from mnorm group by ph),
  linkph as (
    select distinct norm_sa_phone(m.phone) ph,
           lower(regexp_replace(coalesce(l.customer_name,''),'\s+','','g')) cname
    from customer_merchant_links l
    join merchants m on m.store_id = l.store_id and m.snapshot_id = (select sid from latest)
    where norm_sa_phone(m.phone) is not null
  ),
  ar as (
    select lower(regexp_replace(coalesce(contact_name,''),'\s+','','g')) cname,
           total_due, opening_due, days_oldest
    from customer_ar where total_due > 0.5
  ),
  debt as (select distinct lp.ph from linkph lp join ar on ar.cname = lp.cname),
  overdue as (
    select distinct lp.ph from linkph lp join ar on ar.cname = lp.cname
    where ar.opening_due > 0.5 or ar.days_oldest > 45
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
  order by c.phone;
$function$;

-- (٥) سياق مستلِم الحملة — `zoho_due` صار الذمّة الكاملة (عدد الفواتير يبقى من الفواتير)
create or replace function public.campaign_recipient_context(p_phones text[])
 returns table(phone text, store_name text, store_count integer, shipments integer,
               last_shipment timestamptz, wallet numeric, billing_type text, store_status text,
               zoho_due numeric, zoho_open_count bigint, zoho_last_invoice date, zoho_last_payment date)
 language sql stable set search_path to 'public','pg_temp'
as $function$
with latest as (select snapshot_id from merchants order by uploaded_at desc nulls last limit 1),
ph as (
  select distinct norm_sa_phone(p) as phone from unnest(p_phones) p
  where p is not null and length(norm_sa_phone(p)) >= 11
),
m as (
  select norm_sa_phone(mm.phone) as phone,
         mm.store_id, mm.store_name, mm.shipment_count, mm.last_shipment_at,
         mm.wallet_balance, mm.billing_type, mm.status,
         count(*) over (partition by norm_sa_phone(mm.phone))::int as store_count
  from merchants mm join latest l on mm.snapshot_id = l.snapshot_id
  where norm_sa_phone(mm.phone) in (select phone from ph)
),
custs as (
  select m.phone, m.store_id, cml.customer_name
  from m join customer_merchant_links cml on cml.store_id = m.store_id
),
zi as (
  select c.phone, c.store_id,
         sum(ar.total_due) as due,
         (select count(*) from zoho_invoices z2 where z2.customer_name = c.customer_name and z2.balance > 0.5) as cnt,
         (select max(z3.date) from zoho_invoices z3 where z3.customer_name = c.customer_name) as last_inv
  from custs c join customer_ar ar on ar.contact_name = c.customer_name
  group by c.phone, c.store_id, c.customer_name
),
zp as (
  select c.phone, c.store_id, max(p.date) as last_pay
  from custs c join zoho_payments p on p.customer_name = c.customer_name
  group by c.phone, c.store_id
)
select m.phone, m.store_name, m.store_count,
       m.shipment_count, m.last_shipment_at,
       m.wallet_balance, m.billing_type, m.status,
       coalesce(zi.due, 0), coalesce(zi.cnt, 0), zi.last_inv, zp.last_pay
from m
left join zi on zi.phone = m.phone and zi.store_id = m.store_id
left join zp on zp.phone = m.phone and zp.store_id = m.store_id
order by m.phone, m.shipment_count desc;
$function$;
