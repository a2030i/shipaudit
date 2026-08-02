-- Daily management briefing at 10:00 Asia/Riyadh (07:00 UTC).
update public.work_agents set agent_key='management_daily_report',name='وكيل تقرير الإدارة اليومي',
  description='ينشئ ملخصًا صباحيًا للإدارة عن التحصيل وزاتكا والعملاء الجدد والمهام وأخطاء الوكلاء داخل النظام، دون إرسال خارجي.',
  category='الإدارة',status='active',cadence_label='يوميًا، 10:00 ص بتوقيت السعودية',cron_expression='0 7 * * *',timezone='Asia/Riyadh',safety_level='monitor',
  sources='["Zoho Books","المبيعات","المهام","وكلاء العمل"]'::jsonb,
  config='{"hour":10,"minute":0,"include_collections":true,"include_zatca":true,"include_sales":true,"include_tasks":true,"delivery":"in_app"}'::jsonb,
  next_run_at=((case when date_trunc('day',now() at time zone 'Asia/Riyadh')+interval '10 hours'>now() at time zone 'Asia/Riyadh'
    then date_trunc('day',now() at time zone 'Asia/Riyadh')+interval '10 hours' else date_trunc('day',now() at time zone 'Asia/Riyadh')+interval '1 day 10 hours' end) at time zone 'Asia/Riyadh'),updated_at=now()
where agent_key='weekly_team';

create or replace function public.management_daily_snapshot()
returns jsonb language sql security definer set search_path=public,pg_temp stable as $$
  select jsonb_build_object(
    'generated_at',now(),
    'overdue_invoices',(select count(*) from zoho_invoices where balance>0.5 and coalesce(due_date,date)<current_date and lower(coalesce(status,'')) not in('paid','void','draft')),
    'overdue_amount',(select coalesce(sum(balance),0) from zoho_invoices where balance>0.5 and coalesce(due_date,date)<current_date and lower(coalesce(status,'')) not in('paid','void','draft')),
    'zatca_pending',(select count(*) from zoho_invoices where einvoice_status='yet_to_be_pushed' and date<=current_date),
    'new_leads_today',(select count(*) from crm_leads where received_at >= date_trunc('day',now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'),
    'unassigned_leads',(select count(*) from crm_leads where owner_id is null and coalesce(status,'new') not in('won','lost','converted')),
    'overdue_tasks',(select count(*) from crm_tasks where status not in('done','completed','cancelled') and due_at<now()),
    'agent_failures_24h',(select count(*) from work_agent_runs where status in('failed','partial') and started_at>=now()-interval '24 hours'),
    'zoho_last_sync',(select max(synced_at) from zoho_invoices)
  )
$$;
revoke all on function public.management_daily_snapshot() from public,anon,authenticated;
grant execute on function public.management_daily_snapshot() to service_role;

create or replace function public.configure_management_report_agent(p_enabled boolean,p_hour integer,p_minute integer)
returns public.work_agents language plpgsql security definer set search_path=public,cron,pg_temp as $$
declare a public.work_agents;j bigint;expr text;utc_hour integer;next_local timestamp;
begin
  if not exists(select 1 from profiles p where p.id=(select auth.uid()) and (p.role='admin' or coalesce((p.permissions->>'agents.manage')::boolean,false))) then raise exception 'forbidden';end if;
  if p_hour not between 0 and 23 or p_minute not between 0 and 59 then raise exception 'invalid_agent_configuration';end if;
  utc_hour:=p_hour-3;if utc_hour<0 then utc_hour:=utc_hour+24;end if;expr:=format('%s %s * * *',p_minute,utc_hour);
  next_local:=date_trunc('day',now() at time zone 'Asia/Riyadh')+make_interval(hours=>p_hour,mins=>p_minute);if next_local<=now() at time zone 'Asia/Riyadh' then next_local:=next_local+interval '1 day';end if;
  update work_agents set status=case when p_enabled then 'active' else 'paused' end,cadence_label=format('يوميًا، %s:%s بتوقيت السعودية',lpad((case when p_hour%12=0 then 12 else p_hour%12 end)::text,2,'0'),lpad(p_minute::text,2,'0')),cron_expression=expr,
    config=coalesce(config,'{}')||jsonb_build_object('hour',p_hour,'minute',p_minute,'delivery','in_app'),next_run_at=case when p_enabled then next_local at time zone 'Asia/Riyadh' else null end,updated_at=now()
  where agent_key='management_daily_report' returning * into a;
  select jobid into j from cron.job where jobname='work-agent-management-daily';if j is not null then perform cron.alter_job(j,schedule=>expr,active=>p_enabled);end if;return a;
end $$;
revoke all on function public.configure_management_report_agent(boolean,integer,integer) from public,anon;
grant execute on function public.configure_management_report_agent(boolean,integer,integer) to authenticated;

select cron.schedule('work-agent-management-daily','0 7 * * *',$cron$
 select net.http_post(url:='https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/work-agent-management-report',headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Key',(select cron_key from zoho_auth where id=1)),body:='{"action":"run","trigger":"schedule"}'::jsonb,timeout_milliseconds:=120000)
$cron$);
