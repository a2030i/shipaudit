-- ⚠️ 14.5 ثانية على كل فتح لصفحة المطابقة — والصفحة تستدعيها **أولاً
-- بالتتابع** قبل أي جلب، فالمستخدم ينتظر أمام دوّارة فارغة.
--
-- السبب: `CROSS JOIN` بين **كل** صفوف `store_balances` غير المرتبطة
-- (3,121 صفاً من **44 كشفاً قديماً**) و1,542 متجراً، بثلاثة شروط
-- `ILIKE '%…%'` لكل زوج = **4.8 مليون مقارنة نصّية × 3**.
--
-- والأسوأ أنها **بلا فائدة**: الكشف الحالي فيه **صفر** صف غير مرتبط،
-- فكل هذا العمل يجري على صفوف كشوف قديمة لا تقرأها أي شاشة.
--
-- الإصلاح: حصر النطاق بأحدث كشف لكل مصدر (وهو ما تعرضه الشاشة فعلاً)
-- + خروج مبكر حين لا يوجد ما يُربَط.
create or replace function public.autolink_balances_by_exact_name()
 returns table(linked_count integer, store_ids text[])
 language plpgsql security definer set search_path to 'public'
as $function$
DECLARE
  v_linked_ids text[];
  v_snaps uuid[];
  v_todo  int;
BEGIN
  -- أحدث كشف لكل مصدر — الباقي تاريخ لا يُعرَض ولا يُربَط
  SELECT array_agg(id) INTO v_snaps FROM (
    SELECT DISTINCT ON (source) id FROM store_balance_snapshots
    ORDER BY source, uploaded_at DESC
  ) s;
  IF v_snaps IS NULL THEN
    RETURN QUERY SELECT 0, ARRAY[]::text[]; RETURN;
  END IF;

  -- خروج مبكر: لا شيء غير مرتبط → لا تخطيط ولا cross join
  SELECT count(*) INTO v_todo FROM store_balances
  WHERE store_id IS NULL AND snapshot_id = ANY(v_snaps);
  IF v_todo = 0 THEN
    RETURN QUERY SELECT 0, ARRAY[]::text[]; RETURN;
  END IF;

  WITH latest_merchants AS (
    SELECT snapshot_id FROM merchants ORDER BY uploaded_at DESC LIMIT 1
  ),
  merchant_lookup AS (
    SELECT DISTINCT ON (m.store_id) m.store_id, m.store_name
    FROM merchants m JOIN latest_merchants lm ON m.snapshot_id = lm.snapshot_id
    WHERE m.store_name IS NOT NULL AND LENGTH(TRIM(m.store_name)) >= 3
  ),
  todo AS (
    SELECT id, raw_name FROM store_balances
    WHERE store_id IS NULL AND snapshot_id = ANY(v_snaps)
  ),
  candidates AS (
    SELECT t.id AS sb_id, ml.store_id, ml.store_name,
      ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY LENGTH(ml.store_name) DESC, ml.store_id) AS rn
    FROM todo t
    CROSS JOIN merchant_lookup ml
    WHERE TRIM(t.raw_name) = TRIM(ml.store_name)
       OR t.raw_name  ILIKE '%' || ml.store_name || '%'
       OR ml.store_name ILIKE '%' || t.raw_name  || '%'
  ),
  best AS (SELECT sb_id, store_id FROM candidates WHERE rn = 1),
  updated AS (
    UPDATE store_balances sb
    SET store_id = b.store_id, match_method = 'link-segment-backfill', match_confidence = 0.95
    FROM best b WHERE sb.id = b.sb_id AND sb.store_id IS NULL
    RETURNING sb.store_id
  )
  SELECT ARRAY_AGG(DISTINCT store_id) INTO v_linked_ids FROM updated;

  RETURN QUERY SELECT
    COALESCE(ARRAY_LENGTH(v_linked_ids, 1), 0), COALESCE(v_linked_ids, ARRAY[]::text[]);
END;
$function$;
