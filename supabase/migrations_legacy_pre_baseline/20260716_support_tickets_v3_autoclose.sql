-- تذاكر v3 (§1.35): الإغلاق التلقائي — «بانتظار العميل» بلا رد 3 أيام تُقفَل.
-- المؤقّت من updated_at (آخر تغيير على التذكرة نفسها: حالة/إسناد) — أي رد
-- من العميل يعالجه الموظف بتغيير الحالة فيصفّر المؤقّت.
-- (مُطبَّقة على FIN عبر MCP باسم support_tickets_v3_autoclose)
create or replace function public.support_autoclose()
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  with closed as (
    update support_tickets
    set status = 'closed', resolved_at = coalesce(resolved_at, now())
    where status = 'waiting_customer'
      and updated_at < now() - interval '3 days'
    returning id
  )
  insert into support_ticket_events (ticket_id, kind, old_status, new_status, note, internal)
  select id, 'status', 'waiting_customer', 'closed',
         'أُغلقت تلقائياً — لا رد من العميل خلال 3 أيام', true
  from closed;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.support_autoclose() from public, anon, authenticated;

-- جدولة يومية 6:00 صباحاً KSA (3:00 UTC) — نمط بقية كرونات النظام
do $$ begin
  perform cron.unschedule('support-autoclose-daily');
exception when others then null; end $$;
select cron.schedule('support-autoclose-daily', '0 3 * * *', 'select public.support_autoclose()');
