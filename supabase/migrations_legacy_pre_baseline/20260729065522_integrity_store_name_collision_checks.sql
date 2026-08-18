-- فحصان جديدان لعائلة «تصادم أسماء المتاجر» (§1.53):
--  · store_link_ghost      — رابط/استحقاق على متجر صفر شحنة ونظيره الحقيقي موجود
--                            (الإصلاح الآلي لا يمسّ الروابط اليدوية، فتظهر هنا)
--  · store_name_collision  — متجران فأكثر بنفس الاسم المطبَّع **وكلاهما يشحن**:
--                            لا يمكن حسمه آلياً — يحتاج دمجاً في المنصّة
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='integrity_check';

  d := replace(d, E'  ) x;\n$function$', E'  ) x
  UNION ALL
  SELECT ''store_link_ghost'', count(*)::int, 0::numeric,
    string_agg(g.customer_name || '' → متجر '' || g.cur || '' (صفر شحنة) بدل '' || g.best, '', '')
  FROM (
    WITH latest AS (SELECT snapshot_id FROM merchants ORDER BY uploaded_at DESC LIMIT 1),
    mm AS (SELECT store_id, normalize_arabic_name(store_name) nn, coalesce(shipment_count,0) sc, status
           FROM merchants WHERE snapshot_id=(SELECT snapshot_id FROM latest))
    SELECT l.customer_name, cur.store_id cur, best.store_id best
    FROM customer_merchant_links l
    JOIN mm cur ON cur.store_id = l.store_id AND cur.sc = 0
    JOIN LATERAL (SELECT * FROM mm b WHERE b.nn = cur.nn
                  ORDER BY b.sc DESC, (b.status=''نشط'') DESC, b.store_id LIMIT 1) best ON true
    WHERE best.store_id <> cur.store_id AND best.sc > 0
  ) g
  UNION ALL
  SELECT ''store_name_collision'', count(*)::int, 0::numeric,
    string_agg(c.detail, '', '')
  FROM (
    WITH latest AS (SELECT snapshot_id FROM merchants ORDER BY uploaded_at DESC LIMIT 1)
    SELECT string_agg(store_id || '' «'' || store_name || ''» '' || coalesce(shipment_count,0) || '' شحنة'', '' + ''
                      ORDER BY coalesce(shipment_count,0) DESC) detail
    FROM merchants WHERE snapshot_id=(SELECT snapshot_id FROM latest)
      AND normalize_arabic_name(store_name) <> ''''
    GROUP BY normalize_arabic_name(store_name)
    HAVING count(*) FILTER (WHERE coalesce(shipment_count,0) > 0) > 1
  ) c;
$function$');

  execute d;
end $$;
