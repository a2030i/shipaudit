-- Customer balance integrity: never infer an opening balance from a missing
-- invoice in the local Zoho mirror.  The configured opening balance is read
-- explicitly from Zoho and any remaining difference is treated as a sync gap.

alter table public.zoho_contacts
  add column if not exists opening_balance_configured numeric,
  add column if not exists opening_balance_checked_at timestamptz;

comment on column public.zoho_contacts.opening_balance_configured is
  'Opening balance explicitly returned by Zoho contact details; null means not checked yet.';
comment on column public.zoho_contacts.opening_balance_checked_at is
  'When the explicit Zoho opening balance was last verified.';

create index if not exists zoho_invoices_customer_id_open_idx
  on public.zoho_invoices (customer_id)
  where balance > 0.5;

create or replace view public.customer_ar
with (security_invoker = true) as
select
  c.contact_name,
  c.zoho_id,
  coalesce(c.outstanding_receivable, 0)::numeric as total_due,
  coalesce(inv.invoiced_due, 0::numeric) as invoiced_due,
  round(
    least(
      greatest(calc.balance_residual, 0),
      greatest(coalesce(c.opening_balance_configured, 0), 0)
    ),
    2
  ) as opening_due,
  coalesce(inv.open_count, 0::bigint) as open_invoices,
  inv.oldest_invoice_date,
  coalesce(inv.days_oldest, 0) as days_oldest,
  coalesce(c.unused_credits_receivable, 0)::numeric as unused_credits,
  c.status,
  round(least(greatest(coalesce(c.outstanding_receivable, 0), 0), greatest(coalesce(c.unused_credits_receivable, 0), 0)), 2) as credit_offset,
  round(greatest(coalesce(c.outstanding_receivable, 0) - greatest(coalesce(c.unused_credits_receivable, 0), 0), 0), 2) as collectible_due,
  round(greatest(coalesce(c.unused_credits_receivable, 0) - greatest(coalesce(c.outstanding_receivable, 0), 0), 0), 2) as credit_surplus,
  (coalesce(c.outstanding_receivable, 0) > 0.5 and coalesce(c.unused_credits_receivable, 0) > 0.005) as needs_zoho_settlement,
  c.opening_balance_configured,
  c.opening_balance_checked_at,
  calc.balance_residual,
  round(greatest(calc.balance_residual - greatest(coalesce(c.opening_balance_configured, 0), 0), 0), 2) as balance_sync_gap,
  round(greatest(-calc.balance_residual, 0), 2) as balance_sync_overage,
  case
    when abs(calc.balance_residual) <= 0.5 then 'valid'
    when c.opening_balance_checked_at is null then 'unchecked'
    when calc.balance_residual - greatest(coalesce(c.opening_balance_configured, 0), 0) > 0.5 then 'mismatch'
    when -calc.balance_residual > 0.5 then 'mismatch'
    else 'valid'
  end as balance_integrity_status
from public.zoho_contacts c
left join lateral (
  select
    coalesce(sum(i.balance), 0)::numeric as invoiced_due,
    count(*) as open_count,
    min(i.date) as oldest_invoice_date,
    current_date - min(i.date) as days_oldest
  from public.zoho_invoices i
  where (
      i.customer_id = c.zoho_id
      or (i.customer_id is null and i.customer_name = c.contact_name)
    )
    and i.balance > 0.5
) inv on true
cross join lateral (
  select round(coalesce(c.outstanding_receivable, 0) - coalesce(inv.invoiced_due, 0), 2) as balance_residual
) calc
where c.contact_type = 'customer';

comment on view public.customer_ar is
  'Zoho customer balance truth. opening_due is capped by the explicit Zoho opening balance; balance_sync_gap identifies missing/stale mirrored documents.';

grant select on public.customer_ar to authenticated;

create or replace view public.customer_balance_integrity_issues
with (security_invoker = true) as
select
  contact_name,
  zoho_id,
  total_due,
  invoiced_due,
  opening_balance_configured,
  balance_residual,
  balance_sync_gap,
  balance_sync_overage,
  balance_integrity_status,
  opening_balance_checked_at
from public.customer_ar
where balance_integrity_status <> 'valid';

comment on view public.customer_balance_integrity_issues is
  'Customers excluded from automated collection until Zoho contact and invoice balances reconcile.';

grant select on public.customer_balance_integrity_issues to authenticated;

-- Collection lines are emitted only after balance integrity is valid. This
-- protects manual campaigns and all daily/weekly agents that consume the view.
create or replace view public.customer_collectible_lines
with (security_invoker = true) as
with balances as (
  select
    ar.contact_name,
    ar.zoho_id as contact_id,
    greatest(coalesce(ar.opening_due, 0), 0)::numeric as opening_gross,
    greatest(coalesce(ar.unused_credits, 0), 0)::numeric as available_credit,
    least(
      greatest(coalesce(ar.opening_due, 0), 0),
      greatest(coalesce(ar.unused_credits, 0), 0)
    )::numeric as opening_credit,
    greatest(
      greatest(coalesce(ar.unused_credits, 0), 0) - greatest(coalesce(ar.opening_due, 0), 0),
      0
    )::numeric as invoice_credit
  from public.customer_ar ar
  where ar.balance_integrity_status = 'valid'
), invoice_base as (
  select
    b.contact_name,
    b.contact_id,
    i.zoho_id as line_id,
    i.invoice_number,
    i.date as line_date,
    coalesce(i.due_date, i.date) as due_date,
    i.status,
    i.balance::numeric as gross_amount,
    b.invoice_credit,
    coalesce(sum(i.balance::numeric) over (
      partition by b.contact_id
      order by coalesce(i.due_date, i.date), i.date, i.zoho_id
      rows between unbounded preceding and 1 preceding
    ), 0)::numeric as prior_gross
  from balances b
  join public.zoho_invoices i on (
    i.customer_id = b.contact_id
    or (i.customer_id is null and i.customer_name = b.contact_name)
  )
  where i.balance > 0.5
), invoice_lines as (
  select
    contact_name,
    contact_id,
    'invoice'::text as line_kind,
    line_id,
    invoice_number,
    line_date,
    due_date,
    status,
    gross_amount,
    least(gross_amount, greatest(invoice_credit - prior_gross, 0))::numeric as allocated_credit
  from invoice_base
), opening_lines as (
  select
    contact_name,
    contact_id,
    'opening_balance'::text as line_kind,
    null::text as line_id,
    null::text as invoice_number,
    date '2026-01-10' as line_date,
    date '2026-01-10' as due_date,
    'opening_balance'::text as status,
    opening_gross as gross_amount,
    opening_credit as allocated_credit
  from balances
  where opening_gross > 0.005
)
select
  contact_name,
  contact_id,
  line_kind,
  line_id,
  invoice_number,
  line_date,
  due_date,
  status,
  round(gross_amount, 2) as gross_amount,
  round(allocated_credit, 2) as allocated_credit,
  round(greatest(gross_amount - allocated_credit, 0), 2) as collectible_amount,
  greatest(current_date - due_date, 0)::int as age_days
from (
  select * from opening_lines
  union all
  select * from invoice_lines
) lines;

comment on view public.customer_collectible_lines is
  'Read-only FIFO collection projection. It excludes unresolved Zoho balance gaps and applies unused credit to explicit opening balance first, then oldest invoices.';

grant select on public.customer_collectible_lines to authenticated;
