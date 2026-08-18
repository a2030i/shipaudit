-- Reduce repeated Zoho detail reads while keeping the local mirror authoritative.
-- A payment is rechecked when it changes in the list/webhook, or when this
-- timestamp becomes older than the reconciliation TTL in zoho-sync.
alter table public.zoho_payments
  add column if not exists unused_checked_at timestamptz;

comment on column public.zoho_payments.unused_checked_at is
  'Last successful detailed Zoho verification of unused_amount; cleared when the payment changes.';

create index if not exists zoho_payments_unused_recheck_idx
  on public.zoho_payments (unused_checked_at asc nulls first, zoho_id)
  where unused_amount > 0.01;

-- VAT is a reporting snapshot, not an operational invoice feed. Refresh it
-- four times daily instead of calling Zoho every 30 minutes.
do $$
declare
  vat_job_id bigint;
begin
  select jobid into vat_job_id
  from cron.job
  where jobname = 'zoho-vat-refresh'
  limit 1;

  if vat_job_id is not null then
    perform cron.alter_job(vat_job_id, schedule := '17 */6 * * *');
  end if;
end;
$$;
