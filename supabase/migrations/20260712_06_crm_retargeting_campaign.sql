-- CRM إعادة الاستهداف — المرحلة 4: أداء الحملة (قمع التحويل + الموظفين + الشرائح).
-- النجاح = عاد للشحن (status='returned'). المصدر = retargeting_followups × الشريحة.
create or replace function public.crm_retargeting_campaign_stats()
returns json language sql stable security definer set search_path to public as $$
  with fu as (
    select f.phone, f.status, f.owner_id, f.last_touch_at, v.segment, v.total_shipments
    from public.retargeting_followups f
    join public.v_crm_retargeting v on v.phone = f.phone
  ),
  funnel as (
    select
      (select count(*) from public.v_crm_retargeting) as universe,
      count(*) as worked,
      count(*) filter (where last_touch_at is not null) as contacted,
      count(*) filter (where status = 'interested') as interested,
      count(*) filter (where status = 'returned') as returned,
      count(*) filter (where status in ('not_interested','competitor','closed_business')) as lost,
      count(*) filter (where status in ('price_issue','support_issue','integration_issue')) as blocked
    from fu
  )
  select json_build_object(
    'funnel', (select row_to_json(funnel) from funnel),
    'by_status', (select coalesce(json_object_agg(status, c), '{}') from (select status, count(*) c from fu group by status) s),
    'by_owner', (select coalesce(json_agg(o), '[]') from (
       select coalesce(pr.name, '—') as name,
         count(*)::int worked,
         count(*) filter (where fu.last_touch_at is not null)::int contacted,
         count(*) filter (where fu.status = 'interested')::int interested,
         count(*) filter (where fu.status = 'returned')::int returned
       from fu left join public.profiles pr on pr.id = fu.owner_id
       where fu.owner_id is not null
       group by pr.name order by returned desc, worked desc
    ) o),
    'by_segment', (select coalesce(json_agg(s), '[]') from (
       select segment,
         count(*)::int worked,
         count(*) filter (where status = 'returned')::int returned,
         count(*) filter (where status = 'interested')::int interested
       from fu group by segment order by returned desc, worked desc
    ) s)
  );
$$;
revoke all on function public.crm_retargeting_campaign_stats() from public;
grant execute on function public.crm_retargeting_campaign_stats() to authenticated;
