-- §1.52: دين العميل من `customer_ar` (شامل الرصيد الافتتاحي) لا من جمع الفواتير.
-- خمس دوال كانت تجمع `zoho_invoices.balance` فتُسقط الافتتاحي — فيظهر عميل
-- «سليم» وهو مدين، ولا يحمل تاق «عليه مديونية»، ولا يُقترح تحصيله.

-- (١) لوحة الإجراء التالي
create or replace function public.next_best_actions(p_limit integer default 300, p_owner text default null)
 returns table(phone text, name text, store_id text, owner_id text, reason_code text, reason text,
               action text, priority integer, amount numeric, followup_status text, last_touch timestamptz)
 language sql stable set search_path to 'public','pg_temp'
as $function$
  with
  latest_snap as (select max(snapshot_date) sd from merchants),
  m as (
    select norm_sa_phone(phone) as phone, store_id, store_name, shipment_count,
           last_shipment_at, billing_type, status, wallet_balance
    from merchants where snapshot_date = (select sd from latest_snap) and norm_sa_phone(phone) is not null
  ),
  debt as (   -- ✅ الذمّة الكاملة
    select l.store_id, sum(ar.total_due) as owed
    from customer_ar ar join customer_merchant_links l on l.customer_name = ar.contact_name
    where ar.total_due > 0.5 group by l.store_id
  ),
  sig as (
    select norm_sa_phone(w.phone) as phone, w.name as name, null::text as store_id,
      'hot_reply' as reason_code,
      (case reply_intent(w.reply_body) when 'wants_call' then 'ردّ يطلب اتصالاً: '
        when 'price' then 'ردّ باعتراض سعر: ' else 'ردّ باهتمام: ' end) || left(w.reply_body, 45) as reason,
      (case reply_intent(w.reply_body) when 'wants_call' then 'اتصل به الآن'
        when 'price' then 'اعرض سعراً/خصماً' else 'تواصل معه الآن' end) as action,
      108 as priority, null::numeric as amount
    from whatsapp_campaign_sends w
    where w.replied_at is not null and coalesce(w.reply_is_auto,false) = false
      and reply_intent(w.reply_body) in ('interested','wants_call','price')
      and w.replied_at > now() - interval '14 days'
    union all
    select f.phone,
      coalesce((select store_name from m where m.phone = f.phone limit 1), f.phone), null::text,
      'sla',
      case when f.next_action_at is not null and f.next_action_at < now() then 'متابعة تجاوزت موعدها المحدد'
           else 'متابعة راكدة — لم تُلمَس منذ '||greatest(1, floor(extract(epoch from now() - f.last_touch_at)/86400))::int||' يوم' end,
      'تابعه الآن', 105, null::numeric
    from retargeting_followups f
    where f.status not in ('converted','rejected','not_interested','blacklist','supplier','noise','test')
      and ((f.next_action_at is not null and f.next_action_at < now()) or f.last_touch_at < now() - interval '3 days')
    union all
    select norm_sa_phone(w.phone), w.name, null::text,
      'reply', 'ردّ على حملتك ولم يُتابَع', 'تابع الردّ', 100, null::numeric
    from whatsapp_campaign_sends w
    where w.replied_at is not null and coalesce(w.reply_is_auto,false) = false
      and coalesce(w.followed_up,false) = false and w.replied_at > now() - interval '30 days'
    union all
    select m.phone, m.store_name, m.store_id, 'wallet_neg', 'محفظته سالبة (دفع مسبق)', 'حصّل رصيد المحفظة', 88, abs(m.wallet_balance)
    from m where m.billing_type = 'دفع مسبق' and coalesce(m.wallet_balance,0) < -0.5
    union all
    select m.phone, m.store_name, m.store_id, 'debt', 'عليه دين مفتوح', 'حصّل الدين', 82, d.owed
    from m join debt d on d.store_id = m.store_id where d.owed > 0.5
    union all
    select m.phone, m.store_name, m.store_id, 'stopped', 'توقّف عن الشحن (كان نشطاً)', 'أعد تنشيطه', 65, null
    from m where m.shipment_count > 0 and m.last_shipment_at between now() - interval '45 days' and now() - interval '7 days'
  ),
  ranked as (
    select s.*, row_number() over (partition by s.phone order by s.priority desc, s.amount desc nulls last) as rn
    from sig s where s.phone is not null and s.phone <> ''
  )
  select r.phone, r.name, r.store_id, f.owner_id::text,
    r.reason_code, r.reason, r.action, r.priority, r.amount, f.status, f.last_touch_at
  from ranked r
  left join retargeting_followups f on f.phone = r.phone
  where r.rn = 1 and (p_owner is null or f.owner_id::text = p_owner)
  order by r.priority desc, r.amount desc nulls last
  limit greatest(p_limit,1);
