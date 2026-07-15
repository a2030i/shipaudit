-- وسوم + ملاحظة لكل عميل (موحّد بالهاتف) لدفعها لجهات اتصال هاتف.
-- عميل بعدة متاجر بنفس الرقم = صفّ واحد (v_crm_retargeting يوحّد بالهاتف):
-- الاسم = المتجر الأساسي + «(+N متاجر)» · الملاحظة تسرد كل المتاجر · الوسوم من الإجمالي.
-- الدين يُجمَع عبر كل أسماء زوهو المرتبطة بمتاجر هذا الرقم (dedup لكل اسم/هاتف).
create or replace function public.hatif_contact_labels()
returns table (
  phone text, name text, store_count int, store_names text[],
  tags text[], note text, debt numeric, wallet numeric, shipments bigint, days_since_last int
)
language sql stable set search_path = public as $$
  with latest as (
    select snapshot_id from public.merchants order by uploaded_at desc limit 1
  ),
  debt_by_phone as (
    select phone, sum(bal) as debt from (
      select distinct m.phone, d.customer_name, d.bal
      from (select customer_name, sum(balance) bal from public.zoho_invoices where balance > 0.5 group by customer_name) d
      join public.customer_merchant_links cml on cml.customer_name = d.customer_name
      join public.merchants m on m.store_id = cml.store_id and m.snapshot_id = (select snapshot_id from latest)
      where m.phone is not null and btrim(m.phone) <> ''
    ) x group by phone
  )
  select
    v.phone,
    v.primary_store || case when v.store_count > 1 then ' (+' || (v.store_count - 1) || ' متاجر)' else '' end as name,
    v.store_count,
    v.store_names,
    array_remove(array[
      case when v.high_value then 'VIP' end,
      case when v.segment = 'active' then 'نشط' end,
      case when v.segment in ('stopped_recent','stopped_long') then 'متوقف' end,
      case when v.segment in ('new_active','registered_no_ship','linked_no_ship') then 'جديد' end,
      case when coalesce(db.debt,0) > 0.5 then 'عليه مديونية' end,
      case when v.wallet < -0.5 then 'رصيد سالب' end,
      case when v.billing_type = 'دفع مسبق' then 'دفع مسبق'
           when v.billing_type = 'دفع لاحق' then 'دفع لاحق' end
    ], null) as tags,
    'المتاجر: ' || array_to_string(v.store_names, ' · ')
      || ' | شحنات: ' || v.total_shipments::text
      || case when v.days_since_last is not null then ' | آخر شحنة: ' || v.days_since_last || 'ي' else '' end
      || case when coalesce(db.debt,0) > 0.5 then ' | دين: ' || round(db.debt)::text else '' end
      || case when v.wallet < -0.5 then ' | محفظة: ' || round(v.wallet)::text else '' end as note,
    coalesce(db.debt, 0)::numeric as debt,
    v.wallet,
    v.total_shipments::bigint as shipments,
    v.days_since_last
  from public.v_crm_retargeting v
  left join debt_by_phone db on db.phone = v.phone
  where v.phone is not null and btrim(v.phone) <> '';
$$;
revoke all on function public.hatif_contact_labels() from public;
grant execute on function public.hatif_contact_labels() to authenticated;
