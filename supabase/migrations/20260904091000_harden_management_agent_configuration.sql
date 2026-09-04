-- Keep the public RPC invoker-safe. The privileged cron mutation lives in the
-- non-exposed private schema and still performs the authoritative permission check.

create or replace function private.configure_management_report_agent(
  p_enabled boolean,p_hour integer,p_minute integer
)
returns public.work_agents
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_agent public.work_agents;
  v_first_utc integer;
  v_second_local integer;
  v_second_utc integer;
  v_expression text;
  v_next_local timestamp;
begin
  if not exists(
    select 1 from public.profiles p where p.id=(select auth.uid())
      and (p.role='admin' or coalesce((p.permissions->>'agents.manage')::boolean,false))
  ) then raise exception 'forbidden'; end if;
  if p_hour not between 0 and 23 or p_minute not between 0 and 59 then
    raise exception 'invalid_agent_configuration';
  end if;

  v_second_local:=(p_hour+12)%24;
  v_first_utc:=(p_hour+21)%24;
  v_second_utc:=(v_second_local+21)%24;
  v_expression:=format('%s %s,%s * * *',p_minute,v_first_utc,v_second_utc);

  select min(candidate) into v_next_local
  from (
    select day_start+make_interval(days=>day_offset,hours=>run_hour,mins=>p_minute) candidate
    from (select date_trunc('day',now() at time zone 'Asia/Riyadh') day_start) base
    cross join generate_series(0,1) day_offset
    cross join unnest(array[p_hour,v_second_local]) run_hour
  ) choices
  where candidate>now() at time zone 'Asia/Riyadh';

  update public.work_agents set
    status=case when p_enabled then 'active' else 'paused' end,
    cadence_label=format('كل 12 ساعة · %s و%s بتوقيت السعودية',
      to_char(make_time(p_hour,p_minute,0),'HH12:MI AM'),
      to_char(make_time(v_second_local,p_minute,0),'HH12:MI AM')),
    cron_expression=v_expression,
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
      'hour',p_hour,'hours',jsonb_build_array(p_hour,v_second_local),'minute',p_minute,
      'delivery','in_app','external_write',false),
    next_run_at=case when p_enabled then v_next_local at time zone 'Asia/Riyadh' else null end,
    updated_at=now()
  where agent_key='management_daily_report'
  returning * into v_agent;

  perform cron.alter_job(job_id=>jobid,schedule=>v_expression,active=>p_enabled)
  from cron.job where jobname='work-agent-management-daily';
  return v_agent;
end;
$function$;

revoke all on function private.configure_management_report_agent(boolean,integer,integer)
  from public,anon;
grant execute on function private.configure_management_report_agent(boolean,integer,integer)
  to authenticated;

create or replace function public.configure_management_report_agent(
  p_enabled boolean,p_hour integer,p_minute integer
)
returns public.work_agents
language sql
security invoker
set search_path=''
as $function$
  select private.configure_management_report_agent(p_enabled,p_hour,p_minute)
$function$;

revoke all on function public.configure_management_report_agent(boolean,integer,integer)
  from public,anon;
grant execute on function public.configure_management_report_agent(boolean,integer,integer)
  to authenticated;

comment on function public.configure_management_report_agent(boolean,integer,integer) is
  'Invoker-safe API wrapper. Authorization and cron mutation are isolated in private schema.';
