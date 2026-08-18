-- Opening-balance documents are accounting carry-forwards, not tax invoices
-- awaiting submission. Keep them out of every homepage ZATCA metric and list.
create or replace function public.zatca_pending_today()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with sd as (
    select (now() at time zone 'Asia/Riyadh')::date as d
  ), eligible as (
    select *
    from public.zoho_invoices
    where not (coalesce(invoice_number, '') ilike '%الرصيد الافتتاحي%')
  ), pending as (
    select *
    from eligible
    where lower(coalesce(einvoice_status, '')) = 'yet_to_be_pushed'
  ), verify as (
    select *
    from eligible
    where nullif(btrim(coalesce(einvoice_status, '')), '') is null
      and date between (select d - 1 from sd) and (select d from sd)
  )
  select jsonb_build_object(
    'saudi_date', (select d from sd),
    'today_count', (select count(*) from pending where date = (select d from sd)),
    'today_total', coalesce((select sum(total) from pending where date = (select d from sd)), 0),
    'overdue_count', (select count(*) from pending where date < (select d from sd)),
    'overdue_total', coalesce((select sum(total) from pending where date < (select d from sd)), 0),
    'needs_live_check_count', (select count(*) from verify),
    'invoices', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
          'invoice_number', invoice_number,
          'customer', customer_name,
          'total', total,
          'date', date,
          'overdue', date < (select d from sd)
        ) as x
        from pending
        order by date desc, total desc
        limit 100
      ) s
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.zatca_pending_today() from public, anon;
grant execute on function public.zatca_pending_today() to authenticated, service_role;
