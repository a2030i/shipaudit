-- First production work agent: weekly overdue-invoice SADAD campaign.
-- Saturday 18:00 Asia/Riyadh = Saturday 15:00 UTC (Saudi Arabia has no DST).

update public.work_agents
set agent_key = 'overdue_sadad',
    name = 'وكيل سداد الفواتير المتأخرة',
    description = 'يرسل قالب sadad للمتاجر التي لديها فواتير مستحقة منذ أكثر من 30 يومًا، مع منع التكرار وقائمة الحظر وسجل تشغيل كامل.',
    category = 'التحصيل',
    status = 'active',
    cadence_label = 'كل سبت، 6:00 م بتوقيت السعودية',
    cron_expression = '0 15 * * 6',
    timezone = 'Asia/Riyadh',
    safety_level = 'limited',
    sources = '["Zoho Books","دليل المتاجر","هاتف"]'::jsonb,
    config = jsonb_build_object(
      'template_name','sadad','template_language','ar','min_overdue_days',30,
      'min_balance',0.5,'max_recipients',500,'one_message_per_phone',true,
      'exclude_opening_balances',true,'day_of_week',6,'hour',18,'minute',0
    ),
    next_run_at = '2026-08-08 15:00:00+00'::timestamptz,
    updated_at = now()
where agent_key = 'daily_collections';

create or replace function public.work_agent_overdue_candidates(
  p_min_days integer default 30,
  p_min_balance numeric default 0.5,
  p_limit integer default 500
)
returns table(customer_name text, store_name text, phone text, owed numeric, invoice_count bigint, oldest_due date)
language sql security definer set search_path = public, pg_temp stable
as $$
  with latest_snapshot as (
    select snapshot_id from public.merchants order by snapshot_date desc, uploaded_at desc limit 1
  ), debts as (
    select z.customer_name, sum(z.balance)::numeric as owed, count(*)::bigint as invoice_count,
           min(coalesce(z.due_date,z.date)) as oldest_due
    from public.zoho_invoices z
    where coalesce(z.balance,0) >= greatest(p_min_balance,0.01)
      and lower(coalesce(z.status,'')) not in ('draft','void','cancelled','paid')
      and coalesce(z.due_date,z.date) < current_date - greatest(p_min_days,0)
    group by z.customer_name
  )
  select d.customer_name, coalesce(m.store_name,d.customer_name), public.norm_sa_phone(m.phone),
         d.owed, d.invoice_count, d.oldest_due
  from debts d
  left join public.customer_merchant_links l on l.customer_name=d.customer_name
  left join public.merchants m on m.store_id=l.store_id and m.snapshot_id=(select snapshot_id from latest_snapshot)
  order by d.owed desc, d.oldest_due
  limit least(greatest(p_limit,1),2000)
$$;
revoke all on function public.work_agent_overdue_candidates(integer,numeric,integer) from public, anon, authenticated;
grant execute on function public.work_agent_overdue_candidates(integer,numeric,integer) to service_role;

create or replace function public.configure_overdue_sadad_agent(
  p_enabled boolean,
  p_day_of_week integer,
  p_hour integer,
  p_minute integer,
  p_min_days integer,
  p_min_balance numeric,
  p_max_recipients integer
)
returns public.work_agents
language plpgsql security definer set search_path = public, cron, pg_temp
as $$
declare
  a public.work_agents;
  j bigint;
  utc_hour integer;
  expr text;
  next_local timestamp;
begin
  if not exists (
    select 1 from public.profiles p where p.id=(select auth.uid())
      and (p.role='admin' or coalesce((p.permissions->>'agents.manage')::boolean,false))
  ) then raise exception 'forbidden'; end if;
  if p_day_of_week not between 0 and 6 or p_hour not between 0 and 23 or p_minute not between 0 and 59
     or p_min_days not between 1 and 3650 or p_min_balance < 0 or p_max_recipients not between 1 and 2000
  then raise exception 'invalid_agent_configuration'; end if;

  utc_hour := p_hour - 3;
  if utc_hour < 0 then utc_hour := utc_hour + 24; p_day_of_week := (p_day_of_week + 6) % 7; end if;
  expr := format('%s %s * * %s',p_minute,utc_hour,p_day_of_week);
  next_local := date_trunc('day', now() at time zone 'Asia/Riyadh')
    + ((p_day_of_week - extract(dow from now() at time zone 'Asia/Riyadh')::integer + 7) % 7) * interval '1 day'
    + make_interval(hours=>p_hour,mins=>p_minute);
  if next_local <= now() at time zone 'Asia/Riyadh' then next_local := next_local + interval '7 days'; end if;

  update public.work_agents set
    status=case when p_enabled then 'active' else 'paused' end,
    cadence_label=format('كل %s، %s:%s بتوقيت السعودية',
      (array['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'])[p_day_of_week+1],
      lpad(((case when p_hour%12=0 then 12 else p_hour%12 end))::text,2,'0'),lpad(p_minute::text,2,'0')),
    cron_expression=expr,
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object('day_of_week',p_day_of_week,'hour',p_hour,'minute',p_minute,
      'min_overdue_days',p_min_days,'min_balance',p_min_balance,'max_recipients',p_max_recipients,
      'template_name','sadad','template_language','ar','one_message_per_phone',true,'exclude_opening_balances',true),
    next_run_at=case when p_enabled then next_local at time zone 'Asia/Riyadh' else null end,
    updated_at=now()
  where agent_key='overdue_sadad' returning * into a;

  select jobid into j from cron.job where jobname='work-agent-overdue-sadad';
  if j is not null then perform cron.alter_job(j,schedule=>expr,active=>p_enabled); end if;
  return a;
end $$;
revoke all on function public.configure_overdue_sadad_agent(boolean,integer,integer,integer,integer,numeric,integer) from public, anon;
grant execute on function public.configure_overdue_sadad_agent(boolean,integer,integer,integer,integer,numeric,integer) to authenticated;

do $$ declare r record; begin
  for r in select jobid from cron.job where jobname='work-agent-overdue-sadad' loop perform cron.unschedule(r.jobid); end loop;
end $$;
select cron.schedule('work-agent-overdue-sadad','0 15 * * 6',$cron$
  select net.http_post(
    url := 'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/work-agent-overdue-sadad',
    headers := jsonb_build_object('Content-Type','application/json','X-Cron-Key',(select cron_key from public.zoho_auth where id=1)),
    body := '{"action":"run","trigger":"schedule"}'::jsonb,
    timeout_milliseconds := 120000
  )
$cron$);
