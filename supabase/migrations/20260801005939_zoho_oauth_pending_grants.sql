-- اختيار مؤسسة Zoho Books بعد OAuth بدون تمرير refresh_token للمتصفح.
-- الجدول مؤقت وخاص بـservice_role؛ الواجهة ترى فقط pending_id وقائمة مؤسسات
-- منقّحة تُرجعها edge function بعد مصادقة المدير.

create table if not exists public.zoho_oauth_pending_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  refresh_token text,
  accounts_domain text not null,
  api_domain text not null,
  organizations jsonb not null default '[]'::jsonb,
  existing_org_id text,
  replace_existing boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint zoho_oauth_pending_orgs_array
    check (jsonb_typeof(organizations) = 'array')
);

create index if not exists zoho_oauth_pending_grants_expiry_idx
  on public.zoho_oauth_pending_grants (expires_at);

alter table public.zoho_oauth_pending_grants enable row level security;

revoke all on table public.zoho_oauth_pending_grants from public, anon, authenticated;
grant all on table public.zoho_oauth_pending_grants to service_role;

comment on table public.zoho_oauth_pending_grants is
  'Short-lived service-only OAuth grants awaiting explicit Zoho Books organization selection.';

-- A browser can be closed before the administrator chooses an organization.
-- Delete expired/abandoned secrets automatically; authorization also checks
-- expires_at, so this is secret-retention hygiene rather than the access gate.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'zoho-oauth-pending-cleanup'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end $$;

select cron.schedule(
  'zoho-oauth-pending-cleanup',
  '*/15 * * * *',
  $cron$
    delete from public.zoho_oauth_pending_grants
    where expires_at <= now()
       or (consumed_at is not null and consumed_at < now() - interval '15 minutes')
  $cron$
);
