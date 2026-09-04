-- Apply the same private privileged-operation boundary used by the management
-- agent. This changes no ZATCA schedule or invoice execution behavior.

create or replace function private.configure_zatca_work_agent(
  p_enabled boolean,p_hour integer,p_minute integer,p_max_invoices integer
)
returns public.work_agents
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_agent public.work_agents;
  v_job_id bigint;
  v_expression text;
  v_utc_hour integer;
  v_next_local timestamp;
begin
  if not exists(
    select 1 from public.profiles p where p.id=(select auth.uid())
      and (p.role='admin' or coalesce((p.permissions->>'agents.manage')::boolean,false))
  ) then raise exception 'forbidden'; end if;
  if p_hour not between 0 and 23 or p_minute not between 0 and 59
     or p_max_invoices not between 1 and 500 then
    raise exception 'invalid_agent_configuration';
  end if;

  v_utc_hour:=p_hour-3;
  if v_utc_hour<0 then v_utc_hour:=v_utc_hour+24; end if;
  v_expression:=format('%s %s * * *',p_minute,v_utc_hour);
  v_next_local:=date_trunc('day',now() at time zone 'Asia/Riyadh')
    +make_interval(hours=>p_hour,mins=>p_minute);
  if v_next_local<=now() at time zone 'Asia/Riyadh' then
    v_next_local:=v_next_local+interval '1 day';
  end if;

  update public.work_agents set
    status=case when p_enabled then 'active' else 'paused' end,
    cadence_label=format('يوميًا، %s:%s بتوقيت السعودية',
      lpad((case when p_hour%12=0 then 12 else p_hour%12 end)::text,2,'0'),
      lpad(p_minute::text,2,'0')),
    cron_expression=v_expression,
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
      'hour',p_hour,'minute',p_minute,'max_invoices',p_max_invoices,
      'exclude_opening_balances',true,'live_check_before_push',true),
    next_run_at=case when p_enabled then v_next_local at time zone 'Asia/Riyadh' else null end,
    updated_at=now()
  where agent_key='zatca_nightly'
  returning * into v_agent;

  select jobid into v_job_id from cron.job where jobname='zatca-auto-push-2345-riyadh';
  if v_job_id is not null then
    perform cron.alter_job(v_job_id,schedule=>v_expression,active=>p_enabled);
  end if;
  return v_agent;
end;
$function$;

revoke all on function private.configure_zatca_work_agent(boolean,integer,integer,integer)
  from public,anon;
grant execute on function private.configure_zatca_work_agent(boolean,integer,integer,integer)
  to authenticated;

create or replace function public.configure_zatca_work_agent(
  p_enabled boolean,p_hour integer,p_minute integer,p_max_invoices integer
)
returns public.work_agents
language sql
security invoker
set search_path=''
as $function$
  select private.configure_zatca_work_agent(p_enabled,p_hour,p_minute,p_max_invoices)
$function$;

revoke all on function public.configure_zatca_work_agent(boolean,integer,integer,integer)
  from public,anon;
grant execute on function public.configure_zatca_work_agent(boolean,integer,integer,integer)
  to authenticated;

comment on function public.configure_zatca_work_agent(boolean,integer,integer,integer) is
  'Invoker-safe API wrapper. Authorization and cron mutation are isolated in private schema.';
