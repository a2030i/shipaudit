-- Refresh the complete read-only Lamha directory, export and statement twice
-- per Riyadh day. Supabase Cron is UTC and Saudi Arabia has no DST:
--   06:00 UTC = 09:00 Asia/Riyadh
--   15:00 UTC = 18:00 Asia/Riyadh
-- The same guarded sync-directory action is retained; this schedule performs
-- no Lamha write and does not enable the financial policy worker.

do $block$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'lamha-directory-daily-0000-riyadh',
      'lamha-directory-twice-daily-0900-1800-riyadh'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end
$block$;

select cron.schedule(
  'lamha-directory-twice-daily-0900-1800-riyadh',
  '0 6,15 * * *',
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

comment on function public.lamha_store_performance_command_center(text,text,integer,integer) is
  'Read-only Lamha store performance command center; the latest scheduled Riyadh snapshot is compared with the previous daily reference snapshot.';
