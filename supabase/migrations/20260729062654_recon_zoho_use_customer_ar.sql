-- جانب زوهو في شاشة المطابقة كان يجمع الفواتير المفتوحة فقط — فيسقط
-- الرصيد الافتتاحي (ذمّة بلا مستند فاتورة). النتيجة: عميل مثل «لارسا»
-- يظهر بـ79.96 ودينه الحقيقي 6,201.42، ويُصنَّف «متطابق» أو «داخلي فقط»
-- زوراً. الآن المصدر `customer_ar` (نقطة الحقيقة §الرصيد الافتتاحي).
create or replace function public.customer_balance_recon_zoho()
 returns table(anchor text, store_id text, store_name text, phone text, billing_type text,
               platform_status text, wallet_balance numeric, zoho_balance numeric,
               zoho_open_cnt integer, zoho_oldest date, zoho_names text[],
               internal_balance numeric, internal_names text[], diff numeric, recon_status text)
 language sql stable security definer set search_path to 'public'
as $function$
  with latest_settle as (
    select id from store_balance_snapshots
    where source = 'internal' order by uploaded_at desc limit 1
  ),
  latest_merch as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  merch as (
    select m.store_id, m.store_name, m.phone, m.billing_type, m.status,
           coalesce(m.wallet_balance,0) wallet,
           normalize_arabic_name(m.store_name) norm
    from merchants m where m.snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as (select customer_name, l.store_id from customer_merchant_links l where l.store_id is not null),
  -- ✅ زوهو: **إجمالي الذمّة** من customer_ar (يشمل الرصيد الافتتاحي)
  --    وعدد الفواتير/أقدمها يبقيان للعرض فقط.
  zoho_raw as (
    select ar.contact_name as customer_name,
           ar.total_due    as bal,
           ar.open_invoices::int as cnt,
           ar.oldest_invoice_date as oldest
    from customer_ar ar
    where ar.total_due > 0.5 and ar.contact_name is not null
  ),
  zoho_anch as (
    select z.*,
      coalesce(l.store_id,
        (select m.store_id from merch m where m.norm = normalize_arabic_name(z.customer_name) limit 1),
        'n:' || normalize_arabic_name(z.customer_name)) anchor
    from zoho_raw z left join links l on l.customer_name = z.customer_name
  ),
  zoho_g as (
    select anchor, sum(bal) bal, sum(cnt)::int cnt, min(oldest) oldest,
           array_agg(customer_name order by bal desc) names
    from zoho_anch group by anchor
  ),
  int_raw as (
    select sb.raw_name as customer_name, sb.store_id as sid0, -sum(sb.balance) bal
    from store_balances sb
    where sb.snapshot_id = (select id from latest_settle)
    group by sb.raw_name, sb.store_id
    having abs(sum(sb.balance)) > 0.5
  ),
  int_anch as (
    select i.customer_name, i.bal,
      coalesce(i.sid0, l.store_id,
        (select m.store_id from merch m where m.norm = normalize_arabic_name(i.customer_name) limit 1),
        'n:' || normalize_arabic_name(i.customer_name)) anchor
    from int_raw i left join links l on l.customer_name = i.customer_name
  ),
  int_g as (
    select anchor, sum(bal) bal, array_agg(customer_name order by bal desc) names
    from int_anch group by anchor
  ),
  joined as (
    select coalesce(z.anchor, i.anchor) anchor,
      case when coalesce(z.anchor, i.anchor) like 'n:%' then null else coalesce(z.anchor, i.anchor) end sid,
      coalesce(z.bal, 0) zbal, coalesce(z.cnt, 0) zcnt, z.oldest, z.names znames,
      coalesce(i.bal, 0) ibal, i.names inames
    from zoho_g z full outer join int_g i on z.anchor = i.anchor
  )
  select j.anchor, j.sid, m.store_name, m.phone, m.billing_type, m.status, m.wallet,
    round(j.zbal::numeric, 2), j.zcnt, j.oldest, coalesce(j.znames, '{}'),
    round(j.ibal::numeric, 2), coalesce(j.inames, '{}'),
    round((j.ibal - j.zbal)::numeric, 2),
    case
      when abs(j.ibal - j.zbal) <= 1           then 'matched'
      when j.zbal <= 0.5 and abs(j.ibal) > 0.5 then 'internal_only'
      when j.zbal > 0.5 and abs(j.ibal) <= 0.5 then 'zoho_only'
      else 'needs_investigation'
    end
  from joined j
  left join merch m on m.store_id = j.sid
  order by abs(j.ibal - j.zbal) desc;
$function$;
