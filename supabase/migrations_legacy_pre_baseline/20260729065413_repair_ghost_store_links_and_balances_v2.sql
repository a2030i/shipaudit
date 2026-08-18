-- إصلاح ما أفسدته المطابقة القديمة (ORDER BY store_id النصّي — انظر merchant_by_name).
-- **القاعدة الصارمة للإصلاح الآلي**: يُنقَل الإسناد فقط حين يكون المتجر الحالي
-- **صفر شحنة** ويوجد متجر بنفس الاسم المطبَّع **له شحنات فعلية**. متجر بصفر شحنة
-- لا يمكن أن يتراكم عليه استحقاق — فالنقل يقين لا ترجيح.
-- **لا يُمَسّ**: الروابط اليدوية (§1.9)، ولا حالة متجرين حقيقيين بشحنات
-- (بوليصه 187/211 · Smart 1646/316) — تحتاج قرار المستخدم.
create temp table _ghost_fix on commit drop as
with latest as (select snapshot_id from merchants order by uploaded_at desc limit 1),
m as (select store_id, normalize_arabic_name(store_name) nn, coalesce(shipment_count,0) sc, status
      from merchants where snapshot_id=(select snapshot_id from latest))
select cur.store_id ghost_id, best.store_id real_id
from m cur
join lateral (select * from m b where b.nn = cur.nn
              order by b.sc desc, (b.status='نشط') desc, b.store_id limit 1) best on true
where cur.sc = 0 and best.sc > 0 and best.store_id <> cur.store_id;

update customer_merchant_links l
set store_id = g.real_id, linked_at = now()   -- match_method محكوم بقيد؛ يبقى كما هو
from _ghost_fix g
where l.store_id = g.ghost_id and coalesce(l.match_method,'') <> 'manual';

update store_balances sb
set store_id = g.real_id
from _ghost_fix g
where sb.store_id = g.ghost_id;
