-- قرار المستخدم: التاجر يرى **رصيداً واحداً بلا تفصيل**.
-- فأُزيل سطر «رصيد سابق مُرحَّل» الاصطناعي الذي أضفتُه — الإجمالي وحده
-- (من `customer_ar`، شاملاً الرصيد الافتتاحي) هو ما يُعرَض.
-- قائمة الفواتير تبقى في الحمولة لأن البوابة تستعملها في خطوة السداد
-- الجزئي، لكنها لا تُقدَّم كتفصيل للرصيد ولا يُطالَب بمجموعها.
create or replace function public.portal_lookup(p_phone text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  normalized text;
  latest_merchant_snap text;
  result jsonb;
BEGIN
  normalized := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF length(normalized) >= 5 AND substring(normalized FROM 1 FOR 5) = '00966'
    THEN normalized := substring(normalized FROM 6); END IF;
  IF length(normalized) >= 3 AND substring(normalized FROM 1 FOR 3) = '966'
    THEN normalized := substring(normalized FROM 4); END IF;
  IF length(normalized) >= 1 AND substring(normalized FROM 1 FOR 1) = '0'
    THEN normalized := substring(normalized FROM 2); END IF;
  IF length(normalized) < 8 THEN
    RETURN jsonb_build_object('error', 'phone too short', 'stores', '[]'::jsonb);
  END IF;

  SELECT snapshot_id INTO latest_merchant_snap
    FROM merchants ORDER BY uploaded_at DESC NULLS LAST LIMIT 1;

  WITH my_merchants AS (
    SELECT m.*
    FROM merchants m
    WHERE m.snapshot_id = latest_merchant_snap
      AND regexp_replace(
            CASE
              WHEN regexp_replace(coalesce(m.phone,''), '\D', '', 'g') LIKE '00966%'
                THEN substring(regexp_replace(m.phone, '\D', '', 'g') FROM 6)
              WHEN regexp_replace(coalesce(m.phone,''), '\D', '', 'g') LIKE '966%'
                THEN substring(regexp_replace(m.phone, '\D', '', 'g') FROM 4)
              WHEN regexp_replace(coalesce(m.phone,''), '\D', '', 'g') LIKE '0%'
                THEN substring(regexp_replace(m.phone, '\D', '', 'g') FROM 2)
              ELSE regexp_replace(coalesce(m.phone,''), '\D', '', 'g')
            END, '\D', '', 'g') = normalized
  ),
  store_blob AS (
    SELECT
      m.store_id, m.store_name, m.phone, m.billing_type, m.status,
      m.wallet_balance, m.last_shipment_at,
      (SELECT string_agg(l.customer_name, ' | ')
         FROM customer_merchant_links l WHERE l.store_id = m.store_id) as linked_customer_name,
      -- ✅ رصيد واحد من نقطة الحقيقة (يشمل الرصيد الافتتاحي)
      COALESCE((
        SELECT round(SUM(ar.total_due)::numeric, 2) FROM customer_ar ar
        WHERE ar.contact_name IN (
          SELECT l.customer_name FROM customer_merchant_links l WHERE l.store_id = m.store_id)
      ), 0) as total_due,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', z.zoho_id, 'number', z.invoice_number,
          'date', z.date, 'amount', round(z.balance::numeric, 2)
        ) ORDER BY z.date)
        FROM zoho_invoices z
        WHERE z.balance > 0.5
          AND z.customer_name IN (
            SELECT l.customer_name FROM customer_merchant_links l WHERE l.store_id = m.store_id)
      ), '[]'::jsonb) as invoices
    FROM my_merchants m
  )
  SELECT jsonb_build_object(
    'phone',  normalized,
    'source', 'zoho_live',
    'stores', COALESCE(jsonb_agg(jsonb_build_object(
      'store_id',       store_id,
      'store_name',     store_name,
      'phone',          phone,
      'billing_type',   billing_type,
      'status',         status,
      'wallet_balance', wallet_balance,
      'last_shipment_at', last_shipment_at,
      'customer_name',  linked_customer_name,
      'total_due',      total_due,
      'invoices',       invoices
    )), '[]'::jsonb)
  ) INTO result
  FROM store_blob;

  RETURN COALESCE(result, jsonb_build_object('phone', normalized, 'stores', '[]'::jsonb));
END;
$function$;
