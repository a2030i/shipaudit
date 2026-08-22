-- Sales Core: force a caller-specific plan for the unchanged engagement query.
-- The former cached generic plan took about 656ms; the same SQL planned per call takes about 184ms.
create or replace function public.customer_engagement_next_actions(
  p_limit integer default 400,
  p_owner text default null,
  p_journey text default null
)
returns table(
  phone text,
  name text,
  store_id text,
  owner_id text,
  reason_code text,
  journey text,
  reason text,
  action text,
  priority integer,
  amount numeric,
  followup_status text,
  last_touch timestamptz,
  recommended_channel text,
  recommended_template_key text,
  send_eligible boolean,
  guard_code text,
  guard_reason text,
  last_campaign_at timestamptz,
  last_call_at timestamptz,
  source_snapshot_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $function$
begin
  return query execute $query$
  with
  access_guard as (
    select public.app_has_any_permission(array[
      'collections.view', 'sales.view', 'overview.view', 'crm.view'
    ]) as allowed
  ),
  latest_snapshot as (
    select snapshot_id, uploaded_at
    from public.merchants
    order by uploaded_at desc
    limit 1
  ),
  merchant_primary as (
    select distinct on (public.norm_sa_phone(m.phone))
      public.norm_sa_phone(m.phone) as phone,
      m.store_id,
      m.store_name
    from public.merchants m
    where m.snapshot_id = (select snapshot_id from latest_snapshot)
      and public.norm_sa_phone(m.phone) is not null
    order by public.norm_sa_phone(m.phone), coalesce(m.shipment_count, 0) desc, m.store_id
  ),
  lifecycle as (
    select
      public.norm_sa_phone(v.phone) as phone,
      v.primary_store as name,
      mp.store_id,
      v.total_shipments,
      v.last_shipment,
      v.created_at,
      v.wallet,
      v.segment,
      v.priority as lifecycle_priority,
      v.opportunity_score,
      v.readiness_score,
      v.profile_done,
      v.verified,
      v.integration_type,
      v.days_since_last
    from public.v_crm_retargeting v
    left join merchant_primary mp on mp.phone = public.norm_sa_phone(v.phone)
    where public.norm_sa_phone(v.phone) is not null
  ),
  debt_by_phone as (
    select public.norm_sa_phone(m.phone) as phone, sum(ar.total_due)::numeric as owed
    from public.customer_ar ar
    join public.customer_merchant_links l on l.customer_name = ar.contact_name
    join public.merchants m
      on m.store_id = l.store_id
     and m.snapshot_id = (select snapshot_id from latest_snapshot)
    where ar.total_due > 0.5
      and public.norm_sa_phone(m.phone) is not null
    group by public.norm_sa_phone(m.phone)
  ),
  followups as (
    select public.norm_sa_phone(f.phone) as phone,
      f.status, f.owner_id, f.next_action_at, f.last_touch_at
    from public.retargeting_followups f
    where public.norm_sa_phone(f.phone) is not null
  ),
  last_campaign as (
    select public.norm_sa_phone(w.phone) as phone, max(w.sent_at) as sent_at
    from public.whatsapp_campaign_sends w
    where w.sent_at is not null and public.norm_sa_phone(w.phone) is not null
    group by public.norm_sa_phone(w.phone)
  ),
  last_call as (
    select coalesce(h.contact_phone, public.norm_sa_phone(h.contact_number)) as phone,
           max(h.creation_time) as called_at
    from public.hatif_call_log h
    where coalesce(h.contact_phone, public.norm_sa_phone(h.contact_number)) is not null
    group by coalesce(h.contact_phone, public.norm_sa_phone(h.contact_number))
  ),
  blocked as (
    select distinct public.norm_sa_phone(b.phone) as phone
    from public.campaign_phone_blocklist b
    where public.norm_sa_phone(b.phone) is not null
  ),
  signals as (
    select public.norm_sa_phone(w.phone) as phone,
      coalesce(nullif(w.name, ''), l.name, public.norm_sa_phone(w.phone)) as name,
      l.store_id,
      'hot_reply'::text as reason_code, 'reply'::text as journey,
      (case public.reply_intent(w.reply_body)
        when 'wants_call' then 'ردّ يطلب اتصالاً: '
        when 'price' then 'ردّ باعتراض سعر: '
        else 'ردّ باهتمام: '
       end) || left(coalesce(w.reply_body, ''), 45) as reason,
      (case public.reply_intent(w.reply_body)
        when 'wants_call' then 'اتصل به الآن'
        when 'price' then 'راجع اعتراض السعر معه'
        else 'تابع الرد الآن'
       end) as action,
      108 as priority, null::numeric as amount
    from public.whatsapp_campaign_sends w
    left join lifecycle l on l.phone = public.norm_sa_phone(w.phone)
    where w.replied_at > now() - interval '14 days'
      and coalesce(w.reply_is_auto, false) = false
      and public.reply_intent(w.reply_body) in ('interested', 'wants_call', 'price')

    union all
    select f.phone, coalesce(l.name, f.phone), l.store_id,
      'sla', 'team_followup',
      case when f.next_action_at is not null and f.next_action_at < now()
        then 'متابعة تجاوزت موعدها المحدد'
        else 'متابعة راكدة منذ ' || greatest(1, floor(extract(epoch from now() - f.last_touch_at) / 86400))::int || ' يوم'
      end,
      'نفّذ متابعة الموظف الآن', 105, null::numeric
    from followups f
    left join lifecycle l on l.phone = f.phone
    where f.status not in ('converted', 'rejected', 'not_interested', 'blacklist', 'supplier', 'noise', 'test')
      and ((f.next_action_at is not null and f.next_action_at < now())
        or f.last_touch_at < now() - interval '3 days')

    union all
    select public.norm_sa_phone(w.phone), coalesce(nullif(w.name, ''), l.name, public.norm_sa_phone(w.phone)), l.store_id,
      'reply', 'reply', 'ردّ على الحملة ولم يُتابَع', 'تابع الرد الآن', 100, null::numeric
    from public.whatsapp_campaign_sends w
    left join lifecycle l on l.phone = public.norm_sa_phone(w.phone)
    where w.replied_at > now() - interval '30 days'
      and coalesce(w.reply_is_auto, false) = false
      and coalesce(w.followed_up, false) = false

    union all
    select l.phone, l.name, l.store_id,
      'wallet_neg', 'collections', 'محفظة الدفع المسبق سالبة', 'حصّل رصيد المحفظة',
      88, abs(l.wallet)::numeric
    from lifecycle l
    where l.wallet < -0.5

    union all
    select l.phone, l.name, l.store_id,
      'debt', 'collections', 'على العميل ذمة مفتوحة', 'تابع التحصيل حسب كشف العميل',
      82, d.owed
    from lifecycle l
    join debt_by_phone d on d.phone = l.phone
    where d.owed > 0.5

    union all
    select l.phone, l.name, l.store_id,
      'new_ready', 'new_customer',
      case
        when l.segment = 'topped_no_ship' then 'شحن المحفظة ولم ينفذ أول شحنة'
        when l.integration_type is not null then 'الربط جاهز ولم ينفذ أول شحنة'
        else 'بياناته جاهزة ولم ينفذ أول شحنة'
      end,
      'ساعده على تنفيذ أول شحنة', 78 + least(9, coalesce(l.opportunity_score, 0) / 10), null::numeric
    from lifecycle l
    left join followups f on f.phone = l.phone
    where l.total_shipments = 0
      and l.segment in ('topped_no_ship', 'linked_no_ship', 'new_active')
      and l.created_at >= current_date - 90
      and coalesce(f.status, '') not in ('converted', 'rejected', 'not_interested', 'blacklist', 'supplier', 'noise', 'test')

    union all
    select l.phone, l.name, l.store_id,
      'new_registered', 'new_customer', 'مسجل حديثًا ولم يبدأ التجهيز أو الشحن',
      case
        when not coalesce(l.profile_done, false) then 'أرسل ترحيبًا وساعده على إكمال البيانات'
        when not coalesce(l.verified, false) then 'ساعده على إكمال التوثيق'
        else 'ساعده على ربط المتجر'
      end,
      74 + least(7, coalesce(l.readiness_score, 0) / 15), null::numeric
    from lifecycle l
    left join followups f on f.phone = l.phone
    where l.total_shipments = 0
      and l.segment = 'registered_no_ship'
      and l.created_at >= current_date - 14
      and coalesce(f.status, '') not in ('converted', 'rejected', 'not_interested', 'blacklist', 'supplier', 'noise', 'test')

    union all
    select l.phone, l.name, l.store_id,
      'stopped_recent', 'stopped_customer',
      'توقف عن الشحن منذ ' || coalesce(l.days_since_last, 0) || ' يوم',
      'افهم سبب التوقف وأعد تنشيطه', 70 + least(8, coalesce(l.opportunity_score, 0) / 15), null::numeric
    from lifecycle l
    left join followups f on f.phone = l.phone
    where l.segment = 'stopped_recent'
      and l.days_since_last between 7 and 60
      and coalesce(f.status, '') not in ('converted', 'rejected', 'not_interested', 'blacklist', 'supplier', 'noise', 'test')

    union all
    select l.phone, l.name, l.store_id,
      'stopped_long', 'stopped_customer',
      'متوقف عالي القيمة منذ ' || coalesce(l.days_since_last, 0) || ' يوم',
      'راجع سبب الفقد ثم نفّذ محاولة استعادة', 58 + least(8, coalesce(l.opportunity_score, 0) / 15), null::numeric
    from lifecycle l
    left join followups f on f.phone = l.phone
    where l.segment = 'stopped_long'
      and l.days_since_last between 61 and 180
      and l.lifecycle_priority in ('A', 'B')
      and coalesce(f.status, '') not in ('converted', 'rejected', 'not_interested', 'blacklist', 'supplier', 'noise', 'test')
  ),
  ranked as (
    select s.*,
      row_number() over (partition by s.phone order by s.priority desc, s.amount desc nulls last) as rn
    from signals s
    where s.phone is not null and s.phone <> ''
  ),
  contextual as (
    select r.*, f.owner_id::text, f.status as followup_status, f.last_touch_at,
      f.next_action_at, lc.sent_at as last_campaign_at, ll.called_at as last_call_at,
      (select uploaded_at from latest_snapshot) as source_snapshot_at,
      (b.phone is not null) as is_blocked
    from ranked r
    left join followups f on f.phone = r.phone
    left join last_campaign lc on lc.phone = r.phone
    left join last_call ll on ll.phone = r.phone
    left join blocked b on b.phone = r.phone
    where r.rn = 1
  ),
  guarded as (
    select c.*,
      case
        when c.phone !~ '^9665[0-9]{8}$' then 'invalid_phone'
        when c.is_blocked then 'blocked'
        when c.reason_code in ('hot_reply', 'reply', 'sla') then 'human_followup'
        when c.reason_code = 'stopped_long' then 'human_call'
        when c.next_action_at > now() or c.last_touch_at > now() - interval '3 days' then 'owner_followup'
        when c.last_campaign_at > now() - interval '7 days' then 'recent_campaign'
        when c.last_call_at > now() - interval '3 days' then 'recent_call'
        when c.journey in ('new_customer', 'stopped_customer')
          and c.source_snapshot_at < now() - interval '72 hours' then 'stale_source'
        else 'ready'
      end as guard_code
    from contextual c
  )
  select
    g.phone, g.name, g.store_id, g.owner_id, g.reason_code, g.journey,
    g.reason, g.action, g.priority, g.amount, g.followup_status, g.last_touch_at,
    case
      when g.reason_code in ('hot_reply', 'reply', 'sla') then 'call'
      when g.reason_code in ('wallet_neg', 'debt') then 'whatsapp_collections'
      when g.reason_code in ('stopped_long') then 'call'
      else 'whatsapp'
    end as recommended_channel,
    case
      when g.reason_code in ('wallet_neg', 'debt') then 'collections_reminder'
      when g.reason_code = 'new_registered' then 'welcome_activation'
      when g.reason_code = 'new_ready' then 'first_shipment'
      when g.reason_code in ('stopped_recent', 'stopped_long') then 'reactivation'
      else null
    end as recommended_template_key,
    (g.guard_code = 'ready') as send_eligible,
    g.guard_code,
    case g.guard_code
      when 'ready' then 'جاهز للمراجعة والإرسال'
      when 'invalid_phone' then 'رقم الهاتف غير صالح لواتساب'
      when 'blocked' then 'الرقم في قائمة الحظر'
      when 'human_followup' then 'هذه متابعة بشرية وليست رسالة قالب جديدة'
      when 'human_call' then 'هذه فرصة استعادة عالية القيمة وتحتاج اتصالًا أولًا'
      when 'owner_followup' then 'توجد متابعة موظف أو تواصل حديث'
      when 'recent_campaign' then 'أُرسلت له حملة خلال آخر 7 أيام'
      when 'recent_call' then 'جرى اتصال عبر هاتف خلال آخر 3 أيام'
      when 'stale_source' then 'لقطة المتاجر أقدم من 72 ساعة'
      else 'تحتاج مراجعة'
    end as guard_reason,
    g.last_campaign_at, g.last_call_at, g.source_snapshot_at
  from guarded g
  cross join access_guard a
  where a.allowed
    and ($1 is null or g.owner_id = $1)
    and ($2 is null or g.journey = $2)
  order by g.priority desc, g.amount desc nulls last
  limit greatest(1, least(coalesce($3, 400), 1000))
  $query$ using p_owner, p_journey, p_limit;
end;
$function$;

revoke all on function public.customer_engagement_next_actions(integer, text, text) from public, anon;
grant execute on function public.customer_engagement_next_actions(integer, text, text) to authenticated, service_role;

comment on function public.customer_engagement_next_actions(integer, text, text) is
  'Review-first customer engagement decisions across Lamha merchants, CRM, finance and Hatif. Never sends automatically.';





