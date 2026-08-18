-- Register the existing ZATCA 23:45 automation as a controllable work agent.
update public.work_agents set
  status='active', cadence_label='يوميًا، 11:45 م بتوقيت السعودية',
  cron_expression='45 20 * * *', timezone='Asia/Riyadh', safety_level='sensitive',
  description='يفحص الفواتير الجاهزة في Zoho ويرسل غير المرسل منها إلى زاتكا عبر تكامل Zoho، مع فحص حي ومنع التكرار وسجل مستقل لكل فاتورة.',
  sources='["Zoho Books","زاتكا"]'::jsonb,
  config=jsonb_build_object('hour',23,'minute',45,'max_invoices',200,'exclude_opening_balances',true,'live_check_before_push',true),
  next_run_at=((case when (date_trunc('day',now() at time zone 'Asia/Riyadh')+interval '23 hours 45 minutes') > (now() at time zone 'Asia/Riyadh')
    then date_trunc('day',now() at time zone 'Asia/Riyadh')+interval '23 hours 45 minutes'
    else date_trunc('day',now() at time zone 'Asia/Riyadh')+interval '1 day 23 hours 45 minutes' end) at time zone 'Asia/Riyadh'),
  updated_at=now()
where agent_key='zatca_nightly';

create or replace function public.configure_zatca_work_agent(
  p_enabled boolean, p_hour integer, p_minute integer, p_max_invoices integer
)
returns public.work_agents
language plpgsql security definer set search_path=public,cron,pg_temp
as $$
declare a public.work_agents; j bigint; expr text; utc_hour integer; next_local timestamp;
begin
  if not exists(select 1 from public.profiles p where p.id=(select auth.uid())
    and (p.role='admin' or coalesce((p.permissions->>'agents.manage')::boolean,false))) then raise exception 'forbidden'; end if;
  if p_hour not between 0 and 23 or p_minute not between 0 and 59 or p_max_invoices not between 1 and 500 then
    raise exception 'invalid_agent_configuration';
  end if;
  utc_hour:=p_hour-3; if utc_hour<0 then utc_hour:=utc_hour+24; end if;
  expr:=format('%s %s * * *',p_minute,utc_hour);
  next_local:=date_trunc('day',now() at time zone 'Asia/Riyadh')+make_interval(hours=>p_hour,mins=>p_minute);
  if next_local<=now() at time zone 'Asia/Riyadh' then next_local:=next_local+interval '1 day'; end if;
  update public.work_agents set status=case when p_enabled then 'active' else 'paused' end,
    cadence_label=format('يوميًا، %s:%s بتوقيت السعودية',lpad((case when p_hour%12=0 then 12 else p_hour%12 end)::text,2,'0'),lpad(p_minute::text,2,'0')),
    cron_expression=expr, config=coalesce(config,'{}'::jsonb)||jsonb_build_object('hour',p_hour,'minute',p_minute,'max_invoices',p_max_invoices,'exclude_opening_balances',true,'live_check_before_push',true),
    next_run_at=case when p_enabled then next_local at time zone 'Asia/Riyadh' else null end,updated_at=now()
  where agent_key='zatca_nightly' returning * into a;
  select jobid into j from cron.job where jobname='zatca-auto-push-2345-riyadh';
  if j is not null then perform cron.alter_job(j,schedule=>expr,active=>p_enabled); end if;
  return a;
end $$;
revoke all on function public.configure_zatca_work_agent(boolean,integer,integer,integer) from public,anon;
grant execute on function public.configure_zatca_work_agent(boolean,integer,integer,integer) to authenticated;
