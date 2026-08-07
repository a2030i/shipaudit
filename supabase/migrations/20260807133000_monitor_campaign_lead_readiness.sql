-- A deployed webhook is not operationally ready until at least one employee is
-- eligible to receive campaign leads and has a notification phone.
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
      (select count(*) from public.profiles where accepts_campaign_leads and nullif(btrim(lead_notification_phone), '') is not null) as lead_recipients,
      (select count(*) from public.campaign_lead_inbox) as lead_events,
      (select max(received_at) from public.campaign_lead_inbox) as lead_last_received,
      (select count(*) from public.campaign_lead_inbox where status = 'failed') as lead_failed,
      (select count(*) from public.webhook_events where status = 'failed' and received_at >= now() - interval '24 hours') as webhook_failed,
      (select count(*) from public.webhook_events where status in ('pending', 'processing') and processed_at is null and received_at < now() - interval '2 hours') as webhook_stuck,
      (select count(*) from public.zoho_sync_runs where status = 'failed' and started_at >= now() - interval '24 hours') as zoho_failures,
      (select count(*) from cron.job where active) as active_jobs,
      (select count(*) from cron.job where active and jobname in ('zoho-sync-entities', 'hatif-pull-calls', 'work-agent-integration-health')) as active_required_jobs
  )
  select jsonb_build_object(
    'checked_at', now(),
    'zoho', jsonb_build_object('last_sync', zoho_at, 'healthy', zoho_at >= now() - make_interval(mins => p_zoho_minutes), 'max_age_minutes', p_zoho_minutes),
    'hatif', jsonb_build_object('last_sync', hatif_at, 'healthy', hatif_at >= now() - make_interval(mins => p_hatif_minutes), 'max_age_minutes', p_hatif_minutes),
    'platform', jsonb_build_object('last_sync', platform_at, 'healthy', platform_at >= now() - make_interval(hours => p_platform_hours), 'max_age_hours', p_platform_hours),
    'lead_intake', jsonb_build_object('configured_recipients', lead_recipients, 'received_events', lead_events, 'last_received', lead_last_received, 'failed', lead_failed, 'healthy', lead_recipients > 0 and lead_failed = 0),
    'webhooks', jsonb_build_object('failed_24h', webhook_failed, 'stuck', webhook_stuck, 'healthy', webhook_failed = 0 and webhook_stuck = 0),
    'zoho_runs', jsonb_build_object('failed_24h', zoho_failures, 'last_status', zoho_last_status, 'healthy', zoho_last_status = 'succeeded'),
    'cron', jsonb_build_object('active_jobs', active_jobs, 'required_jobs', 3, 'active_required_jobs', active_required_jobs, 'healthy', active_required_jobs = 3),
    'issue_count',
      (case when zoho_at is null or zoho_at < now() - make_interval(mins => p_zoho_minutes) then 1 else 0 end) +
      (case when hatif_at is null or hatif_at < now() - make_interval(mins => p_hatif_minutes) then 1 else 0 end) +
      (case when platform_at is null or platform_at < now() - make_interval(hours => p_platform_hours) then 1 else 0 end) +
      (case when lead_recipients = 0 or lead_failed > 0 then 1 else 0 end) +
      (case when webhook_failed > 0 or webhook_stuck > 0 then 1 else 0 end) +
      (case when zoho_last_status is distinct from 'succeeded' then 1 else 0 end) +
      (case when active_required_jobs <> 3 then 1 else 0 end)
  )
  from x
$$;

revoke all on function public.integration_health_snapshot(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.integration_health_snapshot(integer, integer, integer) to service_role;
