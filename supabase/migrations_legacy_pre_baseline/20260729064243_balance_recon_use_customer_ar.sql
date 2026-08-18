-- تكملة §1.52: عمود «زوهو» في مطابقة أرصدة لمحة الداخلية = الذمّة الكاملة
-- (شاملة الرصيد الافتتاحي) وإلا ظهر فرق وهمي مقابل الرصيد الداخلي الصحيح.
create or replace function public.balance_reconciliation()
 returns table(store_id text, store_name text, internal_balance numeric, zoho_balance numeric,
               receivables_balance numeric, max_diff numeric, internal_raw_name text, zoho_raw_name text)
 language sql stable security definer set search_path to 'public'
as $function$
  WITH
  latest_internal AS (
    SELECT id FROM store_balance_snapshots WHERE source='internal' ORDER BY uploaded_at DESC LIMIT 1
  ),
  latest_receivables AS (SELECT snapshot_id FROM customer_receivables ORDER BY uploaded_at DESC LIMIT 1),
  latest_merchants AS (SELECT snapshot_id FROM merchants ORDER BY uploaded_at DESC LIMIT 1),
  internal_rows AS (
    SELECT sb.store_id, MIN(sb.raw_name) AS raw_name, SUM(sb.balance) AS balance
    FROM store_balances sb JOIN latest_internal li ON sb.snapshot_id = li.id
    GROUP BY sb.store_id
  ),
  merchant_norm AS (
    SELECT m.store_id, normalize_arabic_name(m.store_name) AS norm
    FROM merchants m JOIN latest_merchants lm ON m.snapshot_id = lm.snapshot_id
  ),
  -- ✅ زوهو الحي = الذمّة الكاملة من `customer_ar` (فواتير مفتوحة + رصيد افتتاحي)
  zoho_live AS (
    SELECT contact_name AS customer_name, total_due AS bal
    FROM customer_ar WHERE total_due > 0.5
  ),
  zoho_rows AS (
    SELECT t.store_id, MIN(t.customer_name) AS raw_name, SUM(t.bal) AS balance
    FROM (
      SELECT z.customer_name, z.bal,
        COALESCE(l.store_id,
          (SELECT mn.store_id FROM merchant_norm mn
           WHERE mn.norm = normalize_arabic_name(z.customer_name) LIMIT 1)) AS store_id
      FROM zoho_live z
      LEFT JOIN customer_merchant_links l
        ON l.customer_name = z.customer_name AND l.store_id IS NOT NULL
    ) t
    WHERE t.store_id IS NOT NULL
    GROUP BY t.store_id
  ),
  receivables_rows AS (
    SELECT cml.store_id, SUM(cr.balance_amount)::numeric AS balance
    FROM customer_receivables cr
    JOIN latest_receivables lr ON cr.snapshot_id = lr.snapshot_id
    JOIN customer_merchant_links cml ON cml.customer_name = cr.customer_name
    WHERE cml.store_id IS NOT NULL AND NOT coalesce(cr.is_summary, false)
    GROUP BY cml.store_id
  ),
  merchant_names AS (
    SELECT m.store_id, m.store_name FROM merchants m JOIN latest_merchants lm ON m.snapshot_id = lm.snapshot_id
  ),
  all_stores AS (
    SELECT store_id FROM internal_rows WHERE store_id IS NOT NULL
    UNION SELECT store_id FROM zoho_rows WHERE store_id IS NOT NULL
    UNION SELECT store_id FROM receivables_rows
  )
  SELECT a.store_id, mn.store_name,
    -(coalesce(i.balance, 0)) AS internal_balance,
    coalesce(z.balance, 0)    AS zoho_balance,
    coalesce(r.balance, 0)    AS receivables_balance,
    GREATEST(
      abs(-(coalesce(i.balance, 0)) - coalesce(z.balance, 0)),
      abs(-(coalesce(i.balance, 0)) - coalesce(r.balance, 0)),
      abs(coalesce(z.balance, 0)    - coalesce(r.balance, 0))
    )::numeric AS max_diff,
    i.raw_name AS internal_raw_name, z.raw_name AS zoho_raw_name
  FROM all_stores a
  LEFT JOIN internal_rows     i  ON i.store_id = a.store_id
  LEFT JOIN zoho_rows         z  ON z.store_id = a.store_id
  LEFT JOIN receivables_rows  r  ON r.store_id = a.store_id
  LEFT JOIN merchant_names    mn ON mn.store_id = a.store_id
  ORDER BY max_diff DESC;
$function$;
