-- CRM إعادة الاستهداف — المرحلة 4+: العودة الآلية للشحن.
-- مقارنة إجمالي شحنات العميل (بالهاتف) بين أحدث رفعتَي merchants. الشحنات تراكمية
-- فزيادتها = شحن فعلي في الفترة = عودة موضوعية (بلا تعليم يدوي). «عاد بفضل الحملة»
-- = من له متابعة وزادت شحناته.
create or replace function public.crm_retargeting_reactivations()
returns json language sql stable security definer set search_path to public as $$
  with snaps as (
    select snapshot_id, snapshot_date, row_number() over (order by uploaded_at desc) rn
    from (select snapshot_id, min(snapshot_date) snapshot_date, max(uploaded_at) uploaded_at
          from public.merchants group by snapshot_id) x
  ),
  latest as (select snapshot_id, snapshot_date from snaps where rn = 1),
  prev   as (select snapshot_id, snapshot_date from snaps where rn = 2),
  cur as (select phone, sum(coalesce(shipment_count,0)) sh from public.merchants
          where snapshot_id = (select snapshot_id from latest) and phone is not null and btrim(phone) <> '' group by phone),
  old as (select phone, sum(coalesce(shipment_count,0)) sh from public.merchants
          where snapshot_id = (select snapshot_id from prev) group by phone),
  delta as (
    select c.phone, (c.sh - coalesce(o.sh,0)) as gained
    from cur c left join old o on o.phone = c.phone
  ),
  fu as (select phone from public.retargeting_followups)
  select json_build_object(
    'has_previous', (select count(*) from prev) > 0,
    'previous_date', (select snapshot_date from prev),
    'current_date',  (select snapshot_date from latest),
    'all_reactivated', (select count(*) from delta where gained > 0),
    'all_shipments_generated', (select coalesce(sum(gained),0)::bigint from delta where gained > 0),
    'worked_reactivated', (select count(*) from delta d join fu on fu.phone = d.phone where d.gained > 0),
    'worked_shipments_generated', (select coalesce(sum(d.gained),0)::bigint from delta d join fu on fu.phone = d.phone where d.gained > 0),
    'worked_total', (select count(*) from fu)
  );
$$;
revoke all on function public.crm_retargeting_reactivations() from public;
grant execute on function public.crm_retargeting_reactivations() to authenticated;
