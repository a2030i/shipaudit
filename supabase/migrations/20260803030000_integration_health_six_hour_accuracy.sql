-- Run the integration monitor every six hours and remove two false-positive health signals.
update public.work_agents
set cadence_label = 'كل 6 ساعات',
    cron_expression = '5 */6 * * *',
    config = coalesce(config, '{}'::jsonb) || jsonb_build_object('interval_minutes', 360),
    next_run_at = now() + interval '6 hours',
    updated_at = now()
where agent_key = 'integration_health';

create or replace function public.integration_health_snapshot(
  p_zoho_minutes integer default 90,
  p_hatif_minutes integer default 20,
  p_platform_hours integer default 72
)
returns jsonb
language sql
security definer
set search_path = public, cron, pg_temp
stable
as $$
  with x as (
    select
      (select max(finished_at) from public.zoho_sync_runs where status = 'succeeded') as zoho_at,
      (select status from public.zoho_sync_runs order by started_at desc limit 1) as zoho_last_status,
      (select max(synced_at) from public.hatif_call_log) as hatif_at,
      (select max(uploaded_at) from public.merchants) as platform_at,
      (select count(*) from public.webhook_events where status = 'failed' and received_at >= now() - interval '24 hours') as webhook_failed,
      (select count(*) from public.webhook_events where status in ('pending', 'processing') and processed_at is null and received_at < now() - interval '2 hours') as webhook_stuck,
      (select count(*) from public.zoho_sync_runs where status = 'failed' and started_at >= now() - interval '24 hours') as zoho_failures,
      (select count(*) from cron.job where active) as active_jobs,
      (select count(*) from cron.job where active and jobname in ('zoho-sync-entities', 'hatif-pull-calls', 'work-agent-integration-health')) as active_required_jobs
  )
  select jsonb_build_object(
    'checked_at', now(),
    'zoho', jsonb_build_object(
      'last_sync', zoho_at,
      'healthy', zoho_at >= now() - make_interval(mins => p_zoho_minutes),
      'max_age_minutes', p_zoho_minutes
    ),
    'hatif', jsonb_build_object(
      'last_sync', hatif_at,
      'healthy', hatif_at >= now() - make_interval(mins => p_hatif_minutes),
      'max_age_minutes', p_hatif_minutes
    ),
    'platform', jsonb_build_object(
      'last_sync', platform_at,
      'healthy', platform_at >= now() - make_interval(hours => p_platform_hours),
      'max_age_hours', p_platform_hours
    ),
    'webhooks', jsonb_build_object(
      'failed_24h', webhook_failed,
      'stuck', webhook_stuck,
      'healthy', webhook_failed = 0 and webhook_stuck = 0
    ),
    'zoho_runs', jsonb_build_object(
      'failed_24h', zoho_failures,
      'last_status', zoho_last_status,
      'healthy', zoho_last_status = 'succeeded'
    ),
    'cron', jsonb_build_object(
      'active_jobs', active_jobs,
      'required_jobs', 3,
      'active_required_jobs', active_required_jobs,
      'healthy', active_required_jobs = 3
    ),
    'issue_count',
      (case when zoho_at is null or zoho_at < now() - make_interval(mins => p_zoho_minutes) then 1 else 0 end) +
      (case when hatif_at is null or hatif_at < now() - make_interval(mins => p_hatif_minutes) then 1 else 0 end) +
      (case when platform_at is null or platform_at < now() - make_interval(hours => p_platform_hours) then 1 else 0 end) +
      (case when webhook_failed > 0 or webhook_stuck > 0 then 1 else 0 end) +
      (case when zoho_last_status is distinct from 'succeeded' then 1 else 0 end) +
      (case when active_required_jobs <> 3 then 1 else 0 end)
  )
  from x
$$;

revoke all on function public.integration_health_snapshot(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.integration_health_snapshot(integer, integer, integer) to service_role;

create or replace function public.configure_integration_health_agent(
  p_enabled boolean,
  p_interval_minutes integer,
  p_zoho_minutes integer,
  p_hatif_minutes integer,
  p_platform_hours integer
)
returns public.work_agents
language plpgsql
security definer
set search_path = public, cron, pg_temp
as $$
declare
  a public.work_agents;
  j bigint;
  expr text;
  cadence text;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and (p.role = 'admin' or coalesce((p.permissions ->> 'agents.manage')::boolean, false))
  ) then
    raise exception 'forbidden';
  end if;

  if p_interval_minutes not in (15, 30, 60, 360)
     or p_zoho_minutes not between 15 and 1440
     or p_hatif_minutes not between 5 and 1440
     or p_platform_hours not between 1 and 720 then
    raise exception 'invalid_agent_configuration';
  end if;

  expr := case p_interval_minutes
    when 15 then '5,20,35,50 * * * *'
    when 30 then '5,35 * * * *'
    when 60 then '5 * * * *'
    else '5 */6 * * *'
  end;
  cadence := case p_interval_minutes
    when 60 then 'كل ساعة'
    when 360 then 'كل 6 ساعات'
    else format('كل %s دقيقة', p_interval_minutes)
  end;

  update public.work_agents
  set status = case when p_enabled then 'active' else 'paused' end,
      cadence_label = cadence,
      cron_expression = expr,
      config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
        'interval_minutes', p_interval_minutes,
        'zoho_max_age_minutes', p_zoho_minutes,
        'hatif_max_age_minutes', p_hatif_minutes,
        'platform_max_age_hours', p_platform_hours,
        'auto_repair', false
      ),
      next_run_at = case when p_enabled then now() + make_interval(mins => p_interval_minutes) else null end,
      updated_at = now()
  where agent_key = 'integration_health'
  returning * into a;

  select jobid into j from cron.job where jobname = 'work-agent-integration-health';
  if j is not null then
    perform cron.alter_job(j, schedule => expr, active => p_enabled);
  end if;
  return a;
end
$$;

revoke all on function public.configure_integration_health_agent(boolean, integer, integer, integer, integer) from public, anon;
grant execute on function public.configure_integration_health_agent(boolean, integer, integer, integer, integer) to authenticated;

select cron.alter_job(
  (select jobid from cron.job where jobname = 'work-agent-integration-health'),
  schedule => '5 */6 * * *',
  active => true
);
