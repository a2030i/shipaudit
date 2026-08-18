-- Hourly integration health monitor (minute 5 avoids top-of-hour contention).
update work_agents set status='active',cadence_label='كل ساعة',cron_expression='5 * * * *',timezone='Asia/Riyadh',safety_level='monitor',
 description='يراقب حداثة مزامنة زوهو وهاتف وبيانات المنصة، وأخطاء Webhooks وتشغيلات زوهو والمهام المجدولة، ويسجل سبب أي تأخير دون تنفيذ إصلاح تلقائي.',
 sources='["Zoho Books","هاتف","المنصة","Webhooks","Cron"]'::jsonb,
 config='{"interval_minutes":60,"zoho_max_age_minutes":90,"hatif_max_age_minutes":20,"platform_max_age_hours":72,"auto_repair":false}'::jsonb,
 next_run_at=date_trunc('hour',now())+interval '1 hour 5 minutes',updated_at=now()
where agent_key='integration_health';

create or replace function public.integration_health_snapshot(p_zoho_minutes integer default 90,p_hatif_minutes integer default 20,p_platform_hours integer default 72)
returns jsonb language sql security definer set search_path=public,cron,pg_temp stable as $$
 with x as(select
  (select max(synced_at) from zoho_invoices) zoho_at,
  (select max(synced_at) from hatif_call_log) hatif_at,
  (select max(uploaded_at) from merchants) platform_at,
  (select count(*) from webhook_events where status='failed' and received_at>=now()-interval '24 hours') webhook_failed,
  (select count(*) from webhook_events where processed_at is null and received_at<now()-interval '2 hours' and status<>'failed') webhook_stuck,
  (select count(*) from zoho_sync_runs where status='failed' and started_at>=now()-interval '24 hours') zoho_failures,
  (select count(*) from cron.job where active) active_jobs)
 select jsonb_build_object('checked_at',now(),'zoho',jsonb_build_object('last_sync',zoho_at,'healthy',zoho_at>=now()-make_interval(mins=>p_zoho_minutes),'max_age_minutes',p_zoho_minutes),
 'hatif',jsonb_build_object('last_sync',hatif_at,'healthy',hatif_at>=now()-make_interval(mins=>p_hatif_minutes),'max_age_minutes',p_hatif_minutes),
 'platform',jsonb_build_object('last_sync',platform_at,'healthy',platform_at>=now()-make_interval(hours=>p_platform_hours),'max_age_hours',p_platform_hours),
 'webhooks',jsonb_build_object('failed_24h',webhook_failed,'stuck',webhook_stuck,'healthy',webhook_failed=0 and webhook_stuck=0),
 'zoho_runs',jsonb_build_object('failed_24h',zoho_failures,'healthy',zoho_failures=0),'cron',jsonb_build_object('active_jobs',active_jobs,'healthy',active_jobs>0),
 'issue_count',(case when zoho_at is null or zoho_at<now()-make_interval(mins=>p_zoho_minutes) then 1 else 0 end)+(case when hatif_at is null or hatif_at<now()-make_interval(mins=>p_hatif_minutes) then 1 else 0 end)+(case when platform_at is null or platform_at<now()-make_interval(hours=>p_platform_hours) then 1 else 0 end)+(case when webhook_failed>0 or webhook_stuck>0 then 1 else 0 end)+(case when zoho_failures>0 then 1 else 0 end)) from x
$$;
revoke all on function public.integration_health_snapshot(integer,integer,integer) from public,anon,authenticated;grant execute on function public.integration_health_snapshot(integer,integer,integer) to service_role;

create or replace function public.configure_integration_health_agent(p_enabled boolean,p_interval_minutes integer,p_zoho_minutes integer,p_hatif_minutes integer,p_platform_hours integer)
returns work_agents language plpgsql security definer set search_path=public,cron,pg_temp as $$
declare a work_agents;j bigint;expr text;
begin
 if not exists(select 1 from profiles p where p.id=(select auth.uid()) and (p.role='admin' or coalesce((p.permissions->>'agents.manage')::boolean,false))) then raise exception 'forbidden';end if;
 if p_interval_minutes not in(15,30,60) or p_zoho_minutes not between 15 and 1440 or p_hatif_minutes not between 5 and 1440 or p_platform_hours not between 1 and 720 then raise exception 'invalid_agent_configuration';end if;
 expr:=case p_interval_minutes when 15 then '5,20,35,50 * * * *' when 30 then '5,35 * * * *' else '5 * * * *' end;
 update work_agents set status=case when p_enabled then 'active' else 'paused' end,cadence_label=case p_interval_minutes when 60 then 'كل ساعة' else format('كل %s دقيقة',p_interval_minutes) end,cron_expression=expr,
 config=coalesce(config,'{}')||jsonb_build_object('interval_minutes',p_interval_minutes,'zoho_max_age_minutes',p_zoho_minutes,'hatif_max_age_minutes',p_hatif_minutes,'platform_max_age_hours',p_platform_hours,'auto_repair',false),next_run_at=case when p_enabled then now()+make_interval(mins=>p_interval_minutes) else null end,updated_at=now() where agent_key='integration_health' returning * into a;
 select jobid into j from cron.job where jobname='work-agent-integration-health';if j is not null then perform cron.alter_job(j,schedule=>expr,active=>p_enabled);end if;return a;
end $$;
revoke all on function public.configure_integration_health_agent(boolean,integer,integer,integer,integer) from public,anon;grant execute on function public.configure_integration_health_agent(boolean,integer,integer,integer,integer) to authenticated;

select cron.schedule('work-agent-integration-health','5 * * * *',$cron$
 select net.http_post(url:='https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/work-agent-integration-health',headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Key',(select cron_key from zoho_auth where id=1)),body:='{"action":"run","trigger":"schedule"}'::jsonb,timeout_milliseconds:=120000)
$cron$);
