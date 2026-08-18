-- شاشة الفعل التالي: يوحّد إشارات القرار لكل عميل (مفتاح الهاتف) ويعطي أعلى أولوية
-- + سبب + إجراء مقترح + المسؤول. ما يعجز عنه هاتف: يربط التواصل بالمال والشحن. 2026-07-26.
-- الإشارات: ردّ حملة لم يُتابَع (100) · محفظة سالبة دفع مسبق (88) · دين زوهو (82) · توقّف شحن (65).
create or replace function public.next_best_actions(p_limit int default 300, p_owner text default null)
returns table(
  phone text, name text, store_id text, owner_id text,
  reason_code text, reason text, action text, priority int, amount numeric,
  followup_status text, last_touch timestamptz
)
language sql stable security invoker set search_path = public, pg_temp
as $$
  with
  latest_snap as (select max(snapshot_date) sd from merchants),
  m as (
    select norm_sa_phone(phone) as phone, store_id, store_name, shipment_count,
           last_shipment_at, billing_type, status, wallet_balance
    from merchants
    where snapshot_date = (select sd from latest_snap) and norm_sa_phone(phone) is not null
  ),
  debt as (
    select l.store_id, sum(zi.balance) as owed
    from zoho_invoices zi
    join customer_merchant_links l on l.customer_name = zi.customer_name
    where coalesce(zi.balance,0) > 0.5
    group by l.store_id
  ),
  sig as (
    select norm_sa_phone(w.phone) as phone, w.name, null::text as store_id,
      'reply' as reason_code, 'ردّ على حملتك ولم يُتابَع' as reason, 'تابع الردّ' as action,
      100 as priority, null::numeric as amount
    from whatsapp_campaign_sends w
    where w.replied_at is not null and coalesce(w.reply_is_auto,false) = false
      and coalesce(w.followed_up,false) = false and w.replied_at > now() - interval '30 days'
    union all
    select m.phone, m.store_name, m.store_id,
      'wallet_neg', 'محفظته سالبة (دفع مسبق)', 'حصّل رصيد المحفظة',
      88, abs(m.wallet_balance)
    from m where m.billing_type = 'دفع مسبق' and coalesce(m.wallet_balance,0) < -0.5
    union all
    select m.phone, m.store_name, m.store_id,
      'debt', 'عليه دين مفتوح', 'حصّل الدين', 82, d.owed
    from m join debt d on d.store_id = m.store_id where d.owed > 0.5
    union all
    select m.phone, m.store_name, m.store_id,
      'stopped', 'توقّف عن الشحن (كان نشطاً)', 'أعد تنشيطه', 65, null
    from m where m.shipment_count > 0
      and m.last_shipment_at between now() - interval '45 days' and now() - interval '7 days'
  ),
  ranked as (
    select s.*, row_number() over (partition by s.phone order by s.priority desc, s.amount desc nulls last) as rn
    from sig s where s.phone is not null and s.phone <> ''
  )
  select r.phone, r.name, r.store_id, f.owner_id::text,
    r.reason_code, r.reason, r.action, r.priority, r.amount,
    f.status, f.last_touch_at
  from ranked r
  left join retargeting_followups f on f.phone = r.phone
  where r.rn = 1 and (p_owner is null or f.owner_id::text = p_owner)
  order by r.priority desc, r.amount desc nulls last
  limit greatest(p_limit,1);
$$;
revoke all on function public.next_best_actions(int,text) from anon, public;
grant execute on function public.next_best_actions(int,text) to authenticated, service_role;
