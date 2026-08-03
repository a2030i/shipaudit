-- Invalidate the credential that appeared in public Git history. Scheduled
-- jobs read this value dynamically from zoho_auth, so no job definition
-- contains or needs the replacement value.
update public.zoho_auth
set cron_key = encode(gen_random_bytes(32), 'hex')
where id = 1;
