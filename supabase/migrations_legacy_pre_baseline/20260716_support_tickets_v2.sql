-- تذاكر v2 (§1.35): نوع التذكرة + الملاحظات الداخلية + داشبورد الأرقام
-- (مُطبَّقة على FIN عبر MCP باسم support_tickets_v2_category_internal_dashboard)

-- (١) category: نوع المشكلة (delayed/damaged/cod/billing/platform/other)
alter table public.support_tickets add column if not exists category text;

-- (٢) internal على الأحداث: الملاحظة الداخلية لا تُرسل أي إشعار للتاجر أبداً.
-- القاعدة الدائمة: أي إشعار واتساب مستقبلي يُرسَل فقط حين internal=false.
-- التعليقات افتراضياً داخلية (true) — الأمان بالافتراض.
alter table public.support_ticket_events add column if not exists internal boolean not null default true;

-- (٣) داشبورد الأرقام: الحالات × النوع × شركات الشحن + زمن الحل
create or replace function public.support_dashboard()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'by_status', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
      from (select status, count(*) cnt from support_tickets group by status) s
    ),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'category', category, 'total', cnt, 'open', open_cnt) order by cnt desc), '[]'::jsonb)
      from (
        select coalesce(category, 'other') category, count(*) cnt,
               count(*) filter (where status in ('open','in_progress','waiting_customer')) open_cnt
        from support_tickets group by 1
      ) c
    ),
    'by_carrier', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'carrier_id', carrier_id,
        'carrier_name', carrier_name,
        'total', cnt, 'open', open_cnt) order by cnt desc), '[]'::jsonb)
      from (
        select carrier_id, coalesce(max(carrier_name), carrier_id, 'بدون شركة') carrier_name,
               count(*) cnt,
               count(*) filter (where status in ('open','in_progress','waiting_customer')) open_cnt
        from support_tickets group by carrier_id
      ) c
    ),
    'avg_resolution_hours', (
      select round((avg(extract(epoch from (resolved_at - created_at)) / 3600))::numeric, 1)
      from support_tickets where resolved_at is not null
    ),
    'created_30d',  (select count(*) from support_tickets where created_at > now() - interval '30 days'),
    'resolved_30d', (select count(*) from support_tickets where resolved_at > now() - interval '30 days')
  );
$$;
revoke all on function public.support_dashboard() from public, anon;
grant execute on function public.support_dashboard() to authenticated;
