-- الربط التلقائي كان يقرأ **المدينين** في زوهو فقط (§1.44) — منطقيّ للتحصيل
-- لكنه ترك متاجر لها حسابات زوهو بلا رابط لأنها بصفر دين (دفع مسبق يشحن من
-- محفظته فلا فواتير مفتوحة). النتيجة: متجر شحن 3,403 شحنة بلا سياق زوهو.
--
-- هذا الترحيل يربط **كل متجر** (لا المدينين) حين يوجد عميل زوهو **واحد
-- بالضبط** باسم مطابق — كاملاً أو باللاحقة بعد « - » (صيغة «الكيان
-- القانوني - اسم المتجر»). التطابق الواحد من الطرفين شرط: أي التباس
-- يُترك للبشر (درس «Smart» §1.53 — متجران بنفس الاسم عكستهما المطابقة).
with latest as (select snapshot_id from merchants order by uploaded_at desc limit 1),
m as (select store_id, normalize_arabic_name(store_name) nn
      from merchants where snapshot_id=(select snapshot_id from latest)
        and normalize_arabic_name(store_name) <> ''),
unl as (select * from m where store_id not in (select store_id from customer_merchant_links where store_id is not null)),
zc as (select contact_name,
              normalize_arabic_name(contact_name) nn_full,
              normalize_arabic_name(regexp_replace(contact_name, '^.*? - ', '')) nn_tail
       from customer_ar
       where contact_name not in (select customer_name from customer_merchant_links)),
cand as (
  select u.store_id, z.contact_name
  from unl u join zc z on z.nn_full = u.nn or z.nn_tail = u.nn
),
one  as (select store_id     from cand group by store_id     having count(*) = 1),
onez as (select contact_name from cand group by contact_name having count(*) = 1)
insert into customer_merchant_links (customer_name, store_id, confidence, match_method, linked_at)
select c.contact_name, c.store_id, 1.0, 'auto-exact', now()
from cand c join one o on o.store_id = c.store_id join onez z on z.contact_name = c.contact_name
on conflict (customer_name) do nothing;
