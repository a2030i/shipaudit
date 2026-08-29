-- Re-register the same named job after live directory verification showed that
-- the complete 1,600+ store traversal can exceed two minutes under Lamha's
-- shared request limit. The Edge operation remains read-only against Lamha.
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
