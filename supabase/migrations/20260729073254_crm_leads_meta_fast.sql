-- `crm_leads_dashboard_meta` كانت **2,207ms** (وسجّلت 7.9 ثانية في الذروة)
-- وهي أول ما يُنتظَر عند فتح مركز المبيعات.
-- السبب: CTE يُجسِّد **94 ألف صف** من جدول عريض ثم يمرّ عليه أربع مرات،
-- والقيم المميّزة تُحسَب بفرز خارجي على القرص (4.9 ميغابايت).
--
-- الإصلاح جزآن:
--  (١) العدّادات من **فهرس مغطٍّ** (`ix_crm_leads_meta_cover`) — مسح فهرس
--      فقط بدل قراءة 22 ألف صفحة كومة: 437ms → 61ms.
--  (٢) القيم المميّزة بـ**مسح تخطّي** (loose index scan) — ١٢ نزولاً في
--      الفهرس بدل فرز 94 ألف قيمة: ~35ms لكل عمود، Heap Fetches = 0.
create index if not exists ix_crm_leads_platform on crm_leads (platform) where platform is not null;

create or replace function public.crm_leads_dashboard_meta()
 returns jsonb language sql stable set search_path to 'public'
as $function$
  with counts as (
    select
      count(*)::int total,
      count(*) filter (where status = 'new')::int new_count,
      count(*) filter (where matched_store_id is not null or status = 'existing_customer')::int existing_customers,
      count(*) filter (where coalesce(duplicate_count, 1) > 1)::int duplicate_rows,
      count(*) filter (where owner_id is null)::int unassigned,
      count(*) filter (where status = 'converted')::int converted
    from crm_leads
  ),
  cat as (
    with recursive t as (
      (select category c from crm_leads where category is not null order by category limit 1)
      union all
      select (select category from crm_leads where category > t.c and category is not null order by category limit 1)
      from t where t.c is not null
    )
    select coalesce(jsonb_agg(c order by c), '[]'::jsonb) items from t where nullif(c,'') is not null
  ),
  plat as (
    with recursive t as (
      (select platform c from crm_leads where platform is not null order by platform limit 1)
      union all
      select (select platform from crm_leads where platform > t.c and platform is not null order by platform limit 1)
      from t where t.c is not null
    )
    select coalesce(jsonb_agg(c order by c), '[]'::jsonb) items from t where nullif(c,'') is not null
  ),
  stat as (
    with recursive t as (
      (select status c from crm_leads where status is not null order by status limit 1)
      union all
      select (select status from crm_leads where status > t.c and status is not null order by status limit 1)
      from t where t.c is not null
    )
    select coalesce(jsonb_agg(c order by c), '[]'::jsonb) items from t where nullif(c,'') is not null
  )
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'total', counts.total, 'newCount', counts.new_count,
      'existingCustomers', counts.existing_customers, 'duplicateRows', counts.duplicate_rows,
      'unassigned', counts.unassigned, 'converted', counts.converted
    ),
    'options', jsonb_build_object(
      'categories', cat.items, 'platforms', plat.items, 'statuses', stat.items
    )
  )
  from counts, cat, plat, stat;
$function$;