$function$;

-- (٢) خصائص جهة الاتصال في هاتف
create or replace function public.hatif_contact_labels()
 returns table(phone text, name text, store_count integer, store_names text[], tags text[],
               note text, debt numeric, wallet numeric, shipments bigint, days_since_last integer)
 language sql stable set search_path to 'public'
as $function$
  with latest as (select snapshot_id from public.merchants order by uploaded_at desc limit 1),
  debt_by_phone as (
    select phone, sum(bal) as debt from (
      select distinct public.norm_sa_phone(m.phone) as phone, d.customer_name, d.bal
      from (select contact_name customer_name, total_due bal from public.customer_ar where total_due > 0.5) d
      join public.customer_merchant_links cml on cml.customer_name = d.customer_name
      join public.merchants m on m.store_id = cml.store_id and m.snapshot_id = (select snapshot_id from latest)
      where public.norm_sa_phone(m.phone) is not null
    ) x group by phone
  ),
  base as (
    select public.norm_sa_phone(v.phone) as np, v.*
    from public.v_crm_retargeting v
    where public.norm_sa_phone(v.phone) is not null
      and (public.norm_sa_phone(v.phone) ~ '^9665[0-9]{8}$'
        or (left(public.norm_sa_phone(v.phone), 3) <> '966'
            and length(public.norm_sa_phone(v.phone)) between 10 and 15))
  ),
  agg as (
    select b.np, sum(b.total_shipments)::bigint as shipments, round(sum(b.wallet), 2) as wallet,
      sum(b.store_count)::int as store_count, min(b.days_since_last) as days_since_last
    from base b group by b.np
  ),
  names as (
    select b.np, array_agg(distinct sn.name) as store_names
    from base b, lateral unnest(coalesce(b.store_names, array[]::text[])) as sn(name)
    group by b.np
  ),
  dom as (
    select distinct on (np) np, primary_store, segment, billing_type
    from base order by np, total_shipments desc nulls last
  )
  select
    a.np as phone,
    d.primary_store || case when a.store_count > 1 then ' (+' || (a.store_count - 1) || ' متاجر)' else '' end as name,
    a.store_count,
    coalesce(n.store_names, array[]::text[]) as store_names,
    array_remove(array[
      case when a.shipments >= 300 then 'VIP' end,
      case when d.segment = 'active' then 'نشط' end,
      case when d.segment in ('stopped_recent','stopped_long') then 'متوقف' end,
      case when d.segment in ('new_active','registered_no_ship','linked_no_ship') then 'جديد' end,
      case when coalesce(db.debt,0) > 0.5 then 'عليه مديونية' end,
      case when a.wallet < -0.5 then 'رصيد سالب' end,
      case when d.billing_type = 'دفع مسبق' then 'دفع مسبق'
           when d.billing_type = 'دفع لاحق' then 'دفع لاحق' end
    ], null) as tags,
    'المتاجر: ' || array_to_string(coalesce(n.store_names, array[]::text[]), ' · ')
      || ' | شحنات: ' || a.shipments::text
      || case when a.days_since_last is not null then ' | آخر شحنة: ' || a.days_since_last || 'ي' else '' end
      || case when coalesce(db.debt,0) > 0.5 then ' | دين: ' || round(db.debt)::text else '' end
      || case when a.wallet < -0.5 then ' | محفظة: ' || round(a.wallet)::text else '' end as note,
    coalesce(db.debt, 0)::numeric as debt,
    a.wallet, a.shipments, a.days_since_last
  from agg a
  join dom d on d.np = a.np
  left join names n on n.np = a.np
  left join debt_by_phone db on db.phone = a.np;
$function$;
