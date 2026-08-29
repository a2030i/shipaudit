-- Lamha directory refresh is read-only against Lamha. Supabase Cron is UTC,
-- therefore 21:00 UTC is 00:00 in Asia/Riyadh (Saudi Arabia has no DST).
-- The cron credential is provisioned separately in Vault and verified by a
-- service-role-only RPC; no secret value is stored in migration history.

create or replace function public.authorize_lamha_directory_cron(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256') =
    extensions.digest(convert_to(decrypted_secret, 'UTF8'), 'sha256'),
    false
  )
  from vault.decrypted_secrets
  where name = 'lamha_financial_guard_cron_secret'
  limit 1
$function$;

revoke execute on function public.authorize_lamha_directory_cron(text)
  from public, anon, authenticated;
grant execute on function public.authorize_lamha_directory_cron(text)
  to service_role;

do $block$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'lamha-directory-daily-0000-riyadh',
      'lamha-financial-guard-0005-0255-riyadh'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end
$block$;

select cron.schedule(
  'lamha-directory-daily-0000-riyadh',
  '0 21 * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/lamha-financial-guard',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'lamha_financial_guard_cron_secret')
      ),
      body := '{"action":"sync-directory"}'::jsonb,
      timeout_milliseconds := 300000
    );
  $job$
);
