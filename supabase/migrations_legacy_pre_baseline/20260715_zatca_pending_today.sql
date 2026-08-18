-- فواتير لم تُرسَل لزاتكا بعد — بتوقيت السعودية (المهلة: منتصف ليل نفس اليوم).
-- today = فواتير اليوم لم تُدفَع (عاجلة، المهلة الليلة) · overdue = أيام سابقة لم تُدفَع (متأخرة فعلاً).
-- المصدر مرآة zoho_invoices.einvoice_status = 'yet_to_be_pushed' (تُزامَن كل 30د).
create or replace function public.zatca_pending_today()
returns jsonb language sql stable set search_path = public as $$
  with sd as (select (now() at time zone 'Asia/Riyadh')::date as d)
  select jsonb_build_object(
    'saudi_date',   (select d from sd),
    'today_count',  count(*) filter (where zi.date = (select d from sd)),
    'today_total',  coalesce(sum(zi.total) filter (where zi.date = (select d from sd)), 0),
    'overdue_count',count(*) filter (where zi.date < (select d from sd)),
    'overdue_total',coalesce(sum(zi.total) filter (where zi.date < (select d from sd)), 0),
    'invoices', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'invoice_number', invoice_number, 'customer', customer_name,
          'total', total, 'date', date, 'overdue', date < (select d from sd)
        ) x
        from zoho_invoices
        where einvoice_status = 'yet_to_be_pushed'
        order by date desc, total desc
        limit 100
      ) s
    ), '[]'::jsonb)
  )
  from zoho_invoices zi
  where zi.einvoice_status = 'yet_to_be_pushed';
$$;
revoke all on function public.zatca_pending_today() from public;
grant execute on function public.zatca_pending_today() to authenticated;

-- تنبيه مسائي (cron 21:00 KSA = 18:00 UTC) يستدعي edge function zatca-alert.
-- X-Cron-Key يُقرأ من zoho_auth.cron_key لحظة التنفيذ (لا سرّ مخبوز في الأمر).
-- select cron.schedule('zatca-evening-alert', '0 18 * * *', $CRON$
--   select net.http_post(
--     url     := 'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/zatca-alert',
--     headers := jsonb_build_object('Content-Type','application/json',
--                'X-Cron-Key', (select cron_key from public.zoho_auth where id = 1)),
--     body    := '{}'::jsonb);
-- $CRON$);
