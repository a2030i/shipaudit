-- ⚠️ فخّ مؤكَّد (2026-07-29، حالة «مؤسسة كوبرا دريل»): `normalize_arabic_name`
-- يجرّد بادئات مثل «مؤسسة/متجر» فيتصادم متجران بالاسم نفسه. و`resolve_snapshot_names`
-- كان يفضّ التعادل بـ`ORDER BY store_id` — و**store_id نصّ**، فـ'1255' يسبق '517'
-- سلسلةً! النتيجة: استحقاق 464.60 أُسنِد لمتجر شبح (دفع مسبق · صفر شحنة) بدل
-- المتجر الحقيقي 517 (نشط · 1,076 شحنة). القياس: 24 اسماً متصادماً، **8 منها
-- اختارت الشبح** — وكلها بلا استثناء صفر شحنة مقابل مئات/آلاف.
--
-- نقطة الحقيقة الواحدة: أي «اسم → متجر» يمرّ من هنا. الأولوية بإشارة العمل
-- (شحنات ← آخر شحنة ← نشط) لا بترتيب النصّ.
create or replace view public.merchant_by_name as
  select distinct on (normalize_arabic_name(store_name))
         normalize_arabic_name(store_name) as nname,
         store_id, store_name, phone, billing_type, status,
         wallet_balance, shipment_count, last_shipment_at
  from public.merchants
  where snapshot_id = (select snapshot_id from public.merchants order by uploaded_at desc limit 1)
    and normalize_arabic_name(store_name) <> ''
  order by normalize_arabic_name(store_name),
           coalesce(shipment_count,0) desc,
           last_shipment_at desc nulls last,
           (status = 'نشط') desc,
           store_id;

alter view public.merchant_by_name set (security_invoker = on);
grant select on public.merchant_by_name to authenticated;

create or replace function public.resolve_snapshot_names(p_names text[], p_threshold numeric default 0.78)
 returns table(raw_name text, store_id text, match_method text, match_confidence numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  WITH input AS (SELECT DISTINCT n AS raw_name FROM unnest(p_names) AS n),
  tier1 AS (
    SELECT i.raw_name, l.store_id,
           'link-' || coalesce(l.match_method, 'auto') AS match_method,
           coalesce(l.confidence, 1.0)::numeric        AS match_confidence
    FROM input i
    JOIN LATERAL (
      SELECT store_id, match_method, confidence FROM customer_merchant_links
      WHERE customer_name = i.raw_name AND store_id IS NOT NULL LIMIT 1
    ) l ON true
  ),
  rem1 AS (SELECT raw_name FROM input EXCEPT SELECT raw_name FROM tier1),
  -- Tier 2: تطابق دقيق بعد التطبيع — المتجر يُختار من `merchant_by_name`
  tier2 AS (
    SELECT r.raw_name, m.store_id, 'exact'::text AS match_method, 1.0::numeric AS match_confidence
    FROM rem1 r JOIN merchant_by_name m ON m.nname = normalize_arabic_name(r.raw_name)
  ),
  rem2 AS (SELECT raw_name FROM rem1 EXCEPT SELECT raw_name FROM tier2),
  tier3 AS (
    SELECT r.raw_name, b.store_id, 'fuzzy'::text AS match_method, b.confidence AS match_confidence
    FROM rem2 r
    JOIN bulk_match_customers((SELECT array_agg(raw_name) FROM rem2), p_threshold) b
      ON b.customer_name = r.raw_name
  )
  SELECT raw_name, store_id, match_method, match_confidence FROM tier1
  UNION ALL SELECT raw_name, store_id, match_method, match_confidence FROM tier2
  UNION ALL SELECT raw_name, store_id, match_method, match_confidence FROM tier3
  UNION ALL
  SELECT raw_name, NULL::text, 'unmatched'::text, 0::numeric
  FROM (SELECT raw_name FROM rem2 EXCEPT SELECT raw_name FROM tier3) u;
$function$;
