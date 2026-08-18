-- 23:45 Asia/Riyadh is 20:45 UTC year-round (Saudi Arabia has no DST).
-- The Edge Function authenticates this database job with the rotating cron key;
-- no service-role or OAuth secret is embedded in cron.job.
select cron.schedule(
  'zatca-auto-push-2345-riyadh',
  '45 20 * * *',
  $cron$
  select net.http_post(
    url := 'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/zatca-auto-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Key', (select cron_key from public.zoho_auth where id = 1)
    ),
    body := jsonb_build_object('trigger', 'cron_2345_riyadh'),
    timeout_milliseconds := 120000
  ) as request_id;
  $cron$
);
