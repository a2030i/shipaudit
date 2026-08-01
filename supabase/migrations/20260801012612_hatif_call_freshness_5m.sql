-- Keep the complete Hatif call log near-real-time without relying on client refreshes.
-- The edge function is idempotent by call id and stops once it reaches known rows.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'hatif-pull-calls'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end $$;

select cron.schedule(
  'hatif-pull-calls',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/hatif-pull-calls',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-key', (select cron_key from public.zoho_auth limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )
  $cron$
);
