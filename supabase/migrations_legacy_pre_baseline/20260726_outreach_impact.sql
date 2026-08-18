-- محرّك النتائج: الأثر بالريال لكل حملة — تواصل → سدّد خلال 14 يوماً + المبلغ.
-- المطابقة هاتف→متجر→اسم زوهو→دفعة (تقريبية بالاسم، ارتباط لا سببية). 2026-07-26.
create or replace function public.outreach_impact(p_days int default 90)
returns table(campaign_name text, contacted bigint, replied bigint, paid bigint, collected numeric, conv_rate numeric)
language sql stable security invoker set search_path = public, pg_temp
as $$
  with
  latest_snap as (select max(snapshot_date) sd from merchants),
  pc as (
    select distinct norm_sa_phone(m.phone) as phone, l.customer_name
    from merchants m join customer_merchant_links l on l.store_id = m.store_id
    where m.snapshot_date = (select sd from latest_snap) and norm_sa_phone(m.phone) is not null
  ),
  sends as (
    select coalesce(nullif(w.campaign_name,''),'(بلا اسم)') as campaign_name, w.phone, min(w.sent_at) as first_sent,
           bool_or(w.replied_at is not null and coalesce(w.reply_is_auto,false)=false) as replied
    from whatsapp_campaign_sends w
    where w.sent_at > now() - make_interval(days => greatest(p_days,1)) and w.phone is not null
    group by 1, 2
  ),
  paid as (
    select s.campaign_name, s.phone, sum(pm.amount) as amt
    from sends s join pc on pc.phone = s.phone
    join lateral (
      select distinct zp.zoho_id, zp.amount from zoho_payments zp
      where zp.customer_name = pc.customer_name
        and zp.date >= s.first_sent::date and zp.date <= (s.first_sent + interval '14 days')::date
    ) pm on true
    group by 1, 2
  )
  select s.campaign_name, count(distinct s.phone), count(distinct s.phone) filter (where s.replied),
    count(distinct p.phone), coalesce(sum(p.amt), 0),
    round(100.0 * count(distinct p.phone) / nullif(count(distinct s.phone), 0), 1)
  from sends s left join paid p on p.campaign_name = s.campaign_name and p.phone = s.phone
  group by s.campaign_name order by 5 desc, 2 desc;
$$;
revoke all on function public.outreach_impact(int) from anon, public;
grant execute on function public.outreach_impact(int) to authenticated, service_role;
